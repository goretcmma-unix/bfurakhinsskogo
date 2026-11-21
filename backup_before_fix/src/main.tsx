import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProvider } from './lib/appStore'
import App from './App'
import './styles/index.css'

console.log('[Main] Rendering app...')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
)

console.log('[Main] App rendered')
