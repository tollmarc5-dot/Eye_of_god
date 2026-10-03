export declare const APP_ROOT: string
export declare const LIVE_GRAPH: string
export declare const SNAPSHOT_GRAPH: string

export interface GraphSource {
  readonly path: string
  readonly origin: 'EOG_GRAPH_JSON' | 'graphify-out' | 'snapshot'
}

export declare function resolveGraphSource(env?: Record<string, string | undefined>): GraphSource
