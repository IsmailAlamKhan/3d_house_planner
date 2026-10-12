import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { ProjectSchema } from '../model/schemas';
import { ViewerApp } from './ViewerApp';

/** Entry of the snapshot viewer: reads the project JSON embedded in the page and shows it read-only. */
const el = document.getElementById('project-data');
const root = document.getElementById('viewer-root');
if (el?.textContent && root) {
  try {
    const meta = JSON.parse(el.dataset.meta ?? '{}') as { exportedAt?: string };
    const project = ProjectSchema.parse(JSON.parse(el.textContent));
    createRoot(root).render(
      <StrictMode>
        <ViewerApp project={project} exportedAt={meta.exportedAt ?? ''} />
      </StrictMode>,
    );
  } catch (e) {
    root.textContent = `This snapshot could not be opened: ${e instanceof Error ? e.message : String(e)}`;
  }
}
