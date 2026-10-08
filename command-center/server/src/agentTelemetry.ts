import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ActivityEntry, ActivityKind } from '../../core/src/messages.js';
import type {
  CommandRun,
  ErrorEntry,
  FileTouch,
  TelemetrySnapshot,
  TelemetryStatus,
} from '../../core/src/telemetry.js';
import {
  TELEMETRY_ACTIVITY_MAX,
  TELEMETRY_BROADCAST_THROTTLE_MS,
  TELEMETRY_COMMANDS_MAX,
  TELEMETRY_ERRORS_MAX,
  TELEMETRY_FILES_MAX,
  TELEMETRY_LABEL_MAX,
  TELEMETRY_PROCESSING_RECENT_MS,
  TELEMETRY_SEED_HEAD_BYTES,
  TELEMETRY_SEED_TAIL_BYTES,
  TELEMETRY_SEEN_UUIDS_MAX,
} from './constants.js';
import type { AgentState } from './types.js';

/**
 * Command-center telemetry: everything the inspector and the activity timeline
 * show about an agent, derived ONLY from what the agent actually produced —
 * its JSONL transcript records and the runtime's own status broadcasts. A
 * field nothing has reported stays null; nothing here is estimated or filled
 * in, so the UI can say "Not available" instead of guessing.
 */

/** Mutable per-agent runtime state behind a snapshot. */
interface TelemetryState {
  title: string | null;
  model: string | null;
  cwd: string | null;
  gitBranch: string | null;
  cliVersion: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  status: TelemetryStatus;
  currentActivity: string | null;
  todoTask: string | null;
  promptTask: string | null;
  tools: Map<string, number>;
  files: FileTouch[];
  commands: CommandRun[];
  /** tool_use id → its pending command entry, so the result can mark it ok/failed. */
  pendingCommands: Map<string, CommandRun>;
  /** tool_use id → tool name, to attribute tool_result errors. */
  toolNames: Map<string, string>;
  errorCount: number;
  errors: ErrorEntry[];
  activity: ActivityEntry[];
  nextSeq: number;
  /** Activity not yet sent to clients. */
  unsent: ActivityEntry[];
  /** Live tool ids from the runtime's broadcasts. */
  liveTools: Set<string>;
  /** Tools in flight when the current permission prompt was raised (the message names none). */
  permissionTools: Set<string>;
  /** Activity line of the prompted call: a start with the same line is its transcript echo. */
  permissionActivity: string | null;
  /** Record uuids already ingested: seeding and live watching may read the same lines. */
  seen: Set<string>;
  /** Once a file produced a main-chain record, sidechain records belong to its sub-agents. */
  sawMainChain: boolean;
  /** Whether the newest main-chain record seen closed the turn (from the transcript itself). */
  turnClosed: boolean | null;
  /** True while replaying history: records fill the timeline but never set the live status. */
  seeding: boolean;
  /** Who wrote the newest main-chain record: 'user' (prompt / tool result) means the model owes the next one. */
  lastMainType: 'user' | 'assistant' | null;
  /** Timestamp of that record (ms). */
  lastMainAt: number | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

type Broadcast = (message: Record<string, unknown>) => void;
type StatusFormatter = (toolName: string, input: Record<string, unknown>) => string;

const READ_TOOLS: ReadonlySet<string> = new Set(['Read']);
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);
const WRITE_TOOLS: ReadonlySet<string> = new Set(['Write']);
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Task', 'Agent']);
const ASK_USER_TOOL = 'AskUserQuestion';

function clip(text: string, max = TELEMETRY_LABEL_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Text of a user prompt, or null when the record is not one the user typed. */
function promptText(record: Record<string, unknown>): string | null {
  if (record.isMeta === true) return null;
  const message = record.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  let text: string | null = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const parts = content.filter(
      (block): block is { type: string; text: string } =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string',
    );
    if (parts.length === 0) return null;
    text = parts.map((part) => part.text).join(' ');
  }
  if (!text) return null;
  // Slash commands, command output and system reminders are not the user's task.
  if (/^\s*<(command-|local-command|system-reminder|task-notification)/.test(text)) return null;
  return text.trim() || null;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .join(' ');
  }
  return '';
}

function newState(): TelemetryState {
  return {
    title: null,
    model: null,
    cwd: null,
    gitBranch: null,
    cliVersion: null,
    startedAt: null,
    lastActivityAt: null,
    status: 'unknown',
    currentActivity: null,
    todoTask: null,
    promptTask: null,
    tools: new Map(),
    files: [],
    commands: [],
    pendingCommands: new Map(),
    toolNames: new Map(),
    errorCount: 0,
    errors: [],
    activity: [],
    nextSeq: 1,
    unsent: [],
    liveTools: new Set(),
    permissionTools: new Set(),
    permissionActivity: null,
    seen: new Set(),
    sawMainChain: false,
    turnClosed: null,
    seeding: false,
    lastMainType: null,
    lastMainAt: null,
    flushTimer: null,
  };
}

function pushBounded<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

/** Most recent first, one entry per path. */
function touchFile(state: TelemetryState, filePath: string, op: FileTouch['op'], ts: number): void {
  const rest = state.files.filter((file) => file.path !== filePath);
  state.files = [{ path: filePath, op, ts }, ...rest].slice(0, TELEMETRY_FILES_MAX);
}

/** The uid the graph and the office share for one agent. Never a display name alone. */
export function agentUid(
  agent: Pick<AgentState, 'sessionId' | 'providerId' | 'agentName' | 'leadAgentId'>,
): string {
  const base = `${agent.providerId ?? 'claude'}:${agent.sessionId}`;
  // Teammates can share their lead's session: the name disambiguates within it.
  return agent.agentName && agent.leadAgentId !== undefined ? `${base}:${agent.agentName}` : base;
}

export class AgentTelemetry {
  private readonly states = new Map<number, TelemetryState>();

  constructor(
    private readonly broadcast: Broadcast,
    private readonly getAgent: (id: number) => AgentState | undefined,
    private readonly listAgents: () => Iterable<[number, AgentState]>,
    private readonly formatStatus: StatusFormatter,
  ) {}

  private state(id: number): TelemetryState {
    let state = this.states.get(id);
    if (!state) {
      state = newState();
      this.states.set(id, state);
    }
    return state;
  }

  has(id: number): boolean {
    return this.states.has(id);
  }

  /** Starts tracking an agent and seeds it from what its transcript already holds. */
  track(id: number): void {
    this.state(id);
    this.seedFromTranscript(id);
  }

  remove(id: number): void {
    const state = this.states.get(id);
    if (state?.flushTimer) clearTimeout(state.flushTimer);
    this.states.delete(id);
  }

  dispose(): void {
    for (const id of [...this.states.keys()]) this.remove(id);
  }

  /**
   * Reads what the transcript already holds — its head for when the session
   * started and its tail for recent activity — so an agent adopted mid-session
   * shows its real recent history. Records keep their own timestamps.
   */
  seedFromTranscript(id: number): void {
    const agent = this.getAgent(id);
    if (!agent?.jsonlFile) return;
    let fd: number | null = null;
    const seedState = this.state(id);
    seedState.seeding = true;
    try {
      fd = fs.openSync(agent.jsonlFile, 'r');
      const size = fs.fstatSync(fd).size;
      const readSlice = (start: number, length: number): string => {
        const buffer = Buffer.alloc(length);
        const read = fs.readSync(fd as number, buffer, 0, length, start);
        return buffer.subarray(0, read).toString('utf8');
      };
      const headLines = readSlice(0, Math.min(size, TELEMETRY_SEED_HEAD_BYTES)).split('\n');
      if (size > TELEMETRY_SEED_HEAD_BYTES) headLines.pop(); // may be cut mid-line
      for (const line of headLines) this.ingestLine(id, line, { headOnly: true });

      const tailStart = Math.max(0, size - TELEMETRY_SEED_TAIL_BYTES);
      const tailLines = readSlice(tailStart, size - tailStart).split('\n');
      if (tailStart > 0) tailLines.shift(); // may start mid-line
      for (const line of tailLines) this.ingestLine(id, line);
      // An adopted session says what it is doing in its own transcript: its
      // newest turn ended (done), or it ends on a fresh prompt / tool result
      // the model is still answering (thinking). Otherwise unknown until the
      // runtime reports.
      if (seedState.status === 'unknown') {
        if (seedState.turnClosed === true) seedState.status = 'done';
        else if (this.isModelProcessing(seedState, Date.now())) seedState.status = 'thinking';
      }
    } catch {
      // Unreadable transcript: the agent simply has no seeded history.
    } finally {
      seedState.seeding = false;
      if (fd !== null) fs.closeSync(fd);
    }
    this.scheduleFlush(id);
  }

  private ingestLine(id: number, line: string, opts: { headOnly?: boolean } = {}): void {
    if (!line.trim()) return;
    try {
      const record: unknown = JSON.parse(line);
      if (isRecord(record)) this.ingestRecord(id, record, opts);
    } catch {
      // Malformed or partial line: nothing to learn from it.
    }
  }

  /** One transcript record. Safe to call twice for the same record (uuid de-duplication). */
  ingestRecord(
    id: number,
    record: Record<string, unknown>,
    opts: { headOnly?: boolean } = {},
  ): void {
    const state = this.state(id);
    const ts = parseTime(record.timestamp);
    if (ts !== null) {
      if (state.startedAt === null || ts < state.startedAt) state.startedAt = ts;
      if (!opts.headOnly && (state.lastActivityAt === null || ts > state.lastActivityAt)) {
        state.lastActivityAt = ts;
      }
    }
    if (typeof record.cwd === 'string') state.cwd = record.cwd;
    if (typeof record.gitBranch === 'string' && record.gitBranch)
      state.gitBranch = record.gitBranch;
    if (typeof record.version === 'string') state.cliVersion = record.version;
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string')
      state.title = clip(record.aiTitle);
    if (opts.headOnly) return;
    const uuid = typeof record.uuid === 'string' ? record.uuid : null;
    if (uuid) {
      if (state.seen.has(uuid)) return;
      state.seen.add(uuid);
      if (state.seen.size > TELEMETRY_SEEN_UUIDS_MAX) {
        const oldest = state.seen.values().next().value;
        if (oldest !== undefined) state.seen.delete(oldest);
      }
    }

    // Claude Code's own record of the latest prompt: the task when no prompt line is in view.
    if (record.type === 'last-prompt' && typeof record.lastPrompt === 'string') {
      const text = record.lastPrompt.trim();
      if (text && !/^\s*<(command-|local-command|system-reminder)/.test(text))
        state.promptTask = clip(text);
    }

    // Sidechain records in a lead's file are its sub-agents' turns, not its own.
    if (record.isSidechain === true && state.sawMainChain) return;
    if (record.isSidechain !== true && (record.type === 'user' || record.type === 'assistant')) {
      state.sawMainChain = true;
    }

    const at = ts ?? Date.now();
    this.trackTurnBoundary(state, record);
    if (record.type === 'assistant') this.ingestAssistant(id, state, record, at);
    else if (record.type === 'user') this.ingestUser(id, state, record, at);
    this.scheduleFlush(id);
  }

  /**
   * The model is generating right now: the turn is open, nothing is running,
   * and the newest record is the user's (a prompt or a tool result), recent
   * enough that the session is plausibly still alive.
   */
  /** Closes the open prompt and retires the calls it was raised for (a denied call never reports done). */
  private endPermission(state: TelemetryState): void {
    for (const toolId of state.permissionTools) state.liveTools.delete(toolId);
    state.permissionTools = new Set();
    state.permissionActivity = null;
  }

  private isModelProcessing(state: TelemetryState, now: number): boolean {
    return (
      state.turnClosed !== true &&
      state.liveTools.size === 0 &&
      state.lastMainType === 'user' &&
      state.lastMainAt !== null &&
      now - state.lastMainAt < TELEMETRY_PROCESSING_RECENT_MS
    );
  }

  private trackTurnBoundary(state: TelemetryState, record: Record<string, unknown>): void {
    if (record.isSidechain === true) return;
    if (record.type === 'user' || record.type === 'assistant') {
      state.lastMainType = record.type;
      state.lastMainAt = parseTime(record.timestamp) ?? Date.now();
    }
    if (record.type === 'system') {
      if (record.subtype === 'turn_duration' || record.subtype === 'stop_hook_summary')
        state.turnClosed = true;
      return;
    }
    if (record.type === 'user') {
      state.turnClosed = false;
      return;
    }
    if (record.type === 'assistant') {
      const message = isRecord(record.message) ? record.message : null;
      state.turnClosed = message?.stop_reason === 'end_turn';
    }
  }

  private ingestAssistant(
    id: number,
    state: TelemetryState,
    record: Record<string, unknown>,
    at: number,
  ): void {
    const message = isRecord(record.message) ? record.message : null;
    if (!message) return;
    if (typeof message.model === 'string' && message.model !== '<synthetic>')
      state.model = message.model;
    if (record.isApiErrorMessage === true) {
      const text = toolResultText(message.content) || 'API error';
      this.addError(state, at, null, text);
      this.addActivity(id, state, { ts: at, kind: 'api_error', label: clip(text) });
      if (!state.seeding) state.status = 'error';
      return;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'thinking') {
        this.addActivity(id, state, { ts: at, kind: 'thinking', label: 'Thinking' });
        if (!state.seeding && state.liveTools.size === 0 && state.status !== 'permission') {
          state.status = 'thinking';
        }
      } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        this.addActivity(id, state, { ts: at, kind: 'reply', label: clip(block.text) });
        // Writing a reply is the model producing output, not waiting on it.
        if (!state.seeding && state.status === 'thinking') state.status = 'active';
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        this.ingestToolUse(id, state, block, at);
      }
    }
  }

  private ingestToolUse(
    id: number,
    state: TelemetryState,
    block: Record<string, unknown>,
    at: number,
  ): void {
    const name = block.name as string;
    const input = isRecord(block.input) ? block.input : {};
    const toolId = typeof block.id === 'string' ? block.id : null;
    if (toolId) state.toolNames.set(toolId, name);
    state.tools.set(name, (state.tools.get(name) ?? 0) + 1);

    const filePath =
      typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.notebook_path === 'string'
          ? input.notebook_path
          : null;
    if (filePath) {
      if (READ_TOOLS.has(name)) touchFile(state, filePath, 'read', at);
      else if (EDIT_TOOLS.has(name)) touchFile(state, filePath, 'edit', at);
      else if (WRITE_TOOLS.has(name)) touchFile(state, filePath, 'write', at);
    }
    if (name === 'Bash' && typeof input.command === 'string') {
      const run: CommandRun = {
        command: clip(input.command, TELEMETRY_LABEL_MAX * 2),
        ts: at,
        ok: null,
      };
      pushBounded(state.commands, run, TELEMETRY_COMMANDS_MAX);
      if (toolId) state.pendingCommands.set(toolId, run);
    }
    if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      const current = input.todos.find((todo) => isRecord(todo) && todo.status === 'in_progress');
      state.todoTask =
        isRecord(current) && typeof current.content === 'string' ? clip(current.content) : null;
    }

    const label = clip(this.formatStatus(name, input));
    const kind: ActivityKind = SUBAGENT_TOOLS.has(name) ? 'subagent' : 'tool';
    this.addActivity(id, state, { ts: at, kind, label, toolName: name });
  }

  private ingestUser(
    id: number,
    state: TelemetryState,
    record: Record<string, unknown>,
    at: number,
  ): void {
    const message = isRecord(record.message) ? record.message : null;
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_result') continue;
        const toolId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
        const failed = block.is_error === true;
        const pending = toolId ? state.pendingCommands.get(toolId) : undefined;
        if (pending) {
          pending.ok = !failed;
          state.pendingCommands.delete(toolId as string);
        }
        if (failed) {
          const toolName = (toolId && state.toolNames.get(toolId)) || null;
          const text = clip(toolResultText(block.content) || 'Tool failed');
          this.addError(state, at, toolName, text);
          this.addActivity(id, state, {
            ts: at,
            kind: 'tool_error',
            label: toolName ? `${toolName} failed: ${text}` : text,
            toolName: toolName ?? undefined,
          });
        }
        if (toolId) state.toolNames.delete(toolId);
      }
    }
    const prompt = promptText(record);
    if (prompt) {
      state.promptTask = clip(prompt);
      state.todoTask = null;
      this.addActivity(id, state, { ts: at, kind: 'prompt', label: clip(prompt) });
      // A new prompt opens a turn: until the model writes something, it is processing.
      if (!state.seeding && state.liveTools.size === 0) state.status = 'thinking';
    }
  }

  private addError(
    state: TelemetryState,
    ts: number,
    toolName: string | null,
    message: string,
  ): void {
    state.errorCount++;
    pushBounded(state.errors, { ts, toolName, message: clip(message) }, TELEMETRY_ERRORS_MAX);
  }

  private addActivity(id: number, state: TelemetryState, entry: Omit<ActivityEntry, 'seq'>): void {
    const full: ActivityEntry = { ...entry, seq: state.nextSeq++ };
    pushBounded(state.activity, full, TELEMETRY_ACTIVITY_MAX);
    pushBounded(state.unsent, full, TELEMETRY_ACTIVITY_MAX);
    this.scheduleFlush(id);
  }

  /**
   * The runtime's own broadcasts are the authority on live status: tool
   * start/done, permission prompts and turn ends. Called for every message
   * the main store broadcasts.
   */
  observeBroadcast(message: Record<string, unknown>): void {
    const id = message.id;
    if (typeof id !== 'number' || !this.states.has(id)) return;
    const state = this.state(id);
    const now = Date.now();
    switch (message.type) {
      case 'agentToolStart':
        if (state.status === 'permission') {
          // The same call read back from the other channel (hook ⇄ transcript): still prompting.
          if (
            typeof message.toolId === 'string' &&
            typeof message.status === 'string' &&
            message.status === state.permissionActivity
          ) {
            state.liveTools.add(message.toolId);
            state.permissionTools.add(message.toolId);
            break;
          }
          // Claude Code runs one call at a time past a prompt: a different call starting
          // means the prompt was answered and the prompted call returned.
          this.endPermission(state);
        }
        if (typeof message.toolId === 'string') state.liveTools.add(message.toolId);
        if (typeof message.status === 'string') state.currentActivity = message.status;
        // AskUserQuestion is the agent stopping to ask you something: it waits, it does not work.
        state.status = message.toolName === ASK_USER_TOOL ? 'waiting_input' : 'tool';
        break;
      case 'agentToolDone': {
        const toolId = typeof message.toolId === 'string' ? message.toolId : null;
        // The prompted call returned (approved, denied or blocked): the prompt is over.
        if (state.status === 'permission' && toolId !== null && state.permissionTools.has(toolId)) {
          this.endPermission(state);
          state.status = state.liveTools.size > 0 ? 'tool' : 'thinking';
        }
        if (toolId !== null) state.liveTools.delete(toolId);
        // The tool returned and nothing else runs: the model is now processing its result.
        if (
          state.liveTools.size === 0 &&
          (state.status === 'tool' || state.status === 'waiting_input')
        ) {
          state.status = 'thinking';
          state.currentActivity = null;
        }
        break;
      }
      case 'agentToolsClear':
        state.liveTools.clear();
        this.endPermission(state);
        if (state.status === 'tool' || state.status === 'permission') state.status = 'active';
        break;
      case 'agentToolPermission':
        // AskUserQuestion's dialog rides the permission flow; the agent is still
        // waiting on an answer, not on an approval.
        if (state.status === 'waiting_input') break;
        state.status = 'permission';
        state.permissionTools = new Set(state.liveTools);
        state.permissionActivity = state.currentActivity;
        this.addActivity(id, state, {
          ts: now,
          kind: 'permission',
          label: state.currentActivity
            ? `Permission requested: ${state.currentActivity}`
            : 'Permission requested',
        });
        break;
      case 'agentToolPermissionClear':
        // Approved: the prompted call now runs, so its ids stay live.
        state.permissionTools = new Set();
        state.permissionActivity = null;
        state.status = state.liveTools.size > 0 ? 'tool' : 'active';
        break;
      case 'agentStatus':
        if (message.status === 'active') {
          // A running tool decides the status (tool / waiting on an answer / permission);
          // the generic "active" signal that accompanies it must not override it.
          if (state.liveTools.size === 0 && state.status !== 'thinking') {
            state.status = this.isModelProcessing(state, now) ? 'thinking' : 'active';
          }
        } else if (message.status === 'waiting') {
          state.liveTools.clear();
          state.currentActivity = null;
          const awaitingInput = message.awaitingInput === true;
          // An API error that ended the turn stays visible until the next turn starts.
          if (state.status !== 'error') state.status = awaitingInput ? 'waiting_input' : 'done';
          this.addActivity(id, state, {
            ts: now,
            kind: awaitingInput ? 'waiting_input' : 'turn_end',
            label: awaitingInput ? 'Waiting for your input' : 'Turn finished',
          });
        }
        break;
      default:
        return;
    }
    this.scheduleFlush(id);
  }

  snapshot(id: number): TelemetrySnapshot | null {
    const agent = this.getAgent(id);
    const state = this.states.get(id);
    if (!agent || !state) return null;
    const childAgentIds: number[] = [];
    for (const [otherId, other] of this.listAgents()) {
      if (other.leadAgentId === id) childAgentIds.push(otherId);
    }
    const currentTask = state.todoTask ?? state.promptTask;
    return {
      uid: agentUid(agent),
      agentId: id,
      sessionId: agent.sessionId,
      providerId: agent.providerId ?? 'claude',
      title: state.title,
      model: state.model,
      cwd: state.cwd,
      projectDir: agent.projectDir,
      projectName: state.cwd ? path.basename(state.cwd) : (agent.folderName ?? null),
      gitBranch: state.gitBranch,
      cliVersion: state.cliVersion,
      startedAt: state.startedAt,
      lastActivityAt: state.lastActivityAt,
      status: state.status,
      currentActivity: state.currentActivity,
      currentTask,
      currentTaskSource: state.todoTask ? 'todo' : state.promptTask ? 'prompt' : null,
      tools: Object.fromEntries(state.tools),
      files: state.files,
      commands: [...state.commands].reverse(),
      errorCount: state.errorCount,
      errors: [...state.errors].reverse(),
      contextTokens: agent.contextTokens,
      maxContextTokens: agent.maxContextTokens,
      teamName: agent.teamName ?? null,
      agentName: agent.agentName ?? null,
      isTeamLead: agent.isTeamLead === true,
      leadAgentId: agent.leadAgentId ?? null,
      childAgentIds,
    };
  }

  /** Every activity entry still buffered for an agent (snapshot for a connecting client). */
  activity(id: number): ActivityEntry[] {
    return [...(this.states.get(id)?.activity ?? [])];
  }

  /** Coalesces bursts (a turn can produce dozens of records per second) into one message pair. */
  private scheduleFlush(id: number): void {
    const state = this.states.get(id);
    if (!state || state.flushTimer) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      this.flush(id);
    }, TELEMETRY_BROADCAST_THROTTLE_MS);
  }

  flush(id: number): void {
    const state = this.states.get(id);
    const snapshot = this.snapshot(id);
    if (!state || !snapshot) return;
    this.broadcast({ type: 'agentTelemetry', id, telemetry: snapshot });
    if (state.unsent.length > 0) {
      this.broadcast({ type: 'agentActivity', id, entries: state.unsent, reset: false });
      state.unsent = [];
    }
  }
}
