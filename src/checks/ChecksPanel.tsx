import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { type TranslationKey, useT } from '../i18n';
import { useModel } from '../model/store';
import type { RoomType } from '../model/types';
import { formatArea } from '../ui/units';
import { areaSchedule, runChecks } from './index';
import { focusIssue } from './focus';
import { DEFAULT_MIN_AREAS } from './types';

/** Live issue count for the sidebar tab badge. */
export function useIssueCount(): { errors: number; warnings: number } {
  const project = useModel((s) => s.project);
  return useMemo(() => {
    const issues = runChecks(project);
    return {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    };
  }, [project]);
}

const TYPES: RoomType[] = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'dining',
  'study',
  'utility',
];

function Limits() {
  const t = useT();
  const checks = useModel((s) => s.project.settings.checks);
  const apply = useModel((s) => s.apply);
  const num = (v: string) => Number(v.replace(',', '.'));
  return (
    <details className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
      <summary className="cursor-pointer font-medium text-slate-700">{t('checks.limits')}</summary>
      <div className="mt-2 space-y-1">
        <label className="flex items-center justify-between gap-2">
          {t('checks.maxDrain')}
          <input
            key={checks.maxDrainRun}
            defaultValue={checks.maxDrainRun}
            aria-label={t('checks.maxDrain')}
            className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right"
            onBlur={(e) => {
              const n = num(e.currentTarget.value);
              if (Number.isFinite(n) && n > 0 && n !== checks.maxDrainRun)
                apply((p) => void (p.settings.checks.maxDrainRun = n));
            }}
          />
        </label>
        <p className="pt-1 font-medium text-slate-700">{t('checks.minAreas')}</p>
        {TYPES.map((type) => {
          const value = checks.minAreas[type] ?? DEFAULT_MIN_AREAS[type] ?? 0;
          return (
            <label key={type} className="flex items-center justify-between gap-2">
              <span className="capitalize">{type}</span>
              <input
                key={value}
                defaultValue={value}
                aria-label={`${t('checks.minAreaOf')} ${type}`}
                className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right"
                onBlur={(e) => {
                  const n = num(e.currentTarget.value);
                  if (Number.isFinite(n) && n >= 0 && n !== value)
                    apply(
                      (p) =>
                        void (p.settings.checks.minAreas = {
                          ...p.settings.checks.minAreas,
                          [type]: n,
                        }),
                    );
                }}
              />
            </label>
          );
        })}
      </div>
    </details>
  );
}

function AreaSchedule() {
  const t = useT();
  const project = useModel((s) => s.project);
  const schedule = useMemo(() => areaSchedule(project), [project]);
  const u = project.units;
  const row = (label: string, value: string, strong = false) => (
    <tr className={strong ? 'font-semibold' : ''}>
      <td className="py-0.5 pr-2">{label}</td>
      <td className="py-0.5 text-right tabular-nums">{value}</td>
    </tr>
  );
  return (
    <section aria-label={t('areas.title')} className="space-y-2">
      <h3 className="text-sm font-semibold">{t('areas.title')}</h3>
      {schedule.levels.map((l) => (
        <table key={l.levelId} className="w-full text-xs">
          <caption className="pb-0.5 text-left font-medium text-slate-700">{l.name}</caption>
          <tbody>
            {l.rooms.map((r) => row(r.name, formatArea(r.area, u)))}
            {row(t('areas.usable'), formatArea(l.usable, u), true)}
            {row(t('areas.walls'), formatArea(l.walls, u))}
            {l.openVoid > 0 && row(t('areas.void'), formatArea(l.openVoid, u))}
            {row(t('areas.gross'), formatArea(l.gross, u))}
          </tbody>
        </table>
      ))}
      <table className="w-full border-t border-slate-200 text-xs">
        <caption className="pb-0.5 pt-1 text-left font-medium text-slate-700">
          {t('areas.total')}
        </caption>
        <tbody>
          {row(t('areas.usable'), formatArea(schedule.total.usable, u), true)}
          {row(t('areas.walls'), formatArea(schedule.total.walls, u))}
          {row(t('areas.gross'), formatArea(schedule.total.gross, u))}
          {row(t('areas.circulation'), `${Math.round(schedule.circulationShare * 100)} %`)}
        </tbody>
      </table>
      <table className="w-full text-xs">
        <caption className="pb-0.5 text-left font-medium text-slate-700">
          {t('areas.byType')}
        </caption>
        <tbody>
          {Object.entries(schedule.byType)
            .sort((a, b) => b[1] - a[1])
            .map(([type, area]) =>
              row(type.charAt(0).toUpperCase() + type.slice(1), formatArea(area, u)),
            )}
        </tbody>
      </table>
    </section>
  );
}

/** "Checks" tab: live constraint checker (click an issue to jump to it) and the area schedule. */
export function ChecksPanel() {
  const t = useT();
  const project = useModel((s) => s.project);
  const issues = useMemo(() => runChecks(project), [project]);
  const levelOf = (id?: string) => project.levels.find((l) => l.id === id)?.name;
  const errors = issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="space-y-3 text-sm text-slate-700">
      <h2 className="font-semibold">{t('checks.title')}</h2>
      {issues.length === 0 ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded bg-green-50 p-2 text-xs text-green-800"
        >
          <CheckCircle2 size={16} /> {t('checks.allGood')}
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {t('checks.summary')
              .replace('{e}', String(errors))
              .replace('{w}', String(issues.length - errors))}{' '}
            {t('checks.clickHint')}
          </p>
          <ul className="space-y-1" aria-label={t('checks.title')}>
            {issues.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => focusIssue(i)}
                  data-rule={i.rule}
                  className={`flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs hover:brightness-95 ${i.severity === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
                >
                  {i.severity === 'error' ? (
                    <AlertOctagon size={14} className="mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  )}
                  <span className="flex-1">
                    {i.message}
                    {levelOf(i.target.levelId) && (
                      <span className="ml-1 text-[10px] opacity-70">
                        · {levelOf(i.target.levelId)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Limits />
      <AreaSchedule />
    </div>
  );
}

export type { TranslationKey };
