import type { TelemetryStatus } from '../../../core/src/telemetry.js';

/** How each real status reads in the command center. */
export interface StatusView {
  label: string;
  /** One line on what the real status means. */
  description: string;
  /** CSS modifier: `cc-status--<tone>`. */
  tone: string;
  /** Sort weight: what needs attention first. */
  urgency: number;
}

const VIEWS: Record<TelemetryStatus, StatusView> = {
  permission: {
    label: 'PERMISO',
    description: 'Esperando tu autorización',
    tone: 'permission',
    urgency: 0,
  },
  error: { label: 'ERROR', description: 'Necesita atención', tone: 'error', urgency: 1 },
  waiting_input: {
    label: 'ESPERANDO',
    description: 'Esperando tu respuesta',
    tone: 'waiting',
    urgency: 2,
  },
  tool: {
    label: 'EJECUTANDO',
    description: 'Ejecutando una herramienta',
    tone: 'tool',
    urgency: 3,
  },
  thinking: {
    label: 'PENSANDO',
    description: 'El modelo está generando',
    tone: 'thinking',
    urgency: 4,
  },
  active: { label: 'ACTIVO', description: 'Trabajando', tone: 'active', urgency: 5 },
  done: { label: 'HECHO', description: 'Turno completado', tone: 'done', urgency: 6 },
  unknown: {
    label: 'SIN DATOS',
    description: 'El servidor no ha informado su estado',
    tone: 'unknown',
    urgency: 7,
  },
};

export function statusView(status: TelemetryStatus | null | undefined): StatusView {
  return VIEWS[status ?? 'unknown'] ?? VIEWS.unknown;
}

/** Statuses counted as "working" in the global ACTIVE counter. */
export function isWorking(status: TelemetryStatus | null | undefined): boolean {
  return status === 'active' || status === 'thinking' || status === 'tool';
}
