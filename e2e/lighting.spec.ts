import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cutawayPose } from '../src/present/presets';
import { ROOM, SOFA, WINDOW, whiteRoomProject } from './helpers/whiteRoom';

/**
 * Lighting checks on a white sofa on a white floor against a white wall (one window, one ceiling light), measured on
 * the rendered picture. Software GL is slow, so everything shares one page per test and waits for the frame to settle.
 */
type Hook = {
  stores: {
    model: {
      getState: () => {
        loadProject: (p: unknown) => void;
        setViewMode: (m: string) => void;
        setLights: (
          fn: (l: {
            master: string;
            items: Record<string, boolean>;
            rooms: Record<string, boolean>;
          }) => void,
        ) => void;
        project: { items: { id: string; catalogId: string }[] };
      };
    };
    scene: { getState: () => { setPref: (k: string, v: unknown) => void } };
    camera: {
      getState: () => {
        flyTo: (p: { position: number[]; target: number[] }) => void;
        setMode: (m: string) => void;
      };
    };
  };
  measureLuminance: (
    r: Record<string, { x0: number; y0: number; x1: number; y1: number }>,
  ) => Promise<{ mean: number; rects: Record<string, number> }>;
  worldToScreen: (x: number, y: number, z: number) => { x: number; y: number } | null;
};
type Mode = 'noon' | 'night';
type Quality = 'low' | 'medium' | 'high';

const project = whiteRoomProject();
const pose = cutawayPose(project, 'cutaway-top', project.levels[0]!.id, 1.07, 2.1);
const pose34 = cutawayPose(project, 'cutaway-34', project.levels[0]!.id, 1.07, 1.5);
const wait = (page: Page, ms = 2500) => page.waitForTimeout(ms);

async function setup(page: Page) {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto('/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.evaluate(
    ({ project, pose }) => {
      const h = (window as unknown as { __duplex: Hook }).__duplex;
      h.stores.model.getState().loadProject(project);
      h.stores.model.getState().setViewMode('3d');
      const cam = h.stores.camera.getState();
      cam.setMode('orbit');
      cam.flyTo({ position: pose.position, target: pose.target });
    },
    { project, pose },
  );
}

async function fly(page: Page, p: { position: number[]; target: number[] }) {
  await page.evaluate(
    (p) => (window as unknown as { __duplex: Hook }).__duplex.stores.camera.getState().flyTo(p),
    p,
  );
  await wait(page, 2200);
}

async function look(
  page: Page,
  o: {
    quality: Quality;
    mode: Mode;
    lamps: 'auto' | 'on' | 'off';
    night?: number;
    ceilingOn?: boolean;
    dollhouse?: boolean;
    style?: 'realistic' | 'design';
  },
) {
  await page.evaluate((o) => {
    const h = (window as unknown as { __duplex: Hook }).__duplex;
    const s = h.stores.scene.getState();
    s.setPref('quality', o.quality);
    s.setPref('lightStyle', o.style ?? 'realistic');
    s.setPref('lighting', { mode: o.mode, time: o.mode === 'noon' ? 13 : 22 });
    s.setPref('nightVisibility', o.night ?? 0.02);
    s.setPref('exposure', 0);
    s.setPref('dollhouse', o.dollhouse ?? true);
    s.setPref('wallMode', 'up');
    h.stores.model.getState().setLights((l) => {
      l.master = o.lamps;
      l.items = {};
      l.rooms = {};
      if (o.ceilingOn) {
        const id = h.stores.model
          .getState()
          .project.items.find((i) => i.catalogId === 'ceiling-light')!.id;
        l.items[id] = true;
      }
    });
  }, o);
  await wait(page, 3500);
}

type Pt = [number, number, number];
async function measure(
  page: Page,
  points: Record<string, Pt>,
  half = 0.012,
): Promise<Record<string, number>> {
  return page.evaluate(
    async ({ points, half }) => {
      const h = (window as unknown as { __duplex: Hook }).__duplex;
      const rects: Record<string, { x0: number; y0: number; x1: number; y1: number }> = {};
      for (const [k, p] of Object.entries(points)) {
        const s = h.worldToScreen(p[0], p[1], p[2]);
        if (s) rects[k] = { x0: s.x - half, y0: s.y - half, x1: s.x + half, y1: s.y + half };
      }
      const r = await h.measureLuminance(rects);
      return { mean: r.mean, ...r.rects };
    },
    { points, half },
  );
}

const cx = ROOM.x0 + ROOM.w / 2;
const cz = ROOM.y0 + ROOM.d / 2;
const POINTS: Record<string, Pt> = {
  sofaTop: [SOFA.x, SOFA.h, SOFA.y + 0.1],
  floorBeside: [SOFA.x + 1.9, 0.01, SOFA.y + 0.5],
  sofaFront: [SOFA.x, 0.3, SOFA.y + SOFA.d / 2 + 0.01],
  wallBehind: [SOFA.x + 1.9, 1.2, ROOM.y0 + 0.17],
  openFloor: [cx + 1.6, 0.01, cz + 0.6],
  nearWindow: [WINDOW.x, 0.01, WINDOW.y - 0.8],
  farCorner: [ROOM.x0 + ROOM.w - 0.6, 0.01, ROOM.y0 + 0.9],
  outdoor: [ROOM.x0 + ROOM.w + 2.2, 0.0, ROOM.y0 + 1.5],
  roomFloor: [cx - 1.2, 0.01, cz + 0.4],
};

const CONTRAST: Record<string, Pt> = {
  sofaTop: [SOFA.x, SOFA.h, SOFA.y + 0.1],
  floorBeside: [SOFA.x + SOFA.w / 2 + 0.12, 0.01, SOFA.y + 0.3],
  sofaMid: [SOFA.x, 0.5, SOFA.y + SOFA.d / 2 + 0.02],
  wallHigh: [SOFA.x, 1.6, ROOM.y0 + 0.17],
  floorContact: [SOFA.x, 0.01, SOFA.y + SOFA.d / 2 + 0.08],
  floorOpen: [SOFA.x, 0.01, SOFA.y + SOFA.d / 2 + 0.9],
};

const avg = (m: Record<string, number>, keys: string[]) =>
  keys.reduce((a, k) => a + (m[k] ?? 0), 0) / keys.length;
const INTERIOR = [
  'sofaTop',
  'floorBeside',
  'sofaFront',
  'openFloor',
  'nearWindow',
  'farCorner',
  'roomFloor',
];
const shot = (page: Page, name: string) => {
  mkdirSync('tests/visual', { recursive: true });
  return page.screenshot({
    path: join('tests/visual', `${name}.png`),
    clip: { x: 256, y: 49, width: 740, height: 700 },
  });
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(480_000);

test('tiers: Low, Medium and High have the same brightness and colour at Noon (no dark film on High)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  const m: Record<Quality, Record<string, number>> = { low: {}, medium: {}, high: {} };
  for (const quality of ['low', 'medium', 'high'] as const) {
    await look(page, { quality, mode: 'noon', lamps: 'off' });
    m[quality] = await measure(page, POINTS);
    await shot(page, `noon-realistic-${quality}`);
    await look(page, { quality, mode: 'noon', lamps: 'off', style: 'design' });
    await shot(page, `noon-design-${quality}`);
  }
  const means = Object.values(m).map((x) => x.mean!);
  expect((Math.max(...means) - Math.min(...means)) / Math.max(...means)).toBeLessThan(0.1);
  // An open floor patch away from objects: High is at least 90 % as bright as Low.
  expect(m.high.openFloor!).toBeGreaterThanOrEqual(0.9 * m.low.openFloor!);
  expect(m.medium.openFloor!).toBeGreaterThanOrEqual(0.9 * m.low.openFloor!);
  // The same in a few other places: no tier is systematically darker.
  for (const k of ['roomFloor', 'outdoor', 'farCorner'])
    expect(Math.abs(m.high[k]! - m.low[k]!)).toBeLessThan(0.06);
  expect(errors).toEqual([]);
});

test('night: tiers agree with lamps off and on, and every tier saves a reference picture', async ({
  page,
}) => {
  await setup(page);
  const m: Record<string, Record<string, number>> = {};
  for (const quality of ['low', 'medium', 'high'] as const)
    for (const lamps of ['off', 'on'] as const) {
      await look(page, { quality, mode: 'night', lamps, night: 0 });
      m[`${quality}-${lamps}`] = await measure(page, POINTS);
      await shot(page, `night-lamps-${lamps}-${quality}`);
    }
  for (const lamps of ['off', 'on']) {
    const means = ['low', 'medium', 'high'].map((q) => avg(m[`${q}-${lamps}`]!, INTERIOR));
    expect(Math.max(...means) - Math.min(...means)).toBeLessThan(0.06);
  }
});

test('white on white stays readable on Medium and High (edges, contact shadows)', async ({
  page,
}) => {
  await setup(page);
  await fly(page, pose34);
  for (const quality of ['medium', 'high'] as const) {
    await look(page, { quality, mode: 'noon', lamps: 'off' });
    const day = await measure(page, CONTRAST);
    // The sofa's top is clearly different from the floor beside it, and its front from the wall.
    expect(Math.abs(day.sofaTop! - day.floorBeside!)).toBeGreaterThan(0.08);
    expect(Math.abs(day.sofaMid! - day.wallHigh!)).toBeGreaterThan(0.06);
    // Contact shadow: the floor against the sofa is darker than the open floor a little further away.
    expect(day.floorOpen! - day.floorContact!).toBeGreaterThan(0.08);
    await look(page, { quality, mode: 'night', lamps: 'on', night: 0 });
    const lamp = await measure(page, CONTRAST);
    expect(Math.abs(lamp.sofaTop! - lamp.floorBeside!)).toBeGreaterThan(0.08);
    expect(lamp.floorOpen! - lamp.floorContact!).toBeGreaterThan(0.08);
  }
});

test('rooms are dark unless daylight enters or a light is on', async ({ page }) => {
  await setup(page);
  // Night, every light off, no night visibility: near black inside.
  await look(page, { quality: 'medium', mode: 'night', lamps: 'off', night: 0 });
  const dark = await measure(page, POINTS);
  expect(avg(dark, INTERIOR)).toBeLessThan(0.03);
  // The ceiling light on: the room lights up.
  await look(page, { quality: 'medium', mode: 'night', lamps: 'off', night: 0, ceilingOn: true });
  const lit = await measure(page, POINTS);
  expect(avg(lit, INTERIOR)).toBeGreaterThan(0.25);
  // Noon, lights off: it is bright where daylight comes in and dim at the far corner.
  await look(page, { quality: 'medium', mode: 'noon', lamps: 'off' });
  const day = await measure(page, POINTS);
  expect(day.nearWindow!).toBeGreaterThan(day.farCorner! * 2);
});

test('hidden ceilings and roofs still block light in a cutaway view', async ({ page }) => {
  await setup(page);
  await look(page, { quality: 'high', mode: 'noon', lamps: 'off' }); // dollhouse: the roof is hidden from the camera
  const m = await measure(page, POINTS);
  expect(m.farCorner!).toBeLessThan(0.5 * m.outdoor!);
  expect(m.openFloor!).toBeLessThan(0.75 * m.outdoor!);
});
