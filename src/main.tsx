import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled (no CDN): the app keeps working offline.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/layout.css'
import '@/styles/components.css'
import '@/styles/hud.css'
import { AppShell } from '@/ui/AppShell'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root element in index.html')
}

createRoot(container).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
)
