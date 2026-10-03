/**
 * Heuristic, path-based detection of vendored / minified code. It only flags
 * nodes so the UI can hide them; nothing is ever removed from the data.
 */
export const DEFAULT_THIRD_PARTY_PATTERNS: readonly RegExp[] = [
  /\.min\.[a-z0-9]+$/i,
  /(^|\/)(node_modules|vendor|third_party|bower_components)\//i,
]

export function isThirdPartyPath(
  path: string,
  patterns: readonly RegExp[] = DEFAULT_THIRD_PARTY_PATTERNS,
): boolean {
  return path.length > 0 && patterns.some((pattern) => pattern.test(path))
}
