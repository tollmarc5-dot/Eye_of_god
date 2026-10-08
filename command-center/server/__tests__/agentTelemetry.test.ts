import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { agentUid } from '../src/agentTelemetry.js';
import { formatToolStatus } from '../src/providers/hook/claude/claude.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    terminalRef: undefined,
    isExternal: false,
    projectDir: '/test',
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 1200,
    maxContextTokens: 200_000,
    ...overrides,
  } as AgentState;
}

const T0 = Date.parse('2026-10-07T19:57:41.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

function assistant(
  uuid: string,
  s: number,
  content: unknown[],
  extra: Record<string, unknown> = {},
) {
  const { message: messageExtra, ...recordExtra } = extra;
  return {
    type: 'assistant',
    uuid,
    timestamp: at(s),
    cwd: '/Users/me/Projects/inventario-mhd',
    gitBranch: 'main',
    version: '2.1.292',
    message: { model: 'claude-opus-5-5', content, ...((messageExtra as object) ?? {}) },
    ...recordExtra,
  };
}

function toolResult(uuid: string, s: number, toolUseId: string, isError = false, text = 'ok') {
  return {
    type: 'user',
    uuid,
    timestamp: at(s),
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: text }],
    },
  };
}

describe('AgentTelemetry', () => {
  let store: AgentStateStore;
  let sent: Record<string, unknown>[];

  beforeEach(() => {
    vi.useFakeTimers();
    store = new AgentStateStore();
    sent = [];
    store.on('broadcast', (m) => sent.push(m));
    store.enableTelemetry(formatToolStatus);
    store.set(1, createTestAgent());
  });

  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  const telemetry = () => {
    const t = store.telemetry;
    if (!t) throw new Error('telemetry not enabled');
    return t;
  };

  it('derives model, cwd, project, branch and timing from real records only', () => {
    const t = telemetry();
    expect(t.snapshot(1)).toMatchObject({
      model: null,
      cwd: null,
      startedAt: null,
      status: 'unknown',
    });

    t.ingestRecord(1, {
      type: 'user',
      uuid: 'u1',
      timestamp: at(0),
      message: { content: 'Implement authentication' },
    });
    t.ingestRecord(
      1,
      assistant('a1', 4, [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/p/package.json' } },
      ]),
    );

    expect(t.snapshot(1)).toMatchObject({
      uid: 'claude:sess-1',
      model: 'claude-opus-5-5',
      cwd: '/Users/me/Projects/inventario-mhd',
      projectName: 'inventario-mhd',
      gitBranch: 'main',
      cliVersion: '2.1.292',
      startedAt: T0,
      lastActivityAt: T0 + 4000,
      currentTask: 'Implement authentication',
      currentTaskSource: 'prompt',
      contextTokens: 1200,
    });
  });

  it('builds the timeline from tool uses with their real timestamps and labels', () => {
    const t = telemetry();
    t.ingestRecord(
      1,
      assistant('a1', 0, [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/p/package.json' } },
      ]),
    );
    t.ingestRecord(
      1,
      assistant('a2', 11, [
        { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/p/src/auth.ts' } },
      ]),
    );
    t.ingestRecord(
      1,
      assistant('a3', 20, [
        { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } },
      ]),
    );
    t.ingestRecord(1, toolResult('r3', 26, 't3'));

    const activity = t.activity(1);
    expect(activity.map((e) => [e.ts - T0, e.kind, e.label])).toEqual([
      [0, 'tool', 'Reading package.json'],
      [11_000, 'tool', 'Editing auth.ts'],
      [20_000, 'tool', 'Running: npm test'],
    ]);
    const snap = t.snapshot(1);
    expect(snap?.tools).toEqual({ Read: 1, Edit: 1, Bash: 1 });
    expect(snap?.files.map((f) => [f.path, f.op])).toEqual([
      ['/p/src/auth.ts', 'edit'],
      ['/p/package.json', 'read'],
    ]);
    expect(snap?.commands).toEqual([{ command: 'npm test', ts: T0 + 20_000, ok: true }]);
  });

  it('records tool failures as errors and marks the command failed', () => {
    const t = telemetry();
    t.ingestRecord(
      1,
      assistant('a1', 0, [
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
      ]),
    );
    t.ingestRecord(1, toolResult('r1', 3, 't1', true, '2 tests failed'));
    const snap = t.snapshot(1);
    expect(snap?.errorCount).toBe(1);
    expect(snap?.errors[0]).toMatchObject({ toolName: 'Bash', message: '2 tests failed' });
    expect(snap?.commands[0]?.ok).toBe(false);
    expect(t.activity(1).at(-1)).toMatchObject({
      kind: 'tool_error',
      label: 'Bash failed: 2 tests failed',
    });
  });

  it('prefers the in-progress todo over the prompt as the current task', () => {
    const t = telemetry();
    t.ingestRecord(1, {
      type: 'user',
      uuid: 'u1',
      timestamp: at(0),
      message: { content: 'Ship auth' },
    });
    t.ingestRecord(
      1,
      assistant('a1', 1, [
        {
          type: 'tool_use',
          id: 't1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Write tests', status: 'completed' },
              { content: 'Implement session middleware', status: 'in_progress' },
            ],
          },
        },
      ]),
    );
    expect(t.snapshot(1)).toMatchObject({
      currentTask: 'Implement session middleware',
      currentTaskSource: 'todo',
    });
  });

  it('ignores slash commands, meta records and duplicate lines', () => {
    const t = telemetry();
    const prompt = {
      type: 'user',
      uuid: 'u1',
      timestamp: at(0),
      message: { content: 'Real task' },
    };
    t.ingestRecord(1, prompt);
    t.ingestRecord(1, prompt);
    t.ingestRecord(1, {
      type: 'user',
      uuid: 'u2',
      timestamp: at(1),
      message: { content: '<command-name>/clear</command-name>' },
    });
    t.ingestRecord(1, {
      type: 'user',
      uuid: 'u3',
      timestamp: at(2),
      isMeta: true,
      message: { content: 'meta' },
    });
    expect(t.activity(1).filter((e) => e.kind === 'prompt')).toHaveLength(1);
    expect(t.snapshot(1)?.currentTask).toBe('Real task');
  });

  it("does not attribute a lead's sidechain records (its sub-agents) to the lead", () => {
    const t = telemetry();
    t.ingestRecord(1, assistant('a1', 0, [{ type: 'text', text: 'Delegating' }]));
    t.ingestRecord(
      1,
      assistant('a2', 1, [{ type: 'tool_use', id: 's1', name: 'Grep', input: { pattern: 'x' } }], {
        isSidechain: true,
      }),
    );
    expect(t.snapshot(1)?.tools).toEqual({});
  });

  it('follows the runtime broadcasts for live status', () => {
    const t = telemetry();
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    expect(t.snapshot(1)?.status).toBe('active');
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'x', status: 'Running: npm test' });
    expect(t.snapshot(1)).toMatchObject({ status: 'tool', currentActivity: 'Running: npm test' });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(t.snapshot(1)?.status).toBe('permission');
    expect(t.activity(1).at(-1)).toMatchObject({
      kind: 'permission',
      label: 'Permission requested: Running: npm test',
    });
    store.broadcast({ type: 'agentToolPermissionClear', id: 1 });
    expect(t.snapshot(1)?.status).toBe('tool');
    store.broadcast({ type: 'agentToolDone', id: 1, toolId: 'x' });
    // The tool returned: the model is processing its result.
    expect(t.snapshot(1)).toMatchObject({ status: 'thinking', currentActivity: null });
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true });
    expect(t.snapshot(1)).toMatchObject({ status: 'waiting_input', currentActivity: null });
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting' });
    expect(t.snapshot(1)?.status).toBe('done');
  });

  it('ends a permission once the tools it was raised for are gone', () => {
    const t = telemetry();
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'denied', status: 'Running: ls /x' });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(t.snapshot(1)?.status).toBe('permission');
    // The prompted tool returns (approved, denied or blocked): the model processes it.
    store.broadcast({ type: 'agentToolDone', id: 1, toolId: 'denied' });
    expect(t.snapshot(1)?.status).toBe('thinking');
    // A later tool is plain work — no stale permission latch (no clear was ever sent).
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'py', status: 'Running: python3' });
    expect(t.snapshot(1)?.status).toBe('tool');
  });

  it('a denied tool that never reports done does not pin the agent to PERMISSION', () => {
    // Real Claude Code -p run: PreToolUse + PermissionRequest for a sandbox-blocked
    // `ls`, then no PostToolUse for that hook id; the model moves on to the next tool.
    const t = telemetry();
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'hook-ls', status: 'Running: ls /x' });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(t.snapshot(1)?.status).toBe('permission');
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'hook-edit', status: 'Editing a' });
    expect(t.snapshot(1)?.status).toBe('tool');
    // The prompted call is retired: when the new tool returns, the model is thinking.
    store.broadcast({ type: 'agentToolDone', id: 1, toolId: 'hook-edit' });
    expect(t.snapshot(1)?.status).toBe('thinking');
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'hook-py', status: 'Running: py' });
    expect(t.snapshot(1)?.status).toBe('tool');
  });

  it('the transcript echo of the prompted call keeps the prompt open', () => {
    const t = telemetry();
    // Hook PreToolUse, then the prompt, then the same call read back from the JSONL.
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'hook-1', status: 'Running: rm x' });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'toolu_1', status: 'Running: rm x' });
    expect(t.snapshot(1)?.status).toBe('permission');
    // Denied: only the transcript reports the call done; the hook id never does.
    store.broadcast({ type: 'agentToolDone', id: 1, toolId: 'toolu_1' });
    expect(t.snapshot(1)?.status).toBe('thinking');
  });

  it('a permission raised with no tool in flight yields to the next real tool', () => {
    const t = telemetry();
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(t.snapshot(1)?.status).toBe('permission');
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'e', status: 'Editing a.ts' });
    expect(t.snapshot(1)?.status).toBe('tool');
  });

  it('treats AskUserQuestion as waiting for the user, not as work', () => {
    const t = telemetry();
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 'q',
      toolName: 'AskUserQuestion',
      status: 'Waiting for your answer',
    });
    // The runtime's generic "active" right after the tool start must not override it.
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    expect(t.snapshot(1)).toMatchObject({
      status: 'waiting_input',
      currentActivity: 'Waiting for your answer',
    });
    // Its dialog arrives as a permission prompt; the agent is still waiting on an answer.
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(t.snapshot(1)?.status).toBe('waiting_input');
    store.broadcast({ type: 'agentToolDone', id: 1, toolId: 'q' });
    expect(t.snapshot(1)?.status).toBe('thinking');
  });

  it('is thinking while the model processes a prompt, active once it writes', () => {
    const t = telemetry();
    t.ingestRecord(1, {
      type: 'user',
      uuid: 'u1',
      timestamp: at(0),
      message: { content: 'Plan the release' },
    });
    expect(t.snapshot(1)?.status).toBe('thinking');
    t.ingestRecord(1, assistant('a1', 3, [{ type: 'text', text: 'Here is the plan' }]));
    expect(t.snapshot(1)?.status).toBe('active');
  });

  it('coalesces bursts into one telemetry + activity broadcast pair', () => {
    const t = telemetry();
    sent.length = 0;
    t.ingestRecord(
      1,
      assistant('a1', 0, [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } },
      ]),
    );
    t.ingestRecord(
      1,
      assistant('a2', 1, [
        { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/b' } },
      ]),
    );
    expect(sent.filter((m) => m.type === 'agentTelemetry')).toHaveLength(0);
    vi.runOnlyPendingTimers();
    expect(sent.filter((m) => m.type === 'agentTelemetry')).toHaveLength(1);
    const activity = sent.filter((m) => m.type === 'agentActivity');
    expect(activity).toHaveLength(1);
    expect((activity[0]?.entries as unknown[]).length).toBe(2);
  });

  it('keeps at most 200 activity entries per agent', () => {
    const t = telemetry();
    for (let i = 0; i < 260; i++) {
      t.ingestRecord(1, assistant(`a${i}`, i, [{ type: 'text', text: `step ${i}` }]));
    }
    const activity = t.activity(1);
    expect(activity).toHaveLength(200);
    expect(activity[0]?.label).toBe('step 60');
  });

  it('stops tracking an agent when it is removed', () => {
    store.delete(1);
    expect(telemetry().snapshot(1)).toBeNull();
  });

  it('reports team relations from the store', () => {
    store.set(
      2,
      createTestAgent({ id: 2, sessionId: 'sess-2', agentName: 'researcher', leadAgentId: 1 }),
    );
    expect(telemetry().snapshot(1)?.childAgentIds).toEqual([2]);
    expect(telemetry().snapshot(2)).toMatchObject({ leadAgentId: 1, agentName: 'researcher' });
  });
});

describe('agentUid', () => {
  it('is provider + session, plus the name for a teammate sharing a session', () => {
    expect(
      agentUid({
        sessionId: 's',
        providerId: undefined,
        agentName: undefined,
        leadAgentId: undefined,
      }),
    ).toBe('claude:s');
    expect(
      agentUid({ sessionId: 's', providerId: 'claude', agentName: 'qa', leadAgentId: 1 }),
    ).toBe('claude:s:qa');
  });
});

describe('AgentTelemetry seeding from an adopted transcript', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeTranscript(records: unknown[]): string {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  }

  it('shows the real recent history and a finished turn as done', () => {
    const file = writeTranscript([
      { type: 'ai-title', aiTitle: 'Inventory auth' },
      { type: 'user', uuid: 'u1', timestamp: at(0), message: { content: 'Add login' } },
      assistant('a1', 2, [
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/p/auth.ts' } },
      ]),
      toolResult('r1', 3, 't1'),
      assistant('a2', 4, [{ type: 'thinking', thinking: '…' }]),
      assistant('a3', 5, [{ type: 'text', text: 'Done.' }], {
        message: { stop_reason: 'end_turn' },
      }),
      { type: 'system', subtype: 'turn_duration', uuid: 's1', timestamp: at(5) },
    ]);
    const store = new AgentStateStore();
    store.enableTelemetry(formatToolStatus);
    store.set(1, createTestAgent({ jsonlFile: file }));
    const snap = store.telemetry?.snapshot(1);
    expect(snap).toMatchObject({
      title: 'Inventory auth',
      status: 'done',
      currentTask: 'Add login',
    });
    // History fills the timeline (thinking included) but never sets the live status.
    expect(store.telemetry?.activity(1).map((e) => e.kind)).toEqual([
      'prompt',
      'tool',
      'thinking',
      'reply',
    ]);
    store.dispose();
  });

  it('shows an adopted session whose newest record is a fresh prompt as thinking', () => {
    const now = new Date().toISOString();
    const file = writeTranscript([
      { type: 'user', uuid: 'u1', timestamp: now, message: { content: 'Write a story' } },
    ]);
    const store = new AgentStateStore();
    store.enableTelemetry(formatToolStatus);
    store.set(1, createTestAgent({ jsonlFile: file }));
    expect(store.telemetry?.snapshot(1)?.status).toBe('thinking');
    store.dispose();
  });

  it('leaves the status unknown when the transcript does not show the turn ending', () => {
    const file = writeTranscript([
      { type: 'user', uuid: 'u1', timestamp: at(0), message: { content: 'Add login' } },
      assistant('a1', 2, [
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
      ]),
    ]);
    const store = new AgentStateStore();
    store.enableTelemetry(formatToolStatus);
    store.set(1, createTestAgent({ jsonlFile: file }));
    expect(store.telemetry?.snapshot(1)?.status).toBe('unknown');
    store.dispose();
  });
});
