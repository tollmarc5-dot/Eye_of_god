import { useSyncExternalStore } from 'react';

import {
  TRANSPORT_STATE_CONNECTED,
  TRANSPORT_STATE_DISCONNECTED,
} from '../../../core/src/constants.js';
import type { ActivityEntry, ServerMessage } from '../../../core/src/messages.js';
import type { TelemetrySnapshot } from '../../../core/src/telemetry.js';
import { ACTIVITY_BUFFER_MAX } from '../constants.js';
import { transport } from '../transport/index.js';
import { clearLiveStatuses, deleteLiveStatus, setLiveStatus } from './liveStatus.js';

/**
 * Command-center state: per-agent telemetry and timeline as the server reports
 * them, plus how fresh that picture is. Lives outside React (like OfficeState)
 * and is read through useSyncExternalStore, so a burst of events re-renders
 * only the panels that read it — never the office canvas.
 */

/**
 * - live: connected and the server has sent its full state.
 * - last_known: the connection dropped; what is shown is the last state received.
 * - offline: no connection and nothing was ever received.
 * - connecting: first connection in progress, nothing received yet.
 */
export type ConnectionMode = 'live' | 'last_known' | 'offline' | 'connecting';

export interface AgentRecord {
  id: number;
  /** Null until the server's tracker has reported this agent. */
  telemetry: TelemetrySnapshot | null;
  activity: readonly ActivityEntry[];
}

export interface CommandCenterSnapshot {
  agents: readonly AgentRecord[];
  connection: ConnectionMode;
  /** When the last message arrived from the server (ms since epoch), or null. */
  lastMessageAt: number | null;
}

const records = new Map<number, AgentRecord>();
const listeners = new Set<() => void>();
let receivedState = false;
let lastMessageAt: number | null = null;
let snapshot: CommandCenterSnapshot = { agents: [], connection: 'connecting', lastMessageAt: null };
let notifyScheduled = false;

function connectionMode(): ConnectionMode {
  if (transport.state === TRANSPORT_STATE_CONNECTED) return receivedState ? 'live' : 'connecting';
  if (receivedState) return 'last_known';
  return transport.state === TRANSPORT_STATE_DISCONNECTED ? 'offline' : 'connecting';
}

function rebuild(): void {
  snapshot = {
    agents: [...records.values()].sort((a, b) => a.id - b.id),
    connection: connectionMode(),
    lastMessageAt,
  };
}

/** Coalesces a burst of messages into one notification per frame. */
function changed(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  const run = () => {
    notifyScheduled = false;
    rebuild();
    for (const listener of listeners) listener();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function ensure(id: number): AgentRecord {
  const existing = records.get(id);
  if (existing) return existing;
  const created: AgentRecord = { id, telemetry: null, activity: [] };
  records.set(id, created);
  return created;
}

function mergeActivity(
  current: readonly ActivityEntry[],
  incoming: readonly ActivityEntry[],
  reset: boolean,
): ActivityEntry[] {
  if (reset) return incoming.slice(-ACTIVITY_BUFFER_MAX);
  const lastSeq = current.length > 0 ? current[current.length - 1].seq : 0;
  const fresh = incoming.filter((entry) => entry.seq > lastSeq);
  if (fresh.length === 0) return current as ActivityEntry[];
  return [...current, ...fresh].slice(-ACTIVITY_BUFFER_MAX);
}

/** Applies one server message; exported for tests. */
export function applyServerMessage(msg: ServerMessage): void {
  lastMessageAt = Date.now();
  switch (msg.type) {
    case 'existingAgents': {
      // The handshake lists every live agent: anything else ended while we were away.
      receivedState = true;
      const live = new Set(msg.agents);
      for (const id of [...records.keys()]) {
        if (!live.has(id)) {
          records.delete(id);
          deleteLiveStatus(id);
        }
      }
      for (const id of msg.agents) ensure(id);
      break;
    }
    case 'agentCreated':
      ensure(msg.id);
      break;
    case 'agentClosed':
      records.delete(msg.id);
      deleteLiveStatus(msg.id);
      break;
    case 'agentTelemetry': {
      const record = ensure(msg.id);
      const telemetry = msg.telemetry as unknown as TelemetrySnapshot;
      records.set(msg.id, { ...record, telemetry });
      setLiveStatus(msg.id, telemetry.status, telemetry.errorCount);
      break;
    }
    case 'agentActivity': {
      const record = ensure(msg.id);
      records.set(msg.id, {
        ...record,
        activity: mergeActivity(record.activity, msg.entries, msg.reset),
      });
      break;
    }
    default:
      return;
  }
  changed();
}

/** Clears everything; for tests only. */
export function resetTelemetryStore(): void {
  records.clear();
  clearLiveStatuses();
  receivedState = false;
  lastMessageAt = null;
  rebuild();
}

transport.onMessage(applyServerMessage);
transport.onStateChange(() => changed());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): CommandCenterSnapshot => snapshot;

export function useCommandCenter(): CommandCenterSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Current snapshot outside React (deep links, tests). */
export function readCommandCenter(): CommandCenterSnapshot {
  rebuild();
  return snapshot;
}
