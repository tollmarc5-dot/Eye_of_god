import { describe, expect, test } from 'vitest'
import { adaptGraphify } from '@/data'
import { buildSearchIndex, normalizeText, tokenize } from '@/search'
import { makeRawGraph } from './fixtures'

const model = adaptGraphify(makeRawGraph())
const idsFor = (query: string, limit?: number) =>
  buildSearchIndex(model)
    .search(query, limit)
    .hits.map((hit) => hit.node.id)

describe('normalizeText', () => {
  test('folds case, diacritics and Unicode form', () => {
    expect(normalizeText('Guía')).toBe('guia')
    expect(normalizeText('GUÍA')).toBe('guia')
    expect(normalizeText('ﬁle')).toBe('file')
  })

  test('tokenize drops empty words', () => {
    expect(tokenize('  Index   MAIN ')).toEqual(['index', 'main'])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('search index', () => {
  test('finds a node by its label', () => {
    expect(idsFor('main')).toEqual(['app_index_main'])
  })

  test('finds a node by norm_label when the label has diacritics', () => {
    expect(idsFor('guia')).toEqual(['docs_readme'])
    expect(idsFor('guía')).toEqual(['docs_readme'])
  })

  test('is case-insensitive', () => {
    expect(idsFor('LICENSE')).toEqual(idsFor('license'))
    expect(idsFor('LiCeNsE')).toEqual(['lonely'])
  })

  test('finds nodes by file, folder and project', () => {
    expect(idsFor('xlsx.full')).toEqual(['app_lib_xlsx_min_s'])
    expect(idsFor('public')).toEqual(['app_lib_xlsx_min_s'])
    expect(idsFor('mhd-aplicacion')).toEqual(['docs_readme'])
  })

  test('finds nodes by community name, kind and extension', () => {
    expect(idsFor('community 2')).toEqual(['docs_readme'])
    expect(idsFor('document').sort()).toEqual(['docs_readme', 'lonely'])
    expect(idsFor('md')).toEqual(['docs_readme'])
  })

  test('every word has to match', () => {
    expect(idsFor('index main')).toEqual(['app_index_main'])
    expect(idsFor('index guia')).toEqual([])
  })

  test('returns nothing for an unknown term or an empty query', () => {
    const index = buildSearchIndex(model)

    expect(index.search('zzz-not-there')).toEqual({ hits: [], total: 0 })
    expect(index.search('   ')).toEqual({ hits: [], total: 0 })
  })

  test('ranks label matches above path matches, then by degree', () => {
    const hits = buildSearchIndex(model).search('index').hits

    // "index.js" (label prefix) beats "main()" (only its file matches).
    expect(hits.map((hit) => hit.node.id)).toEqual(['app_index', 'app_index_main'])
    expect(hits.map((hit) => hit.matchedField)).toEqual(['label', 'file'])
  })

  test('is deterministic and honours the limit while reporting the total', () => {
    const index = buildSearchIndex(model)
    const first = index.search('app', 2)

    expect(first.hits).toHaveLength(2)
    expect(first.total).toBe(3)
    expect(index.search('app', 2)).toEqual(first)
    expect(buildSearchIndex(model).search('app', 2)).toEqual(first)
  })

  test('narrowing a query gives the same result as searching from scratch', () => {
    const typed = buildSearchIndex(model)
    typed.search('a')
    typed.search('ap')

    expect(typed.search('app in')).toEqual(buildSearchIndex(model).search('app in'))
    // Going back to a shorter query must not reuse the narrowed candidates.
    expect(typed.search('s').total).toBe(buildSearchIndex(model).search('s').total)
  })
})
