import { produce } from 'immer';
import { Color, MeshStandardMaterial } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { getEntry } from '../catalog';
import * as ops from '../model/ops';
import { createEmptyProject } from '../model/project';
import { createSampleProject } from '../model/sample';
import { edit, redo, undo, useModel } from '../model/store';
import { windowLightSpecs } from './SceneLights';
import { type LightingState, PRESET_TIME } from './lighting';
import {
  anyLampOn,
  daylightLevel,
  kelvinToHex,
  lampOn,
  lampParams,
  lumensToCandela,
  presetWantsLamp,
  roomOfItem,
} from './lights';
import { QUALITY, resolveQuality } from './quality';
import { effectiveLightStyle } from './sceneStore';
import { MAX_ALBEDO, applySkyMix, capAlbedo, getIndoorSky, setIndoorSky } from './skyMix';
import { bevelOf } from '../catalog/three';
import { MATERIALS } from '../materials';

const state = (mode: LightingState['mode'], time = PRESET_TIME.noon): LightingState => ({
  mode,
  time,
});

const room = () =>
  produce(createEmptyProject('r'), (p) => {
    const L = p.levels[0]!.id;
    const sq = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ];
    const walls = sq.map((a, i) =>
      ops.addWall(p, {
        levelId: L,
        start: a,
        end: sq[(i + 1) % 4]!,
        type: 'exterior',
        thickness: 0.3,
      }),
    );
    ops.syncRooms(p, L);
    p.rooms[0]!.type = 'living';
    ops.addOpening(p, {
      wallId: walls[2]!,
      offset: 2,
      kind: 'window',
      catalogId: 'window-casement',
      width: 1.4,
      height: 1.2,
      sillHeight: 0.9,
    });
    ops.addOpening(p, {
      wallId: walls[0]!,
      offset: 1,
      kind: 'door',
      catalogId: 'door-single',
      width: 0.9,
      height: 2.1,
    });
    ops.addItem(p, {
      levelId: L,
      catalogId: 'ceiling-light',
      position: { x: 2.5, y: 2 },
      elevation: 2.6,
    });
    ops.addItem(p, { levelId: L, catalogId: 'table-lamp', position: { x: 1, y: 1 } });
    ops.addItem(p, { levelId: L, catalogId: 'sofa-3seat', position: { x: 3, y: 1 } });
  });

describe('light fixtures', () => {
  it('colour temperature maps from warm candle light to cool daylight', () => {
    const warm = new Color(kelvinToHex(2700));
    const cool = new Color(kelvinToHex(6500));
    expect(warm.r).toBeGreaterThan(warm.b * 1.5);
    expect(cool.b).toBeGreaterThanOrEqual(cool.r * 0.9);
    expect(kelvinToHex(1900)).not.toBe(kelvinToHex(3000));
    expect(kelvinToHex(6500)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('light fixtures carry lumens, kelvin and, for spots, a beam angle', () => {
    const ceiling = getEntry('ceiling-light')!;
    expect(ceiling.props.map((p) => p.key)).toEqual(expect.arrayContaining(['lumens', 'kelvin']));
    expect(ceiling.defaults).toMatchObject({ lumens: 1800, kelvin: 2700 });
    const spot = getEntry('downlight')!;
    expect(spot.lamp!.beam).toBe(55);
    expect(spot.props.map((p) => p.key)).toContain('beam');
    expect(getEntry('sofa-3seat')!.props.map((p) => p.key)).not.toContain('lumens');
    const p = room();
    const item = p.items.find((i) => i.catalogId === 'ceiling-light')!;
    expect(lampParams(item)).toEqual({ lumens: 1800, kelvin: 2700, beam: undefined });
    const tuned = { ...item, props: { lumens: 900, kelvin: 4000 } };
    expect(lampParams(tuned)).toEqual({ lumens: 900, kelvin: 4000, beam: undefined });
    expect(lampParams(p.items.find((i) => i.catalogId === 'sofa-3seat')!)).toBeNull();
    expect(lumensToCandela(4 * Math.PI * 100)).toBeCloseTo(100);
  });

  it('presets decide which lamps are on: daylight off, evening keeps bedrooms dark, dusk and night all on', () => {
    expect(presetWantsLamp(state('noon'), 'living')).toBe(false);
    expect(presetWantsLamp(state('morning'), 'kitchen')).toBe(false);
    expect(presetWantsLamp(state('evening'), 'living')).toBe(true);
    expect(presetWantsLamp(state('evening'), 'kitchen')).toBe(true);
    expect(presetWantsLamp(state('evening'), 'bedroom')).toBe(false);
    expect(presetWantsLamp(state('evening'), null)).toBe(true);
    for (const m of ['dusk', 'night', 'marketing'] as const)
      expect(presetWantsLamp(state(m), 'bedroom')).toBe(true);
    expect(presetWantsLamp(state('custom', 12), 'living')).toBe(false);
    expect(presetWantsLamp(state('custom', 19), 'living')).toBe(true);
  });

  it("a fixture's own switch beats its room's switch, which beats the master switch, which beats the preset", () => {
    const p = room();
    const item = p.items.find((i) => i.catalogId === 'ceiling-light')!;
    const r = roomOfItem(p, item)!;
    expect(r.id).toBe(p.rooms[0]!.id);
    const noon = state('noon');
    const night = state('night');
    expect(lampOn(p, item, noon)).toBe(false); // preset
    expect(lampOn(p, item, night)).toBe(true);
    const withLights = (fn: (l: typeof p.lights) => void) => produce(p, (d) => void fn(d.lights));
    expect(
      lampOn(
        withLights((l) => (l.master = 'on')),
        item,
        noon,
      ),
    ).toBe(true);
    expect(
      lampOn(
        withLights((l) => (l.master = 'off')),
        item,
        night,
      ),
    ).toBe(false);
    const roomOn = withLights((l) => ((l.master = 'off'), (l.rooms[r.id] = true)));
    expect(lampOn(roomOn, item, noon)).toBe(true);
    const itemOff = withLights(
      (l) => ((l.master = 'on'), (l.rooms[r.id] = true), (l.items[item.id] = false)),
    );
    expect(lampOn(itemOff, item, night)).toBe(false);
    expect(anyLampOn(itemOff, night)).toBe(true); // the table lamp is still on
  });

  it("daylight depends on the sun's height; the moon gives a little", () => {
    expect(daylightLevel(state('noon'), { elevation: 1.1 })).toBeGreaterThan(0.9);
    expect(daylightLevel(state('evening'), { elevation: 0.05 })).toBeLessThan(0.2);
    expect(daylightLevel(state('night'), { elevation: 0.8 })).toBeLessThan(0.05);
  });

  it('every exterior window gets a skylight facing into its room; windows opening into nothing get none', () => {
    const p = room();
    const specs = windowLightSpecs(p);
    expect(specs).toHaveLength(1);
    const s = specs[0]!;
    // The window is in the wall along y = 4 and the room is north of it (smaller y): the light looks north.
    expect(s.aim[2]).toBeLessThan(s.position[2]);
    expect(s.width).toBeLessThan(1.4);
    expect(s.position[1]).toBeCloseTo(0.9 + 0.6, 1);
    // Without a room behind the window there is nothing to light.
    const empty = produce(p, (d) => void (d.rooms = []));
    expect(windowLightSpecs(empty)).toHaveLength(0);
  });
});

describe('lighting style', () => {
  it('is design lighting while editing in the split view, and realistic when walking or presenting', () => {
    expect(effectiveLightStyle('auto', 'split', false, false)).toBe('design');
    expect(effectiveLightStyle('auto', '3d', false, false)).toBe('realistic');
    expect(effectiveLightStyle('auto', 'split', true, false)).toBe('realistic');
    expect(effectiveLightStyle('auto', 'split', false, true)).toBe('realistic');
    expect(effectiveLightStyle('design', '3d', false, false)).toBe('design');
    expect(effectiveLightStyle('realistic', 'split', false, false)).toBe('realistic');
    expect(effectiveLightStyle('design', '3d', true, false)).toBe('design'); // an explicit choice wins
  });
});

describe('quality tiers: cost, not look', () => {
  it('light budgets, shadow lights, shadow maps, AO and AA follow the table', () => {
    expect(QUALITY.low).toMatchObject({
      maxLights: 8,
      shadowLights: 0,
      shadowMapSize: 1024,
      shadowType: 'percentage',
      ao: 'none',
      aa: 'fxaa',
      bloom: false,
      blobShadows: true,
    });
    expect(QUALITY.medium).toMatchObject({
      maxLights: 16,
      shadowLights: 2,
      shadowMapSize: 2048,
      shadowType: 'soft',
      ao: 'half',
      aa: 'smaa',
      bloom: true,
      blobShadows: false,
    });
    expect(QUALITY.high).toMatchObject({
      maxLights: 32,
      shadowLights: 4,
      shadowMapSize: 4096,
      ao: 'full',
      aa: 'smaa',
      bloom: true,
    });
    expect(QUALITY.high.dpr[1]).toBe(2);
    expect(resolveQuality('medium')).toBe('medium');
  });
});

describe('sky light stays outdoors', () => {
  it('materials multiply hemisphere and environment light by a per-material mix, indoors by the shared night visibility', () => {
    const m = applySkyMix(new MeshStandardMaterial());
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      fragmentShader:
        '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>',
    };
    (m.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null);
    expect(shader.fragmentShader).toContain('uniform float uSkyMix;');
    expect(shader.fragmentShader).toContain(
      'getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * uSkyMix',
    );
    expect(shader.fragmentShader).toContain('getIBLIrradiance( geometryNormal ) * uSkyMix');
    expect(shader.fragmentShader).toContain('radiance += iblRadiance * uSkyMix');
    setIndoorSky(0.02);
    expect(shader.uniforms.uSkyMix!.value).toBe(0.02); // shared with every indoor material
    const out = applySkyMix(new MeshStandardMaterial(), true);
    const s2 = {
      uniforms: {} as Record<string, { value: number }>,
      fragmentShader: '#include <common>',
    };
    (out.onBeforeCompile as (s: unknown, r: unknown) => void)(s2, null);
    expect(s2.uniforms.uSkyMix!.value).toBe(1); // outdoor materials always get the full sky
    setIndoorSky(5);
    expect(getIndoorSky()).toBe(1);
    setIndoorSky(1);
  });
});

describe('whites', () => {
  it('no colour reflects more than 88 %: albedo is capped, and the library has warm and cool whites', () => {
    const c = capAlbedo(new Color('#ffffff'));
    expect(c.r).toBeLessThanOrEqual(MAX_ALBEDO + 1e-9);
    expect(capAlbedo(new Color('#336699')).b).toBeCloseTo(new Color('#336699').b);
    const whites = MATERIALS.filter((m) => /^paint-(white|cool-white|oak-white)$/.test(m.id)).map(
      (m) => new Color(m.color),
    );
    expect(whites).toHaveLength(3);
    expect(new Set(whites.map((w) => w.getHexString())).size).toBe(3);
    for (const w of whites) expect(Math.max(w.r, w.g, w.b)).toBeLessThan(0.9);
  });

  it('boxes get small bevels; films and rugs stay sharp', () => {
    expect(bevelOf([1, 1, 1])).toBeCloseTo(0.014);
    expect(bevelOf([0.05, 0.4, 0.4])).toBeCloseTo(0.009); // thin pieces get a smaller bevel
    expect(bevelOf([2, 0.015, 1.4])).toBe(0);
  });
});

describe('lamp switches are saved with the project but are not undo steps', () => {
  beforeEach(() => useModel.getState().loadProject(room()));

  it('switching a lamp changes the project, not the history', () => {
    const id = useModel.getState().project.items.find((i) => i.catalogId === 'ceiling-light')!.id;
    const before = useModel.temporal.getState().pastStates.length;
    useModel.getState().setLights((l) => void (l.items[id] = true));
    expect(useModel.getState().project.lights.items[id]).toBe(true);
    expect(useModel.temporal.getState().pastStates.length).toBe(before);
  });

  it('undoing an edit does not flip the lamps back', () => {
    const id = useModel.getState().project.items.find((i) => i.catalogId === 'ceiling-light')!.id;
    edit((p) => void (p.name = 'First'));
    useModel.getState().setLights((l) => void ((l.master = 'on'), (l.items[id] = false)));
    edit((p) => void (p.name = 'Second'));
    undo();
    expect(useModel.getState().project.name).toBe('First');
    expect(useModel.getState().project.lights).toMatchObject({
      master: 'on',
      items: { [id]: false },
    });
    redo();
    expect(useModel.getState().project.name).toBe('Second');
    expect(useModel.getState().project.lights.master).toBe('on');
  });

  it('files without lamp switches load with the defaults, and the sample project round-trips', () => {
    const sample = createSampleProject();
    expect(sample.lights).toEqual({ master: 'auto', rooms: {}, items: {} });
  });
});
