import type { AudioClip, Project } from '../../../engine/types';
import { store } from '../editor/store';

// Sound in the editor (docs/DESIGN.md A7, LS2): decoding clips, playback that
// drives the playhead from the audio clock (so picture and sound can't drift
// apart), short snippets while stepping or scrubbing, and waveform data.

let ctx: AudioContext | null = null;
function context(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const buffers = new Map<string, AudioBuffer | 'loading' | 'failed'>();

// Decoding uses an offline context, so importing a sound never needs (or
// wakes) the sound card. Everything is decoded at 48 kHz, the export rate.
let decoder: OfflineAudioContext | null = null;

/** Decodes an audio file. Used on import (to learn its length) and for playback. */
export async function decodeAudio(bytes: Uint8Array): Promise<AudioBuffer> {
  decoder ??= new OfflineAudioContext(2, 1, 48000);
  return decoder.decodeAudioData(bytes.slice().buffer);
}

/** The decoded sound for a clip's asset, starting the decode if needed. */
export function clipBuffer(assetId: string): AudioBuffer | null {
  const entry = buffers.get(assetId);
  if (entry instanceof AudioBuffer) return entry;
  if (entry) return null;
  const bytes = store.getState().assets.get(assetId);
  if (!bytes) return null;
  buffers.set(assetId, 'loading');
  decodeAudio(bytes)
    .then((b) => {
      buffers.set(assetId, b);
      store.set((s) => ({ audioVersion: s.audioVersion + 1 }));
    })
    .catch(() => buffers.set(assetId, 'failed'));
  return null;
}

// ---- Playback --------------------------------------------------------------------

let playing: AudioBufferSourceNode[] = [];

function stopSources(): void {
  for (const s of playing) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  playing = [];
}

function schedule(clip: AudioClip, fps: number, fromSeconds: number, length?: number): void {
  const buffer = clipBuffer(clip.assetId);
  if (!buffer || clip.muted || clip.volume <= 0) return;
  const c = context();
  const offset = fromSeconds - clip.startFrame / fps;
  if (offset >= buffer.duration) return;
  const source = c.createBufferSource();
  source.buffer = buffer;
  const gain = c.createGain();
  source.connect(gain).connect(c.destination);
  const now = c.currentTime + 0.01;
  if (length !== undefined) {
    // A short snippet: fade in and out so it doesn't click.
    if (offset < 0) return;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(clip.volume, now + 0.005);
    gain.gain.setValueAtTime(clip.volume, now + length - 0.008);
    gain.gain.linearRampToValueAtTime(0, now + length);
    source.start(now, offset, length);
  } else {
    gain.gain.value = clip.volume;
    if (offset < 0) source.start(now - offset, 0);
    else source.start(now, offset);
  }
  playing.push(source);
}

/**
 * A clock for playback, in seconds. It is the audio hardware's clock when
 * sound can play, so the picture follows the sound exactly; otherwise (no
 * sound device) the ordinary system clock.
 */
export function playbackClock(): () => number {
  const c = context();
  if (c.state === 'running') return () => c.currentTime;
  return () => performance.now() / 1000;
}

/** Starts every clip from `frame`. */
export function playFrom(project: Project, frame: number): void {
  stopSources();
  const fps = project.scene.fps;
  for (const clip of project.scene.audio) schedule(clip, fps, frame / fps);
}

export function stopPlayback(): void {
  stopSources();
}

/** Plays about one and a half frames of sound at `frame` (hearing each frame while stepping). */
export function scrubAt(project: Project, frame: number): void {
  stopSources();
  const fps = project.scene.fps;
  for (const clip of project.scene.audio) schedule(clip, fps, frame / fps, Math.max(0.05, 1.5 / fps));
}

// ---- Waveforms -----------------------------------------------------------------------

const PEAKS_PER_FRAME = 4;
const peakCache = new Map<string, Float32Array>();

/** Loudness (0–1) in quarter-frame steps, for drawing a clip's waveform. */
export function clipPeaks(assetId: string, fps: number): { peaks: Float32Array; perFrame: number } | null {
  const buffer = clipBuffer(assetId);
  if (!buffer) return null;
  const key = `${assetId}@${fps}`;
  let peaks = peakCache.get(key);
  if (!peaks) {
    const step = buffer.sampleRate / fps / PEAKS_PER_FRAME;
    const count = Math.ceil(buffer.length / step);
    peaks = new Float32Array(count);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < count; i++) {
        let max = peaks[i]!;
        const end = Math.min(data.length, Math.floor((i + 1) * step));
        for (let j = Math.floor(i * step); j < end; j++) {
          const v = Math.abs(data[j]!);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
    }
    peakCache.set(key, peaks);
  }
  return { peaks, perFrame: PEAKS_PER_FRAME };
}

// ---- Mixing for export -------------------------------------------------------------------

/** Mixes all clips for frames [first, last] into stereo at 48 kHz (for the exported video). */
export async function mixdown(project: Project, assets: ReadonlyMap<string, Uint8Array>, first: number, last: number): Promise<AudioBuffer | null> {
  const clips = project.scene.audio.filter((c) => !c.muted && c.volume > 0 && assets.has(c.assetId));
  if (clips.length === 0) return null;
  const fps = project.scene.fps;
  const sampleRate = 48000;
  const seconds = (last - first + 1) / fps;
  const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
  for (const clip of clips) {
    const buffer = await decodeAudio(assets.get(clip.assetId)!);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    const gain = offline.createGain();
    gain.gain.value = clip.volume;
    source.connect(gain).connect(offline.destination);
    const at = (clip.startFrame - first) / fps;
    if (at >= seconds || at + buffer.duration <= 0) continue;
    if (at >= 0) source.start(at);
    else source.start(0, -at);
  }
  return offline.startRendering();
}
