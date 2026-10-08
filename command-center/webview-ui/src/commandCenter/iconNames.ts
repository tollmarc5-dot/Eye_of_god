import type { ActivityEntry } from '../../../core/src/messages.js';

/** Icons available to the command center chrome (see icons.tsx). */
export type IconName =
  | 'agents'
  | 'bolt'
  | 'spark'
  | 'hourglass'
  | 'lock'
  | 'alert'
  | 'check'
  | 'branch'
  | 'terminal'
  | 'file'
  | 'edit'
  | 'globe'
  | 'list'
  | 'chat'
  | 'reply'
  | 'cpu'
  | 'search'
  | 'close'
  | 'hooks'
  | 'gear';

/** Icon for a real tool name (same families as the in-world holograms). */
export function toolIcon(toolName: string | null | undefined): IconName {
  if (!toolName) return 'cpu';
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(toolName)) return 'file';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(toolName)) return 'edit';
  if (/^(Bash|BashOutput|KillShell)$/.test(toolName)) return 'terminal';
  if (/^(WebSearch|WebFetch)$/.test(toolName) || toolName.startsWith('mcp__')) return 'globe';
  if (/^(Task|Agent)$/.test(toolName)) return 'branch';
  if (toolName === 'TodoWrite') return 'list';
  if (toolName === 'AskUserQuestion') return 'chat';
  return 'cpu';
}

const KIND_ICON: Record<ActivityEntry['kind'], IconName> = {
  prompt: 'chat',
  thinking: 'spark',
  reply: 'reply',
  tool: 'cpu',
  tool_error: 'alert',
  subagent: 'branch',
  permission: 'lock',
  waiting_input: 'hourglass',
  turn_end: 'check',
  api_error: 'alert',
};

export function activityIcon(entry: ActivityEntry): IconName {
  return entry.kind === 'tool' ? toolIcon(entry.toolName) : KIND_ICON[entry.kind];
}

/**
 * Display form of a real tool name. MCP tools arrive as
 * `mcp__<server>__<tool>`; show `<tool> · <server>` (the raw name stays in titles).
 */
export function prettyToolName(toolName: string): string {
  if (!toolName.startsWith('mcp__')) return toolName;
  const parts = toolName.split('__');
  const tool = parts[parts.length - 1] ?? toolName;
  let server = (parts[1] ?? '').replace(/^plugin_/, '');
  const half = server.length / 2;
  // Plugin servers repeat their name ("playwright_playwright").
  if (Number.isInteger(half - 0.5) && server.slice(0, half - 0.5) === server.slice(half + 0.5)) {
    server = server.slice(0, half - 0.5);
  }
  return server ? `${tool} · ${server}` : tool;
}
