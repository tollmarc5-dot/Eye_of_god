import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { resolveGraphSource } from './scripts/graph-source.mjs'

// Graphify's output is only ever READ here: the live file next to the app when
// it exists, otherwise the versioned snapshot (see scripts/graph-source.mjs).
const GRAPH_SOURCE = resolveGraphSource().path
// Must match GRAPH_DATA_PATH in src/data/load.ts.
const GRAPH_DATA_PATH = 'data/graph.json'

function graphifySource(): Plugin {
  return {
    name: 'graphify-source',
    // Dev: stream the live file, so a regenerated graph shows up on reload.
    configureServer(server) {
      server.middlewares.use(`/${GRAPH_DATA_PATH}`, (_req, res) => {
        if (!existsSync(GRAPH_SOURCE)) {
          res.statusCode = 404
          res.end(`graph.json not found at ${GRAPH_SOURCE}`)
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(GRAPH_SOURCE).pipe(res)
      })
    },
    // Build: snapshot the file into dist/ as an asset.
    generateBundle() {
      if (!existsSync(GRAPH_SOURCE)) {
        this.error(`graph.json not found at ${GRAPH_SOURCE}`)
      }
      this.emitFile({ type: 'asset', fileName: GRAPH_DATA_PATH, source: readFileSync(GRAPH_SOURCE) })
    },
  }
}

/**
 * Third-party code in two chunks that change only when a dependency does, so
 * a new release of the app does not make returning visitors download them
 * again. Everything in them is needed for the first render: this is about
 * caching and parallel download, not about loading less.
 */
const VENDOR_CHUNKS: Readonly<Record<string, readonly string[]>> = {
  'vendor-react': ['react', 'react-dom', 'scheduler', 'zustand'],
  'vendor-graph': ['sigma', 'graphology', 'graphology-components', 'graphology-utils', 'events'],
}

function vendorChunk(id: string): string | undefined {
  const name = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]
  if (!name) return undefined
  return Object.keys(VENDOR_CHUNKS).find((chunk) => VENDOR_CHUNKS[chunk]?.includes(name))
}

export default defineConfig({
  // Relative URLs: dist/ works from the root of a domain or from any subfolder.
  base: './',
  plugins: [react(), graphifySource()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: { manualChunks: vendorChunk },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
