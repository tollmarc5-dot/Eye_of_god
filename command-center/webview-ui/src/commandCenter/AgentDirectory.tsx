import { memo, useMemo, useState } from 'react';

import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { AgentAvatar } from './AgentAvatar.js';
import { Icon } from './icons.js';
import { displayName } from './identity.js';
import { isWorking, statusView } from './status.js';
import type { AgentRecord } from './telemetryStore.js';

type Filter = 'all' | 'working' | 'attention' | 'done';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'TODOS' },
  { id: 'working', label: 'TRABAJANDO' },
  { id: 'attention', label: 'ATENCIÓN' },
  { id: 'done', label: 'HECHOS' },
];

interface AgentDirectoryProps {
  officeState: OfficeState;
  agents: readonly AgentRecord[];
  subagents: readonly SubagentCharacter[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function matchesFilter(filter: Filter, record: AgentRecord): boolean {
  const status = record.telemetry?.status;
  switch (filter) {
    case 'all':
      return true;
    case 'working':
      return isWorking(status);
    case 'attention':
      return status === 'permission' || status === 'waiting_input' || status === 'error';
    case 'done':
      return status === 'done';
  }
}

function matchesQuery(query: string, record: AgentRecord): boolean {
  if (!query) return true;
  const t = record.telemetry;
  const haystack = [displayName(t, record.id), t?.projectName, t?.agentName, t?.title, t?.uid]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

interface TreeNode {
  record: AgentRecord;
  depth: number;
}

/** Leads and solo sessions at the root, teammates under their lead (only real links). */
function buildTree(agents: readonly AgentRecord[]): TreeNode[] {
  const ids = new Set(agents.map((a) => a.id));
  const children = new Map<number, AgentRecord[]>();
  const roots: AgentRecord[] = [];
  for (const record of agents) {
    const lead = record.telemetry?.leadAgentId ?? null;
    if (lead !== null && ids.has(lead)) {
      children.set(lead, [...(children.get(lead) ?? []), record]);
    } else {
      roots.push(record);
    }
  }
  const out: TreeNode[] = [];
  const visit = (record: AgentRecord, depth: number) => {
    out.push({ record, depth });
    for (const child of children.get(record.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return out;
}

const AgentRow = memo(function AgentRow({
  officeState,
  record,
  depth,
  selected,
  onSelect,
  subagents,
  selectedId,
}: {
  officeState: OfficeState;
  record: AgentRecord;
  depth: number;
  selected: boolean;
  onSelect: (id: number) => void;
  subagents: readonly SubagentCharacter[];
  selectedId: number | null;
}) {
  const t = record.telemetry;
  const view = statusView(t?.status);
  const activity = t?.currentActivity ?? record.activity[record.activity.length - 1]?.label ?? null;
  return (
    <li className="cc-tree__item">
      <button
        type="button"
        className={`cc-agent${selected ? ' is-selected' : ''} cc-agent--${view.tone}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={() => onSelect(record.id)}
        aria-pressed={selected}
        title={t?.uid}
      >
        {depth > 0 && <span className="cc-agent__branch" aria-hidden="true" />}
        <span className="cc-agent__portrait">
          <AgentAvatar officeState={officeState} id={record.id} scale={1.5} dimmed={!t} />
        </span>
        <span className="cc-agent__body">
          <span className="cc-agent__name">
            {displayName(t, record.id)}
            {t?.isTeamLead && <span className="cc-agent__lead">LEAD</span>}
          </span>
          <span className={`cc-agent__status cc-status--${view.tone}`}>
            <span className="cc-dot" aria-hidden="true" />
            {view.label}
          </span>
          <span className="cc-agent__activity">{activity ?? 'Sin actividad registrada'}</span>
        </span>
      </button>
      {subagents.length > 0 && (
        <ul className="cc-tree">
          {subagents.map((sub) => {
            const active = officeState.characters.get(sub.id)?.isActive === true;
            const tone = active ? 'tool' : 'done';
            return (
              <li key={sub.id} className="cc-tree__item">
                <button
                  type="button"
                  className={`cc-agent cc-agent--sub${selectedId === sub.id ? ' is-selected' : ''} cc-agent--${tone}`}
                  style={{ paddingLeft: 10 + (depth + 1) * 16 }}
                  onClick={() => onSelect(sub.id)}
                  aria-pressed={selectedId === sub.id}
                >
                  <span className="cc-agent__branch" aria-hidden="true" />
                  <span className="cc-agent__portrait cc-agent__portrait--sm">
                    <AgentAvatar officeState={officeState} id={sub.id} scale={1.25} />
                  </span>
                  <span className="cc-agent__body">
                    <span className="cc-agent__name">{sub.label}</span>
                    <span className={`cc-agent__status cc-status--${tone}`}>
                      <span className="cc-dot" aria-hidden="true" />
                      {active ? 'SUB-AGENTE ACTIVO' : 'SUB-AGENTE INACTIVO'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
});

export const AgentDirectory = memo(function AgentDirectory({
  officeState,
  agents,
  subagents,
  selectedId,
  onSelect,
}: AgentDirectoryProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildTree(agents), [agents]);
  const subsByParent = useMemo(() => {
    const map = new Map<number, SubagentCharacter[]>();
    for (const sub of subagents)
      map.set(sub.parentAgentId, [...(map.get(sub.parentAgentId) ?? []), sub]);
    return map;
  }, [subagents]);
  const needle = query.trim().toLowerCase();
  const visible = tree.filter(
    (node) => matchesFilter(filter, node.record) && matchesQuery(needle, node.record),
  );

  return (
    <nav className="cc-panel cc-directory" aria-label="Agentes">
      <div className="cc-panel__head">
        <h2 className="cc-panel__title">
          AGENTES <span className="cc-panel__count">({agents.length})</span>
        </h2>
      </div>
      <label className="cc-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar agente..."
          aria-label="Buscar agente"
        />
      </label>
      <div className="cc-filters" role="tablist" aria-label="Filtrar agentes">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`cc-filter${filter === f.id ? ' is-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {agents.length === 0 ? (
        <div className="cc-empty">
          <div className="cc-empty__title">NINGUNA SESIÓN ACTIVA</div>
          <p>
            Esperando una sesión de Claude Code. Ejecuta <code>claude</code> en cualquier proyecto y
            aparecerá aquí en cuanto escriba su transcripción.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="cc-empty">Ningún agente coincide.</div>
      ) : (
        <ul className="cc-tree cc-scroll">
          {visible.map((node) => (
            <AgentRow
              key={node.record.id}
              officeState={officeState}
              record={node.record}
              depth={node.depth}
              selected={selectedId === node.record.id}
              onSelect={onSelect}
              subagents={subsByParent.get(node.record.id) ?? []}
              selectedId={selectedId}
            />
          ))}
        </ul>
      )}
    </nav>
  );
});
