import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { setCurrency, setUnitCost } from '../model/ops';
import { createSampleProject } from '../model/sample';
import { ProjectSchema } from '../model/schemas';
import { BOM_CATEGORIES, billOfMaterials, bomCsv, priceBom } from './bom';
import { DXF_LAYERS, planDxf } from './dxf';
import { exportGlb, exportObj } from './model3d';
import { type SvgRenderer, buildPdf, choosePaper } from './pdf';
import { mmPerMetre, planSvg, toPaperStrokes } from './planSvg';

const project = createSampleProject();
const ground = project.levels[0]!;

describe('bill of materials', () => {
  it('counts wall faces net of openings, floors by material, items, openings and stairs', () => {
    const lines = billOfMaterials(project);
    const cats = new Set(lines.map((l) => l.category));
    for (const c of ['walls', 'floors', 'openings', 'furniture', 'stairs'] as const)
      expect(cats.has(c)).toBe(true);
    // Wall area: every face of every wall minus the doors/windows cut through it (each opening is removed from both faces).
    const wallTotal = lines
      .filter((l) => l.category === 'walls')
      .reduce((s, l) => s + l.quantity, 0);
    let expected = 0;
    for (const w of project.walls) {
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      const level = project.levels.find((l) => l.id === w.levelId)!;
      const cut = project.openings
        .filter((o) => o.wallId === w.id)
        .reduce((s, o) => s + o.width * o.height, 0);
      expected += 2 * Math.max(0, len * (w.height ?? level.floorToCeiling) - cut);
    }
    expect(wallTotal).toBeCloseTo(expected, 0);
    expect(lines.filter((l) => l.category === 'stairs').reduce((s, l) => s + l.quantity, 0)).toBe(
      project.stairs.length,
    );
    expect(
      lines.filter((l) => l.category === 'furniture').reduce((s, l) => s + l.quantity, 0),
    ).toBe(project.items.length);
    expect(lines.filter((l) => l.category === 'openings').reduce((s, l) => s + l.quantity, 0)).toBe(
      project.openings.length,
    );
    // Floor area = sum of room floor areas.
    expect(
      lines.filter((l) => l.category === 'floors').reduce((s, l) => s + l.quantity, 0),
    ).toBeGreaterThan(100);
  });

  it('totals follow the unit costs and the currency', () => {
    const lines = billOfMaterials(project);
    expect(priceBom(project).total).toBe(0);
    const floor = lines.find((l) => l.category === 'floors')!;
    const door = lines.find((l) => l.category === 'openings')!;
    const priced = produce(project, (d) => {
      setUnitCost(d, floor.key, 50);
      setUnitCost(d, door.key, 200);
      setCurrency(d, 'eur');
    });
    const bom = priceBom(priced);
    expect(bom.currency).toBe('EUR');
    expect(bom.byCategory.floors).toBeCloseTo(floor.quantity * 50, 1);
    expect(bom.byCategory.openings).toBe(door.quantity * 200);
    expect(bom.total).toBeCloseTo(bom.byCategory.floors + bom.byCategory.openings, 1);
    // Changing a price changes the total.
    const dearer = produce(priced, (d) => void setUnitCost(d, floor.key, 100));
    expect(priceBom(dearer).total).toBeGreaterThan(bom.total);
    // Clearing a price (0) removes it.
    expect(
      produce(dearer, (d) => void setUnitCost(d, floor.key, 0)).costs.unitCosts[floor.key],
    ).toBeUndefined();
    expect(() => produce(project, (d) => void setUnitCost(d, 'x', -1))).toThrow();
  });

  it('exports a CSV with category subtotals and a grand total', () => {
    const floor = billOfMaterials(project).find((l) => l.category === 'floors')!;
    const csv = bomCsv(produce(project, (d) => void setUnitCost(d, floor.key, 10)));
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toContain('Quantity');
    expect(rows.some((r) => r.includes('Subtotal'))).toBe(true);
    expect(rows.at(-1)).toMatch(/^,TOTAL,,,,\d/);
    expect(BOM_CATEGORIES).toContain('walls');
  });

  it('costs are part of the saved project and old files without them still load', () => {
    const priced = produce(project, (d) => void setUnitCost(d, 'floor:floor-oak', 12));
    expect(
      ProjectSchema.parse(JSON.parse(JSON.stringify(priced))).costs.unitCosts['floor:floor-oak'],
    ).toBe(12);
    const old = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    delete old.costs;
    expect(ProjectSchema.parse(old).costs).toEqual({ currency: 'USD', unitCosts: {} });
  });
});

describe('plan SVG (to scale)', () => {
  it('is sized in millimetres so that 5 m is 100 mm at 1:50 and 50 mm at 1:100', () => {
    expect(mmPerMetre(50)).toBe(20);
    expect(mmPerMetre(100)).toBe(10);
    for (const scale of [50, 100] as const) {
      const p = planSvg(project, ground.id, { scale });
      const w = (p.box.x1 - p.box.x0) * mmPerMetre(scale);
      expect(p.widthMm).toBeCloseTo(w, 6);
      expect(p.svg).toContain(`width="${Math.round(p.widthMm * 10000) / 10000}mm"`);
      // viewBox is in metres.
      const vb = /viewBox="([^"]+)"/.exec(p.svg)![1]!.split(' ').map(Number);
      expect(vb[2]! * mmPerMetre(scale)).toBeCloseTo(p.widthMm, 2);
    }
    const p50 = planSvg(project, ground.id, { scale: 50 });
    const p100 = planSvg(project, ground.id, { scale: 100 });
    // The same building takes twice the paper at 1:50 as at 1:100 (the margins are paper-sized, so compare the building).
    const fp = project.shell.footprint.map((p) => p.x);
    const buildingW = Math.max(...fp) - Math.min(...fp);
    expect(p50.widthMm - p100.widthMm).toBeCloseTo(buildingW * 10, 0);
  });

  it('draws rooms with names and areas, wall dimensions, door swings, a north arrow and a scale bar', () => {
    const { svg } = planSvg(project, ground.id, { scale: 50 });
    expect(svg).toContain('Living room');
    expect(svg).toMatch(/\d+\.\d m²/);
    expect(svg).toContain('10.00 m'); // exterior wall dimension
    expect(svg).toContain('>N<'); // north arrow
    expect(svg).toContain('1:50');
    expect(svg).toMatch(/<text[^>]*>5<\/text>/); // scale bar to 5 m
    expect(svg).toContain('<path'); // door swing arcs
    expect(svg).not.toContain('non-scaling-stroke');
  });

  it('rewrites on-screen pixel strokes into metres', () => {
    const out = toPaperStrokes(
      '<line stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>',
      0.0125,
    );
    expect(out).toBe('<line stroke-width="0.025" stroke-dasharray="0.075 0.05"/>');
  });

  it('upper level plan shows the stair as dashed DN opening', () => {
    expect(planSvg(project, project.levels[1]!.id, { scale: 100 }).svg).toContain('DN');
    expect(planSvg(project, ground.id, { scale: 100 }).svg).toContain('UP');
  });
});

describe('DXF', () => {
  it('has separate layers for walls, openings and room labels and a valid structure', () => {
    const dxf = planDxf(project, ground.id);
    const lines = dxf.split('\n');
    expect(lines.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'HEADER']);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    const layerNames = DXF_LAYERS.map(([n]) => n);
    for (const name of layerNames) expect(dxf).toContain(`\n2\n${name}\n`);
    // Entities by layer: group code 8 follows the entity type.
    const onLayer = (layer: string, type: string) => {
      let n = 0;
      for (let i = 0; i < lines.length - 3; i++)
        if (
          lines[i] === '0' &&
          lines[i + 1] === type &&
          lines[i + 2] === '8' &&
          lines[i + 3] === layer
        )
          n++;
      return n;
    };
    expect(onLayer('WALLS', 'POLYLINE')).toBe(
      project.walls.filter((w) => w.levelId === ground.id).length,
    );
    expect(onLayer('ROOM_LABELS', 'TEXT')).toBeGreaterThanOrEqual(
      project.rooms.filter((r) => r.levelId === ground.id).length,
    );
    expect(onLayer('DOORS', 'POLYLINE')).toBeGreaterThan(0);
    expect(onLayer('WINDOWS', 'POLYLINE')).toBeGreaterThan(0);
    expect(onLayer('DOORS', 'ARC')).toBeGreaterThan(0);
  });

  it('uses millimetres with y pointing up', () => {
    const dxf = planDxf(project, ground.id);
    // The shell footprint is 10 × 12 m: x up to 10000, y down to -12000.
    expect(dxf).toContain('10000.000');
    expect(dxf).toContain('-12000.000');
  });
});

describe('3D export', () => {
  it('writes a valid binary glTF (GLB) with meshes and materials', async () => {
    const buf = await exportGlb(project, { textures: false });
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(buf.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))) as {
      meshes: unknown[];
      materials: unknown[];
      nodes: { name?: string }[];
    };
    expect(json.meshes.length).toBeGreaterThan(20);
    expect(json.materials.length).toBeGreaterThan(3);
  });

  it('can export a single level', async () => {
    const all = await exportGlb(project, { textures: false });
    const one = await exportGlb(project, { textures: false, levelId: ground.id });
    expect(one.byteLength).toBeLessThan(all.byteLength);
  });

  it('writes OBJ + MTL with consistent indices and materials', () => {
    const { obj, mtl, mtlName } = exportObj(project, { levelId: ground.id });
    expect(obj).toContain(`mtllib ${mtlName}`);
    const vCount = obj.split('\n').filter((l) => l.startsWith('v ')).length;
    expect(vCount).toBeGreaterThan(100);
    let maxIndex = 0;
    for (const l of obj.split('\n'))
      if (l.startsWith('f '))
        for (const tok of l.slice(2).split(' '))
          maxIndex = Math.max(maxIndex, Number(tok.split('/')[0]));
    expect(maxIndex).toBeLessThanOrEqual(vCount);
    const used = [...obj.matchAll(/^usemtl (\S+)/gm)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const name of new Set(used)) expect(mtl).toContain(`newmtl ${name}`);
    expect(mtl).toMatch(/Kd [\d.]+ [\d.]+ [\d.]+/);
    // Geometry is positioned in world metres: the ground level spans the 10 × 12 m footprint.
    const xs = obj
      .split('\n')
      .filter((l) => l.startsWith('v '))
      .map((l) => Number(l.split(' ')[1]));
    expect(Math.max(...xs)).toBeGreaterThan(9.5);
    expect(Math.min(...xs)).toBeLessThan(0.5);
  });
});

describe('PDF plan set', () => {
  const calls: { svg: string; box: { x: number; y: number; width: number; height: number } }[] = [];
  const stub: SvgRenderer = async (_doc, svg, box) => {
    calls.push({ svg, box });
  };

  it('chooses the smallest sheet that holds the drawing at scale', () => {
    expect(choosePaper(150, 180).name).toBe('a4');
    const big = choosePaper(200, 240);
    expect(big.name).toBe('a3');
    expect(big.fits).toBe(true);
    expect(choosePaper(5000, 5000).fits).toBe(false);
    expect(choosePaper(200, 240, 'a4').fits).toBe(false);
  });

  it('places each level at its exact scaled size: cover, one plan per level, schedule, materials', async () => {
    calls.length = 0;
    const r = await buildPdf(project, { scale: 50, date: new Date('2026-01-02') }, stub);
    expect(r.pages).toBe(1 + project.levels.length + 2);
    expect(r.placements).toHaveLength(project.levels.length);
    expect(new TextDecoder().decode(new Uint8Array(r.data, 0, 5))).toBe('%PDF-');
    for (const pl of r.placements) {
      const expected = planSvg(project, pl.levelId, { scale: 50 });
      expect(pl.widthMm).toBeCloseTo(expected.widthMm, 6);
      expect(pl.scale).toBe(50);
    }
    // 1 m of building = 20 mm of paper: the 10 m wide footprint takes 200 mm of the drawing.
    const call = calls[0]!;
    expect(
      call.box.width / (call.svg.match(/viewBox="[^ ]+ [^ ]+ ([^ ]+)/)![1] as unknown as number),
    ).toBeCloseTo(20, 4);
  });

  it('every page carries the disclaimer, and only the requested levels are drawn', async () => {
    calls.length = 0;
    const r = await buildPdf(project, { scale: 100, levelIds: [ground.id] }, stub);
    expect(r.placements).toHaveLength(1);
    expect(r.pages).toBe(1 + 1 + 2);
    // jsPDF writes text as literal strings in the content streams (uncompressed by default).
    const text = new TextDecoder('latin1').decode(new Uint8Array(r.data));
    expect((text.match(/Indicative only/g) ?? []).length).toBe(r.pages);
  });
});

describe('snapshot HTML', () => {
  const bundle = { js: 'window.__loaded = "</script><b>" + 1;', css: 'body{color:red}' };

  it('is one self-contained file with the project JSON and the viewer inlined', async () => {
    const { buildSnapshotHtml, safeJson } = await import('./snapshot');
    const tricky = produce(project, (d) => {
      d.name = 'A </script><script>alert(1)</script> "home" & more';
    });
    const html = buildSnapshotHtml(tricky, bundle, '2026-03-04');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<link[^>]+href=|<script[^>]+src=/); // nothing external
    // Exactly the two script elements we wrote, no early termination from the project name or the bundle.
    expect((html.match(/<script/g) ?? []).length).toBe(2);
    const m = /<script id="project-data"[^>]*>([\s\S]*?)<\/script>/.exec(html)!;
    expect(JSON.parse(m[1]!)).toEqual(JSON.parse(JSON.stringify(tricky)));
    expect(ProjectSchema.safeParse(JSON.parse(m[1]!)).success).toBe(true);
    expect(html).toContain('2026-03-04');
    expect(html).toContain('<\\/script><b>');
    expect(html).toContain('<style>body{color:red}</style>');
    expect(safeJson({ a: '<!--' })).not.toContain('<');
  });
});
