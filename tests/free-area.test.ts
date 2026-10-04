import { describe, expect, test } from 'vitest'
import {
  freeCentre,
  freeInsets,
  isInFreeArea,
  isUnderRects,
  NO_INSETS,
  quantizeRect,
  sameRects,
  type ScreenRect,
} from '@/renderer/free-area'

const rect = (left: number, top: number, right: number, bottom: number): ScreenRect => ({ left, top, right, bottom })

// What the HUD covers at 1440 × 900 with both panels open, as measured in the app.
const DESKTOP: ScreenRect[] = [
  rect(16, 16, 48, 56), // wordmark symbol
  rect(56, 16, 248, 56), // wordmark text
  rect(528, 16, 912, 64), // search
  rect(976, 16, 1424, 64), // status, share, stats
  rect(16, 72, 280, 824), // explorer
  rect(1120, 72, 1424, 280), // inspector (short: nothing selected)
  rect(480, 832, 960, 888), // dock
  rect(1288, 832, 1424, 888), // zoom read-out
]

describe('free area', () => {
  test('nothing covers the graph: the whole viewport is free', () => {
    expect(freeInsets(1440, 900, [])).toEqual(NO_INSETS)
    expect(freeCentre(1440, 900, NO_INSETS)).toEqual({ x: 720, y: 450 })
  })

  test('desktop: a tall panel pushes its side, header pieces the top, dock and read-out the bottom', () => {
    const insets = freeInsets(1440, 900, DESKTOP)

    expect(insets.left).toBe(280)
    expect(insets.top).toBe(64)
    expect(insets.bottom).toBe(900 - 832)
    // The inspector is short when empty: it does not narrow the free area, the label layer avoids it.
    expect(insets.right).toBe(0)
  })

  test('a full-height inspector pushes the right side, and the centre moves with the free area', () => {
    const insets = freeInsets(1440, 900, [...DESKTOP.slice(0, 5), rect(1120, 72, 1424, 824), ...DESKTOP.slice(6)])

    expect(insets.right).toBe(1440 - 1120)
    expect(freeCentre(1440, 900, insets)).toEqual({ x: (280 + 1120) / 2, y: (64 + 832) / 2 })
  })

  test('phone: a wide bottom sheet pushes the bottom, never the sides', () => {
    const sheet = rect(12, 360, 378, 712)
    const insets = freeInsets(390, 780, [rect(12, 12, 378, 108), sheet, rect(12, 720, 378, 768)])

    expect(insets).toMatchObject({ left: 0, right: 0, top: 108 })
    expect(insets.bottom).toBe(780 - 360)
  })

  test('the graph always keeps a minimum of room, whatever the HUD covers', () => {
    const insets = freeInsets(1000, 800, [rect(0, 0, 450, 800), rect(550, 0, 1000, 800)])

    expect(1000 - insets.left - insets.right).toBeCloseTo(300)
    // Shrunk in proportion: both sides keep their share.
    expect(insets.left).toBeCloseTo(insets.right)
  })

  test('a short panel in a corner does not move the framing, but a point under it is covered', () => {
    const insets = freeInsets(1440, 900, DESKTOP)

    expect(insets.right).toBe(0)
    expect(isUnderRects({ x: 1300, y: 150 }, DESKTOP)).toBe(true)
    expect(isUnderRects({ x: 1300, y: 400 }, DESKTOP)).toBe(false)
    expect(isUnderRects({ x: 1300, y: 290 }, DESKTOP, 24)).toBe(true)
  })

  test('rectangles outside the viewport or empty are ignored', () => {
    expect(freeInsets(800, 600, [rect(900, 0, 1000, 600), rect(10, 10, 10, 400)])).toEqual(NO_INSETS)
    expect(freeInsets(0, 600, DESKTOP)).toEqual(NO_INSETS)
  })

  test('a point counts as visible only inside the free area, past the margin', () => {
    const insets = freeInsets(1440, 900, DESKTOP)

    expect(isInFreeArea({ x: 700, y: 450 }, 1440, 900, insets)).toBe(true)
    expect(isInFreeArea({ x: 150, y: 450 }, 1440, 900, insets)).toBe(false)
    expect(isInFreeArea({ x: 290, y: 450 }, 1440, 900, insets, 24)).toBe(false)
  })

  test('quantizing rounds outward, so the covered area never shrinks', () => {
    expect(quantizeRect(rect(13, 17.5, 101, 299), 8)).toEqual(rect(8, 16, 104, 304))
  })

  test('two lists of rectangles are the same only when every edge matches', () => {
    expect(sameRects(DESKTOP, [...DESKTOP])).toBe(true)
    expect(sameRects(DESKTOP, DESKTOP.slice(1))).toBe(false)
    expect(sameRects([rect(0, 0, 8, 8)], [rect(0, 0, 8, 16)])).toBe(false)
  })
})
