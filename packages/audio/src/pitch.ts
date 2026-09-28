/**
 * Monophonic pitch detection (hum / sing / play correction input).
 *
 * PURE DSP + bookkeeping: no DOM, no Web Audio, no I/O. The capture adapter
 * (`hum-input.ts`) feeds PCM blocks into `PitchStream` and turns the emitted
 * frames into `HumNote`s via `segmentHumNotes`.
 *
 * Detector: YIN (de Cheveigné & Kawahara, 2002) — difference function →
 * cumulative-mean-normalised difference → absolute threshold → parabolic
 * interpolation. Robust on the voice, cheap enough for real time, and fully
 * deterministic so it can be unit-tested against synthetic tones. A WASM
 * port of the same interface can replace `yinFrame` later without touching
 * the segmentation or the editor (see ARCHITECTURE "ports & adapters").
 */

export interface YinOptions {
  /** Lowest fundamental to accept (Hz). */
  readonly minHz?: number;
  /** Highest fundamental to accept (Hz). */
  readonly maxHz?: number;
  /** Absolute threshold on the normalised difference (lower = stricter). */
  readonly threshold?: number;
  /** RMS below this is silence (unvoiced). */
  readonly rmsFloor?: number;
}

const DEFAULTS = {
  minHz: 70, // low E2-ish for guitar / male voice
  maxHz: 1000,
  threshold: 0.15,
  rmsFloor: 0.004,
} as const;

/** RMS level of a block (cheap loudness gate). */
export function rmsOf(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i++) {
    const v = block[i] ?? 0;
    sum += v * v;
  }
  return block.length > 0 ? Math.sqrt(sum / block.length) : 0;
}

/**
 * Fundamental frequency of one analysis window, or null when unvoiced.
 * `frame` must hold at least `2 * maxLag` samples; the first half is the
 * comparison window, the second half the look-ahead used by the difference
 * function.
 */
export function yinFrame(frame: Float32Array, sampleRate: number, options: YinOptions = {}): number | null {
  const minHz = options.minHz ?? DEFAULTS.minHz;
  const maxHz = options.maxHz ?? DEFAULTS.maxHz;
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const rmsFloor = options.rmsFloor ?? DEFAULTS.rmsFloor;

  const half = frame.length >> 1;
  if (half < 8) return null;
  if (rmsOf(frame) < rmsFloor) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(half - 1, Math.ceil(sampleRate / minHz));
  if (tauMax <= tauMin) return null;

  // 1. difference function d(τ)
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let acc = 0;
    for (let j = 0; j < half; j++) {
      const a = frame[j] ?? 0;
      const b = frame[j + tau] ?? 0;
      const diff = a - b;
      acc += diff * diff;
    }
    d[tau] = acc;
  }

  // 2. cumulative-mean-normalised difference d'(τ)
  const cmndf = new Float32Array(tauMax + 1);
  cmndf[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau] ?? 0;
    cmndf[tau] = running > 0 ? ((d[tau] ?? 0) * tau) / running : 1;
  }

  // 3. absolute threshold: first τ in range below the threshold, refined to
  //    the local minimum that follows it (the classic YIN rule)
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    const v = cmndf[t] ?? 1;
    if (v < threshold) {
      while (t + 1 <= tauMax && (cmndf[t + 1] ?? 1) < (cmndf[t] ?? 1)) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // nothing crossed the threshold — fall back to the global minimum if it
    // is still a plausible pitch, otherwise report unvoiced
    let best = -1;
    let bestVal = Number.POSITIVE_INFINITY;
    for (let t = tauMin; t <= tauMax; t++) {
      const v = cmndf[t] ?? 1;
      if (v < bestVal) {
        bestVal = v;
        best = t;
      }
    }
    if (best < 0 || bestVal > threshold * 2.2) return null;
    tau = best;
  }

  // 4. parabolic interpolation around τ for sub-sample accuracy
  const betterTau = parabolic(cmndf, tau, tauMax);
  const hz = sampleRate / betterTau;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;
  return hz;
}

function parabolic(cmndf: Float32Array, tau: number, tauMax: number): number {
  if (tau <= 0 || tau >= tauMax) return tau;
  const s0 = cmndf[tau - 1] ?? 1;
  const s1 = cmndf[tau] ?? 1;
  const s2 = cmndf[tau + 1] ?? 1;
  const denom = 2 * (2 * s1 - s2 - s0);
  if (denom === 0) return tau;
  const shift = (s2 - s0) / denom;
  if (!Number.isFinite(shift) || Math.abs(shift) > 1) return tau;
  return tau + shift;
}

/** MIDI note number for a frequency (fractional; 69 = A4 = 440 Hz). */
export function midiFromHz(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Frequency of a MIDI note number. */
export function hzFromMidi(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Framing: raw PCM blocks → a regular stream of pitch frames
// ---------------------------------------------------------------------------

export interface PitchFrame {
  /** Seconds since the stream started. */
  readonly tSec: number;
  /** Detected fundamental, or null when the window is unvoiced. */
  readonly hz: number | null;
  /** RMS of the window (input level metering). */
  readonly rms: number;
}

export interface PitchStreamOptions extends YinOptions {
  readonly sampleRate?: number;
  /** Analysis window in samples (default 2048 ≈ 43 ms @ 48 kHz). */
  readonly windowSize?: number;
  /** Hop between analyses in samples (default 256 ≈ 5 ms @ 48 kHz). */
  readonly hopSize?: number;
}

/**
 * Accumulates PCM blocks and emits one `PitchFrame` per hop. Owns its sample
 * clock so frame timestamps are exact regardless of block size.
 */
export class PitchStream {
  private readonly sampleRate: number;
  private readonly windowSize: number;
  private readonly hopSize: number;
  private readonly options: YinOptions;
  private readonly buffer: Float32Array;
  private fill = 0;
  private samplesSeen = 0;
  private readonly pending: Float32Array[] = [];

  constructor(options: PitchStreamOptions = {}) {
    this.sampleRate = options.sampleRate ?? 48000;
    this.windowSize = options.windowSize ?? 2048;
    this.hopSize = options.hopSize ?? 256;
    this.options = options;
    this.buffer = new Float32Array(this.windowSize);
  }

  /** Seconds per analysis hop (the frame cadence). */
  get hopSec(): number {
    return this.hopSize / this.sampleRate;
  }

  /** Consumes a block of PCM; returns the frames it completed. */
  push(block: Float32Array): PitchFrame[] {
    this.pending.push(block);
    return this.drain(false);
  }

  /** Analyses whatever is left in the window (call on stop). */
  flush(): PitchFrame[] {
    return this.drain(true);
  }

  private drain(final: boolean): PitchFrame[] {
    const out: PitchFrame[] = [];
    for (const block of this.pending.splice(0)) {
      let offset = 0;
      while (offset < block.length) {
        const take = Math.min(this.windowSize - this.fill, block.length - offset);
        this.buffer.set(block.subarray(offset, offset + take), this.fill);
        this.fill += take;
        this.samplesSeen += take;
        offset += take;
        if (this.fill < this.windowSize) break;
        const tSec = (this.samplesSeen - this.windowSize) / this.sampleRate;
        out.push({
          tSec,
          hz: yinFrame(this.buffer, this.sampleRate, this.options),
          rms: rmsOf(this.buffer),
        });
        // advance by one hop, keeping the overlap
        this.buffer.copyWithin(0, this.hopSize);
        this.fill -= this.hopSize;
      }
    }
    if (final && this.fill > this.windowSize >> 1) {
      const tSec = (this.samplesSeen - this.fill) / this.sampleRate;
      out.push({
        tSec,
        hz: yinFrame(this.buffer.subarray(0, this.fill), this.sampleRate, this.options),
        rms: rmsOf(this.buffer.subarray(0, this.fill)),
      });
      this.fill = 0;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Segmentation: pitch frames → sung notes
// ---------------------------------------------------------------------------

export interface HumNote {
  /** MIDI note number (rounded to the nearest semitone). */
  readonly midi: number;
  /** Median fundamental over the note (Hz). */
  readonly hz: number;
  readonly startSec: number;
  readonly endSec: number;
}

export interface SegmentOptions {
  /** Frames of silence that end a note (default 3 ≈ 15 ms at a 5 ms hop). */
  readonly gapFrames?: number;
  /** Frames a pitch must hold before a jump splits the note (vibrato guard). */
  readonly holdFrames?: number;
  /** Minimum note length in seconds (shorter bursts are dropped). */
  readonly minNoteSec?: number;
  /** Pitch jump, in semitones, that starts a new note. */
  readonly splitSemitones?: number;
}

/**
 * Turns a monophonic pitch stream into sung notes. Bridges short unvoiced
 * gaps (consonants) and ignores sub-semitone wobble (vibrato) so a wobbly
 * sung pitch becomes ONE note, not many.
 */
export function segmentHumNotes(frames: readonly PitchFrame[], options: SegmentOptions = {}): HumNote[] {
  const gapFrames = options.gapFrames ?? 3;
  const holdFrames = options.holdFrames ?? 3;
  const minNoteSec = options.minNoteSec ?? 0.08;
  const splitSemitones = options.splitSemitones ?? 0.8;
  if (frames.length === 0) return [];

  // ---- pass 1: clean the stream ------------------------------------------
  // carry the pitch across short unvoiced gaps (consonants) and drop isolated
  // voiced blips surrounded by silence
  type Clean = { readonly tSec: number; readonly hz: number | null };
  const cleaned: Clean[] = frames.map((f) => ({ tSec: f.tSec, hz: f.hz }));
  {
    let i = 0;
    while (i < cleaned.length) {
      if (cleaned[i]?.hz !== null) {
        i++;
        continue;
      }
      let j = i;
      while (j < cleaned.length && cleaned[j]?.hz === null) j++;
      const gapLen = j - i;
      const prev = i > 0 ? cleaned[i - 1] : undefined;
      const next = j < cleaned.length ? cleaned[j] : undefined;
      if (gapLen <= gapFrames && prev?.hz != null && next?.hz != null) {
        for (let k = i; k < j; k++) {
          const slot = cleaned[k];
          if (slot) cleaned[k] = { tSec: slot.tSec, hz: prev.hz };
        }
      }
      i = j;
    }
  }

  // ---- pass 2: run-length encode on the rounded pitch --------------------
  interface Run {
    midi: number;
    hz: number[];
    startSec: number;
    endSec: number;
    frames: number;
  }
  const runs: Run[] = [];
  let broke = true; // silence always starts a fresh run
  for (const f of cleaned) {
    if (f.hz === null) {
      broke = true;
      continue;
    }
    const midi = Math.round(midiFromHz(f.hz));
    const last = runs[runs.length - 1];
    if (!broke && last && last.midi === midi) {
      last.hz.push(f.hz);
      last.endSec = f.tSec;
      last.frames++;
    } else {
      runs.push({ midi, hz: [f.hz], startSec: f.tSec, endSec: f.tSec, frames: 1 });
    }
    broke = false;
  }

  // ---- pass 3: merge wobble (short runs) into their neighbour ------------
  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run.frames < holdFrames) {
      // vibrato / portamento / a rounding wobble — one note, not two
      prev.hz.push(...run.hz);
      prev.endSec = run.endSec;
      prev.frames += run.frames;
      continue;
    }
    if (prev && Math.abs(run.midi - prev.midi) < splitSemitones && run.frames < holdFrames * 2) {
      prev.hz.push(...run.hz);
      prev.endSec = run.endSec;
      prev.frames += run.frames;
      continue;
    }
    merged.push({ ...run, hz: [...run.hz] });
  }

  // ---- pass 4: to notes --------------------------------------------------
  const first = frames[0];
  const second = frames[1];
  const hopSec = first && second ? second.tSec - first.tSec || 0.005 : 0.005;
  const notes: HumNote[] = [];
  for (const run of merged) {
    const endSec = run.endSec + hopSec;
    if (endSec - run.startSec < minNoteSec) continue;
    // trimmed mean: drops the extremes so vibrato resolves to the centre of
    // the wobble instead of its upper or lower edge
    const sorted = [...run.hz].sort((a, b) => a - b);
    const trim = Math.floor(sorted.length * 0.15);
    const kept = sorted.slice(trim, Math.max(trim + 1, sorted.length - trim));
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    notes.push({ midi: Math.round(midiFromHz(mean)), hz: mean, startSec: run.startSec, endSec });
  }
  return notes;
}
