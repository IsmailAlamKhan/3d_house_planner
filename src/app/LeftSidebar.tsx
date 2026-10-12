import { Bot, Layers, Shapes } from 'lucide-react';
import { useT } from '../i18n';
import { useUiStore, type LeftTab } from '../ui/uiStore';

const tabs: {
  id: LeftTab;
  label: 'sidebar.library' | 'sidebar.levels' | 'sidebar.ai';
  icon: typeof Bot;
}[] = [
  { id: 'library', label: 'sidebar.library', icon: Shapes },
  { id: 'levels', label: 'sidebar.levels', icon: Layers },
  { id: 'ai', label: 'sidebar.ai', icon: Bot },
];

export function LeftSidebar() {
  const t = useT();
  const { leftTab, setLeftTab } = useUiStore();
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex border-b border-slate-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={leftTab === id}
            onClick={() => setLeftTab(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-xs ${
              leftTab === id
                ? 'border-b-2 border-sky-500 font-semibold text-sky-700'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon size={16} />
            {t(label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex-1 overflow-y-auto p-3 text-sm text-slate-500">
        {t('sidebar.empty')}
      </div>
    </div>
  );
}
