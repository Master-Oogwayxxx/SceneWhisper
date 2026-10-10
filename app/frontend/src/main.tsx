import { createRoot } from 'react-dom/client'
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <App />
)
