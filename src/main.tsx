import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
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
