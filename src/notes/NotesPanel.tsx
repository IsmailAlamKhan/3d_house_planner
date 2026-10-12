import { Check, MapPin, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { deleteNote, notePin, setNoteResolved, updateNoteText } from '../model/ops';
import { useModel } from '../model/store';
import type { Note } from '../model/types';
import { useUiStore } from '../ui/uiStore';
import { createNoteForSelection, showNote } from './actions';

const small =
  'inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40';

function NoteCard({ note }: { note: Note }) {
  const t = useT();
  const project = useModel((s) => s.project);
  const active = useUiStore((s) => s.activeNoteId === note.id);
  const area = useRef<HTMLTextAreaElement>(null);
  const level = project.levels.find((l) => l.id === notePin(project, note).levelId);
  // Typing is local until the field loses focus; `key` below re-mounts the card when the stored text changes elsewhere.
  const [text, setText] = useState(note.text);
  // A freshly placed note is ready to type in.
  useEffect(() => {
    if (active && !note.text) area.current?.focus();
  }, [active, note.text]);
  const commit = () => {
    if (text !== note.text) useModel.getState().apply((p) => updateNoteText(p, note.id, text));
  };
  return (
    <li
      data-testid="note-card"
      data-resolved={note.resolved}
      className={`rounded-lg border p-2 ${active ? 'border-sky-400 ring-1 ring-sky-300' : 'border-slate-200'} ${note.resolved ? 'opacity-70' : ''}`}
    >
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>{level?.name}</span>
        {note.resolved && (
          <span className="rounded bg-emerald-100 px-1.5 text-emerald-800">
            {t('notes.resolved')}
          </span>
        )}
      </div>
      <textarea
        ref={area}
        aria-label={t('notes.text')}
        placeholder={t('notes.placeholder')}
        rows={2}
        value={text}
        onFocus={() => useUiStore.getState().setActiveNoteId(note.id)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        className="w-full resize-y rounded border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-800"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        <button className={small} onClick={() => showNote(note.id)}>
          <MapPin size={12} /> {t('notes.show')}
        </button>
        <button
          className={small}
          onClick={() =>
            useModel.getState().apply((p) => setNoteResolved(p, note.id, !note.resolved))
          }
        >
          {note.resolved ? <RotateCcw size={12} /> : <Check size={12} />}
          {note.resolved ? t('notes.reopen') : t('notes.resolve')}
        </button>
        <button
          className={`${small} text-red-700`}
          aria-label={t('notes.delete')}
          title={t('notes.delete')}
          onClick={() => {
            commit();
            useModel.getState().apply((p) => deleteNote(p, note.id));
            if (useUiStore.getState().activeNoteId === note.id)
              useUiStore.getState().setActiveNoteId(null);
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </li>
  );
}

/** All notes in the project, with resolve / delete, and "add a note to the selection". */
export function NotesPanel() {
  const t = useT();
  const notes = useModel((s) => s.project.notes);
  const hasSelection = useModel((s) => s.selection.ids.length > 0);
  const [showResolved, setShowResolved] = useState(true);
  const shown = useMemo(
    () =>
      [...notes]
        .filter((n) => showResolved || !n.resolved)
        .sort(
          (a, b) =>
            Number(a.resolved) - Number(b.resolved) || a.createdAt.localeCompare(b.createdAt),
        ),
    [notes, showResolved],
  );
  const open = notes.filter((n) => !n.resolved).length;
  return (
    <section aria-label={t('notes.title')} className="space-y-2 text-slate-700">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('notes.title')}</h2>
        {open > 0 && (
          <span className="text-xs text-slate-500">
            {t('notes.open').replace('{n}', String(open))}
          </span>
        )}
      </div>
      <button
        className={`${small} w-full justify-center`}
        disabled={!hasSelection}
        title={hasSelection ? undefined : t('notes.noSelection')}
        onClick={() => createNoteForSelection()}
      >
        <MapPin size={12} /> {t('notes.addToSelection')}
      </button>
      {notes.some((n) => n.resolved) && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          {t('notes.showResolved')}
        </label>
      )}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
          {t('notes.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((n) => (
            <NoteCard key={`${n.id}:${n.text}`} note={n} />
          ))}
        </ul>
      )}
    </section>
  );
}
