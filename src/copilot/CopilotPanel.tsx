import { Mic, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlanThumb } from '../ai/PlanThumb';
import { largestInnerRect } from '../ai/layout/rect';
import { IMPROVE_CHIPS } from '../ai/layout/improve';
import { TEMPLATES, VILLA_TEMPLATE } from '../templates';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import { useUiStore } from '../ui/uiStore';
import { useRecreate } from '../ai/vision/recreateStore';
import { BriefCard } from './BriefCard';
import { BubbleDiagram } from './BubbleDiagram';
import { SketchDialog } from './SketchDialog';
import { budgetNote } from './applyStyle';
import { CHAT_CHIPS } from './commands';
import { type ProposalCandidate, projectForBrief, projectIsBlank, shellFits } from './design';
import { useCopilot } from './copilotStore';
import { dominantColors } from './mood';
import { STYLE_PRESETS } from './styles';
import { type Recording, startRecording, voiceAvailable } from './voice';

const btn =
  'rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50';
const ghost =
  'rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50';
const card =
  'flex flex-col items-start gap-0.5 rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-sky-400';

const EXAMPLES = [
  'I want a 4-bedroom villa with a pool for my family',
  '3 bedroom duplex with a room for my mother downstairs',
  'luxury villa with pool, garden, 2-car garage, gym and sauna',
];

/** The microphone button: hidden unless the server's speech service is running. */
function Mic_({ onText }: { onText: (text: string) => void }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  const [rec, setRec] = useState<Recording | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    void voiceAvailable().then((v) => !stop && setOk(v));
    return () => {
      stop = true;
    };
  }, []);
  if (!ok) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t(rec ? 'copilot.voice.stop' : 'copilot.voice.start')}
        aria-pressed={!!rec}
        title={t(rec ? 'copilot.voice.stop' : 'copilot.voice.start')}
        onClick={async () => {
          setErr(null);
          try {
            if (rec) {
              const r = rec;
              setRec(null);
              onText(await r.stop());
            } else setRec(await startRecording('auto'));
          } catch (e) {
            setRec(null);
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
        className={`rounded p-1.5 ${rec ? 'bg-red-100 text-red-700' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        <Mic size={16} />
      </button>
      {err && (
        <span role="alert" className="text-[11px] text-red-700">
          {err}
        </span>
      )}
    </>
  );
}

function Progress() {
  const t = useT();
  const { busy, progress, cancel } = useCopilot();
  if (!busy) return null;
  const key = progress?.key ?? 'reading';
  const text = t(`copilot.progress.${key}` as 'copilot.progress.reading')
    .replace('{n}', String(progress?.vars?.n ?? ''))
    .replace('{what}', String(progress?.vars?.what ?? ''));
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded bg-sky-50 p-2 text-xs text-sky-900"
      data-testid="copilot-progress"
    >
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
      <span className="flex-1">{text}</span>
      <button onClick={cancel} className="rounded border border-sky-300 px-2 py-0.5">
        {t('ai.cancel')}
      </button>
    </div>
  );
}

// ───────────────────────── start ─────────────────────────

function StartView() {
  const t = useT();
  const s = useCopilot();
  const setPanelMode = useRecreate((r) => r.setPanelMode);
  const [sketch, setSketch] = useState(false);
  const [base, setBase] = useState('reference');
  const [like, setLike] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const mood = async (files: FileList | null) => {
    if (!files?.length) return;
    const images: string[] = [];
    const palettes: string[][] = [];
    for (const f of [...files].slice(0, 4)) {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      palettes.push(dominantColors(ctx.getImageData(0, 0, c.width, c.height).data));
      images.push(c.toDataURL('image/jpeg', 0.85));
    }
    await s.fromMood(images, palettes);
  };
  return (
    <div className="space-y-3" data-testid="copilot-start">
      <div>
        <h3 className="text-base font-semibold">{t('copilot.start.title')}</h3>
        <p className="text-xs text-slate-600">{t('copilot.start.help')}</p>
      </div>
      <div className="space-y-1">
        <div className="flex items-start gap-1">
          <textarea
            aria-label={t('copilot.describe.label')}
            placeholder={t('copilot.describe.placeholder')}
            rows={4}
            value={s.input}
            onChange={(e) => s.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !s.busy) void s.describe();
            }}
            className="w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-sm focus:border-sky-400 focus:outline-none"
          />
          <Mic_ onText={(x) => s.setInput(`${s.input} ${x}`.trim())} />
        </div>
        <div className="flex flex-wrap gap-1">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => s.setInput(ex)}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200"
            >
              {ex}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            className={btn}
            disabled={s.busy || !s.input.trim()}
            onClick={() => void s.describe()}
          >
            {t('copilot.describe.go')}
          </button>
          <button className={ghost} disabled={s.busy} onClick={() => s.startInterview()}>
            {t('copilot.interview.go')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2" data-testid="copilot-options">
        <button className={card} onClick={() => setPanelMode('recreate')}>
          <b className="text-xs">{t('copilot.opt.picture')}</b>
          <span className="text-[11px] text-slate-500">{t('copilot.opt.pictureHelp')}</span>
        </button>
        <button className={card} onClick={() => setSketch(true)} data-testid="opt-sketch">
          <b className="text-xs">{t('copilot.opt.sketch')}</b>
          <span className="text-[11px] text-slate-500">{t('copilot.opt.sketchHelp')}</span>
        </button>
        <button
          className={card}
          onClick={() => s.setStartMode(s.startMode === 'like' ? 'describe' : 'like')}
          data-testid="opt-like"
        >
          <b className="text-xs">{t('copilot.opt.like')}</b>
          <span className="text-[11px] text-slate-500">{t('copilot.opt.likeHelp')}</span>
        </button>
        <button className={card} onClick={() => fileRef.current?.click()} data-testid="opt-mood">
          <b className="text-xs">{t('copilot.opt.mood')}</b>
          <span className="text-[11px] text-slate-500">{t('copilot.opt.moodHelp')}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label={t('copilot.opt.mood')}
          onChange={(e) => void mood(e.target.files)}
        />
      </div>

      {s.startMode === 'like' && (
        <div
          className="space-y-1 rounded-lg border border-slate-200 bg-white p-2"
          data-testid="like-form"
        >
          <label className="flex items-center gap-1 text-xs">
            {t('copilot.like.base')}
            <select
              className="rounded border border-slate-300 px-1 py-0.5"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              aria-label={t('copilot.like.base')}
            >
              <option value="reference">{t('copilot.like.reference')}</option>
              <option value="project">{t('copilot.like.project')}</option>
              {[...TEMPLATES, VILLA_TEMPLATE].map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.nameKey)}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label={t('copilot.like.but')}
            placeholder={t('copilot.like.placeholder')}
            rows={2}
            value={like}
            onChange={(e) => setLike(e.target.value)}
            className="w-full resize-none rounded border border-slate-300 p-1.5 text-sm"
          />
          <button
            className={btn}
            disabled={s.busy || !like.trim()}
            onClick={() => void s.fromLike(base, like)}
          >
            {t('copilot.like.go')}
          </button>
        </div>
      )}
      {sketch && <SketchDialog onClose={() => setSketch(false)} />}
    </div>
  );
}

// ───────────────────────── interview ─────────────────────────

function InterviewView() {
  const q = useCopilot((s) => s.question);
  // A fresh form for every question (its ticks and typed words start empty).
  return q ? <QuestionForm key={q.id} q={q} /> : null;
}

function QuestionForm({
  q,
}: {
  q: NonNullable<ReturnType<typeof useCopilot.getState>['question']>;
}) {
  const t = useT();
  const s = useCopilot();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const done = s.interview.answered.length;
  const toggle = (id: string) =>
    setPicked((p) => (q.multi ? (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]) : [id]));
  const go = (chips: string[]) => s.answer(chips, text);
  return (
    <div className="space-y-2" data-testid="copilot-interview">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200">
          <div
            className="h-full bg-sky-600"
            style={{ width: `${Math.min(100, (done / (done + 4)) * 100)}%` }}
          />
        </div>
        <span>{t('copilot.interview.step').replace('{n}', String(done + 1))}</span>
      </div>
      <h3 className="text-sm font-semibold">{t(`copilot.q.${q.id}` as 'copilot.q.size')}</h3>
      <div className="flex flex-wrap gap-1.5">
        {q.chips.map((c) => (
          <button
            key={c.id}
            aria-pressed={picked.includes(c.id)}
            onClick={() => (q.multi ? toggle(c.id) : go([c.id]))}
            className={`rounded-full border px-3 py-1 text-sm ${picked.includes(c.id) ? 'border-sky-600 bg-sky-50 text-sky-900' : 'border-slate-300 hover:bg-slate-50'}`}
          >
            {t(c.key as 'copilot.q.size.small')}
          </button>
        ))}
      </div>
      {q.draw && (
        <button
          className={ghost}
          data-testid="draw-shell"
          onClick={() => useUiStore.getState().setWizardOpen(true)}
        >
          {t('copilot.interview.draw')}
        </button>
      )}
      <div className="flex gap-1">
        <input
          aria-label={t('copilot.interview.free')}
          placeholder={t('copilot.interview.free')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (text.trim() || picked.length) && go(picked)}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <Mic_ onText={(x) => setText((v) => `${v} ${x}`.trim())} />
        <button
          className={btn}
          disabled={!picked.length && !text.trim()}
          onClick={() => go(picked)}
        >
          {t('copilot.interview.next')}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button className={ghost} onClick={() => go([])}>
          {t('copilot.interview.skipQuestion')}
        </button>
        <button
          className={`${ghost} ml-auto`}
          data-testid="skip-design"
          disabled={s.busy}
          onClick={() => void s.skipAndDesign()}
        >
          {t('copilot.interview.skipAll')}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── brief + results ─────────────────────────

function useShell(): { w: number; h: number; x: number; y: number } {
  const brief = useCopilot((s) => s.brief);
  const project = useModel((s) => s.project);
  return useMemo(() => {
    if (brief && projectIsBlank(project) && !shellFits(brief, project))
      return largestInnerRect(projectForBrief(brief).shell.footprint).rect;
    return largestInnerRect(project.shell.footprint).rect;
  }, [project, brief]);
}

function BriefView() {
  const t = useT();
  const s = useCopilot();
  const shell = useShell();
  const [bubbles, setBubbles] = useState(true);
  if (!s.brief) return null;
  return (
    <div className="space-y-2">
      <BriefCard brief={s.brief} edit={s.editBrief} />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={bubbles} onChange={(e) => setBubbles(e.target.checked)} />
        {t('copilot.bubbles.show')}
      </label>
      {bubbles && (
        <BubbleDiagram
          brief={s.brief}
          shell={shell}
          onHint={(id, at) => s.editBrief([{ op: 'setHint', room: id, at }])}
        />
      )}
      <div className="flex gap-2">
        <button
          className={btn}
          data-testid="design-it"
          disabled={s.busy || s.brief.program.length === 0}
          onClick={() => void s.design()}
        >
          {t(s.proposal ? 'copilot.regenerate' : 'copilot.design')}
        </button>
        <button className={ghost} onClick={s.reset}>
          {t('copilot.startOver')}
        </button>
      </div>
    </div>
  );
}

function CandidateCard({ c, index }: { c: ProposalCandidate; index: number }) {
  const t = useT();
  const s = useCopilot();
  const selected = s.chosen === c.id;
  const items = c.plan.breakdown ?? [];
  return (
    <li
      data-testid="copilot-candidate"
      aria-current={selected}
      className={`space-y-1.5 rounded-lg border bg-white p-2 ${selected ? 'border-sky-500 ring-1 ring-sky-300' : 'border-slate-200'}`}
    >
      <div className="flex items-center gap-2">
        <button className="flex-1 text-left text-sm font-semibold" onClick={() => s.choose(c.id)}>
          {t('copilot.option').replace('{n}', String(index + 1))}
        </button>
        {c.plan.archetype && (
          <span className="text-[11px] text-slate-500">
            {t(`layout.arch.${c.plan.archetype}` as 'layout.arch.villa-wings')}
          </span>
        )}
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
        {t('copilot.adherence').replace('{pct}', String(Math.round(c.adherence * 100)))} ·{' '}
        {c.issues.length === 0
          ? t('copilot.noIssues')
          : t('copilot.issues').replace('{n}', String(c.issues.length))}
      </p>
      {items.length > 0 && (
        <details className="text-xs" open={selected}>
          <summary className="cursor-pointer font-medium text-slate-700">
            {t('layout.scores')}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {items.slice(0, 14).map((it, i) => (
              <li key={i} className={it.ok ? 'text-emerald-800' : 'text-red-700'}>
                {it.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      {selected && (
        <button className={`${btn} w-full`} data-testid="copilot-apply" onClick={s.applyChosen}>
          {t('ai.apply')}
        </button>
      )}
    </li>
  );
}

function StylePicker() {
  const t = useT();
  const s = useCopilot();
  const project = useModel((m) => m.project);
  if (!s.brief) return null;
  const note = budgetNote(project, s.brief.budget);
  return (
    <section
      className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-2"
      data-testid="copilot-style"
    >
      <h3 className="text-sm font-semibold">{t('copilot.style.title')}</h3>
      <div className="flex flex-wrap gap-1.5">
        {STYLE_PRESETS.map((p) => (
          <button
            key={p.id}
            aria-pressed={s.brief?.style.preset === p.id}
            onClick={() => s.applyStyle(p.id)}
            className={`rounded-full border px-3 py-1 text-xs ${s.brief?.style.preset === p.id ? 'border-emerald-600 bg-white font-semibold' : 'border-emerald-300 bg-white/70 hover:bg-white'}`}
          >
            {t(`copilot.style.${p.id}` as 'copilot.style.tropical')}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-600">
        {t(`copilot.budgetNote.${note.level}` as 'copilot.budgetNote.low')}
        {note.estimate &&
          ` ${t('copilot.estimate').replace('{total}', Math.round(note.estimate.total).toLocaleString()).replace('{cur}', note.estimate.currency)}`}
      </p>
    </section>
  );
}

function ResultsView() {
  const t = useT();
  const s = useCopilot();
  const rooms = s.brief?.program.map((r) => r.name) ?? [];
  const [room, setRoom] = useState('');
  return (
    <div className="space-y-2" data-testid="copilot-results">
      {s.firstDesignMs !== null && (
        <p className="text-[11px] text-slate-500" data-testid="first-design-time">
          {t('copilot.took').replace('{s}', (s.firstDesignMs / 1000).toFixed(1))}
        </p>
      )}
      <ul className="space-y-2">
        {s.proposal?.candidates.map((c, i) => (
          <CandidateCard key={c.id} c={c} index={i} />
        ))}
      </ul>
      {s.applied && <StylePicker />}
      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">
          {t('copilot.brief.title')}
        </summary>
        {s.brief && <BriefView />}
      </details>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <select
          aria-label={t('copilot.versions.room')}
          className="rounded border border-slate-300 px-1 py-0.5"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
        >
          <option value="">{t('copilot.versions.room')}</option>
          {rooms.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          className={ghost}
          disabled={!room || s.busy || !s.applied}
          onClick={() => void s.makeVersions(room, 3)}
        >
          {t('copilot.versions.go')}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── chat ─────────────────────────

function Chat() {
  const t = useT();
  const s = useCopilot();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const selected = useModel((m) => {
    const sel = m.selection;
    if (!sel.type || !sel.ids.length) return null;
    return sel.type === 'room'
      ? m.project.rooms.find((r) => r.id === sel.ids[0])?.name
      : sel.type === 'item'
        ? m.project.items.find((i) => i.id === sel.ids[0])?.catalogId
        : null;
  });
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [s.chat.length]);
  const send = () => {
    if (!text.trim()) return;
    void s.send(text);
    setText('');
  };
  return (
    <section
      className="space-y-1.5 border-t border-slate-200 pt-2"
      aria-label={t('copilot.chat.title')}
      data-testid="copilot-chat"
    >
      <h3 className="text-sm font-semibold">{t('copilot.chat.title')}</h3>
      <ul className="max-h-48 space-y-1 overflow-y-auto" aria-live="polite">
        {s.chat.map((m, i) => (
          <li
            key={i}
            className={`rounded px-2 py-1 text-xs ${m.role === 'user' ? 'ml-6 bg-sky-50 text-sky-900' : 'mr-6 bg-slate-100 text-slate-800'}`}
            data-testid={`chat-${m.role}`}
          >
            {m.text}
            {m.chips && (
              <div className="mt-1 flex flex-wrap gap-1">
                {m.chips.map((c) => (
                  <button
                    key={c}
                    className="rounded-full border border-slate-300 bg-white px-2 py-0.5"
                    onClick={() => void s.send(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
        <div ref={end} />
      </ul>
      <div className="flex flex-wrap gap-1" data-testid="chat-chips">
        {CHAT_CHIPS.map((c) => (
          <button
            key={c.id}
            disabled={s.busy}
            onClick={() => void s.chip(c.id)}
            className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50"
          >
            {t(c.key as 'copilot.chip.kitchen')}
          </button>
        ))}
        {IMPROVE_CHIPS.length > 0 && null}
      </div>
      {selected && (
        <p className="text-[11px] text-slate-500">
          {t('copilot.chat.pointing').replace('{what}', selected)}
        </p>
      )}
      <div className="flex items-center gap-1">
        <input
          aria-label={t('copilot.chat.placeholder')}
          placeholder={t('copilot.chat.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <Mic_ onText={(x) => setText((v) => `${v} ${x}`.trim())} />
        <button
          aria-label={t('copilot.chat.send')}
          className="rounded bg-sky-700 p-1.5 text-white disabled:opacity-50"
          disabled={s.busy || !text.trim()}
          onClick={send}
        >
          <Send size={14} />
        </button>
      </div>
    </section>
  );
}

/** "Design with AI": every way of starting a design, the Design Brief, three checked layouts, style, and a chat to refine. */
export function CopilotPanel() {
  const t = useT();
  const s = useCopilot();
  return (
    <div className="space-y-3 text-sm text-slate-700" data-testid="copilot">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-sky-600" />
        <h2 className="flex-1 font-semibold">{t('copilot.title')}</h2>
        {s.stage !== 'start' && (
          <button
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label={t('copilot.startOver')}
            onClick={s.reset}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <Progress />
      {s.error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-800">
          {s.error}
        </p>
      )}
      {s.stage === 'start' && <StartView />}
      {s.stage === 'interview' && <InterviewView />}
      {s.stage === 'brief' && <BriefView />}
      {s.stage === 'results' && <ResultsView />}
      {s.stage !== 'start' && s.stage !== 'interview' && <Chat />}
      <p className="text-[11px] text-slate-400">{t('copilot.disclaimer')}</p>
    </div>
  );
}
