import { memo, useMemo, useState } from 'react';

import type { ActivityEntry } from '../../../core/src/messages.js';
import { activityIcon, prettyToolName } from './iconNames.js';
import { Icon } from './icons.js';
import { displayName, formatClock, formatShortTime } from './identity.js';
import type { AgentRecord } from './telemetryStore.js';

const KIND_TITLE: Record<ActivityEntry['kind'], string> = {
  prompt: 'Prompt',
  thinking: 'Pensando',
  reply: 'Respuesta',
  tool: 'Herramienta',
  tool_error: 'Error de herramienta',
  subagent: 'Sub-agente',
  permission: 'Permiso',
  waiting_input: 'Esperando',
  turn_end: 'Turno completado',
  api_error: 'Error de API',
};

/** Merged timeline rows never exceed this (the per-agent buffer is already capped). */
const GLOBAL_TIMELINE_MAX = 200;

interface Row {
  key: string;
  entry: ActivityEntry;
  agent: string | null;
}

function timelineTitle(entry: ActivityEntry): string {
  return entry.kind === 'tool' && entry.toolName
    ? prettyToolName(entry.toolName)
    : KIND_TITLE[entry.kind];
}

/** Drops a leading "Tool:" so the detail line does not repeat the title. */
function timelineDetail(entry: ActivityEntry): string {
  if (entry.toolName && entry.label.startsWith(`${entry.toolName}:`)) {
    return entry.label.slice(entry.toolName.length + 1).trim();
  }
  return entry.label;
}

interface ActivityTimelineProps {
  agents: readonly AgentRecord[];
  selectedId: number | null;
}

/**
 * The live timeline: the selected agent's real events, or — with nothing
 * selected — every agent's events merged by time. Pausing freezes the view
 * (the store keeps receiving); resuming jumps back to live.
 */
export const ActivityTimeline = memo(function ActivityTimeline({
  agents,
  selectedId,
}: ActivityTimelineProps) {
  const [live, setLive] = useState(true);
  const [frozen, setFrozen] = useState<Row[] | null>(null);
  const selected = selectedId !== null ? agents.find((a) => a.id === selectedId) : undefined;

  const rows = useMemo<Row[]>(() => {
    if (selected) {
      return [...selected.activity]
        .reverse()
        .map((entry) => ({ key: `${selected.id}:${entry.seq}`, entry, agent: null }));
    }
    const merged: Row[] = [];
    for (const record of agents) {
      const name = displayName(record.telemetry, record.id);
      for (const entry of record.activity) {
        merged.push({ key: `${record.id}:${entry.seq}`, entry, agent: name });
      }
    }
    merged.sort((a, b) => b.entry.ts - a.entry.ts || b.entry.seq - a.entry.seq);
    return merged.slice(0, GLOBAL_TIMELINE_MAX);
  }, [agents, selected]);

  const shown = live ? rows : (frozen ?? rows);

  const toggleLive = () => {
    setFrozen(live ? rows : null);
    setLive(!live);
  };

  return (
    <section className="cc-panel cc-timeline-panel" aria-label="Línea de tiempo">
      <div className="cc-panel__head">
        <h2 className="cc-panel__title">
          LÍNEA DE TIEMPO
          {!selected && <span className="cc-panel__scope">· TODOS</span>}
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={live}
          className={`cc-live-toggle${live ? ' is-on' : ''}`}
          onClick={toggleLive}
          title={live ? 'Pausar la vista' : 'Volver al directo'}
        >
          En vivo
          <span className="cc-live-toggle__knob" aria-hidden="true" />
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="cc-empty">Sin actividad registrada.</div>
      ) : (
        <ol className="cc-timeline cc-scroll">
          {shown.map(({ key, entry, agent }) => (
            <li key={key} className={`cc-event cc-event--${entry.kind}`}>
              <time
                className="cc-event__time"
                dateTime={new Date(entry.ts).toISOString()}
                title={formatClock(entry.ts)}
              >
                {formatShortTime(entry.ts)}
              </time>
              <span className="cc-event__dot" aria-hidden="true" />
              <span className="cc-event__icon">
                <Icon name={activityIcon(entry)} size={14} />
              </span>
              <span className="cc-event__text">
                <span className="cc-event__title" title={entry.toolName ?? undefined}>
                  {timelineTitle(entry)}
                  {agent && <span className="cc-event__agent"> · {agent}</span>}
                </span>
                <span className="cc-event__label">{timelineDetail(entry)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});
