import { Group } from 'three';
import { getEntry, itemSize, withDefaults } from '../../catalog';
import type { Item } from '../../model/types';
import type { ObjectPart } from './common';

/** A furniture / fixture item, positioned on its level. Unknown catalog ids render nothing. */
export function generateItemPart(item: Item): ObjectPart | null {
  const entry = getEntry(item.catalogId);
  if (!entry) return null;
  const model = entry.build3D(withDefaults(entry, item.props), itemSize(entry, item.scale));
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
