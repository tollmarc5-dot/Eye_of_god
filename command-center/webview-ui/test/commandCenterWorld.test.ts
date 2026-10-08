/// <reference lib="dom" />
/**
 * Command-center world: a character's real status drives what it does
 * (never aimless wandering, never animated work it is not doing), and the
 * effects pick their glyph from the real tool name.
 *
 * Run with: npm test
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { clearLiveStatuses, setLiveStatus } from '../src/commandCenter/liveStatus.js';
import {
  createCharacter,
  setCommandCenterBehaviour,
  updateCharacter,
} from '../src/office/engine/characters.js';
import {
  commandStatusText,
  hasLiveStatus,
  holoKind,
} from '../src/office/engine/commandCenterFx.js';
import type { Character, Seat, TileType as TileTypeVal } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

const COLS = 12;
const ROWS = 8;
const tileMap: TileTypeVal[][] = Array.from({ length: ROWS }, () =>
  Array<TileTypeVal>(COLS).fill(TileType.FLOOR_1),
);
const walkable = tileMap.flatMap((row, r) => row.map((_, c) => ({ col: c, row: r })));
const seat: Seat = {
  uid: 'chair',
  seatCol: 5,
  seatRow: 4,
  facingDir: Direction.UP,
  assigned: true,
};
const seats = new Map([[seat.uid, seat]]);

function seated(status: string | null, isActive: boolean): Character {
  const ch = createCharacter(1, 0, seat.uid, seat);
  ch.state = CharacterState.TYPE;
  ch.isActive = isActive;
  ch.seatTimer = 0;
  ch.commandStatus = status;
  return ch;
}

function run(ch: Character, seconds: number, step = 0.1): void {
  for (let t = 0; t < seconds; t += step)
    updateCharacter(ch, step, walkable, seats, tileMap, new Set());
}

describe('status-driven behaviour', () => {
  beforeEach(() => setCommandCenterBehaviour(true));
  afterEach(() => setCommandCenterBehaviour(false));

  test('a working agent at its station animates its work', () => {
    const ch = seated('tool', true);
    const frames = new Set<number>();
    for (let i = 0; i < 20; i++) {
      run(ch, 0.1);
      frames.add(ch.frame);
    }
    expect(ch.state).toBe(CharacterState.TYPE);
    expect(frames.size).toBeGreaterThan(1);
  });

  test.each(['thinking', 'permission', 'waiting_input', 'error'])(
    '%s holds still at the station — no typing animation',
    (status) => {
      const ch = seated(status, true);
      run(ch, 3);
      expect(ch.state).toBe(CharacterState.TYPE);
      expect(ch.frame).toBe(0);
    },
  );

  test.each(['waiting_input', 'permission'])(
    '%s keeps the agent seated even when the runtime marks it inactive',
    (status) => {
      const ch = seated(status, false);
      run(ch, 5);
      expect(ch.state).toBe(CharacterState.TYPE);
    },
  );

  test('a finished agent steps away once and then rests — no wandering', () => {
    const ch = seated('done', false);
    run(ch, 1);
    expect(ch.state === CharacterState.WALK || ch.state === CharacterState.IDLE).toBe(true);
    run(ch, 8);
    expect(ch.state).toBe(CharacterState.IDLE);
    const restCol = ch.tileCol;
    const restRow = ch.tileRow;
    expect(
      Math.abs(restCol - seat.seatCol) + Math.abs(restRow - seat.seatRow),
    ).toBeGreaterThanOrEqual(1);
    run(ch, 30);
    expect([ch.tileCol, ch.tileRow, ch.state]).toEqual([restCol, restRow, CharacterState.IDLE]);
  });

  test('an agent with no reported status stays where it is', () => {
    const ch = seated(null, false);
    run(ch, 1);
    const at = [ch.tileCol, ch.tileRow];
    run(ch, 30);
    expect([ch.tileCol, ch.tileRow]).toEqual(at);
    expect(ch.state).not.toBe(CharacterState.WALK);
  });

  test('when real work resumes, the agent walks back to its station', () => {
    const ch = seated('done', false);
    run(ch, 9);
    ch.isActive = true;
    ch.commandStatus = 'tool';
    run(ch, 10);
    expect([ch.tileCol, ch.tileRow, ch.state]).toEqual([
      seat.seatCol,
      seat.seatRow,
      CharacterState.TYPE,
    ]);
  });
});

describe('effects follow the real tool and status', () => {
  afterEach(() => clearLiveStatuses());

  test('hologram glyph by the real tool name', () => {
    expect(holoKind('Read')).toBe('read');
    expect(holoKind('Edit')).toBe('code');
    expect(holoKind('Write')).toBe('code');
    expect(holoKind('Bash')).toBe('terminal');
    expect(holoKind('WebSearch')).toBe('web');
    expect(holoKind('Task')).toBe('agent');
    expect(holoKind('SomethingNew')).toBe('generic');
    expect(holoKind(null)).toBeNull();
  });

  test('labels name the real status; no status means no label and no live effects', () => {
    const ch = createCharacter(7, 0, null, null);
    expect(hasLiveStatus(ch)).toBe(false);
    expect(commandStatusText(ch)).toBeNull();
    setLiveStatus(7, 'thinking');
    expect(hasLiveStatus(ch)).toBe(true);
    expect(commandStatusText(ch)).toBe('Pensando…');
    setLiveStatus(7, 'waiting_input');
    ch.currentTool = 'AskUserQuestion';
    expect(commandStatusText(ch)).toBeNull(); // keeps the tool's own "Waiting for your answer"
    setLiveStatus(7, 'done');
    expect(hasLiveStatus(ch)).toBe(false);
  });
});
