import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { parseProject, ProjectFormatError } from '../engine/project';
import type { Project } from '../engine/types';

// A .nyah file is a zip archive (docs/DESIGN.md F1):
//   project.json      the document
//   assets/<id>       embedded audio and images, referenced by Project.assets

const PROJECT_ENTRY = 'project.json';
const ASSET_DIR = 'assets/';

export interface ProjectBundle {
  project: Project;
  /** Asset bytes by asset id. */
  assets: Map<string, Uint8Array>;
}

export function packProject({ project, assets }: ProjectBundle): Uint8Array {
  const files: Zippable = {
    [PROJECT_ENTRY]: strToU8(JSON.stringify(project, null, 2)),
  };
  for (const ref of project.assets) {
    const bytes = assets.get(ref.id);
    if (!bytes) throw new Error(`Asset "${ref.name}" (${ref.id}) is missing its data.`);
    // Audio and images are already compressed; storing them avoids wasted work.
    files[ASSET_DIR + ref.id] = [bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

export function unpackProject(bytes: Uint8Array): ProjectBundle {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ProjectFormatError("This file isn't a Nyahmation project (it isn't a valid archive).");
  }
  const json = entries[PROJECT_ENTRY];
  if (!json) throw new ProjectFormatError("This file isn't a Nyahmation project (project.json is missing).");

  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch {
    throw new ProjectFormatError('The project data is damaged (project.json is not valid JSON).');
  }
  const project = parseProject(raw);

  const assets = new Map<string, Uint8Array>();
  for (const ref of project.assets) {
    const data = entries[ASSET_DIR + ref.id];
    if (!data) throw new ProjectFormatError(`The project is missing the file for "${ref.name}".`);
    assets.set(ref.id, data);
  }
  return { project, assets };
}
