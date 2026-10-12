import { useState } from 'react';
import { useT } from '../i18n';
import {
  DEFAULT_MODEL,
  type ProviderChoice,
  currentSettings,
  testConnection,
  useAiSettings,
} from './provider';

const MODEL_HINTS = ['qwen3:14b', 'qwen3:8b', 'gemma3:12b', 'mistral-small'];

const field =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-sky-400 focus:outline-none';

/** Provider, model, "Test connection" and a clear status indicator. */
export function AiSettingsPanel() {
  const t = useT();
  const s = useAiSettings();
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    s.setStatus('checking');
    try {
      const r = await testConnection(currentSettings());
      if (!r.ok) s.setStatus('unreachable', [], r.message);
      else if (r.message.startsWith('missing:'))
        s.setStatus('no-model', r.models, r.message.slice(8));
      else s.setStatus('ok', r.models, r.message);
    } finally {
      setTesting(false);
    }
  };

  const providers: {
    id: ProviderChoice;
    label: 'ai.set.ollama' | 'ai.set.openai' | 'ai.set.offline';
  }[] = [
    { id: 'ollama', label: 'ai.set.ollama' },
    { id: 'openai', label: 'ai.set.openai' },
    { id: 'offline', label: 'ai.set.offline' },
  ];

  return (
    <div
      className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs"
      aria-label={t('ai.settings')}
    >
      <fieldset className="space-y-1">
        <legend className="font-medium text-slate-700">{t('ai.set.provider')}</legend>
        {providers.map((p) => (
          <label key={p.id} className="flex items-start gap-1.5">
            <input
              type="radio"
              name="ai-provider"
              checked={s.provider === p.id}
              onChange={() => s.set({ provider: p.id })}
              className="mt-0.5"
            />
            <span>{t(p.label)}</span>
          </label>
        ))}
      </fieldset>

      {s.provider === 'ollama' && (
        <label className="block">
          <span className="text-slate-600">{t('ai.set.model')}</span>
          <input
            list="ai-models"
            value={s.model}
            onChange={(e) => s.set({ model: e.target.value.trim() || DEFAULT_MODEL })}
            className={field}
          />
          <datalist id="ai-models">
            {[...new Set([...s.models, ...MODEL_HINTS])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <span className="text-slate-500">{t('ai.set.modelHint')}</span>
        </label>
      )}
      {s.provider === 'openai' && (
        <>
          <label className="block">
            <span className="text-slate-600">{t('ai.set.baseUrl')}</span>
            <input
              value={s.openaiBaseUrl}
              onChange={(e) => s.set({ openaiBaseUrl: e.target.value.trim() })}
              className={field}
            />
          </label>
          <label className="block">
            <span className="text-slate-600">{t('ai.set.model')}</span>
            <input
              list="ai-models"
              value={s.openaiModel}
              onChange={(e) => s.set({ openaiModel: e.target.value.trim() })}
              className={field}
            />
          </label>
        </>
      )}
      {s.provider !== 'offline' && (
        <div className="space-y-1">
          <button
            onClick={test}
            disabled={testing}
            className="rounded bg-slate-800 px-2 py-1 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {testing ? t('ai.set.testing') : t('ai.set.test')}
          </button>
          <StatusLine />
        </div>
      )}
      <p className="text-slate-500">{t('ai.set.free')}</p>
    </div>
  );
}

/** One line saying how the connection test went. */
export function StatusLine() {
  const t = useT();
  const { status, models, statusMessage, model } = useAiSettings();
  if (status === 'unknown') return null;
  const color =
    status === 'ok' ? 'text-green-700' : status === 'checking' ? 'text-slate-500' : 'text-red-700';
  const text =
    status === 'ok'
      ? t('ai.set.ok').replace('{n}', String(models.length))
      : status === 'checking'
        ? t('ai.set.testing')
        : status === 'no-model'
          ? t('ai.set.noModel').replace('{model}', statusMessage || model)
          : t('ai.set.unreachable');
  return (
    <p role="status" className={`${color} text-xs`}>
      {text}
      {status === 'ok' && models.length > 0 && (
        <span className="block text-slate-500">{models.slice(0, 8).join(', ')}</span>
      )}
    </p>
  );
}
