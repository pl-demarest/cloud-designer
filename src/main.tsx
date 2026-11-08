import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';
import { autosaveStorage, restoreAutosave, startAutosave } from './store/autosave';

// Before the first render, so the editor and its history open on a restored preset.
const storage = autosaveStorage();
if (storage) {
  restoreAutosave(storage);
  startAutosave(storage);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
