// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { measureHudZones } from '@/ui/occlusion'

/** Gives an element a fixed box, as jsdom has no layout. */
function place(element: Element, left: number, top: number, width: number, height: number): void {
  const box = { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
  element.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect
  element.getClientRects = () => [box] as unknown as DOMRectList
}

function hud(markup: string, originLeft = 0, originTop = 0): HTMLElement {
  const root = document.createElement('div')
  root.className = 'eog-hud'
  root.innerHTML = markup
  document.body.append(root)
  place(root, originLeft, originTop, 1440, 900)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('HUD zones', () => {
  test('measures every visible HUD piece relative to the HUD layer, rounded outward to 8 px', () => {
    const root = hud(
      `<div class="eog-wordmark"><span id="symbol"></span><div id="name"></div></div>
       <div class="eog-search eog-topbar__search" data-open="false"></div>
       <nav class="eog-dock"></nav>`,
      10,
      20,
    )
    place(root.querySelector('#symbol')!, 26, 36, 32, 40)
    place(root.querySelector('#name')!, 66, 36, 190, 40)
    place(root.querySelector('.eog-search')!, 540, 37, 381, 40)
    place(root.querySelector('.eog-dock')!, 490, 851, 480, 56)

    expect(measureHudZones(root)).toEqual([
      // The wordmark is measured by its children: the element stretches over its grid column.
      { left: 16, top: 16, right: 48, bottom: 56 },
      { left: 56, top: 16, right: 248, bottom: 56 },
      // The search keeps its zone: its data-open is about the results list, not about being shown.
      { left: 528, top: 16, right: 912, bottom: 64 },
      { left: 480, top: 824, right: 960, bottom: 888 },
    ])
  })

  test('a closed panel covers nothing, an open one does', () => {
    const root = hud(
      `<section class="eog-panel eog-explorer" data-open="false"></section>
       <section class="eog-panel eog-inspector" data-open="true"></section>`,
    )
    place(root.querySelector('.eog-explorer')!, 16, 72, 264, 752)
    place(root.querySelector('.eog-inspector')!, 1120, 72, 304, 752)

    expect(measureHudZones(root)).toEqual([{ left: 1120, top: 72, right: 1424, bottom: 824 }])
  })

  test('pieces that are not rendered or are invisible are left out', () => {
    const root = hud(`<div class="eog-readout"></div><div class="eog-mode" style="visibility: hidden"></div>`)
    // No layout box: display none.
    root.querySelector('.eog-readout')!.getClientRects = () => [] as unknown as DOMRectList
    place(root.querySelector('.eog-mode')!, 500, 80, 400, 40)

    expect(measureHudZones(root)).toEqual([])
  })
})
