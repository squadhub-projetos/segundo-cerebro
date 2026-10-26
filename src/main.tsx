import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/base.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/graph.css'
import './styles/panels.css'
import './styles/shell.css'
import './styles/assistant.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
