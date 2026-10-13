import { Eye, EyeOff, Lock, Plus, Unlock } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { addLevel, copyWallsFromBelow, updateLevel } from '../model/ops';
import { toast } from '../catalog/actions';
import { usePlanStore } from '../plan2d/planStore';
import { OptionsPanel } from '../options/OptionsPanel';
import { fmtNum, tf } from '../i18n';

export function LevelsPanel() {
  const t = useT();
  const levels = useModel((s) => s.project.levels);
  const activeId = useModel((s) => s.activeLevelId);
  const { apply, setActiveLevel } = useModel.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const kind = useModel((s) => s.project.kind);
  const { siteVisible, siteLocked, setPref } = usePlanStore();
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
            <button
              aria-label={l.locked ? t('levels.unlock') : t('levels.lock')}
              onClick={() => apply((p) => updateLevel(p, l.id, { locked: !l.locked }))}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              {l.locked ? <Lock size={16} /> : <Unlock size={16} />}
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
                <span className="ml-1 text-xs text-slate-500">
                  {fmtNum(l.elevation, 2)} {t('unit.m')}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {(() => {
        const active = levels.find((l) => l.id === activeId);
        if (!active || active.index === 0) return null;
        return (
          <button
            onClick={() => {
              const n = apply((p) => copyWallsFromBelow(p, active.id));
              toast(
                n
                  ? tf('levels.copied', { n, level: active.name })
                  : tf('levels.copiedNone', { level: active.name }),
              );
            }}
            className="w-full rounded-md border border-slate-300 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            {t('levels.copyBelow')}
          </button>
        );
      })()}
      {kind === 'villa' && (
        <div
          data-testid="site-level-row"
          className="flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-slate-800"
        >
          <button
            aria-label={siteVisible ? t('levels.hideSite') : t('levels.showSite')}
            aria-pressed={siteVisible}
            onClick={() => setPref('siteVisible', !siteVisible)}
            className="rounded p-1 text-slate-600 hover:bg-emerald-100"
          >
            {siteVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('levels.site')}</span>
          <button
            aria-label={siteLocked ? t('levels.unlockSite') : t('levels.lockSite')}
            aria-pressed={siteLocked}
            onClick={() => setPref('siteLocked', !siteLocked)}
            className="rounded p-1 text-slate-600 hover:bg-emerald-100"
          >
            {siteLocked ? <Lock size={16} /> : <Unlock size={16} />}
          </button>
        </div>
      )}
      <button
        onClick={() => {
          const id = apply((p) => addLevel(p));
          setActiveLevel(id);
        }}
        className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
      >
        <Plus size={16} /> {t('levels.add')}
      </button>
      <OptionsPanel />
    </div>
  );
}
