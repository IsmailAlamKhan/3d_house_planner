import { Suspense, lazy } from 'react';
import { Bot, Layers, ListChecks, Shapes, StickyNote } from 'lucide-react';
import { useT } from '../i18n';
import { ChecksPanel, useIssueCount } from '../checks/ChecksPanel';
import { LibraryPanel } from '../catalog/LibraryPanel';
import { NotesPanel } from '../notes/NotesPanel';
import { LevelsPanel } from './LevelsPanel';
import { useUiStore, type LeftTab } from '../ui/uiStore';

const tabs: {
  id: LeftTab;
  label: 'sidebar.library' | 'sidebar.levels' | 'sidebar.ai' | 'sidebar.checks' | 'sidebar.notes';
  icon: typeof Bot;
}[] = [
  { id: 'library', label: 'sidebar.library', icon: Shapes },
  { id: 'levels', label: 'sidebar.levels', icon: Layers },
  { id: 'ai', label: 'sidebar.ai', icon: Bot },
  { id: 'checks', label: 'sidebar.checks', icon: ListChecks },
  { id: 'notes', label: 'sidebar.notes', icon: StickyNote },
];

const AiPanel = lazy(() => import('../ai/AiPanel').then((m) => ({ default: m.AiPanel })));

export function LeftSidebar() {
  const t = useT();
  const { leftTab, setLeftTab } = useUiStore();
  const issues = useIssueCount();
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex border-b border-slate-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            data-tour={`tab-${id}`}
            aria-selected={leftTab === id}
            onClick={() => setLeftTab(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-xs ${
              leftTab === id
                ? 'border-b-2 border-sky-500 font-semibold text-sky-700'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="relative">
              <Icon size={16} />
              {id === 'checks' && issues.errors + issues.warnings > 0 && (
                <span
                  aria-label={`${issues.errors + issues.warnings}`}
                  className={`absolute -right-2 -top-1.5 rounded-full px-1 text-[9px] font-bold leading-4 text-white ${issues.errors ? 'bg-red-700' : 'bg-amber-700'}`}
                >
                  {issues.errors + issues.warnings}
                </span>
              )}
            </span>
            {t(label)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        className={`min-h-0 flex-1 p-3 text-sm text-slate-500 ${leftTab === 'library' ? 'overflow-hidden' : 'overflow-y-auto'}`}
      >
        {leftTab === 'levels' ? (
          <LevelsPanel />
        ) : leftTab === 'library' ? (
          <LibraryPanel />
        ) : leftTab === 'checks' ? (
          <ChecksPanel />
        ) : leftTab === 'notes' ? (
          <NotesPanel />
        ) : (
          <Suspense fallback={<p role="status">{t('app.loading')}</p>}>
            <AiPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
