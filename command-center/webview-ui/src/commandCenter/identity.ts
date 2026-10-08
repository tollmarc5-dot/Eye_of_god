import type { TelemetrySnapshot } from '../../../core/src/telemetry.js';

/** Shown wherever the server has not reported a value. Never replaced by a guess. */
export const NOT_AVAILABLE = 'No disponible';

export type AgentRole = 'Lead' | 'Teammate' | 'Sub-agent' | 'Session';

/**
 * The name a person reads. Prefers what the agent was really called: a
 * teammate's name, then Claude Code's own session title, then the project.
 * The stable identity is always `uid`, never this string.
 */
export function displayName(telemetry: TelemetrySnapshot | null, id: number): string {
  return telemetry?.agentName ?? telemetry?.title ?? telemetry?.projectName ?? `Agente ${id}`;
}

export function roleOf(telemetry: TelemetrySnapshot | null): AgentRole {
  if (!telemetry) return 'Session';
  if (telemetry.isTeamLead) return 'Lead';
  if (telemetry.leadAgentId !== null) return 'Teammate';
  return 'Session';
}

export function shortSession(sessionId: string | null | undefined): string {
  return sessionId ? sessionId.slice(0, 8) : NOT_AVAILABLE;
}

/** `/Users/me/Desktop/x` → `~/Desktop/x` (display only). */
export function compactPath(path: string | null | undefined): string {
  if (!path) return NOT_AVAILABLE;
  return path.replace(/^\/(Users|home)\/[^/]+/, '~');
}

export function formatClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NOT_AVAILABLE;
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/** `20:42` — timeline and clock. */
export function formatShortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/** `8 OCT 2026` — command bar date. */
export function formatDay(ms: number): string {
  return new Date(ms)
    .toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    .replace('.', '')
    .toUpperCase();
}

/** `01:07` / `1:02:07` — elapsed time of the running tool. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
