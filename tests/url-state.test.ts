import { describe, expect, test } from 'vitest'
import { adaptGraphify } from '@/data'
import { buildGraphIndex } from '@/graph'
import {
  decodeViewState,
  DEFAULT_VIEW_STATE,
  encodeViewState,
  type ViewState,
} from '@/state/url-state'
import { makeRawGraph } from './fixtures'

const model = adaptGraphify(makeRawGraph())
const context = { model, index: buildGraphIndex(model) }
const view = (patch: Partial<ViewState>): ViewState => ({ ...DEFAULT_VIEW_STATE, ...patch })
const decode = (search: string) => decodeViewState(search, context)

describe('encodeViewState', () => {
  test('the default view is an empty query: nothing to carry', () => {
    expect(encodeViewState(DEFAULT_VIEW_STATE)).toBe('')
  })

  test('a selected node', () => {
    expect(encodeViewState(view({ nodeId: 'app_index_main' }))).toBe('node=app_index_main')
  })

  test('a selected community', () => {
    expect(encodeViewState(view({ communityId: 2 }))).toBe('community=2')
  })

  test('filters and scope are written only when they differ from the default', () => {
    expect(encodeViewState(view({ showThirdParty: true }))).toBe('thirdParty=1')
    expect(encodeViewState(view({ showIsolated: false, showRelations: false }))).toBe('isolated=0&relations=0')
    expect(encodeViewState(view({ project: 'app', folder: 'src', onlyCommunity: 0 }))).toBe(
      'project=app&folder=src&only=0',
    )
  })

  test('the root project and the root folder have an empty, but present, value', () => {
    expect(encodeViewState(view({ project: '', folder: '' }))).toBe('project=&folder=')
  })

  test('community view and its exceptions, sorted so the link is stable', () => {
    expect(encodeViewState(view({ aggregation: { mode: 'communities', exceptions: [] } }))).toBe('view=communities')
    expect(encodeViewState(view({ aggregation: { mode: 'communities', exceptions: [3, 0] } }))).toBe(
      'view=communities&expanded=0%2C3',
    )
    expect(encodeViewState(view({ aggregation: { mode: 'nodes', exceptions: [2, 1] } }))).toBe('collapsed=1%2C2')
  })

  test('the camera is rounded, and left out when it is the default framing', () => {
    expect(encodeViewState(view({ camera: { x: 0.123456, y: 0.5, ratio: 0.2 } }))).toBe('cam=0.123%2C0.5%2C0.2')
    expect(encodeViewState(view({ camera: { x: 0.5, y: 0.5, ratio: 1 } }))).toBe('')
    expect(encodeViewState(view({ camera: { x: 0.50001, y: 0.49999, ratio: 1.0004 } }))).toBe('')
  })

  test('a path carries its two ends only, an expansion its depth', () => {
    expect(encodeViewState(view({ nodeId: 'os', path: { fromId: 'app_index', toId: 'os' } }))).toBe(
      'node=os&from=app_index&to=os',
    )
    expect(encodeViewState(view({ nodeId: 'os', expansionDepth: 2 }))).toBe('node=os&expand=2')
  })

  test('a full combination is deterministic and escapes what the URL needs', () => {
    const full = view({
      nodeId: 'docs_readme',
      project: 'mhd-aplicación',
      showThirdParty: true,
      aggregation: { mode: 'nodes', exceptions: [1] },
      camera: { x: 0.25, y: 0.75, ratio: 0.5 },
    })

    expect(encodeViewState(full)).toBe(
      'node=docs_readme&project=mhd-aplicaci%C3%B3n&thirdParty=1&collapsed=1&cam=0.25%2C0.75%2C0.5',
    )
    expect(encodeViewState({ ...full })).toBe(encodeViewState(full))
  })

  test('stays short: ids and switches, never node data', () => {
    const busy = view({
      nodeId: 'app_index_main',
      project: 'app',
      folder: 'src',
      onlyCommunity: 0,
      showThirdParty: true,
      showIsolated: false,
      aggregation: { mode: 'communities', exceptions: [0, 1, 2, 3] },
      path: { fromId: 'app_index', toId: 'app_index_main' },
      camera: { x: 0.1, y: 0.9, ratio: 0.2 },
    })

    expect(encodeViewState(busy).length).toBeLessThan(250)
  })
})

describe('decodeViewState', () => {
  test('a valid URL', () => {
    expect(decode('?node=os&thirdParty=1&cam=0.25,0.75,0.5')).toEqual(
      view({ nodeId: 'os', showThirdParty: true, camera: { x: 0.25, y: 0.75, ratio: 0.5 } }),
    )
  })

  test('an empty or incomplete URL falls back to the defaults', () => {
    expect(decode('')).toEqual(DEFAULT_VIEW_STATE)
    expect(decode('?')).toEqual(DEFAULT_VIEW_STATE)
    expect(decode('?node=')).toEqual(DEFAULT_VIEW_STATE)
    expect(decode('?from=app_index')).toEqual(DEFAULT_VIEW_STATE)
  })

  test('a corrupt URL never throws', () => {
    for (const search of ['?%E0%A4%A', '?node=%', '?=&&&=', '?cam=,,', '?node[]=x&node[__proto__]=y', '?\u0000']) {
      expect(() => decode(search)).not.toThrow()
      expect(decode(search).nodeId).toBeNull()
    }
  })

  test('a node that is not in the graph is ignored', () => {
    expect(decode('?node=ghost&thirdParty=1')).toEqual(view({ showThirdParty: true }))
    expect(decode('?node=<script>alert(1)</script>').nodeId).toBeNull()
    expect(decode(`?node=${'a'.repeat(5000)}`).nodeId).toBeNull()
  })

  test('a community that is not in the graph is ignored', () => {
    expect(decode('?community=99').communityId).toBeNull()
    expect(decode('?only=99').onlyCommunity).toBeNull()
    expect(decode('?collapsed=0,99,2').aggregation).toEqual({ mode: 'nodes', exceptions: [0, 2] })
  })

  test('numbers that are not plain whole numbers are ignored', () => {
    for (const value of ['abc', '-1', '1.5', '1e1', ' 2', '0x1', '', 'NaN', '99999999999999999999']) {
      expect(decode(`?community=${encodeURIComponent(value)}`).communityId).toBeNull()
    }
    expect(decode('?community=2').communityId).toBe(2)
  })

  test('an invalid camera is ignored, never clamped into something else', () => {
    for (const value of ['1,2', '1,2,3,4', 'a,b,c', '0.5,0.5,0', '0.5,0.5,-1', '0.5,0.5,999', '500,0.5,1', 'NaN,0,1', 'Infinity,0,1']) {
      expect(decode(`?cam=${value}`).camera).toBeNull()
    }
    expect(decode('?cam=0.5,0.5,0.2').camera).toEqual({ x: 0.5, y: 0.5, ratio: 0.2 })
  })

  test('switches accept 1 and 0 only', () => {
    expect(decode('?thirdParty=yes&isolated=false&relations=2')).toEqual(DEFAULT_VIEW_STATE)
    expect(decode('?thirdParty=1&isolated=0&relations=0')).toEqual(
      view({ showThirdParty: true, showIsolated: false, showRelations: false }),
    )
  })

  test('unknown parameters are ignored', () => {
    expect(decode('?utm_source=mail&node=os&debug=1')).toEqual(view({ nodeId: 'os' }))
  })

  test('scope: a project has to exist, and a folder needs its project', () => {
    expect(decode('?project=app&folder=src')).toMatchObject({ project: 'app', folder: 'src' })
    expect(decode('?project=nope&folder=src')).toMatchObject({ project: null, folder: null })
    expect(decode('?folder=src')).toMatchObject({ project: null, folder: null })
    expect(decode('?project=app&folder=nope')).toMatchObject({ project: 'app', folder: null })
    expect(decode('?project=')).toMatchObject({ project: '' })
  })

  test('never returns a state that contradicts itself', () => {
    // A node and a community: one inspected thing, the node.
    expect(decode('?node=os&community=2')).toMatchObject({ nodeId: 'os', communityId: null })
    // An expansion needs its root, and a path replaces it.
    expect(decode('?expand=2').expansionDepth).toBeNull()
    expect(decode('?node=os&expand=9').expansionDepth).toBeNull()
    expect(decode('?node=os&expand=2&from=app_index&to=os').expansionDepth).toBeNull()
    // The exception list that does not belong to the mode is not read.
    expect(decode('?view=communities&collapsed=1').aggregation).toEqual({ mode: 'communities', exceptions: [] })
    expect(decode('?expanded=1').aggregation).toEqual({ mode: 'nodes', exceptions: [] })
  })

  test('a very long list is cut, not processed whole', () => {
    const search = `?collapsed=${Array.from({ length: 100000 }, () => '1').join(',')}`

    expect(decode(search).aggregation.exceptions).toEqual([1])
  })
})

describe('round trip', () => {
  const views: ViewState[] = [
    DEFAULT_VIEW_STATE,
    view({ nodeId: 'app_index_main', expansionDepth: 3 }),
    view({ communityId: 3, showIsolated: false }),
    view({ nodeId: 'docs_readme', project: 'mhd-aplicación', folder: '' }),
    view({ project: 'app', folder: 'public', onlyCommunity: 1, showThirdParty: true, showRelations: false }),
    view({ aggregation: { mode: 'communities', exceptions: [0, 2] }, communityId: 0 }),
    view({ aggregation: { mode: 'nodes', exceptions: [1, 3] } }),
    view({ nodeId: 'os', path: { fromId: 'app_index', toId: 'os' }, camera: { x: 0.2, y: 0.8, ratio: 0.125 } }),
  ]

  test.each(views.map((item) => [encodeViewState(item) || '(default)', item]))('%s', (_query, item) => {
    expect(decode(`?${encodeViewState(item)}`)).toEqual(item)
  })

  test('decoding then encoding normalises a messy link', () => {
    const messy = '?expanded=3,0,3&view=communities&ghost=1&node=nope&community=2&cam=0.2000,0.80,0.125'

    expect(encodeViewState(decode(messy))).toBe('community=2&view=communities&expanded=0%2C3&cam=0.2%2C0.8%2C0.125')
  })
})
