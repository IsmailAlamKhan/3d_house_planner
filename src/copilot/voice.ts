/** Voice input for the copilot: record in the browser, make a 16 kHz mono WAV, send it to the local whisper service. */

/** 16-bit PCM mono WAV bytes for samples in −1…1. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return buf;
}

/** Linear resampling (speech does not need better), to 16 kHz for whisper. */
export function resample(samples: Float32Array, from: number, to = 16000): Float32Array {
  if (from === to) return samples;
  const n = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(n);
  const k = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * k;
    const a = Math.floor(x);
    const b = Math.min(samples.length - 1, a + 1);
    out[i] = samples[a]! * (1 - (x - a)) + samples[b]! * (x - a);
  }
  return out;
}

/** Does the server have a speech service running? (The microphone button is hidden when it does not.) */
export async function voiceAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch('/api/voice/health', { signal });
    if (!r.ok) return false;
    const j = (await r.json()) as { configured?: boolean; reachable?: boolean };
    return !!j.configured && !!j.reachable;
  } catch {
    return false;
  }
}

/** Sends a recording and returns the text. `language`: `en`, `bn` or `auto`. */
export async function transcribe(
  wav: ArrayBuffer,
  language: 'en' | 'bn' | 'auto',
  signal?: AbortSignal,
): Promise<string> {
  const r = await fetch(`/api/voice/transcribe?language=${language}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
    signal,
  });
  const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!r.ok) throw new Error(j.error ?? `Speech service error ${r.status}`);
  return j.text ?? '';
}

/** A recording in progress: call `stop()` to get the text. */
export interface Recording {
  stop: () => Promise<string>;
  cancel: () => void;
}

export async function startRecording(language: 'en' | 'bn' | 'auto'): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    cancel: () => {
      rec.stop();
      release();
    },
    stop: () =>
      new Promise<string>((resolve, reject) => {
        rec.onstop = () => {
          release();
          void (async () => {
            try {
              const bytes = await new Blob(chunks).arrayBuffer();
              const ctx = new AudioContext();
              const audio = await ctx.decodeAudioData(bytes);
              void ctx.close();
              const mono = audio.getChannelData(0);
              resolve(await transcribe(encodeWav(resample(mono, audio.sampleRate)), language));
            } catch (e) {
              reject(e);
            }
          })();
        };
        rec.stop();
      }),
  };
}
