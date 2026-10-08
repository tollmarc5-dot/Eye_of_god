import type { TelemetryStatus } from '../../../core/src/telemetry.js';

/**
 * Real status per agent id, as last reported by the server. Written by the
 * telemetry store, read by the canvas renderer every frame. Kept dependency-free
 * so the renderer never pulls in the transport.
 */
const statuses = new Map<number, TelemetryStatus>();
const errorCounts = new Map<number, number>();

export function setLiveStatus(id: number, status: TelemetryStatus, errorCount = 0): void {
  statuses.set(id, status);
  errorCounts.set(id, errorCount);
}

export function deleteLiveStatus(id: number): void {
  statuses.delete(id);
  errorCounts.delete(id);
}

export function clearLiveStatuses(): void {
  statuses.clear();
  errorCounts.clear();
}

/** Real failures (tool errors + API errors) reported for an agent so far. */
export function getLiveErrorCount(id: number): number {
  return errorCounts.get(id) ?? 0;
}

/** Null when the server has not reported this agent: draw nothing rather than guess. */
export function getLiveStatus(id: number): TelemetryStatus | null {
  return statuses.get(id) ?? null;
}
