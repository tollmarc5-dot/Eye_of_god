import { memo, useEffect, useMemo, useState } from 'react';

import type { IconName } from './iconNames.js';
import { Icon } from './icons.js';
import { formatClock, formatDay, formatShortTime } from './identity.js';
import type { CommandCenterSnapshot, ConnectionMode } from './telemetryStore.js';

interface CommandBarProps {
  snapshot: CommandCenterSnapshot;
  /** Claude hooks actually installed (hooksStatus), not the preference. */
  hooksInstalled: boolean;
  subagentCount: number;
  onOpenSettings: () => void;
}

const CONNECTION_COPY: Record<ConnectionMode, { label: string; hint: string }> = {
  live: {
    label: 'EN VIVO',
    hint: 'Conectado al servidor de Pixel Agents: cada cambio llega en el momento.',
  },
  last_known: {
    label: 'ÚLTIMO ESTADO',
    hint: 'Conexión perdida. Se muestra el último estado recibido; reconectando automáticamente.',
  },
  offline: { label: 'SIN CONEXIÓN', hint: 'Sin conexión con el servidor de Pixel Agents.' },
  connecting: { label: 'CONECTANDO', hint: 'Esperando a que el servidor envíe su estado.' },
};

interface Counter {
  key: string;
  label: string;
  value: number;
  tone: string;
  icon: IconName;
}

/** Wall clock for the bar; ticks every second without re-rendering anything else. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const Clock = memo(function Clock() {
  const now = useNow();
  return (
    <div className="cc-clock">
      <span className="cc-clock__time">{formatShortTime(now)}</span>
      <span className="cc-clock__date">{formatDay(now)}</span>
    </div>
  );
});

export const CommandBar = memo(function CommandBar({
  snapshot,
  hooksInstalled,
  subagentCount,
  onOpenSettings,
}: CommandBarProps) {
  const { agents, connection, lastMessageAt } = snapshot;

  const counters = useMemo<Counter[]>(() => {
    const tally = { active: 0, thinking: 0, waiting: 0, permission: 0, error: 0, done: 0 };
    for (const agent of agents) {
      const status = agent.telemetry?.status;
      if (status === 'active' || status === 'tool') tally.active++;
      else if (status === 'thinking') tally.thinking++;
      else if (status === 'waiting_input') tally.waiting++;
      else if (status === 'permission') tally.permission++;
      else if (status === 'error') tally.error++;
      else if (status === 'done') tally.done++;
    }
    return [
      { key: 'agents', label: 'AGENTES', value: agents.length, tone: 'total', icon: 'agents' },
      { key: 'active', label: 'ACTIVOS', value: tally.active, tone: 'active', icon: 'bolt' },
      {
        key: 'thinking',
        label: 'PENSANDO',
        value: tally.thinking,
        tone: 'thinking',
        icon: 'spark',
      },
      {
        key: 'waiting',
        label: 'ESPERANDO',
        value: tally.waiting,
        tone: 'waiting',
        icon: 'hourglass',
      },
      {
        key: 'permission',
        label: 'PERMISO',
        value: tally.permission,
        tone: 'permission',
        icon: 'lock',
      },
      { key: 'error', label: 'ERRORES', value: tally.error, tone: 'error', icon: 'alert' },
      { key: 'done', label: 'HECHOS', value: tally.done, tone: 'done', icon: 'check' },
      { key: 'subs', label: 'SUB-AGENTES', value: subagentCount, tone: 'subs', icon: 'branch' },
    ];
  }, [agents, subagentCount]);

  const copy = CONNECTION_COPY[connection];

  return (
    <header className="cc-bar" role="banner">
      <div className="cc-bar__brand">
        <span className="cc-bar__eye" aria-hidden="true" />
        <div>
          <div className="cc-bar__title">AI COMMAND CENTER</div>
          <div className="cc-bar__subtitle">EYE OF GOD</div>
        </div>
      </div>

      <dl className="cc-bar__counters">
        {counters.map((c) => (
          <div
            key={c.key}
            className={`cc-counter cc-counter--${c.tone}${c.value > 0 ? ' is-lit' : ''}`}
          >
            <span className="cc-counter__icon">
              <Icon name={c.icon} size={18} />
            </span>
            <span className="cc-counter__text">
              <dt>{c.label}</dt>
              <dd>{c.value}</dd>
            </span>
          </div>
        ))}
      </dl>

      <div className="cc-bar__right">
        <div
          className={`cc-conn cc-conn--${connection}`}
          role="status"
          aria-live="polite"
          title={`${copy.hint}${lastMessageAt ? ` Último mensaje ${formatClock(lastMessageAt)}.` : ''}`}
        >
          <span className="cc-conn__row">
            <span className="cc-conn__dot cc-conn__dot--system" aria-hidden="true" />
            SISTEMA
          </span>
          <span className="cc-conn__row">
            <span className="cc-conn__dot" aria-hidden="true" />
            {copy.label}
          </span>
        </div>
        <Clock />
        <span
          className={`cc-bar__icon${hooksInstalled ? ' is-on' : ''}`}
          title={
            hooksInstalled
              ? 'Hooks de Claude Code instalados: permisos y fin de turno llegan al instante.'
              : 'Hooks no instalados: los permisos se deducen del ritmo de la transcripción.'
          }
          aria-label={hooksInstalled ? 'Hooks activos' : 'Hooks inactivos'}
          role="img"
        >
          <Icon name="hooks" size={18} />
        </span>
        <button
          type="button"
          className="cc-bar__icon cc-bar__icon--btn"
          onClick={onOpenSettings}
          aria-label="Ajustes"
          title="Ajustes"
        >
          <Icon name="gear" size={18} />
        </button>
      </div>
    </header>
  );
});
