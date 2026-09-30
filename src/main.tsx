import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import './localOnlyGuard';
import App from './App';
import { localeReady } from './i18n';
import './styles.css';

// Apply the chosen appearance before the first render, so the page does not flash the other theme.
try {
  const appearance = localStorage.getItem('trampovision.appearance');
  if (appearance === 'light' || appearance === 'dark') document.documentElement.setAttribute('data-theme', appearance);
} catch {
  /* storage unavailable: follow the system */
}

// The first screen waits for the messages of the language of the person (a small chunk, fetched while the rest loads).
void localeReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
