import { type TranslationKey, useT } from '../i18n';
import { STAIR_TYPES } from '../model/schemas';
import { updateStair } from '../model/ops';
import type { Stair } from '../model/types';
import { useModel } from '../model/store';
import { layoutStair, validateStair } from '../scene3d/generators/stairs';
import { formatLength, parseLength } from '../ui/units';
import { CommitField, Row, inputCls, useEditor } from './fields';

const TYPE_KEY: Record<(typeof STAIR_TYPES)[number], TranslationKey> = {
  straight: 'stair.straight',
  L: 'stair.L',
  U: 'stair.U',
  spiral: 'stair.spiral',
};

/** Properties of the (linked) stair: type, width, direction, railing, and a live read-out of riser / tread / headroom. */
export function StairProps({ stair }: { stair: Stair }) {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const project = useModel((s) => s.project);
  const { run, error } = useEditor();
  const from = project.levels.find((l) => l.id === stair.fromLevelId);
  const to = project.levels.find((l) => l.id === stair.toLevelId);
  const layout = from && to ? layoutStair(stair, from, to) : null;
  const warnings = validateStair(project, stair);
  const patch = (p: Partial<Stair>) => run((d) => updateStair(d, stair.id, p));
  const deg = Math.round(((((stair.rotation * 180) / Math.PI) % 360) + 360) % 360);
  return (
    <div>
      <Row name={t('props.type')}>
        <select
          className={inputCls}
          value={stair.type}
          onChange={(e) => patch({ type: e.target.value as Stair['type'] })}
        >
          {STAIR_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(TYPE_KEY[s])}
            </option>
          ))}
        </select>
      </Row>
      <CommitField
        name={t('props.width')}
        value={formatLength(stair.width, units)}
        onCommit={(v) => {
          const m = parseLength(v, units);
          if (m !== null && m >= 0.6 && m <= 2) patch({ width: m });
        }}
      />
      <CommitField
        name={t('props.rotation')}
        value={`${deg}°`}
        onCommit={(v) => {
          const n = Number(v.replace('°', '').replace(',', '.'));
          if (Number.isFinite(n)) patch({ rotation: ((((n % 360) + 360) % 360) * Math.PI) / 180 });
        }}
      />
      <Row name={t('props.railing')}>
        <input
          type="checkbox"
          className="mr-auto h-4 w-4"
          checked={stair.railing}
          onChange={(e) => patch({ railing: e.target.checked })}
        />
      </Row>
      {layout && (
        <p className="py-1 text-xs text-slate-600">
          {t('stair.summary')
            .replace('{n}', String(layout.riserCount))
            .replace('{riser}', (layout.riser * 100).toFixed(1))
            .replace('{tread}', (layout.tread * 100).toFixed(0))
            .replace('{rise}', formatLength(layout.rise, units))}
        </p>
      )}
      <p className="text-xs text-slate-500">{t('stair.linked')}</p>
      {warnings.map((w, i) => (
        <p key={i} className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          ⚠ {w}
        </p>
      ))}
      {error && (
        <p role="alert" className="pt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
