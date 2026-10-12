import { Settings } from 'lucide-react';
import { useT } from '../i18n';
import {
  LANGUAGES,
  type Language,
  type MotionChoice,
  type ThemeChoice,
  usePrefs,
} from '../prefs/prefsStore';
import { PopoverMenu } from '../ui/PopoverMenu';

const field = 'w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-sm';

/** Language, theme and motion — saved on this device. */
export function SettingsMenu() {
  const t = useT();
  const { language, theme, motion, set } = usePrefs();
  return (
    <PopoverMenu label={t('settings.title')} icon={<Settings size={18} />} tourId="settings">
      {() => (
        <div className="w-60 space-y-2 p-1">
          <label className="block text-xs text-slate-600">
            {t('settings.language')}
            <select
              className={field}
              value={language}
              onChange={(e) => set({ language: e.target.value as Language })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            {t('settings.theme')}
            <select
              className={field}
              value={theme}
              onChange={(e) => set({ theme: e.target.value as ThemeChoice })}
            >
              <option value="system">{t('settings.themeSystem')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            {t('settings.motion')}
            <select
              className={field}
              value={motion}
              onChange={(e) => set({ motion: e.target.value as MotionChoice })}
            >
              <option value="system">{t('settings.motionSystem')}</option>
              <option value="reduce">{t('settings.motionReduce')}</option>
              <option value="full">{t('settings.motionFull')}</option>
            </select>
          </label>
        </div>
      )}
    </PopoverMenu>
  );
}
