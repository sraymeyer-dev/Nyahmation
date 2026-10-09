import { applyMouthCues, extendedShapesFor } from '../../../engine/autoLipSync';
import { locatePart } from '../../../engine/edit';
import { encodeWav } from '../../../io/wav';
import type { LipSyncOptions } from '../../../preload/api';
import { decodeAudio } from '../audio/audioEngine';
import { store } from './store';

// Automatic lip sync (docs/DESIGN.md LS7): the chosen sound clip goes to
// Rhubarb Lip Sync in the main process, and the mouth shapes it hears come
// back as mouth changes on the timeline, in one undoable step.

export async function runAutoLipSync(mouthId: string, clipId: string, options: Omit<LipSyncOptions, 'extendedShapes'>): Promise<{ changes: number } | null> {
  const api = window.nyah;
  if (!api) throw new Error('Automatic lip sync needs the desktop app.');
  const s = store.getState();
  const clip = s.project.scene.audio.find((c) => c.id === clipId);
  const mouth = locatePart(s.project, mouthId)?.part;
  if (!clip || !mouth) throw new Error('The sound or the mouth is gone.');
  const bytes = s.assets.get(clip.assetId);
  if (!bytes) throw new Error(`The sound “${clip.name}” has no data.`);

  const buffer = await decodeAudio(bytes);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const wav = encodeWav(channels, buffer.sampleRate);
  const keys = new Set(s.project.drawingSets.find((d) => d.id === mouth.drawingSetId)?.drawings.map((d) => d.key) ?? []);
  const cues = await api.lipSync.run(wav, { ...options, extendedShapes: extendedShapesFor(keys) });

  // Apply to the project as it is now (the user may have kept working).
  const now = store.getState();
  const { project, changes } = applyMouthCues(now.project, mouthId, clip, cues);
  store.commit(project, {
    status: `Lip sync for “${clip.name}”: ${changes} mouth change${changes === 1 ? '' : 's'}. Play it to check; fix any shape by typing its letter.`,
  });
  return { changes };
}
