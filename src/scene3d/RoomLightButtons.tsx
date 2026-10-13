import { Html } from '@react-three/drei';
import { Lightbulb } from 'lucide-react';
import { setRoomLights } from '../app/PropertiesPanel';
import { getEntry } from '../catalog';
import { useExportFlags } from '../export/flags';
import { labelPoint } from '../geometry/polygon';
import { useT } from '../i18n';
import { useCamera } from './camera/cameraStore';
import { lampOn, roomOfItem } from './lights';
import { useLightStyle } from './SceneLights';
import { useSceneProject } from './sceneProject';
import { useSceneStore } from './sceneStore';

/** Small "lights on / off" button floating in each room that has light fixtures (realistic lighting only). */
export function RoomLightButtons() {
  const t = useT();
  const project = useSceneProject();
  const lighting = useSceneStore((s) => s.lighting);
  const style = useLightStyle();
  const presentation = useExportFlags((s) => s.presentation);
  const walking = useCamera((s) => s.mode === 'walk');
  if (style !== 'realistic' || presentation || walking) return null;
  const lampItems = project.items.filter((i) => getEntry(i.catalogId)?.lamp);
  if (!lampItems.length) return null;
  return (
    <>
      {project.rooms.map((r) => {
        const level = project.levels.find((l) => l.id === r.levelId);
        if (!level?.visible || r.name === 'Open to below') return null;
        const mine = lampItems.filter((i) => roomOfItem(project, i)?.id === r.id);
        if (!mine.length) return null;
        const on = mine.some((i) => lampOn(project, i, lighting, r));
        const p = labelPoint(r.polygon);
        return (
          <Html
            key={r.id}
            position={[p.x, level.elevation + 0.3, p.y]}
            center
            zIndexRange={[14, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <button
              data-testid="room-light-button"
              data-on={on}
              aria-label={`${r.name}: ${on ? t('light.roomOff') : t('light.roomOn')}`}
              aria-pressed={on}
              title={`${r.name}: ${on ? t('light.roomOff') : t('light.roomOn')}`}
              onClick={() => setRoomLights([r.id], !on)}
              style={{ pointerEvents: 'auto' }}
              className={`rounded-full border p-1 shadow ${on ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-slate-300 bg-white/90 text-slate-500'}`}
            >
              <Lightbulb size={14} />
            </button>
          </Html>
        );
      })}
    </>
  );
}
