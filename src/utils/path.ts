export interface PathParts {
  readonly project: string | null
  readonly folder: string
  readonly fileName: string
  readonly extension: string
}

/** Splits a relative, '/'-separated path. Pure string work: no filesystem access. */
export function parsePath(path: string): PathParts {
  const segments = path.split('/').filter((segment) => segment.length > 0)
  const fileName = segments.at(-1) ?? ''
  const dotIndex = fileName.lastIndexOf('.')
  return {
    project: segments.length > 1 ? (segments[0] ?? null) : null,
    folder: segments.slice(0, -1).join('/'),
    fileName,
    // dotIndex 0 is a dotfile (".gitignore"), which has no extension.
    extension: dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '',
  }
}
