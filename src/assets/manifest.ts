import { z } from 'zod';

/**
 * The asset pack: free, legally reusable (CC0) 3D models, PBR textures and HDRI skies. `assets/manifest.json` lists every
 * asset with where it comes from and under which licence; nothing is used without an entry, and the downloader refuses
 * anything whose licence is not on the allow-list. The binaries themselves are not in git: `npm run assets:download`
 * (or the `assets-init` Docker service) fetches, verifies, converts and indexes them into `assets/pack/`.
 */

/** Licences that may be used. CC0 only by default; anything else needs a deliberate change here and in LICENSES.md. */
export const ALLOWED_LICENSES = ['CC0-1.0'] as const;

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Source = z.object({
  /** Where the asset is published. */
  provider: z.enum(['polyhaven', 'ambientcg', 'kenney', 'quaternius']),
  /** The page a person can open to see the asset and its licence. */
  pageUrl: z.string().url(),
  /**
   * What to download. polyhaven / ambientcg: the asset's name on the site (the API is asked for the files).
   * kenney / quaternius: the URL of the archive.
   */
  downloadUrl: z.string().url().optional(),
  /** Path of the model inside the archive. */
  entry: z.string().optional(),
  /** SHA-256 of the file that was downloaded (the archive, or the main file), pinned the first time it is fetched. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

const Common = z.object({
  id,
  name: z.string().min(1),
  source: Source,
  author: z.string().min(1),
  license: z.enum(ALLOWED_LICENSES),
  /** The page that states the licence. */
  licenseUrl: z.string().url(),
  /** The day the licence was checked and the asset downloaded. */
  downloaded: date,
  notes: z.string().optional(),
});

/** Recolouring by material slot: materials whose name matches `slot` take the item's colour property. */
const Recolor = z.object({ slot: z.string().min(1), prop: z.string().min(1).default('color') });

export const ModelAssetSchema = Common.extend({
  kind: z.literal('model'),
  /** The catalogue item this model stands in for. */
  catalogId: z.string().min(1),
  /** Real-world size in metres of the normalised model (width, depth, height); the catalogue's default size. */
  size: z.object({ w: z.number().positive(), d: z.number().positive(), h: z.number().positive() }),
  /** 0 = full detail; higher numbers are lighter copies for walkthrough distance. */
  lod: z.number().int().min(0).default(0),
  /** Turn the model by this many degrees about the vertical axis so its front faces +z (the catalogue convention). */
  rotateY: z.number().default(0),
  recolor: z.array(Recolor).default([]),
});

export const TextureAssetSchema = Common.extend({
  kind: z.literal('texture'),
  /** The library material (`floor-marble` …) whose procedural texture this replaces. */
  materialId: z.string().min(1),
  /** Metres covered by one repeat of the image. */
  scale: z.number().positive(),
  /** Multiply the albedo by this colour (a white tile used as blue pool tile). */
  tint: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const HdriAssetSchema = Common.extend({
  kind: z.literal('hdri'),
  /** Which look it lights: a clear day, dusk or night. */
  preset: z.enum(['day', 'dusk', 'night']),
});

export const AssetSchema = z.discriminatedUnion('kind', [
  ModelAssetSchema,
  TextureAssetSchema,
  HdriAssetSchema,
]);
export type Asset = z.infer<typeof AssetSchema>;
export type ModelAsset = z.infer<typeof ModelAssetSchema>;
export type TextureAsset = z.infer<typeof TextureAssetSchema>;
export type HdriAsset = z.infer<typeof HdriAssetSchema>;

export const ManifestSchema = z
  .object({
    version: z.literal(1),
    assets: z.array(AssetSchema),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.assets.forEach((a, i) => {
      if (seen.has(a.id))
        ctx.addIssue({
          code: 'custom',
          message: `duplicate asset id ${a.id}`,
          path: ['assets', i, 'id'],
        });
      seen.add(a.id);
    });
  });
export type Manifest = z.infer<typeof ManifestSchema>;

/** One file of the converted pack, as listed in `pack.json` (paths are relative to the pack folder). */
export const PackIndexSchema = z.object({
  version: z.literal(1),
  generated: z.string(),
  models: z.array(
    z.object({
      id,
      catalogId: z.string(),
      file: z.string(),
      /** The measured size of the converted model (metres): the loader checks it against the catalogue. */
      size: z.object({ w: z.number(), d: z.number(), h: z.number() }),
      recolor: z.array(Recolor).default([]),
      lod: z.number().int().default(0),
      bytes: z.number().optional(),
    }),
  ),
  textures: z.array(
    z.object({
      id,
      materialId: z.string(),
      scale: z.number(),
      albedo: z.string(),
      normal: z.string().optional(),
      roughness: z.string().optional(),
      ao: z.string().optional(),
      tint: z.string().optional(),
    }),
  ),
  hdris: z.array(z.object({ id, preset: z.enum(['day', 'dusk', 'night']), file: z.string() })),
});
export type PackIndex = z.infer<typeof PackIndexSchema>;

/** Problems that would make an asset unusable or unlawful to ship; empty when the manifest is sound. */
export function manifestProblems(m: Manifest): string[] {
  const out: string[] = [];
  for (const a of m.assets) {
    if (!(ALLOWED_LICENSES as readonly string[]).includes(a.license))
      out.push(`${a.id}: licence ${a.license} is not allowed`);
    if (!a.licenseUrl.startsWith('https://')) out.push(`${a.id}: the licence page must be https`);
    if (a.source.provider === 'kenney' || a.source.provider === 'quaternius') {
      if (!a.source.downloadUrl) out.push(`${a.id}: no download URL`);
    }
    if (a.kind === 'model' && a.source.provider !== 'polyhaven' && !a.source.entry)
      out.push(`${a.id}: no entry inside the archive`);
  }
  return out;
}
