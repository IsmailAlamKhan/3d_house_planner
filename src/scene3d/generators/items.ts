import {
  type BufferGeometry,
  BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
} from 'three';
import { getEntry, itemSize, surfaceKey, withDefaults } from '../../catalog';
import type { Item } from '../../model/types';
import { getMaterial } from '../materials3d';
import type { ObjectPart } from './common';

/**
 * Box-style UVs in metres: each vertex is projected along the axis its normal points to, so textures keep
 * their real-world size on furniture too (UVs × texture repeat 1/scale).
 */
export function boxProjectUV(g: BufferGeometry): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  if (!pos || !nor) return;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const [u, v] =
      ay >= ax && ay >= az
        ? [pos.getX(i), pos.getZ(i)]
        : ax >= az
          ? [pos.getZ(i), pos.getY(i)]
          : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
}

/** Swaps the item's main-surface colour for a library material (textured), leaving other parts alone. */
function applyLibraryMaterial(model: Group, surfaceColor: string, material: string): void {
  const target = surfaceColor.replace('#', '').toLowerCase();
  const textured = getMaterial(material, {});
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as MeshStandardMaterial;
    if (m.color && m.color.getHexString() === target) {
      o.material = textured;
      boxProjectUV(o.geometry);
    }
  });
}

/** A furniture / fixture item, positioned on its level. Unknown catalog ids render nothing. */
export function generateItemPart(item: Item): ObjectPart | null {
  const entry = getEntry(item.catalogId);
  if (!entry) return null;
  const props = withDefaults(entry, item.props);
  const model = entry.build3D(props, itemSize(entry, item.scale));
  const key = surfaceKey(entry);
  if (typeof item.props.material === 'string' && key && typeof props[key] === 'string') {
    applyLibraryMaterial(model, props[key] as string, item.props.material);
  }
  const holder = new Group();
  // Plan rotation r ↔ rotation about Y of −r (same convention as walls and stairs).
  holder.position.set(item.position.x, item.elevation, item.position.y);
  holder.rotation.y = -item.rotation;
  holder.add(model);
  return {
    id: `item:${item.id}`,
    layer: 'item',
    entity: { type: 'item', id: item.id },
    object: holder,
  };
}
