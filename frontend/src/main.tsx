import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { checkAndClearStaleCache } from './lib/cache'

// Clear stale caches on app startup if deployment version changed
checkAndClearStaleCache();

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
