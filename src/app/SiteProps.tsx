import { polygonArea } from '../geometry/polygon';
import { useT } from '../i18n';
import { deleteGate, deleteZone, updateGate, updateZone } from '../model/ops';
import { GATE_KINDS, ZONE_TYPES } from '../model/schemas';
import { useModel } from '../model/store';
import type { Gate, SiteZone } from '../model/types';
import { formatArea, formatLength } from '../ui/units';
import { CommitField, Row, SelectField, inputCls, useEditor } from './fields';
import { MaterialPicker } from './MaterialPicker';

/** Properties of a site zone (lawn, pool, deck, parking …). */
export function ZoneProps({ zone }: { zone: SiteZone }) {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const { run } = useEditor();
  return (
    <div>
      <CommitField
        name={t('props.name')}
        value={zone.name}
        onCommit={(v) => v.trim() && run((p) => updateZone(p, zone.id, { name: v.trim() }))}
      />
      <SelectField
        name={t('props.type')}
        value={zone.type}
        options={[...ZONE_TYPES]}
        labelOf={(o) => t(`zone.${o}` as 'zone.lawn')}
        mixed=""
        onChange={(v) => run((p) => updateZone(p, zone.id, { type: v as SiteZone['type'] }))}
      />
      <MaterialPicker
        label={t('props.surface')}
        value={zone.material}
        categories={['ground']}
        onPick={(m) => run((p) => updateZone(p, zone.id, { material: m }))}
      >
        <span />
      </MaterialPicker>
      <Row name={t('props.area')}>
        <span className="text-sm">{formatArea(polygonArea(zone.polygon), units)}</span>
      </Row>
      <label className="mt-1 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={zone.covered}
          onChange={(e) => run((p) => updateZone(p, zone.id, { covered: e.target.checked }))}
        />
        {t('props.covered')}
      </label>
      <button
        className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
        onClick={() => {
          run((p) => deleteZone(p, zone.id));
          useModel.getState().setSelection({ type: null, ids: [] });
        }}
      >
        {t('tool.delete')}
      </button>
    </div>
  );
}

/** Properties of a gate in the plot boundary. */
export function GateProps({ gate }: { gate: Gate }) {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const { run } = useEditor();
  return (
    <div>
      <SelectField
        name={t('props.type')}
        value={gate.kind}
        options={[...GATE_KINDS]}
        labelOf={(o) => t(`gate.${o}` as 'gate.pedestrian')}
        mixed=""
        onChange={(v) =>
          run((p) =>
            updateGate(p, gate.id, { kind: v as Gate['kind'], width: v === 'vehicle' ? 3.5 : 1.2 }),
          )
        }
      />
      <Row name={t('props.width')}>
        <input
          className={inputCls}
          type="number"
          step="0.1"
          min="0.6"
          defaultValue={gate.width}
          aria-label={t('props.width')}
          key={gate.width}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v >= 0.6 && v <= 8) run((p) => updateGate(p, gate.id, { width: v }));
          }}
        />
        <span className="ml-1 text-xs text-slate-500">{formatLength(gate.width, units)}</span>
      </Row>
      <button
        className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
        onClick={() => {
          run((p) => deleteGate(p, gate.id));
          useModel.getState().setSelection({ type: null, ids: [] });
        }}
      >
        {t('tool.delete')}
      </button>
    </div>
  );
}
