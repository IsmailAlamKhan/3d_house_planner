import { createContext, useContext } from 'react';
import { useModel } from '../model/store';
import type { Project } from '../model/types';

/** Lets a 3D scene show a project other than the one being edited (the design comparison does this). */
interface SceneProject {
  project: Project;
  /** Clicks select nothing (the project is not the live one). */
  readOnly: boolean;
}

const Ctx = createContext<SceneProject | null>(null);

export const SceneProjectProvider = Ctx.Provider;

/** The project the surrounding 3D scene draws: the live one unless a provider says otherwise. */
export function useSceneProject(): Project {
  const override = useContext(Ctx);
  const live = useModel((s) => s.project);
  return override?.project ?? live;
}

export function useSceneReadOnly(): boolean {
  return useContext(Ctx)?.readOnly ?? false;
}
