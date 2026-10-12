export const en = {
  'app.title': 'Duplex Designer',
  'project.name': 'Project name',
  'project.defaultName': 'My Duplex Home',
  'topbar.undo': 'Undo',
  'topbar.redo': 'Redo',
  'topbar.export': 'Export',
  'view.2d': '2D',
  'view.3d': '3D',
  'view.split': 'Split',
  'sidebar.library': 'Library',
  'sidebar.levels': 'Levels',
  'sidebar.ai': 'AI Assistant',
  'sidebar.empty': 'Nothing here yet.',
  'properties.title': 'Properties',
  'properties.empty': 'Select something to see its properties.',
  'status.units': 'Units',
  'status.snap': 'Snap',
  'status.on': 'On',
  'status.off': 'Off',
  'status.cursor': 'Cursor',
  'drawer.left': 'Tools',
  'drawer.right': 'Properties',
  'drawer.close': 'Close',
} as const;

export type TranslationKey = keyof typeof en;
export type Translations = Record<TranslationKey, string>;
