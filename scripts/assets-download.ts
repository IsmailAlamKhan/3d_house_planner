/**
 * `npm run assets:download` — fetch, verify, convert and index the CC0 asset pack described by `assets/manifest.json`.
 *
 *   npm run assets:download                 # everything not already in assets/pack
 *   npm run assets:download -- --pin        # record the SHA-256 of every downloaded file in the manifest
 *   npm run assets:download -- --only sofa-u,hdri-day   # just these ids
 *   npm run assets:download -- --force      # rebuild even if the converted file exists
 *
 * Environment: ASSETS_DIR (default `assets`) holds `manifest.json`, `.cache/` (raw downloads) and `pack/` (the result).
 *
 * What it does for each asset: refuses anything whose licence is not on the allow-list; downloads the raw files into the
 * cache (resumable, retried); checks the pinned SHA-256; then converts —
 *   models   → one optimised `.glb`: turned to face +z, scaled to the real-world size, footprint centred, standing on
 *              the floor, de-duplicated, pruned, welded, textures resized to ≤ 2048 px as WebP, Meshopt-compressed;
 *   textures → albedo / normal / roughness / AO as WebP, ≤ 2048 px;
 *   HDRIs    → the `.hdr` file as is (1k);
 * and writes `pack/pack.json`, the index the app reads. The binaries are never committed to git.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { unzipSync } from 'fflate';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions';
import {
  type Asset,
  type Manifest,
  ManifestSchema,
  type ModelAsset,
  type PackIndex,
  type TextureAsset,
  manifestProblems,
} from '../src/assets/manifest';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string) => args.includes(`--${n}`);
const ROOT = process.env.ASSETS_DIR ?? 'assets';
const MANIFEST = join(ROOT, 'manifest.json');
const CACHE = join(ROOT, '.cache');
const PACK = join(ROOT, 'pack');
const UA = 'duplex-designer-asset-pack (https://github.com/; CC0 assets only)';
const only = flag('only')?.split(',');

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const ensure = (p: string) => mkdirSync(dirname(p), { recursive: true });

/** Download to the cache (resumable via a complete-file check; retried), returning the bytes. */
async function fetchBytes(url: string, cacheName: string): Promise<Buffer> {
  const file = join(CACHE, cacheName);
  if (existsSync(file) && statSync(file).size > 0) return readFileSync(file);
  ensure(file);
  let last: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(900_000),
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const expected = Number(r.headers.get('content-length') ?? 0);
      if (expected && buf.length !== expected)
        throw new Error(`incomplete (${buf.length} of ${expected} bytes)`);
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      last = e;
      console.warn(`  retry ${attempt}/5 for ${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`could not download ${url}: ${(last as Error).message}`);
}

const manifest: Manifest = ManifestSchema.parse(JSON.parse(readFileSync(MANIFEST, 'utf8')));
const problems = manifestProblems(manifest);
if (problems.length) {
  console.error(`The manifest has problems:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

/** Verify (or, with --pin, record) the hash of the file an asset was made from. */
function checkHash(a: Asset, bytes: Buffer, what: string): void {
  const h = sha256(bytes);
  if (a.source.sha256 && a.source.sha256 !== h)
    throw new Error(
      `${a.id}: ${what} has SHA-256 ${h}, the manifest pins ${a.source.sha256}. The file changed upstream; check it and re-pin.`,
    );
  if (!a.source.sha256) {
    if (has('pin')) a.source.sha256 = h;
    else console.warn(`  ${a.id}: not pinned yet (run with --pin to record ${h.slice(0, 12)}…)`);
  }
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// ───────────────────────────── models ─────────────────────────────

/** The model's bytes + any files it refers to, as a glTF document. */
async function readModel(a: ModelAsset): Promise<{ doc: Document; hashed: Buffer }> {
  const s = a.source;
  if (s.provider === 'polyhaven') {
    const files = (await (
      await fetch(`https://api.polyhaven.com/files/${a.id.replace(/^ph-/, '')}`, {
        headers: { 'User-Agent': UA },
      })
    ).json()) as {
      gltf?: Record<string, { gltf: { url: string; include?: Record<string, { url: string }> } }>;
    };
    const res = files.gltf?.['1k'] ?? files.gltf?.['2k'];
    if (!res) throw new Error(`${a.id}: Poly Haven has no glTF for it`);
    const dir = join(CACHE, 'polyhaven', a.id);
    const main = await fetchBytes(res.gltf.url, `polyhaven/${a.id}/model.gltf`);
    for (const [rel, f] of Object.entries(res.gltf.include ?? {}))
      await fetchBytes(f.url, `polyhaven/${a.id}/${rel}`);
    const doc = await io.read(join(dir, 'model.gltf'));
    return { doc, hashed: main };
  }
  // archives (Kenney, Quaternius): download once, pick the entry
  const zipBytes = await fetchBytes(
    s.downloadUrl!,
    `archives/${posix.basename(new URL(s.downloadUrl!).pathname)}`,
  );
  const entries = unzipSync(new Uint8Array(zipBytes), {
    filter: (f) =>
      f.name === s.entry ||
      (f.name.startsWith(`${posix.dirname(s.entry!)}/`) &&
        /\.(png|jpg|jpeg|bin|webp)$/i.test(f.name)),
  });
  const raw = entries[s.entry!];
  if (!raw) throw new Error(`${a.id}: ${s.entry} is not in the archive`);
  const dir = join(CACHE, 'extracted', a.id);
  const target = join(dir, posix.basename(s.entry!));
  ensure(target);
  writeFileSync(target, raw);
  for (const [name, data] of Object.entries(entries)) {
    if (name === s.entry) continue;
    const side = join(dir, posix.relative(posix.dirname(s.entry!), name));
    ensure(side);
    writeFileSync(side, data);
  }
  return { doc: await io.read(target), hashed: zipBytes };
}

async function convertModel(a: ModelAsset): Promise<PackIndex['models'][number]> {
  const { doc, hashed } = await readModel(a);
  checkHash(a, hashed, 'the download');
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
  // 1. face +z, then scale to the real size, centre the footprint, stand on the floor
  const group = doc
    .createNode('normalise')
    .setRotation([
      0,
      Math.sin((a.rotateY * Math.PI) / 360),
      0,
      Math.cos((a.rotateY * Math.PI) / 360),
    ]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    group.addChild(child);
  }
  scene.addChild(group);
  let b = getBounds(scene);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const scale: [number, number, number] = [
    a.size.w / Math.max(size[0]!, 1e-6),
    a.size.h / Math.max(size[1]!, 1e-6),
    a.size.d / Math.max(size[2]!, 1e-6),
  ];
  const q = group.getRotation();
  group.setScale(scale);
  b = getBounds(scene);
  void q;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  group.setTranslation([
    group.getTranslation()[0] - cx,
    group.getTranslation()[1] - b.min[1],
    group.getTranslation()[2] - cz,
  ]);
  // 2. optimise
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  const out = join(PACK, 'models', `${a.id}.glb`);
  ensure(out);
  const glb = await io.writeBinary(doc);
  writeFileSync(out, glb);
  const fb = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!);
  return {
    id: a.id,
    catalogId: a.catalogId,
    file: `models/${a.id}.glb`,
    size: { w: fb.max[0] - fb.min[0], d: fb.max[2] - fb.min[2], h: fb.max[1] - fb.min[1] },
    recolor: a.recolor,
    lod: a.lod,
    bytes: glb.length,
  };
}

// ───────────────────────────── textures ─────────────────────────────

const MAPS: Record<string, RegExp> = {
  albedo: /_Color\.(jpg|png)$/i,
  normal: /_NormalGL\.(jpg|png)$/i,
  roughness: /_Roughness\.(jpg|png)$/i,
  ao: /_AmbientOcclusion\.(jpg|png)$/i,
};

async function convertTexture(a: TextureAsset): Promise<PackIndex['textures'][number]> {
  const name = a.source.downloadUrl
    ? posix.basename(new URL(a.source.downloadUrl).searchParams.get('file') ?? a.id)
    : `${a.id}_1K-JPG.zip`;
  const url = a.source.downloadUrl ?? `https://ambientcg.com/get?file=${name}`;
  const zipBytes = await fetchBytes(url, `archives/${name}`);
  checkHash(a, zipBytes, 'the download');
  const files = unzipSync(new Uint8Array(zipBytes));
  const out: Record<string, string> = {};
  for (const [kind, re] of Object.entries(MAPS)) {
    const f = Object.keys(files).find((n) => re.test(n));
    if (!f) continue;
    const rel = `textures/${a.id}/${kind}.webp`;
    const file = join(PACK, rel);
    ensure(file);
    // keep every map at the same size (≤ 2048) so one repeat value serves all
    await sharp(Buffer.from(files[f]!))
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: kind === 'normal' ? 90 : 82 })
      .toFile(file);
    out[kind] = rel;
  }
  if (!out.albedo) throw new Error(`${a.id}: the archive has no colour map`);
  return {
    id: a.id,
    materialId: a.materialId,
    scale: a.scale,
    albedo: out.albedo!,
    normal: out.normal,
    roughness: out.roughness,
    ao: out.ao,
    tint: a.tint,
  };
}

// ───────────────────────────── HDRIs ─────────────────────────────

async function convertHdri(
  a: Extract<Asset, { kind: 'hdri' }>,
): Promise<PackIndex['hdris'][number]> {
  const name = a.id.replace(/^hdri-/, '');
  const url =
    a.source.downloadUrl ?? `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${name}_1k.hdr`;
  const bytes = await fetchBytes(url, `hdri/${name}_1k.hdr`);
  checkHash(a, bytes, 'the download');
  const rel = `hdri/${a.id}.hdr`;
  const file = join(PACK, rel);
  ensure(file);
  writeFileSync(file, bytes);
  return { id: a.id, preset: a.preset, file: rel };
}

// ───────────────────────────── main ─────────────────────────────

const index: PackIndex = {
  version: 1,
  generated: new Date().toISOString(),
  models: [],
  textures: [],
  hdris: [],
};
const prev = existsSync(join(PACK, 'pack.json'))
  ? (JSON.parse(readFileSync(join(PACK, 'pack.json'), 'utf8')) as PackIndex)
  : null;
let failures = 0;
const todo = manifest.assets.filter((a) => !only || only.includes(a.id));
for (const a of todo) {
  const done =
    prev &&
    (a.kind === 'model'
      ? prev.models.some((m) => m.id === a.id)
      : a.kind === 'texture'
        ? prev.textures.some((t) => t.id === a.id)
        : prev.hdris.some((h) => h.id === a.id));
  try {
    if (done && !has('force') && !has('pin')) {
      if (a.kind === 'model') index.models.push(prev!.models.find((m) => m.id === a.id)!);
      else if (a.kind === 'texture')
        index.textures.push(prev!.textures.find((t) => t.id === a.id)!);
      else index.hdris.push(prev!.hdris.find((h) => h.id === a.id)!);
      continue;
    }
    process.stdout.write(`${a.kind} ${a.id} … `);
    if (a.kind === 'model') index.models.push(await convertModel(a));
    else if (a.kind === 'texture') index.textures.push(await convertTexture(a));
    else index.hdris.push(await convertHdri(a));
    console.log('ok');
  } catch (e) {
    failures++;
    console.log(`FAILED: ${(e as Error).message}`);
  }
}
// keep what an earlier run produced for assets outside this run (--only)
if (only && prev) {
  for (const m of prev.models)
    if (!index.models.some((x) => x.id === m.id) && !only.includes(m.id)) index.models.push(m);
  for (const t of prev.textures)
    if (!index.textures.some((x) => x.id === t.id) && !only.includes(t.id)) index.textures.push(t);
  for (const h of prev.hdris)
    if (!index.hdris.some((x) => x.id === h.id) && !only.includes(h.id)) index.hdris.push(h);
}
ensure(join(PACK, 'pack.json'));
writeFileSync(join(PACK, 'pack.json'), JSON.stringify(index, null, 1));
if (has('pin')) writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Pack: ${index.models.length} models, ${index.textures.length} textures, ${index.hdris.length} HDRIs → ${PACK}${failures ? ` (${failures} failed)` : ''}`,
);
process.exit(failures ? 1 : 0);
