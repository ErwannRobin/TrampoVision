import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '../styles.css';
import '../styles/moderation.css';
import { ModerationPage } from './ModerationPage';

// The owner's page (/moderation.html): the app's styles, none of its engine. It talks to the review service only.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModerationPage />
  </StrictMode>,
);
