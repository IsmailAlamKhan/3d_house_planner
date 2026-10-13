import { type ReactNode } from 'react';
import { polygonArea } from '../geometry/polygon';
import { type TranslationKey, useT } from '../i18n';
import { entryForOpening, getEntry } from '../catalog';
import {
  type WallFaceField,
  faceField,
  paintLevelCeilings,
  paintLevelFloors,
  paintLevelWalls,
  paintRoomWalls,
  roomOnSide,
  updateRoom,
  setRoomParapet,
  parapetWallsOf,
  updateWall,
} from '../model/ops';
import { ROOM_TYPES, WALL_TYPES } from '../model/schemas';
import { useModel } from '../model/store';
import type { Room, Wall } from '../model/types';
import { ItemProps, OpeningProps } from './CatalogProps';
import { StairProps } from './StairProps';
import { GateProps, ZoneProps } from './SiteProps';
import { MaterialPicker, ShortcutButton } from './MaterialPicker';
import { CommitField, Row, SelectField, shared, useEditor } from './fields';
import {
  formatArea,
  formatLength,
  metersToSmall,
  parseLength,
  smallToMeters,
  smallUnitLabel,
} from '../ui/units';

/** Picker for one face (inside / outside finish) of the selected wall(s), with the "same for this room / level" shortcuts. */
function WallFacePicker({
  field,
  walls,
  label,
  onPick,
}: {
  field: WallFaceField;
  walls: Wall[];
  label: string;
  onPick: (m: string) => void;
}) {
  const t = useT();
  const project = useModel((s) => s.project);
  const { run } = useEditor();
  const wall = walls.length === 1 ? walls[0]! : null;
  // The room this face looks into, if any.
  const room = wall
    ? (['left', 'right'] as const)
        .map((side) =>
          faceField(project, wall, side) === field ? roomOnSide(project, wall, side) : undefined,
        )
        .find(Boolean)
    : undefined;
  return (
    <MaterialPicker
      label={label}
      value={shared(walls, (w) => w[field])}
      categories={['wall']}
      customPaint
      onPick={onPick}
    >
      {wall && room && (
        <ShortcutButton onClick={() => run((d) => paintRoomWalls(d, room.id, wall[field]))}>
          {t('mat.allRoom')}
        </ShortcutButton>
      )}
      {wall && (
        <ShortcutButton
          onClick={() => run((d) => paintLevelWalls(d, wall.levelId, field, wall[field]))}
        >
          {t('mat.allLevel')}
        </ShortcutButton>
      )}
    </MaterialPicker>
  );
}

function WallProps({ walls }: { walls: Wall[] }) {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const { run, error } = useEditor();
  const ids = walls.map((w) => w.id);
  const patch = (p: Partial<Wall>) => run((d) => ids.forEach((id) => updateWall(d, id, p)));
  const mixed = t('props.mixed');
  const thickness = shared(walls, (w) => w.thickness);
  const height = shared(walls, (w) => w.height ?? null);
  const length =
    walls.length === 1
      ? Math.hypot(walls[0]!.end.x - walls[0]!.start.x, walls[0]!.end.y - walls[0]!.start.y)
      : null;
  return (
    <div>
      {length !== null && (
        <Row name={t('props.length')}>
          <span className="w-32 px-2 text-sm tabular-nums">{formatLength(length, units)}</span>
        </Row>
      )}
      <CommitField
        name={t('props.thickness')}
        value={thickness === undefined ? '' : String(metersToSmall(thickness, units))}
        placeholder={thickness === undefined ? mixed : undefined}
        suffix={smallUnitLabel(units)}
        onCommit={(v) => {
          const n = Number(v.replace(',', '.'));
          if (Number.isFinite(n) && n > 0) patch({ thickness: smallToMeters(n, units) });
        }}
      />
      <SelectField
        name={t('props.type')}
        value={shared(walls, (w) => w.type)}
        options={[...WALL_TYPES]}
        mixed={mixed}
        onChange={(v) => patch({ type: v as Wall['type'] })}
      />
      <CommitField
        name={t('props.height')}
        value={height === undefined ? '' : height === null ? '' : formatLength(height, units)}
        placeholder={height === undefined ? mixed : t('props.heightAuto')}
        onCommit={(v) => {
          if (v.trim() === '') return patch({ height: undefined });
          const m = parseLength(v, units);
          if (m !== null && m > 0) patch({ height: m });
        }}
      />
      {(['materialInside', 'materialOutside'] as const).map((field) => (
        <WallFacePicker
          key={field}
          field={field}
          walls={walls}
          label={t(field === 'materialInside' ? 'props.insideMaterial' : 'props.outsideMaterial')}
          onPick={(m) => patch({ [field]: m })}
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

function RoomProps({ rooms }: { rooms: Room[] }) {
  const t = useT();
  const units = useModel((s) => s.project.units);
  const { run, error } = useEditor();
  const ids = rooms.map((r) => r.id);
  const patch = (p: Partial<Room>) => run((d) => ids.forEach((id) => updateRoom(d, id, p)));
  const mixed = t('props.mixed');
  const name = shared(rooms, (r) => r.name);
  const area = rooms.reduce((a, r) => a + polygonArea(r.polygon), 0);
  const level = shared(rooms, (r) => r.levelId);
  const levels = useModel((s) => s.project.levels);
  const parapetOn = useModel((s) => {
    const ws = rooms.flatMap((r) => parapetWallsOf(s.project, r.id));
    return ws.length > 0 && ws.every((w) => (w.height ?? 99) <= 1.2);
  });
  const levelAboveExists = rooms.every((r) => {
    const l = levels.find((x) => x.id === r.levelId);
    return !!l && levels.some((x) => x.index === l.index + 1);
  });
  return (
    <div>
      <CommitField
        name={t('props.name')}
        value={name ?? ''}
        placeholder={name === undefined ? mixed : undefined}
        onCommit={(v) => v.trim() && patch({ name: v.trim() })}
      />
      <SelectField
        name={t('props.roomType')}
        value={shared(rooms, (r) => r.type)}
        options={[...ROOM_TYPES]}
        labelOf={(o) => t(`roomtype.${o}` as 'roomtype.living')}
        mixed={mixed}
        onChange={(v) =>
          patch(
            v === 'outdoor'
              ? { type: 'outdoor', floorMaterial: 'decking' }
              : { type: v as Room['type'] },
          )
        }
      />
      <MaterialPicker
        label={t('props.floorMaterial')}
        value={shared(rooms, (r) => r.floorMaterial)}
        categories={rooms.every((r) => r.type === 'outdoor') ? ['floor', 'ground'] : ['floor']}
        onPick={(m) => patch({ floorMaterial: m })}
      >
        {level && (
          <ShortcutButton
            onClick={() => run((d) => paintLevelFloors(d, level, rooms[0]!.floorMaterial))}
          >
            {t('mat.allLevel')}
          </ShortcutButton>
        )}
      </MaterialPicker>
      <MaterialPicker
        label={t('props.ceilingMaterial')}
        value={shared(rooms, (r) => r.ceilingMaterial)}
        categories={['ceiling']}
        customPaint
        onPick={(m) => patch({ ceilingMaterial: m })}
      >
        {level && (
          <ShortcutButton
            onClick={() => run((d) => paintLevelCeilings(d, level, rooms[0]!.ceilingMaterial))}
          >
            {t('mat.allLevel')}
          </ShortcutButton>
        )}
      </MaterialPicker>
      {rooms.every((r) => r.type === 'outdoor') && (
        <Row name={t('props.parapet')}>
          <input
            type="checkbox"
            className="mr-auto h-4 w-4"
            checked={parapetOn}
            onChange={(e) =>
              run((d) => ids.forEach((id) => setRoomParapet(d, id, e.target.checked)))
            }
          />
        </Row>
      )}
      <Row name={t('props.doubleHeight')}>
        <input
          type="checkbox"
          className="mr-auto h-4 w-4"
          checked={shared(rooms, (r) => r.doubleHeight) === true}
          disabled={!levelAboveExists}
          title={levelAboveExists ? undefined : t('props.doubleHeightNoLevel')}
          onChange={(e) => patch({ doubleHeight: e.target.checked })}
        />
      </Row>
      <Row name={t('props.area')}>
        <span className="w-32 px-2 text-sm tabular-nums">{formatArea(area, units)}</span>
      </Row>
      {error && (
        <p role="alert" className="pt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function PropertiesPanel() {
  const t = useT();
  const selection = useModel((s) => s.selection);
  const project = useModel((s) => s.project);
  let title: string | null = null;
  let body: ReactNode = <p className="text-sm text-slate-500">{t('properties.empty')}</p>;
  const count = selection.ids.length;
  const suffix = count > 1 ? ` · ${count} ${t('props.selected')}` : '';

  if (selection.type === 'wall') {
    const walls = project.walls.filter((w) => selection.ids.includes(w.id));
    if (walls.length) {
      title = (count > 1 ? t('props.walls') : t('props.wall')) + suffix;
      body = <WallProps key={walls.map((w) => w.id).join()} walls={walls} />;
    }
  } else if (selection.type === 'room') {
    const rooms = project.rooms.filter((r) => selection.ids.includes(r.id));
    if (rooms.length) {
      title = (count > 1 ? t('props.rooms') : t('props.room')) + suffix;
      body = <RoomProps key={rooms.map((r) => r.id).join()} rooms={rooms} />;
    }
  } else if (selection.type === 'item') {
    const items = project.items.filter((i) => selection.ids.includes(i.id));
    if (items.length) {
      const entry = items.length === 1 ? getEntry(items[0]!.catalogId) : undefined;
      title = entry ? t(entry.nameKey as TranslationKey) : `${t('props.item')}${suffix}`;
      body = <ItemProps key={items.map((i) => i.id).join()} items={items} />;
    }
  } else if (selection.type === 'opening') {
    const openings = project.openings.filter((o) => selection.ids.includes(o.id));
    if (openings.length) {
      const entry =
        openings.length === 1
          ? entryForOpening(openings[0]!.catalogId, openings[0]!.kind)
          : undefined;
      title = entry ? t(entry.nameKey as TranslationKey) : `${t('props.opening')}${suffix}`;
      body = <OpeningProps key={openings.map((o) => o.id).join()} openings={openings} />;
    }
  } else if (selection.type === 'stair') {
    const stair = project.stairs.find((x) => x.id === selection.ids[0]);
    if (stair) {
      title = t('props.stair');
      body = <StairProps key={stair.id} stair={stair} />;
    }
  } else if (selection.type === 'zone') {
    const zone = project.site.zones.find((z) => z.id === selection.ids[0]);
    if (zone) {
      title = t('props.zone');
      body = <ZoneProps key={zone.id} zone={zone} />;
    }
  } else if (selection.type === 'gate') {
    const gate = project.site.gates.find((g) => g.id === selection.ids[0]);
    if (gate) {
      title = t('props.gate');
      body = <GateProps key={gate.id} gate={gate} />;
    }
  } else if (selection.type === 'column') {
    title = t('props.column');
    body = <p className="text-sm text-slate-500">{t('props.columnNote')}</p>;
  }
  return (
    <div className="flex h-full flex-col">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">
        {t('properties.title')}
      </h2>
      <div className="flex-1 overflow-y-auto p-3">
        {title && <h3 className="mb-1 text-sm font-semibold capitalize text-slate-800">{title}</h3>}
        {body}
      </div>
    </div>
  );
}

export type { TranslationKey };
