import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces'
// Instrument Sans over Inter: narrower, warmer, and it does not read as the
// library default. Fraunces carries the headings, this carries the reading.
import '@fontsource-variable/instrument-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles/tokens.css'
import './styles/app.css'
import App from './App'
import { setupI18n } from './lib/i18n'
import { bootstrapTheme } from './lib/theme'

bootstrapTheme()

void setupI18n().then(() => {
  const container = document.getElementById('root')
  if (!container) throw new Error('Root element missing')
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
