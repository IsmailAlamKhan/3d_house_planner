import { Eye, EyeOff, Plus } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { addLevel, updateLevel } from '../model/ops';

export function LevelsPanel() {
  const t = useT();
  const levels = useModel((s) => s.project.levels);
  const activeId = useModel((s) => s.activeLevelId);
  const { apply, setActiveLevel } = useModel.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const sorted = [...levels].sort((a, b) => b.index - a.index);

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {sorted.map((l) => (
          <li
            key={l.id}
            className={`flex items-center gap-1 rounded-md border px-2 py-1.5 ${
              l.id === activeId ? 'border-sky-400 bg-sky-50' : 'border-slate-200'
            }`}
          >
            <button
              aria-label={l.visible ? t('levels.hide') : t('levels.show')}
              onClick={() => apply((p) => updateLevel(p, l.id, { visible: !l.visible }))}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              {l.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            {editing === l.id ? (
              <input
                autoFocus
                aria-label={t('levels.rename')}
                defaultValue={l.name}
                className="min-w-0 flex-1 rounded border border-sky-400 px-1 text-sm"
                onBlur={(e) => {
                  const name = e.currentTarget.value.trim();
                  if (name && name !== l.name) apply((p) => updateLevel(p, l.id, { name }));
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <button
                aria-label={`${t('levels.active')}: ${l.name}`}
                aria-current={l.id === activeId}
                onClick={() => setActiveLevel(l.id)}
                onDoubleClick={() => setEditing(l.id)}
                title={t('levels.rename')}
                className="min-w-0 flex-1 truncate text-left text-sm"
              >
                {l.name}
                <span className="ml-1 text-xs text-slate-400">{l.elevation.toFixed(2)} m</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        onClick={() => {
          const id = apply((p) => addLevel(p));
          setActiveLevel(id);
        }}
        className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
      >
        <Plus size={16} /> {t('levels.add')}
      </button>
    </div>
  );
}
