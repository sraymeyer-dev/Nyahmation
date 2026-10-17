import { encodeWav } from '../../../io/wav';
import { decodeAudio } from './audioEngine';

// Recording dialogue from the microphone (docs/DESIGN.md AU6). The sound is
// kept as a WAV file (one channel, the decoder's 48 kHz), like an imported
// one, so lip sync, export and saving treat it the same.

export interface Recording {
  /** How loud the microphone is right now, 0–1. */
  level(): number;
  /** Seconds since recording started. */
  elapsed(): number;
  /** Stops and returns the recording as WAV bytes. */
  stop(): Promise<{ wav: Uint8Array; seconds: number }>;
  /** Stops and throws the recording away. */
  cancel(): void;
}

/** Plain words for why the microphone can't be used. */
function microphoneProblem(err: unknown): Error {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return new Error('Nyahmation isn’t allowed to use the microphone.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('No microphone was found. Plug one in (or a headset) and try again.');
  if (name === 'NotReadableError') return new Error('The microphone is being used by another program.');
  return new Error(`The microphone couldn't be started (${(err as Error)?.message ?? err}).`);
}

export async function startRecording(): Promise<Recording> {
  let stream: MediaStream;
  try {
    // Dialogue sounds most natural without the processing meant for calls.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (err) {
    throw microphoneProblem(err);
  }
  const meter = new AudioContext();
  const analyser = meter.createAnalyser();
  analyser.fftSize = 1024;
  meter.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();
  const started = performance.now();

  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    void meter.close();
  };

  return {
    level() {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      return Math.min(1, peak);
    },
    elapsed: () => (performance.now() - started) / 1000,
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      release();
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const buffer = await decodeAudio(new Uint8Array(await blob.arrayBuffer()));
      // One channel: the average of what was recorded.
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
      }
      return { wav: encodeWav([mono], buffer.sampleRate), seconds: buffer.duration };
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}
