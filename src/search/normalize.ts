const COMBINING_MARKS = /\p{M}/gu

/**
 * Canonical form for matching: compatibility-decomposed, without diacritics,
 * lowercase. "Guía", "GUIA" and "guia" (NFC or NFD) all become "guia".
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase()
}

/** Query words; every one of them has to match for a node to be a result. */
export function tokenize(query: string): string[] {
  return normalizeText(query).split(/\s+/).filter(Boolean)
}
