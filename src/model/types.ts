import type { z } from 'zod';
import type * as S from './schemas';

export type Point = z.infer<typeof S.PointSchema>;
export type Shell = z.infer<typeof S.ShellSchema>;
export type Level = z.infer<typeof S.LevelSchema>;
export type Wall = z.infer<typeof S.WallSchema>;
export type Opening = z.infer<typeof S.OpeningSchema>;
export type Room = z.infer<typeof S.RoomSchema>;
export type Stair = z.infer<typeof S.StairSchema>;
export type Column = z.infer<typeof S.ColumnSchema>;
export type Item = z.infer<typeof S.ItemSchema>;
export type Roof = z.infer<typeof S.RoofSchema>;
export type MaterialOverride = z.infer<typeof S.MaterialOverrideSchema>;
export type Settings = z.infer<typeof S.SettingsSchema>;
export type Project = z.infer<typeof S.ProjectSchema>;

export type Units = (typeof S.UNITS)[number];
export type WallType = (typeof S.WALL_TYPES)[number];
export type OpeningKind = (typeof S.OPENING_KINDS)[number];
export type RoomType = (typeof S.ROOM_TYPES)[number];
export type StairType = (typeof S.STAIR_TYPES)[number];

/** Entity collections on the project that can be selected, duplicated and deleted. */
export type EntityType = 'wall' | 'opening' | 'room' | 'stair' | 'item' | 'column' | 'roof';

export interface Selection {
  type: EntityType | null;
  ids: string[];
}

export type Tool = 'select' | 'wall' | 'room' | 'opening' | 'item' | 'stair' | 'measure';
