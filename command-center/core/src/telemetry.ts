/**
 * Command-center telemetry shapes shared by the server's tracker
 * (server/src/agentTelemetry.ts) and the webview's inspector. The wire
 * message `agentTelemetry` carries a TelemetrySnapshot as an opaque object
 * (see core/asyncapi.yaml); `ActivityEntry` is modeled in the contract itself.
 */

export type { ActivityEntry, ActivityKind } from './messages.js';

export type TelemetryStatus =
  'active' | 'thinking' | 'tool' | 'permission' | 'waiting_input' | 'done' | 'error' | 'unknown';

export interface FileTouch {
  path: string;
  op: 'read' | 'edit' | 'write';
  ts: number;
}

export interface CommandRun {
  command: string;
  ts: number;
  /** null until the tool result arrives. */
  ok: boolean | null;
}

export interface ErrorEntry {
  ts: number;
  toolName: string | null;
  message: string;
}

export interface TelemetrySnapshot {
  /** Stable cross-system id (office ⇄ graph ⇄ inspector): `<provider>:<sessionId>[:<agentName>]`. */
  uid: string;
  agentId: number;
  sessionId: string;
  providerId: string;
  title: string | null;
  model: string | null;
  cwd: string | null;
  projectDir: string;
  projectName: string | null;
  gitBranch: string | null;
  cliVersion: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  status: TelemetryStatus;
  currentActivity: string | null;
  currentTask: string | null;
  currentTaskSource: 'todo' | 'prompt' | null;
  tools: Record<string, number>;
  files: FileTouch[];
  commands: CommandRun[];
  errorCount: number;
  errors: ErrorEntry[];
  contextTokens: number;
  maxContextTokens: number;
  teamName: string | null;
  agentName: string | null;
  isTeamLead: boolean;
  leadAgentId: number | null;
  childAgentIds: number[];
}
