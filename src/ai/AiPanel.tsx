import { Settings, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { AiSettingsPanel } from './AiSettingsPanel';
import { type Candidate, useAi } from './aiStore';
import type { AiSource } from './pipeline';
import { PlanThumb } from './PlanThumb';
import { useAiSettings } from './provider';

const GENERATE_EXAMPLES = [
  '2 bedroom duplex with open kitchen',
  '3 bedrooms, home office, modern style',
  'Cozy home for 2 people with a study',
  '4 bedrooms and 3 baths, dark wood floors',
];
const EDIT_EXAMPLES = [
  'Make the living room 1 m wider',
  'Paint the study sage green',
  'Add a plant to the living room',
  'Change the stairs to L-shaped',
];

function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

function SourceLabel({ source }: { source: AiSource }) {
  const t = useT();
  const label =
    source === 'ollama'
      ? t('ai.via.ollama')
      : source === 'openai'
        ? t('ai.via.openai')
        : t('ai.via.offline');
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${source === 'offline' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}
      data-testid="ai-source"
    >
      {label}
    </span>
  );
}

function CandidateCard({ c, index }: { c: Candidate; index: number }) {
  const t = useT();
  const apply = useAi((s) => s.applyCandidate);
  const discard = useAi((s) => s.discardCandidate);
  const rooms = c.plan.rooms.filter(
    (r) => r.type !== 'stair' && !(r.type === 'corridor' && r.name === 'Landing'),
  ).length;
  return (
    <li
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-2"
      data-testid="ai-candidate"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {t('ai.resultTitle').replace('{n}', String(index + 1))}
        </span>
        <SourceLabel source={c.source} />
      </div>
      <div className="flex flex-wrap gap-2">
        {c.plan.levelNames.map((n, level) => (
          <figure key={n} className="text-center">
            <PlanThumb plan={c.plan} level={level} />
            <figcaption className="text-[10px] text-slate-500">{n}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-slate-600">
        {t('ai.rooms').replace('{n}', String(rooms))}
        {c.plan.items.length > 0 &&
          ` · ${t('ai.furniture').replace('{n}', String(c.plan.items.length))}`}
      </p>
      {c.notes.length > 0 && (
        <div className="text-xs text-slate-600">
          {c.source === 'offline' && c.fellBack === undefined ? (
            <span className="font-medium">{t('ai.understood')}</span>
          ) : null}
          <ul className="list-inside list-disc">
            {c.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {c.plan.warnings.length > 0 && (
        <details className="text-xs text-amber-800">
          <summary className="cursor-pointer font-medium">
            {t('ai.notes')} ({c.plan.warnings.length})
          </summary>
          <ul className="mt-1 list-inside list-disc">
            {c.plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex gap-1">
        <button
          onClick={() => apply(c.id)}
          className="flex-1 rounded bg-sky-700 px-2 py-1 text-sm font-medium text-white hover:bg-sky-800"
        >
          {t('ai.apply')}
        </button>
        <button
          onClick={() => discard(c.id)}
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
        >
          {t('ai.discard')}
        </button>
      </div>
    </li>
  );
}

/** Left-sidebar tab: describe a home (or a change) in plain language. */
export function AiPanel() {
  const t = useT();
  const ai = useAi();
  const settings = useAiSettings();
  const [showSettings, setShowSettings] = useState(false);
  const elapsed = useElapsed(ai.startedAt);
  const hasWalls = useModel((s) => s.project.walls.length > 0);
  const generate = ai.mode === 'generate';
  const examples = generate ? GENERATE_EXAMPLES : EDIT_EXAMPLES;
  const usingModel = settings.provider !== 'offline';
  const dot =
    settings.status === 'ok'
      ? 'bg-green-500'
      : settings.status === 'unreachable' || settings.status === 'no-model'
        ? 'bg-red-700'
        : 'bg-slate-300';

  return (
    <div className="space-y-3 text-sm text-slate-700">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-sky-600" />
        <h2 className="flex-1 font-semibold">{t('ai.title')}</h2>
        <span
          className="flex items-center gap-1 text-xs text-slate-600"
          title={usingModel ? settings.model : t('ai.via.offline')}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${usingModel ? dot : 'bg-amber-400'}`}
          />
          {usingModel
            ? settings.provider === 'ollama'
              ? settings.model
              : settings.openaiModel || 'LM Studio'
            : t('ai.via.offline')}
        </span>
        <button
          aria-label={t('ai.settings')}
          aria-expanded={showSettings}
          onClick={() => setShowSettings((v) => !v)}
          className={`rounded p-1 ${showSettings ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
        >
          <Settings size={16} />
        </button>
      </div>
      {showSettings && <AiSettingsPanel />}
      {!usingModel && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">{t('ai.offlineBanner')}</p>
      )}

      <div role="tablist" className="flex rounded-md bg-slate-100 p-0.5">
        {(['generate', 'edit'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={ai.mode === m}
            onClick={() => ai.setMode(m)}
            className={`flex-1 rounded px-2 py-1 text-xs ${ai.mode === m ? 'bg-white font-semibold shadow-sm' : 'text-slate-600'}`}
          >
            {t(m === 'generate' ? 'ai.mode.generate' : 'ai.mode.edit')}
          </button>
        ))}
      </div>

      <textarea
        aria-label={t(generate ? 'ai.placeholder.generate' : 'ai.placeholder.edit')}
        placeholder={t(generate ? 'ai.placeholder.generate' : 'ai.placeholder.edit')}
        value={ai.input}
        rows={4}
        onChange={(e) => ai.setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !ai.busy)
            void (generate ? ai.generate(1) : ai.runEdit());
        }}
        className="w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-sm focus:border-sky-400 focus:outline-none"
      />
      <div>
        <p className="mb-1 text-xs text-slate-500">{t('ai.examples')}</p>
        <div className="flex flex-wrap gap-1">
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => ai.setInput(ex)}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {generate && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={ai.furnish}
            onChange={(e) => ai.setFurnish(e.target.checked)}
          />
          {t('ai.furnish')}
        </label>
      )}

      {ai.busy ? (
        <div className="flex items-center gap-2 rounded-md bg-sky-50 p-2" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          <span className="flex-1 text-sm" data-testid="ai-progress">
            {ai.progress?.phase === 'queued'
              ? t('ai.waiting').replace('{n}', String(ai.progress.ahead))
              : ai.progress?.phase === 'thinking'
                ? t('ai.thinking').replace('{s}', String(elapsed))
                : t('ai.working').replace('{s}', String(elapsed))}
          </span>
          <button
            onClick={ai.cancel}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50"
          >
            {t('ai.cancel')}
          </button>
        </div>
      ) : generate ? (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => void ai.generate(1)}
            className="flex items-center justify-center gap-1 rounded-md bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800"
          >
            <Wand2 size={14} /> {t('ai.generate')}
          </button>
          <button
            onClick={() => void ai.generate(3)}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
          >
            {t('ai.variations')}
          </button>
        </div>
      ) : (
        <button
          onClick={() => void ai.runEdit()}
          disabled={!ai.input.trim()}
          className="w-full rounded-md bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {t('ai.preview')}
        </button>
      )}

      {ai.error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">
          {ai.error}
        </p>
      )}
      {ai.done && (
        <p role="status" className="rounded bg-green-50 p-2 text-xs text-green-800">
          {ai.done}
        </p>
      )}

      {ai.candidates.length > 0 && (
        <>
          {hasWalls && <p className="text-xs text-slate-500">{t('ai.replaces')}</p>}
          <ul className="space-y-2">
            {ai.candidates.map((c, i) => (
              <CandidateCard key={c.id} c={c} index={i} />
            ))}
          </ul>
        </>
      )}

      {ai.preview && (
        <div
          className="space-y-2 rounded-lg border border-slate-200 bg-white p-2"
          data-testid="ai-preview"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {ai.preview.error ? t('ai.cantDo') : t('ai.willChange')}
            </span>
            <SourceLabel source={ai.preview.source} />
          </div>
          {ai.preview.summary && <p className="text-xs text-slate-600">{ai.preview.summary}</p>}
          {ai.preview.error ? (
            <p className="text-xs text-red-700">{ai.preview.error}</p>
          ) : (
            <ul className="list-inside list-disc text-xs text-slate-700">
              {ai.preview.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {ai.preview.notes.map((n, i) => (
            <p key={i} className="text-xs text-amber-800">
              {n}
            </p>
          ))}
          <div className="flex gap-1">
            {!ai.preview.error && (
              <button
                onClick={ai.applyEdit}
                className="flex-1 rounded bg-sky-700 px-2 py-1 text-sm font-medium text-white hover:bg-sky-800"
              >
                {t('ai.apply')}
              </button>
            )}
            <button
              onClick={ai.discardEdit}
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
            >
              {t('ai.discard')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
