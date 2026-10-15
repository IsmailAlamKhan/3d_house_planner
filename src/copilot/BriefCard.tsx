import { Lock, Trash2, Unlock } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import { CARE_ABOUT, ROOM_TYPES, ZONE_TYPES, BUDGET_LEVELS } from '../model/schemas';
import type { DesignBrief, RoomType } from '../model/types';
import type { BriefOp } from './brief';
import { TYPE_NAME } from './program';
import { STYLE_PRESETS } from './styles';

const input = 'rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs';
const OFFERED: RoomType[] = ROOM_TYPES.filter(
  (r) => !['stair', 'corridor', 'outdoor', 'other', 'balcony'].includes(r),
);

/** One-tap corrections for the things the copilot assumed. */
function Corrections({ brief, edit }: { brief: DesignBrief; edit: (ops: BriefOp[]) => void }) {
  const t = useT();
  return (
    <ul className="space-y-1" data-testid="assumptions">
      {brief.assumptions.map((a) => (
        <li key={a.key} className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
          <span>• {a.text}</span>
          {a.key === 'levels' &&
            [1, 2, 3].map((n) => (
              <button
                key={n}
                className="rounded-full border border-slate-300 px-1.5"
                onClick={() => edit([{ op: 'setLevels', levels: n }])}
              >
                {n}
              </button>
            ))}
          {a.key === 'bedrooms' &&
            [1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className="rounded-full border border-slate-300 px-1.5"
                onClick={() => edit([{ op: 'setBedrooms', count: n }])}
              >
                {n}
              </button>
            ))}
          {a.key === 'cars' &&
            [1, 2, 3].map((n) => (
              <button
                key={n}
                className="rounded-full border border-slate-300 px-1.5"
                onClick={() => edit([{ op: 'setCars', cars: n }])}
              >
                {t('copilot.cars').replace('{n}', String(n))}
              </button>
            ))}
          {a.key === 'budget' &&
            BUDGET_LEVELS.map((b) => (
              <button
                key={b}
                className="rounded-full border border-slate-300 px-1.5"
                onClick={() => edit([{ op: 'setBudget', budget: b }])}
              >
                {t(`copilot.budget.${b}` as 'copilot.budget.low')}
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
}

/** The editable Design Brief: program, outdoors, style, budget, priorities. The layout engine reads only this. */
export function BriefCard({ brief, edit }: { brief: DesignBrief; edit: (ops: BriefOp[]) => void }) {
  const t = useT();
  const [add, setAdd] = useState<RoomType>('study');
  const total = brief.program.reduce((s, r) => s + r.area, 0);
  return (
    <section
      aria-label={t('copilot.brief.title')}
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-2"
      data-testid="brief-card"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <h3 className="flex-1 text-sm font-semibold">{t('copilot.brief.title')}</h3>
        <label className="flex items-center gap-1">
          {t('copilot.brief.levels')}
          <select
            aria-label={t('copilot.brief.levels')}
            className={input}
            value={brief.levels}
            onChange={(e) => edit([{ op: 'setLevels', levels: Number(e.target.value) }])}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={brief.kind === 'villa'}
            onChange={(e) => edit([{ op: 'setKind', kind: e.target.checked ? 'villa' : 'duplex' }])}
          />
          {t('copilot.brief.plot')}
        </label>
      </div>

      <table className="w-full text-xs" data-testid="brief-rooms">
        <thead>
          <tr className="text-left text-[10px] uppercase text-slate-400">
            <th>{t('copilot.brief.room')}</th>
            <th className="w-14">m²</th>
            <th>{t('copilot.brief.must')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {brief.program.map((r) => (
            <tr key={r.id} data-testid="brief-room" className="border-t border-slate-100">
              <td>
                <input
                  aria-label={`${t('copilot.brief.room')}: ${r.name}`}
                  defaultValue={r.name}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== r.name &&
                    edit([{ op: 'renameRoom', room: r.id, name: e.target.value.trim() }])
                  }
                  className={`${input} w-full`}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={2}
                  max={150}
                  aria-label={`m² ${r.name}`}
                  defaultValue={Math.round(r.area * 10) / 10}
                  key={`${r.id}:${r.area}`}
                  onBlur={(e) =>
                    Number(e.target.value) > 0 &&
                    Number(e.target.value) !== r.area &&
                    edit([{ op: 'resizeRoom', room: r.id, area: Number(e.target.value) }])
                  }
                  className={`${input} w-14`}
                />
              </td>
              <td>
                <button
                  aria-pressed={r.priority === 'must'}
                  aria-label={`${r.name}: ${t(r.priority === 'must' ? 'copilot.brief.must' : 'copilot.brief.nice')}`}
                  onClick={() =>
                    edit([
                      {
                        op: 'setPriority',
                        room: r.id,
                        priority: r.priority === 'must' ? 'nice' : 'must',
                      },
                    ])
                  }
                  className={`rounded-full px-1.5 text-[10px] ${r.priority === 'must' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}`}
                >
                  {t(r.priority === 'must' ? 'copilot.brief.must' : 'copilot.brief.nice')}
                </button>
              </td>
              <td className="whitespace-nowrap text-right">
                <button
                  aria-label={`${t('copilot.brief.lock')}: ${r.name}`}
                  aria-pressed={r.locked}
                  className="p-0.5 text-slate-500"
                  onClick={() => edit([{ op: 'lockRoom', room: r.id, locked: !r.locked }])}
                >
                  {r.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
                <button
                  aria-label={`${t('copilot.brief.remove')}: ${r.name}`}
                  className="p-0.5 text-slate-500 hover:text-red-700"
                  onClick={() => edit([{ op: 'removeRoom', room: r.id }])}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-1 text-xs">
        <select
          aria-label={t('copilot.brief.addRoom')}
          className={input}
          value={add}
          onChange={(e) => setAdd(e.target.value as RoomType)}
        >
          {OFFERED.map((r) => (
            <option key={r} value={r}>
              {TYPE_NAME[r] ?? r}
            </option>
          ))}
        </select>
        <button
          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
          onClick={() => edit([{ op: 'addRoom', type: add }])}
        >
          {t('copilot.brief.addRoom')}
        </button>
        <span className="ml-auto text-slate-500">
          {t('copilot.brief.total').replace('{m}', String(Math.round(total)))}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-slate-500">{t('copilot.brief.outdoors')}:</span>
        {ZONE_TYPES.filter((z) => z !== 'path').map((z) => {
          const on = brief.features.some((f) => f.type === z);
          return (
            <button
              key={z}
              aria-pressed={on}
              onClick={() =>
                edit([on ? { op: 'removeFeature', type: z } : { op: 'addFeature', type: z }])
              }
              className={`rounded-full border px-2 py-0.5 ${on ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-600'}`}
            >
              {t(`zone.${z}` as 'zone.pool')}
            </button>
          );
        })}
        {brief.features.some((f) => f.type === 'parking') && (
          <label className="flex items-center gap-1">
            {t('copilot.cars').replace('{n}', '')}
            <input
              type="number"
              min={1}
              max={6}
              className={`${input} w-12`}
              value={brief.cars || 2}
              onChange={(e) => edit([{ op: 'setCars', cars: Number(e.target.value) }])}
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          {t('copilot.brief.style')}
          <select
            aria-label={t('copilot.brief.style')}
            className={input}
            value={brief.style.preset ?? ''}
            onChange={(e) => edit([{ op: 'setStyle', preset: e.target.value || undefined }])}
          >
            <option value="">{t('copilot.style.none')}</option>
            {STYLE_PRESETS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(`copilot.style.${s.id}` as 'copilot.style.tropical')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          {t('copilot.brief.budget')}
          <select
            aria-label={t('copilot.brief.budget')}
            className={input}
            value={brief.budget}
            onChange={(e) =>
              edit([{ op: 'setBudget', budget: e.target.value as DesignBrief['budget'] }])
            }
          >
            {BUDGET_LEVELS.map((b) => (
              <option key={b} value={b}>
                {t(`copilot.budget.${b}` as 'copilot.budget.low')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-slate-500">{t('copilot.brief.cares')}:</span>
        {CARE_ABOUT.map((c) => {
          const on = brief.priorities.includes(c);
          return (
            <button
              key={c}
              aria-pressed={on}
              onClick={() => edit([{ op: on ? 'removePriority' : 'addPriority', priority: c }])}
              className={`rounded-full border px-2 py-0.5 ${on ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-300 text-slate-600'}`}
            >
              {t(`copilot.care.${c}` as 'copilot.care.light')}
            </button>
          );
        })}
      </div>
      {brief.assumptions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-700">{t('copilot.assumed')}</p>
          <Corrections brief={brief} edit={edit} />
        </div>
      )}
    </section>
  );
}
