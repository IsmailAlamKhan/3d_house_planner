import {
  type CatalogEntry,
  type PropSpec,
  getEntry,
  entryForOpening,
  itemSize,
  openingStyles,
  surfaceKey,
} from '../catalog';
import { type TranslationKey, useT } from '../i18n';
import { ModelError, paintItemSurface, updateItem, updateOpening } from '../model/ops';
import { useModel } from '../model/store';
import type { Item, Opening } from '../model/types';
import { formatLength, parseLength } from '../ui/units';
import { CommitField, Row, inputCls, shared, useEditor } from './fields';
import { MaterialPicker } from './MaterialPicker';
import { NativeColor } from './NativeColor';
import { lampOn } from '../scene3d/lights';
import { useSceneStore } from '../scene3d/sceneStore';

type Mixed = string;

/** Color picker that commits once the picker closes, so one choice is one undo step. */
function ColorField({
  name,
  value,
  onCommit,
}: {
  name: string;
  value: string | undefined;
  onCommit: (v: string) => void;
}) {
  return (
    <Row name={name}>
      <NativeColor
        value={value ?? '#cccccc'}
        onCommit={onCommit}
        className="h-7 w-32 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
      />
    </Row>
  );
}

/** One adjustable property from a catalog entry's schema. */
function PropField({
  spec,
  value,
  mixed,
  onChange,
}: {
  spec: PropSpec;
  value: string | number | boolean | undefined;
  mixed: Mixed;
  onChange: (v: string | number | boolean) => void;
}) {
  const t = useT();
  const name = t(spec.label);
  switch (spec.kind) {
    case 'color':
      return (
        <ColorField
          name={name}
          value={typeof value === 'string' ? value : undefined}
          onCommit={onChange}
        />
      );
    case 'select':
      return (
        <Row name={name}>
          <select
            className={inputCls}
            value={value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
          >
            {value === undefined && (
              <option value="" disabled>
                {mixed}
              </option>
            )}
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </Row>
      );
    case 'boolean':
      return (
        <Row name={name}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="mr-auto h-4 w-4"
          />
        </Row>
      );
    case 'number':
      return (
        <CommitField
          name={name}
          value={value === undefined ? '' : String(value)}
          onCommit={(v) => {
            const n = Number(v.replace(',', '.'));
            if (Number.isFinite(n)) onChange(Math.min(spec.max, Math.max(spec.min, n)));
          }}
        />
      );
  }
}

const deg = (r: number) => Math.round(((((r * 180) / Math.PI) % 360) + 360) % 360);

/** The on/off switch of a light fixture (saved with the project, not an undo step). */
function LampSwitch({ item }: { item: Item }) {
  const t = useT();
  const project = useModel((s) => s.project);
  const setLights = useModel((s) => s.setLights);
  const lighting = useSceneStore((s) => s.lighting);
  const on = lampOn(project, item, lighting);
  return (
    <Row name={t('props.lampOn')}>
      <input
        type="checkbox"
        data-testid="lamp-switch"
        className="mr-auto h-4 w-4"
        checked={on}
        onChange={(e) =>
          setLights((l) => {
            l.items[item.id] = e.target.checked;
          })
        }
      />
    </Row>
  );
}

function ItemProps({ items }: { items: Item[] }) {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const { run, error } = useEditor();
  const mixed = t('props.mixed');
  const catalogId = shared(items, (i) => i.catalogId);
  const entry: CatalogEntry | undefined = catalogId ? getEntry(catalogId) : undefined;
  const single = items.length === 1 ? items[0]! : null;
  const ids = items.map((i) => i.id);
  const size = single && entry ? itemSize(entry, single.scale) : null;

  const setSize = (axis: 'x' | 'y' | 'z', def: number, text: string) => {
    const m = parseLength(text, units);
    if (m === null || m <= 0 || !single || !entry) return;
    const k = m / def;
    const lo = entry.minScale ?? 0.3;
    const hi = entry.maxScale ?? 4;
    if (k < lo || k > hi) {
      run(() => {
        throw new ModelError(`${formatLength(def * lo, units)} – ${formatLength(def * hi, units)}`);
      });
      return;
    }
    run((d) => updateItem(d, single.id, { scale: { ...single.scale, [axis]: k } }));
  };
  const setProp = (key: string, v: string | number | boolean) =>
    run((d) =>
      ids.forEach((id) => {
        const it = d.items.find((x) => x.id === id)!;
        updateItem(d, id, { props: { ...it.props, [key]: v } });
      }),
    );

  return (
    <div>
      {size && entry && (
        <>
          <CommitField
            name={t('props.width')}
            value={formatLength(size.w, units)}
            onCommit={(v) => setSize('x', entry.defaultSize.w, v)}
          />
          <CommitField
            name={t('props.depth')}
            value={formatLength(size.d, units)}
            onCommit={(v) => setSize('z', entry.defaultSize.d, v)}
          />
          <CommitField
            name={t('props.height')}
            value={formatLength(size.h, units)}
            onCommit={(v) => setSize('y', entry.defaultSize.h, v)}
          />
        </>
      )}
      {single && entry?.lamp && <LampSwitch item={single} />}
      <CommitField
        name={t('props.rotation')}
        value={
          shared(items, (i) => deg(i.rotation)) === undefined
            ? ''
            : `${shared(items, (i) => deg(i.rotation))}°`
        }
        placeholder={shared(items, (i) => deg(i.rotation)) === undefined ? mixed : undefined}
        onCommit={(v) => {
          const n = Number(v.replace('°', '').replace(',', '.'));
          if (Number.isFinite(n))
            run((d) =>
              ids.forEach((id) =>
                updateItem(d, id, { rotation: ((((n % 360) + 360) % 360) * Math.PI) / 180 }),
              ),
            );
        }}
      />
      {entry && entry.placement !== 'floor' && single && (
        <CommitField
          name={t('props.elevation')}
          value={formatLength(single.elevation, units)}
          onCommit={(v) => {
            const m = parseLength(v, units);
            if (m !== null && m >= 0) run((d) => updateItem(d, single.id, { elevation: m }));
          }}
        />
      )}
      {entry && surfaceKey(entry) && (
        <MaterialPicker
          label={t('mat.itemSurface')}
          value={shared(items, (i) =>
            typeof i.props.material === 'string' ? i.props.material : null,
          )}
          categories={['surface', 'floor']}
          onPick={(m) => run((d) => ids.forEach((id) => paintItemSurface(d, id, m)))}
          onClear={() => run((d) => ids.forEach((id) => paintItemSurface(d, id, null)))}
        />
      )}
      {entry?.props.map((spec) => (
        <PropField
          key={spec.key}
          spec={spec}
          mixed={mixed}
          value={shared(items, (i) => i.props[spec.key] ?? entry.defaults[spec.key])}
          onChange={(v) => setProp(spec.key, v)}
        />
      ))}
      {error && (
        <p role="alert" className="pt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function OpeningProps({ openings }: { openings: Opening[] }) {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const walls = useModel((s) => s.project.walls);
  const { run, error } = useEditor();
  const mixed = t('props.mixed');
  const ids = openings.map((o) => o.id);
  const kind = shared(openings, (o) => o.kind);
  const catalogId = shared(openings, (o) => o.catalogId);
  const entry = catalogId && kind ? entryForOpening(catalogId, kind) : undefined;
  const styles = kind ? openingStyles(kind) : [];
  const patch = (p: Partial<Opening>) => run((d) => ids.forEach((id) => updateOpening(d, id, p)));
  const lenField = (
    name: string,
    pick: (o: Opening) => number,
    key: 'width' | 'height' | 'sillHeight',
    allowZero = false,
  ) => {
    const v = shared(openings, pick);
    return (
      <CommitField
        name={name}
        value={v === undefined ? '' : formatLength(v, units)}
        placeholder={v === undefined ? mixed : undefined}
        onCommit={(text) => {
          const m = parseLength(text, units);
          if (m !== null && (allowZero ? m >= 0 : m > 0)) patch({ [key]: m });
        }}
      />
    );
  };
  const wallOf = (o: Opening) => walls.find((w) => w.id === o.wallId);
  const single = openings.length === 1 ? openings[0]! : null;

  return (
    <div>
      {styles.length > 1 && (
        <Row name={t('props.catalogStyle')}>
          <select
            className={inputCls}
            value={catalogId ?? ''}
            onChange={(e) => patch({ catalogId: e.target.value })}
          >
            {catalogId === undefined && (
              <option value="" disabled>
                {mixed}
              </option>
            )}
            {styles.map((s) => (
              <option key={s.catalogId} value={s.catalogId}>
                {t(s.nameKey as TranslationKey)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {lenField(t('props.width'), (o) => o.width, 'width')}
      {lenField(t('props.height'), (o) => o.height, 'height')}
      {kind !== 'door' && lenField(t('props.sill'), (o) => o.sillHeight, 'sillHeight', true)}
      {single && (
        <CommitField
          name={t('props.offset')}
          value={formatLength(single.offset, units)}
          onCommit={(text) => {
            const m = parseLength(text, units);
            if (m !== null) patch({ offset: m });
          }}
        />
      )}
      {kind === 'door' && (
        <Row name={t('props.swing')}>
          <select
            className={inputCls}
            value={shared(openings, (o) => o.swing) ?? ''}
            onChange={(e) => patch({ swing: e.target.value as Opening['swing'] })}
          >
            <option value="left">{t('props.swingLeft')}</option>
            <option value="right">{t('props.swingRight')}</option>
            <option value="none">{t('props.swingNone')}</option>
          </select>
        </Row>
      )}
      {kind !== 'archway' && (
        <Row name={t('props.flip')}>
          <input
            type="checkbox"
            className="mr-auto h-4 w-4"
            checked={shared(openings, (o) => o.flip) === true}
            onChange={(e) => patch({ flip: e.target.checked })}
          />
        </Row>
      )}
      {entry?.props.map((spec) => (
        <PropField
          key={spec.key}
          spec={spec}
          mixed={mixed}
          value={shared(openings, (o) => o.props[spec.key] ?? entry.defaults[spec.key])}
          onChange={(v) =>
            run((d) =>
              ids.forEach((id) => {
                const o = d.openings.find((x) => x.id === id)!;
                updateOpening(d, id, { props: { ...o.props, [spec.key]: v } });
              }),
            )
          }
        />
      ))}
      {single && wallOf(single) && (
        <p className="pt-1 text-xs text-slate-500">
          {formatLength(single.offset - single.width / 2, units)} ·{' '}
          {formatLength(
            Math.hypot(
              wallOf(single)!.end.x - wallOf(single)!.start.x,
              wallOf(single)!.end.y - wallOf(single)!.start.y,
            ) -
              single.offset -
              single.width / 2,
            units,
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="pt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export { ItemProps, OpeningProps };
