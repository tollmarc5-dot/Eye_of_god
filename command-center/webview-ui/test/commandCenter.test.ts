/// <reference lib="dom" />
/// <reference types="vite/client" />
/**
 * Command-center state: the telemetry store (what the server reported, and how
 * fresh it is), the observable office selection, and the display helpers.
 * The transport is faked at the module boundary so no socket is opened.
 *
 * Run with: npm test
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const stateHandlers = new Set<() => void>();
  return {
    state: 'connected' as string,
    stateHandlers,
    setState(next: string) {
      this.state = next;
      for (const h of stateHandlers) h();
    },
  };
});

vi.mock('../src/transport/index.js', () => ({
  transport: {
    get state() {
      return fake.state;
    },
    onMessage: () => () => {},
    onStateChange: (handler: () => void) => {
      fake.stateHandlers.add(handler);
      return () => fake.stateHandlers.delete(handler);
    },
    send: () => {},
  },
}));

const { getLiveStatus } = await import('../src/commandCenter/liveStatus.js');
const { applyServerMessage, readCommandCenter, resetTelemetryStore } =
  await import('../src/commandCenter/telemetryStore.js');
const { displayName, roleOf, NOT_AVAILABLE, compactPath } =
  await import('../src/commandCenter/identity.js');
const { statusView, isWorking } = await import('../src/commandCenter/status.js');
const { OfficeState } = await import('../src/office/engine/officeState.js');

type Msg = Parameters<typeof applyServerMessage>[0];
const msg = (m: Record<string, unknown>) => m as unknown as Msg;

function telemetry(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'claude:sess-1',
    agentId: 1,
    sessionId: 'sess-1',
    providerId: 'claude',
    title: null,
    model: null,
    cwd: null,
    projectDir: '/p',
    projectName: null,
    gitBranch: null,
    cliVersion: null,
    startedAt: null,
    lastActivityAt: null,
    status: 'active',
    currentActivity: null,
    currentTask: null,
    currentTaskSource: null,
    tools: {},
    files: [],
    commands: [],
    errorCount: 0,
    errors: [],
    contextTokens: 0,
    maxContextTokens: 0,
    teamName: null,
    agentName: null,
    isTeamLead: false,
    leadAgentId: null,
    childAgentIds: [],
    ...overrides,
  };
}

const entry = (seq: number, label: string) => ({ seq, ts: 1000 + seq, kind: 'tool', label });

describe('telemetry store', () => {
  beforeEach(() => {
    fake.state = 'connected';
    resetTelemetryStore();
  });

  test('is "connecting" until the server has sent its state, then "live"', () => {
    expect(readCommandCenter().connection).toBe('connecting');
    applyServerMessage(
      msg({ type: 'existingAgents', agents: [1], agentMeta: {}, folderNames: {} }),
    );
    expect(readCommandCenter().connection).toBe('live');
  });

  test('keeps the last known state when the connection drops, and says so', () => {
    applyServerMessage(
      msg({ type: 'existingAgents', agents: [1], agentMeta: {}, folderNames: {} }),
    );
    applyServerMessage(
      msg({ type: 'agentTelemetry', id: 1, telemetry: telemetry({ status: 'tool' }) }),
    );
    fake.setState('reconnecting');
    const snap = readCommandCenter();
    expect(snap.connection).toBe('last_known');
    expect(snap.agents[0]?.telemetry?.status).toBe('tool');
    fake.setState('connected');
    expect(readCommandCenter().connection).toBe('live');
  });

  test('is "offline" when nothing was ever received and the socket is down', () => {
    fake.state = 'disconnected';
    expect(readCommandCenter().connection).toBe('offline');
  });

  test('a (re)connect handshake drops agents that ended while away', () => {
    applyServerMessage(
      msg({ type: 'existingAgents', agents: [1, 2], agentMeta: {}, folderNames: {} }),
    );
    applyServerMessage(
      msg({ type: 'agentTelemetry', id: 2, telemetry: telemetry({ agentId: 2 }) }),
    );
    expect(getLiveStatus(2)).toBe('active');
    applyServerMessage(
      msg({ type: 'existingAgents', agents: [1], agentMeta: {}, folderNames: {} }),
    );
    expect(readCommandCenter().agents.map((a) => a.id)).toEqual([1]);
    expect(getLiveStatus(2)).toBeNull();
  });

  test('appends activity by sequence, ignoring entries it already holds, and resets on snapshot', () => {
    applyServerMessage(
      msg({ type: 'agentActivity', id: 1, entries: [entry(1, 'a'), entry(2, 'b')], reset: true }),
    );
    applyServerMessage(
      msg({ type: 'agentActivity', id: 1, entries: [entry(2, 'b'), entry(3, 'c')], reset: false }),
    );
    expect(readCommandCenter().agents[0]?.activity.map((e) => e.label)).toEqual(['a', 'b', 'c']);
    applyServerMessage(
      msg({ type: 'agentActivity', id: 1, entries: [entry(9, 'z')], reset: true }),
    );
    expect(readCommandCenter().agents[0]?.activity.map((e) => e.label)).toEqual(['z']);
  });

  test('caps the timeline at 200 entries', () => {
    const many = Array.from({ length: 250 }, (_, i) => entry(i + 1, `e${i + 1}`));
    applyServerMessage(msg({ type: 'agentActivity', id: 1, entries: many, reset: true }));
    const activity = readCommandCenter().agents[0]?.activity ?? [];
    expect(activity).toHaveLength(200);
    expect(activity[0]?.label).toBe('e51');
  });

  test('an agent with no reported status has no live status (the renderer draws nothing)', () => {
    applyServerMessage(msg({ type: 'agentCreated', id: 5 }));
    expect(readCommandCenter().agents[0]?.telemetry).toBeNull();
    expect(getLiveStatus(5)).toBeNull();
    applyServerMessage(msg({ type: 'agentClosed', id: 5 }));
    expect(readCommandCenter().agents).toHaveLength(0);
  });
});

describe('office selection', () => {
  afterEach(() => vi.restoreAllMocks());

  test('notifies subscribers on every change and only on change', () => {
    const os = new OfficeState();
    const listener = vi.fn();
    const unsubscribe = os.onSelectionChange(listener);
    os.selectedAgentId = 3;
    os.selectedAgentId = 3;
    os.selectedAgentId = null;
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    os.selectedAgentId = 4;
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('a manual pan releases the camera point target', () => {
    const os = new OfficeState();
    os.cameraPointTarget = { x: 10, y: 10 };
    os.cancelGreeterCamera();
    expect(os.cameraPointTarget).toBeNull();
  });
});

describe('display helpers', () => {
  test('names come from what the agent was really called, never a guess', () => {
    expect(displayName(null, 7)).toBe('Agente 7');
    expect(displayName(telemetry({ projectName: 'inventario-mhd' }) as never, 1)).toBe(
      'inventario-mhd',
    );
    expect(displayName(telemetry({ title: 'Auth work', projectName: 'x' }) as never, 1)).toBe(
      'Auth work',
    );
    expect(displayName(telemetry({ agentName: 'researcher', title: 'T' }) as never, 1)).toBe(
      'researcher',
    );
  });

  test('roles follow the team semantics of Pixel Agents', () => {
    expect(roleOf(telemetry({ isTeamLead: true }) as never)).toBe('Lead');
    expect(roleOf(telemetry({ leadAgentId: 1 }) as never)).toBe('Teammate');
    expect(roleOf(telemetry() as never)).toBe('Session');
  });

  test('missing values read "Not available"', () => {
    expect(compactPath(null)).toBe(NOT_AVAILABLE);
    expect(compactPath('/Users/me/Desktop/x')).toBe('~/Desktop/x');
  });

  test('status views and the working group', () => {
    expect(statusView('permission').label).toBe('PERMISO');
    expect(statusView(null).label).toBe('SIN DATOS');
    expect(isWorking('tool')).toBe(true);
    expect(isWorking('done')).toBe(false);
  });
});
