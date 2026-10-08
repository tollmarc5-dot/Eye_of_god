# AI Command Center (Eye of God)

A fork of [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) v1.4.1
that turns the office into a live operations center for real Claude Code
agents. Everything on screen comes from the agents themselves — their JSONL
transcripts and Claude Code hooks — through the existing Pixel Agents server.
There is no mock data, no simulated activity and no polling.

```
Claude Code ─┬─ JSONL transcripts ─→ FileWatcher → TranscriptParser ─┐
             └─ hooks (POST /api/hooks/claude) → HookEventHandler ───┤
                                                                     ↓
                                   AgentRuntime → AgentStateStore ──→ AgentTelemetry
                                                         │                 │
                                                  broadcasts (WebSocket /ws)
                                                         ↓
                    Command center: top bar · workforce · office canvas · inspector
```

## Run it

```bash
cd ~/Desktop/Eye-of-god/pixel-agents-command-center
npm install
npm run build
npm start            # = node dist/cli.js --port 3100
```

The server prints a URL with a token, e.g.
`http://127.0.0.1:3100/?token=…`. Open **that** URL: the token is what lets
the page approve or remove the Claude Code hooks (treat it as a secret; it
changes on every start). Without the token the page still shows everything.

Leave the server running; any Claude Code session (interactive or `claude -p`)
appears in the office as soon as it writes its transcript. "Watch All
Sessions" (Settings) adopts sessions from every project, not only the
current folder.

### Hooks

Claude Code hooks make permission prompts, turn ends and sub-agent starts
arrive instantly instead of being inferred from transcript timing. They are
installed through Pixel Agents' own consent step (first-run intro or
Settings → Instant Detection), which adds 12 hook events to
`~/.claude/settings.json` (a backup is kept as
`settings.json.pixel-agents.backup`) and copies the hook script to
`~/.pixel-agents/hooks/claude-hook.js`. The script posts to whichever server
`~/.pixel-agents/server.json` names, so only run one server at a time (stop
any `npx pixel-agents` first). The top bar shows `HOOKS ON/OFF` from the
actual install state.

## What was added to Pixel Agents

| Area                                                                                                                                                                             | Files                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Telemetry tracker (model, cwd, project, branch, session start, last activity, live status, current activity/task, tools, files, commands, errors, relations, 200-entry timeline) | `server/src/agentTelemetry.ts`, wired in `agentStateStore.ts`, `transcriptParser.ts`, `cli.ts`, VS Code adapter |
| Protocol: `agentTelemetry`, `agentActivity` (+ `ActivityEntry`, `ActivityKind`)                                                                                                  | `core/asyncapi.yaml` → `core/src/messages.ts` (generated), `core/src/telemetry.ts`                              |
| Handshake snapshot (telemetry + timeline) for every connecting client                                                                                                            | `server/src/clientMessageHandler.ts` step 9                                                                     |
| Reconnect: re-handshake after a dropped socket, prune agents that ended meanwhile                                                                                                | `webview-ui/src/hooks/useExtensionMessages.ts`                                                                  |
| Shutdown no longer reports every agent as closed to connected clients                                                                                                            | `server/src/cli.ts`                                                                                             |
| Command-center UI (top bar, workforce tree, inspector + timeline, camera nav)                                                                                                    | `webview-ui/src/commandCenter/*`                                                                                |
| Observable selection, camera point target                                                                                                                                        | `webview-ui/src/office/engine/officeState.ts`                                                                   |
| Status rings, monitor light, selection beam                                                                                                                                      | `webview-ui/src/office/engine/commandCenterFx.ts`                                                               |
| HQ layout (8 zones) + server rack / holo table / data wall / neon sign assets                                                                                                    | `scripts/command-center/generate_hq.py` → `webview-ui/public/assets/`                                           |

### Status model

The server derives one status per agent from the runtime's own broadcasts:

| Status          | Source                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `active`        | `agentStatus: active`                                                                                                    |
| `thinking`      | a `thinking` block in the agent's newest assistant record                                                                |
| `tool`          | `agentToolStart` until `agentToolDone` / `agentToolsClear`                                                               |
| `permission`    | `agentToolPermission` (hooks: `PermissionRequest`) until approved, the prompted call returns, or a different call starts |
| `waiting_input` | `agentStatus: waiting` with `awaitingInput`                                                                              |
| `done`          | `agentStatus: waiting`, or an adopted transcript whose newest turn ended                                                 |
| `error`         | an API-error record (`isApiErrorMessage`) until the next turn                                                            |
| `unknown`       | nothing reported yet — shown as **SIN DATOS**, never guessed                                                             |

Transcript history seeds the timeline (with each record's own timestamp)
but never sets the live status. Fields nothing has reported render as
**No disponible** (the UI is in Spanish).

### Relations

Pixel Agents' semantics are used unchanged: a **Lead** spawned named
**Teammates** (each an agent with its own seat), and any agent can run
unnamed **Sub-agents** (characters around their parent, no session of their
own). The workforce list shows them as a tree; the inspector links lead ⇄
teammates and sub-agent → parent.

## Living world

The office sits inside a space station drawn in the same frame as the office
(`webview-ui/src/office/engine/space/`). The rule: **ambient may be
procedural, work must be real.**

**Ambient (procedural, independent of agents):** three parallax star layers
with twinkling, drifting nebulae, a slowly rotating galaxy, two planets with
rotating surfaces (one ringed, one with an orbiting moon), tumbling asteroids,
an occasional ship with an engine trail, shooting stars, drifting dust, and a
station hull with a neon edge and beacons. Detailed art is pre-rendered once;
a frame blits images plus a few hundred pixels.

**Agents (real status only):** with command-center behaviour on
(`setCommandCenterBehaviour`), the character state machine follows the
status the server reports:

| Status            | Character                                                                        | Effects                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool` / `active` | walks (BFS path, interpolated) to its seat and types or reads — by the real tool | station light, energy particles, a hologram by tool: read (Read/Grep/Glob), code (Edit/Write), terminal (Bash), web (WebSearch/WebFetch/MCP), agent (Task/Agent) |
| `thinking`        | stays seated, still                                                              | orbs circling the head                                                                                                                                           |
| `permission`      | stays seated, still, even if the runtime marks it inactive                       | amber lock badge, amber light                                                                                                                                    |
| `waiting_input`   | stays seated, still                                                              | magenta "?" badge                                                                                                                                                |
| `error`           | stays seated, still                                                              | red alert badge, flickering red light, red wave                                                                                                                  |
| `done`            | stands up, steps 2–4 tiles away once, rests                                      | completion burst on the transition                                                                                                                               |
| no status         | stays where it is                                                                | nothing                                                                                                                                                          |

Agents never wander aimlessly. A ripple marks the moment an agent starts
working; a red wave marks each real tool failure (the error count rising).
Live sub-agents are joined to their parent by a flowing holographic link;
teammates to their lead while either is selected. The always-on labels show
only agents with a live status, and their text comes from that status.

**Zones react:** each zone's floor brightens with the number of agents really
working inside it and fades back when they stop.

**Status semantics the visuals rely on** (server, `agentTelemetry.ts`):
`thinking` = the turn is open, nothing is running and the newest main-chain
record is the user's (a prompt or a tool result) — the model is generating.
A tool finishing therefore moves `tool → thinking`. `AskUserQuestion` is
`waiting_input` (its dialog also fires `PermissionRequest`, which does not
turn it into `permission`). A running tool owns the status over the runtime's
generic `active`.

## Interface (v2)

The world fills the screen; the chrome floats over it as glass panels
(`webview-ui/src/commandCenter/`). Everything in it is real telemetry.

- **Top bar:** AGENTES / ACTIVOS / PENSANDO / ESPERANDO / PERMISO / ERRORES /
  HECHOS / SUB-AGENTES counters (icons light up when non-zero), SISTEMA +
  connection state (EN VIVO / ÚLTIMO ESTADO / SIN CONEXIÓN), wall clock and
  date, hooks indicator, settings.
- **Agentes:** search (name, project, title, uid), filters (todos / trabajando /
  atención / hechos), rows with the agent's own sprite, coloured status and
  its real current activity; teammates and sub-agents nested.
- **Inspector** (tabs Información / Actividad / Archivos): model, project,
  branch, folder, start, last activity, context gauge (tokens / window, %),
  **Herramienta actual** — the newest real tool event while the status is
  tool / permission / waiting, with its elapsed time counted from that
  event — state + description, current task, team, session, CLI version,
  UID and VER EN EL GRAFO. Context with no reported usage reads No disponible.
- **Línea de tiempo:** the selected agent's events, or every agent's merged
  by time when nothing is selected; icon per real tool; **En vivo** pauses
  the view without dropping events. MCP tools are shown as
  `<tool> · <server>` (raw name in the tooltip).
- **In-world signage:** every zone carries a neon sign (title + Spanish
  subtitle) on its wall; the sign burns brighter and reads `N AGENTES
ACTIVOS` only while agents really work there. Zones have a neon trim and
  floor plating. The command deck's holo table projects a rotating galaxy —
  ambient art whose intensity and spin follow the zone's real activity.
- **VISTA GENERAL** frames the station in the gap between the panels at a
  whole zoom (it rounds up past 0.6 of a step), so on a Retina screen the
  station fills the view; the planets and galaxy sit in the visible strips.

## Zones

The bundled layout (`default-layout-2.json`, 46×30, 32 seats) defines eight
layout **Areas**: COMMAND CENTER, ENGINEERING, RESEARCH, DESIGN, MARKETING,
AUTOMATION, DATA, OPERATIONS. Map a project folder to a zone with the
existing editor (Layout → Areas → folder mapping); new agents from that
folder take a seat in that zone. Nothing forces an agent into a zone.
Regenerate the layout and assets with `npm run hq:generate`; an existing
`~/.pixel-agents/layout.json` with a lower `layoutRevision` is replaced by
the bundled one on the next start (Pixel Agents' normal reset path).

## Graph integration (Eye of God)

Every agent carries a stable **uid**: `claude:<sessionId>` (teammates that
share their lead's session: `claude:<sessionId>:<agentName>`). It is never a
display name. The original ids are kept alongside it (`agentId` — the Pixel
Agents runtime id — and `sessionId`).

- **VIEW IN OFFICE** (graph → office): open
  `http://127.0.0.1:3100/?token=…&agent=<uid>`; the office selects that agent
  and flies the camera to it once it is present.
- **VIEW IN GRAPH** (office → graph): build the webview with
  `VITE_EYE_OF_GOD_GRAPH_URL=<graph url>`; the inspector button then opens
  `<graph url>?agent=<uid>`. Unset, the button is disabled. The graph side
  still has to create agent nodes keyed by the same uid — not implemented yet.

## Verification (2026-10-07, real sessions)

- Agents appear/disappear: a headless `claude -p` session was adopted within
  seconds with its own AI title, and left the office when it ended.
- Live state and activity: `Reading notes.txt → Running: ls -la → Subtask →
Running: wc -l → Running: sleep 8 → Writing summary.txt`, status
  ACTIVE ⇄ TOOL, then DONE.
- Sub-agent: a Task spawn showed up under its parent and the SUB-AGENTS counter
  went 0 → 1 → 0.
- Hooks: `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop` received.
- Reconnect: stopping the server shows `LAST KNOWN STATE` with the agents still
  listed; restarting returns to `LIVE` without a reload.
- Performance: 60 fps (p95 17.6 ms/frame) in the browser; the tracker handles
  ~2 µs per record with 30 agents and keeps every buffer bounded.

## Verification — living world (2026-10-08, real sessions)

- Full flow (`claude -p`, Haiku): read → `ls` → a blocked `ls` (real
  `PermissionRequest`, auto-denied in `-p`, shown as a tool error + red wave)
  → edit → Task sub-agent (appeared under its parent) → finish.
- Simultaneous real sessions, each showing only its own state:
  THINKING (story being generated), TOOL (70–95 s foreground compute),
  WAITING (interactive session in `AskUserQuestion`), DONE (interactive
  session after its reply); after Claude Code's own idle notification the
  interactive ones moved to "Waiting for your input".
- Sub-agent: a real Task sub-agent sat beside its parent, listed as
  "Sub-agent of …", SUB-AGENTS counter 1 → 0.
- Performance: with 15 real agents, the full universe and all effects, the
  page left 88 % of the main thread idle (≈4 ms of work per frame). The
  test browser itself was capped at 30 Hz (an empty page measured 30 fps too).
- Tests: server 567, webview 111 (status-driven behaviour, hologram mapping,
  status labels, telemetry semantics).

## Verification — v2 interface (2026-10-08, real sessions)

Four real Claude Code sessions (Haiku) at once, observed every 2.5 s in a
devicePixelRatio-2 browser:

- **Full flow** (`claude -p`): Read → `ls -la` → sandbox-blocked `ls`
  (real tool error, real `PermissionRequest` hook, auto-denied) → Edit
  (`beta`→`BETA`) → Task sub-agent **Verify edit** (appeared nested, then
  left) → 45 s `python3` loop → DONE. The agent read **EJECUTANDO** for the
  whole loop.
- **Simultaneous:** EJECUTANDO (flow), PENSANDO (a story being generated),
  ESPERANDO (interactive session asking via AskUserQuestion), HECHO (a
  `READY` reply) — each on its own character, counters matching.
- Selection → camera follow, inspector and per-agent timeline; no page scroll.
- 60.3 fps measured at devicePixelRatio 2 with the whole universe running.

**Bug found and fixed:** a denied call fires `PreToolUse` +
`PermissionRequest` but never `PostToolUse`, so its hook id stayed "live"
and pinned the agent to PERMISSION for the rest of the turn (seen on the
45 s loop). The tracker now ties a prompt to the calls in flight when it was
raised, treats the transcript echo of the same call as part of it, and ends
it when one of those calls returns or a different call starts (tests in
`agentTelemetry.test.ts`).

## Known limits

- Rendering is Pixel Agents' top-down 3/4 view with integer zoom (pixel-perfect);
  it is not a true isometric engine.
- Zone assignment per individual agent (agent → zone) is not built yet; mapping
  is per project folder.
- Tool and file lists cover what the tracker has seen since adoption plus the
  last 256 KB of the transcript, not the whole session.
- Sub-agents report active/idle only; they have no transcript of their own.
- Interactive Claude Code sessions in this CLI version can be hooks-only (no
  transcript): they appear on their first hook event but are not
  re-discovered after a server restart until they emit another hook.
- Claude Code's Bash tool blocks a bare foreground `sleep`; that is the CLI's
  behaviour, not the office's.
- The base Pixel Agents hover label still reads "Idle" for agents without a
  live status (the upstream e2e suite asserts on that text).
- On a 1× (non-Retina) screen VISTA GENERAL frames the station at 1×, which
  leaves it small; zoom in with the + control.
