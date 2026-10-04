import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * Text on the HUD panels must stay readable (WCAG AA, 4.5:1) in the worst case:
 * a panel is translucent, and the brightest thing that can sit behind it is a
 * pure white highlight. Computed from the real tokens, so a token change that
 * breaks contrast fails here.
 */
const TOKENS = readFileSync(fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)), 'utf-8')
const AA_TEXT = 4.5

type Rgb = [number, number, number]

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(TOKENS)
  if (!match?.[1]) throw new Error(`token --${name} not found`)
  return match[1].trim()
}

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match?.[1]) throw new Error(`not a 6-digit hex colour: ${value}`)
  return [0, 2, 4].map((offset) => parseInt(match[1]!.slice(offset, offset + 2), 16)) as Rgb
}

function rgba(value: string): { rgb: Rgb; alpha: number } {
  const match = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value)
  if (!match) throw new Error(`not an rgba() colour: ${value}`)
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) }
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

function over(top: { rgb: Rgb; alpha: number }, bottom: Rgb): Rgb {
  return top.rgb.map((value, index) => value * top.alpha + bottom[index]! * (1 - top.alpha)) as Rgb
}

const WHITE: Rgb = [255, 255, 255]
const TEXT_TOKENS = ['eog-text', 'eog-text-muted', 'eog-text-faint'] as const

describe('text contrast on the HUD', () => {
  const surface = rgba(token('eog-surface'))
  const worstPanel = over(surface, WHITE)
  const background = hex(token('eog-bg'))

  test.each(TEXT_TOKENS)('%s stays at least 4.5:1 on a panel over pure white', (name) => {
    expect(contrast(hex(token(name)), worstPanel)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  test.each(TEXT_TOKENS)('%s stays at least 4.5:1 on the background', (name) => {
    expect(contrast(hex(token(name)), background)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  test('the check is not vacuous: the panel opacity before this phase failed it', () => {
    const before = over({ rgb: surface.rgb, alpha: 0.7 }, WHITE)
    expect(contrast(hex('#7189a8'), before)).toBeLessThan(AA_TEXT)
  })
})
