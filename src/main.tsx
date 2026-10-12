import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { useModel } from './model/store';

// Read-only hook so end-to-end tests can inspect the model (never used by the app itself).
(window as unknown as { __duplex: unknown }).__duplex = {
  getProject: () => useModel.getState().project,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
