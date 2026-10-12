import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './index.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { initPrefs } from './prefs/prefsStore';
import { useModel } from './model/store';
import { useCamera } from './scene3d/camera/cameraStore';

// Read-only hook so end-to-end tests can inspect the model (never used by the app itself).
(window as unknown as { __duplex: unknown }).__duplex = {
  getProject: () => useModel.getState().project,
  getCamera: () => useCamera.getState(),
};

initPrefs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
