import { memo, type ReactNode, useEffect, useState } from 'react';

import type { TelemetrySnapshot } from '../../../core/src/telemetry.js';
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { AgentAvatar } from './AgentAvatar.js';
import { prettyToolName, toolIcon } from './iconNames.js';
import { Icon } from './icons.js';
import {
  compactPath,
  displayName,
  formatClock,
  formatElapsed,
  formatTokens,
  NOT_AVAILABLE,
  roleOf,
  shortSession,
} from './identity.js';
import { statusView } from './status.js';
import type { AgentRecord } from './telemetryStore.js';

/** Where "VER EN EL GRAFO" points (Eye of God graph). Unset: the link is shown disabled. */
const GRAPH_URL: string | undefined = import.meta.env.VITE_EYE_OF_GOD_GRAPH_URL;

type Tab = 'info' | 'activity' | 'files';

const TABS: { id: Tab; label: string }[] = [
  { id: 'info', label: 'Información' },
  { id: 'activity', label: 'Actividad' },
  { id: 'files', label: 'Archivos' },
];

const ROLE_LABEL = {
  Lead: 'LÍDER',
  Teammate: 'COMPAÑERO',
  'Sub-agent': 'SUB-AGENTE',
  Session: 'SESIÓN',
};

/** Statuses during which the latest real tool event is still the running tool. */
const TOOL_RUNNING = new Set(['tool', 'permission', 'waiting_input']);

interface AgentInspectorProps {
  officeState: OfficeState;
  selectedId: number | null;
  agents: readonly AgentRecord[];
  subagents: readonly SubagentCharacter[];
  onSelect: (id: number) => void;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cc-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Missing() {
  return <span className="cc-missing">{NOT_AVAILABLE}</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cc-section">
      <h3 className="cc-section__title">{title}</h3>
      {children}
    </section>
  );
}

/** The running tool, from the newest real tool event; elapsed ticks locally. */
function CurrentTool({ record }: { record: AgentRecord }) {
  const t = record.telemetry;
  const running = t !== null && TOOL_RUNNING.has(t.status);
  const last = running
    ? [...record.activity].reverse().find((e) => e.kind === 'tool' || e.kind === 'subagent')
    : undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!last) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [last]);

  if (!t || !last) {
    return <div className="cc-tool cc-tool--idle">Ninguna herramienta en curso</div>;
  }
  const name = last.toolName ?? (last.kind === 'subagent' ? 'Agent' : 'Herramienta');
  return (
    <div className="cc-tool">
      <span className="cc-tool__icon">
        <Icon name={toolIcon(name)} size={18} />
      </span>
      <span className="cc-tool__text">
        <span className="cc-tool__name" title={name}>
          {prettyToolName(name)}
        </span>
        <span className="cc-tool__detail">{t.currentActivity ?? last.label}</span>
      </span>
      <time className="cc-tool__elapsed" title={`Desde ${formatClock(last.ts)}`}>
        {formatElapsed(now - last.ts)}
      </time>
    </div>
  );
}

function ContextGauge({ t }: { t: TelemetrySnapshot | null }) {
  // No usage reported yet (e.g. hooks-only sessions have no transcript): unknown, not 0%.
  if (!t || t.maxContextTokens <= 0 || t.contextTokens <= 0) return <Missing />;
  const pct = Math.min(100, (t.contextTokens / t.maxContextTokens) * 100);
  return (
    <span className="cc-gauge" title={`${t.contextTokens} / ${t.maxContextTokens} tokens`}>
      <span className="cc-gauge__nums">
        {formatTokens(t.contextTokens)} / {formatTokens(t.maxContextTokens)}
        <span className="cc-gauge__pct">{Math.round(pct)}%</span>
      </span>
      <span className="cc-gauge__bar">
        <span
          className={`cc-gauge__fill${pct > 80 ? ' is-high' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

function InfoTab({
  record,
  agents,
  onSelect,
}: {
  record: AgentRecord;
  agents: readonly AgentRecord[];
  onSelect: (id: number) => void;
}) {
  const t = record.telemetry;
  const view = statusView(t?.status);
  const lead = t?.leadAgentId != null ? agents.find((a) => a.id === t.leadAgentId) : undefined;
  const children = (t?.childAgentIds ?? [])
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is AgentRecord => a !== undefined);
  return (
    <>
      <dl className="cc-rows">
        <Row label="Modelo">{t?.model ?? <Missing />}</Row>
        <Row label="Proyecto">
          <span title={t?.cwd ?? undefined}>{t?.cwd ? compactPath(t.cwd) : <Missing />}</span>
        </Row>
        <Row label="Rama">{t?.gitBranch ?? <Missing />}</Row>
        <Row label="Carpeta">{t?.projectName ?? <Missing />}</Row>
        <Row label="Inicio">{t?.startedAt ? formatClock(t.startedAt) : <Missing />}</Row>
        <Row label="Última act.">
          {t?.lastActivityAt ? formatClock(t.lastActivityAt) : <Missing />}
        </Row>
        <Row label="Contexto">
          <ContextGauge t={t} />
        </Row>
      </dl>

      <Section title="Herramienta actual">
        <CurrentTool record={record} />
      </Section>

      <Section title="Estado">
        <div className={`cc-state cc-status--${view.tone}`}>
          <span className="cc-dot" aria-hidden="true" />
          <span>
            <span className="cc-state__label">{view.label}</span>
            <span className="cc-state__desc">{view.description}</span>
          </span>
        </div>
        {t?.currentTask && (
          <p className="cc-task">
            <span className="cc-task__src">
              {t.currentTaskSource === 'todo' ? 'Tarea (lista de tareas)' : 'Último prompt'}
            </span>
            {t.currentTask}
          </p>
        )}
      </Section>

      {(t?.teamName || lead || children.length > 0) && (
        <Section title={`Equipo${t?.teamName ? ` · ${t.teamName}` : ''}`}>
          <ul className="cc-relations">
            {lead && (
              <li>
                <span className="cc-relations__kind">LÍDER</span>
                <button type="button" className="cc-link" onClick={() => onSelect(lead.id)}>
                  {displayName(lead.telemetry, lead.id)}
                </button>
              </li>
            )}
            {children.map((child) => (
              <li key={child.id}>
                <span className="cc-relations__kind">COMPAÑERO</span>
                <button type="button" className="cc-link" onClick={() => onSelect(child.id)}>
                  {displayName(child.telemetry, child.id)}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <dl className="cc-rows cc-rows--meta">
        <Row label="Sesión">
          <span title={t?.sessionId}>{t ? shortSession(t.sessionId) : <Missing />}</span>
        </Row>
        <Row label="Claude Code">{t?.cliVersion ?? <Missing />}</Row>
        <Row label="UID">
          <code className="cc-uid">{t?.uid ?? <Missing />}</code>
        </Row>
      </dl>

      <div className="cc-actions">
        {GRAPH_URL && t ? (
          <a
            className="cc-btn"
            href={`${GRAPH_URL}${GRAPH_URL.includes('?') ? '&' : '?'}agent=${encodeURIComponent(t.uid)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            VER EN EL GRAFO
          </a>
        ) : (
          <button
            type="button"
            className="cc-btn"
            disabled
            title="Enlace al grafo no configurado (VITE_EYE_OF_GOD_GRAPH_URL)"
          >
            VER EN EL GRAFO
          </button>
        )}
      </div>
    </>
  );
}

function ActivityTab({ t }: { t: TelemetrySnapshot | null }) {
  const tools = t ? Object.entries(t.tools).sort((a, b) => b[1] - a[1]) : [];
  return (
    <>
      <Section title="Herramientas usadas">
        {tools.length === 0 ? (
          <Missing />
        ) : (
          <ul className="cc-tags">
            {tools.map(([name, count]) => (
              <li key={name} className="cc-tag">
                <Icon name={toolIcon(name)} size={12} />
                <span title={name}>{prettyToolName(name)}</span>
                <span className="cc-tag__count">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Comandos">
        {!t || t.commands.length === 0 ? (
          <Missing />
        ) : (
          <ul className="cc-list">
            {t.commands.slice(0, 12).map((cmd) => (
              <li key={`${cmd.ts}-${cmd.command}`} title={cmd.command}>
                <span
                  className={`cc-op cc-op--${cmd.ok === null ? 'running' : cmd.ok ? 'ok' : 'fail'}`}
                >
                  {cmd.ok === null ? 'EN CURSO' : cmd.ok ? 'OK' : 'FALLO'}
                </span>
                <code>{cmd.command}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`Errores · ${t?.errorCount ?? 0}`}>
        {!t || t.errors.length === 0 ? (
          <span className="cc-missing">Ninguno registrado</span>
        ) : (
          <ul className="cc-list">
            {t.errors.slice(0, 8).map((err) => (
              <li key={`${err.ts}-${err.message}`} className="cc-list__error">
                <time>{formatClock(err.ts)}</time> {err.toolName ? `${err.toolName}: ` : ''}
                {err.message}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

const OP_LABEL = { read: 'LEÍDO', edit: 'EDITADO', write: 'ESCRITO' } as const;

function FilesTab({ t }: { t: TelemetrySnapshot | null }) {
  if (!t || t.files.length === 0) {
    return <div className="cc-empty">Ningún archivo tocado en esta sesión.</div>;
  }
  return (
    <ul className="cc-list cc-list--files">
      {t.files.map((file) => (
        <li key={file.path} title={file.path}>
          <span className={`cc-op cc-op--${file.op}`}>{OP_LABEL[file.op]}</span>
          <span className="cc-list__path">{compactPath(file.path)}</span>
          <time>{formatClock(file.ts)}</time>
        </li>
      ))}
    </ul>
  );
}

function SubagentInspector({
  officeState,
  sub,
  parent,
  onSelect,
}: {
  officeState: OfficeState;
  sub: SubagentCharacter;
  parent: AgentRecord | undefined;
  onSelect: (id: number) => void;
}) {
  const active = officeState.characters.get(sub.id)?.isActive === true;
  const tone = active ? 'tool' : 'done';
  return (
    <>
      <div className="cc-hero">
        <span className="cc-hero__portrait">
          <AgentAvatar officeState={officeState} id={sub.id} scale={2.5} />
        </span>
        <div className="cc-hero__text">
          <h2 className="cc-hero__name">{sub.label}</h2>
          <span className={`cc-agent__status cc-status--${tone}`}>
            <span className="cc-dot" aria-hidden="true" />
            {active ? 'ACTIVO' : 'INACTIVO'}
          </span>
          <span className="cc-hero__role">SUB-AGENTE</span>
        </div>
      </div>
      <dl className="cc-rows">
        <Row label="Padre">
          {parent ? (
            <button type="button" className="cc-link" onClick={() => onSelect(parent.id)}>
              {displayName(parent.telemetry, parent.id)}
            </button>
          ) : (
            <Missing />
          )}
        </Row>
        <Row label="Sesión">Dentro de la sesión del padre (sin transcripción propia)</Row>
      </dl>
    </>
  );
}

export const AgentInspector = memo(function AgentInspector({
  officeState,
  selectedId,
  agents,
  subagents,
  onSelect,
  onClose,
}: AgentInspectorProps) {
  const [tab, setTab] = useState<Tab>('info');
  const record = agents.find((a) => a.id === selectedId);
  const sub =
    selectedId !== null && selectedId < 0 ? subagents.find((s) => s.id === selectedId) : undefined;

  let body: ReactNode;
  if (selectedId === null) {
    body = (
      <div className="cc-empty cc-empty--center">
        <div className="cc-empty__title">NINGÚN AGENTE SELECCIONADO</div>
        <p>Selecciona un personaje en la estación o un agente de la lista.</p>
      </div>
    );
  } else if (sub) {
    body = (
      <SubagentInspector
        officeState={officeState}
        sub={sub}
        parent={agents.find((a) => a.id === sub.parentAgentId)}
        onSelect={onSelect}
      />
    );
  } else if (!record) {
    body = (
      <div className="cc-empty cc-empty--center">
        <div className="cc-empty__title">AGENTE DESCONECTADO</div>
        <p>El servidor ya no informa de este agente.</p>
      </div>
    );
  } else {
    const t = record.telemetry;
    const view = statusView(t?.status);
    body = (
      <>
        <div className="cc-hero">
          <span className={`cc-hero__portrait cc-status--${view.tone}`}>
            <AgentAvatar officeState={officeState} id={record.id} scale={2.5} />
          </span>
          <div className="cc-hero__text">
            <h2 className="cc-hero__name">{displayName(t, record.id)}</h2>
            <span className={`cc-agent__status cc-status--${view.tone}`}>
              <span className="cc-dot" aria-hidden="true" />
              {view.label}
            </span>
            <span className="cc-hero__activity">{t?.currentActivity ?? view.description}</span>
            <span className="cc-hero__role">{ROLE_LABEL[roleOf(t)]}</span>
          </div>
        </div>
        <div className="cc-tabs" role="tablist" aria-label="Secciones del inspector">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`cc-tab${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="cc-tabpanel" role="tabpanel">
          {tab === 'info' && <InfoTab record={record} agents={agents} onSelect={onSelect} />}
          {tab === 'activity' && <ActivityTab t={t} />}
          {tab === 'files' && <FilesTab t={t} />}
        </div>
      </>
    );
  }

  return (
    <aside className="cc-panel cc-inspector" aria-label="Inspector">
      <div className="cc-panel__head">
        <h2 className="cc-panel__title">INSPECTOR</h2>
        {selectedId !== null && (
          <button
            type="button"
            className="cc-icon-btn"
            onClick={onClose}
            aria-label="Quitar selección"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="cc-scroll cc-inspector__body">{body}</div>
    </aside>
  );
});
