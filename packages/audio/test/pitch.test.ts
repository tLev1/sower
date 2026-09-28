import { describe, expect, it } from "vitest";
import {
  PitchStream,
  hzFromMidi,
  midiFromHz,
  rmsOf,
  segmentHumNotes,
  yinFrame,
  type PitchFrame,
} from "../src/index.js";

const SR = 48000;
const FRAME = 2048;

function sine(hz: number, samples: number, sampleRate = SR, amp = 0.4, phase = 0): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate + phase);
  }
  return out;
}

function noise(samples: number, amp = 0.3, seed = 12345): Float32Array {
  const out = new Float32Array(samples);
  let s = seed;
  for (let i = 0; i < samples; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = amp * ((s / 0xffffffff) * 2 - 1);
  }
  return out;
}

describe("yinFrame", () => {
  it("detects a pure sine's fundamental within 1%", () => {
    for (const hz of [82.4, 110, 220, 440, 660]) {
      const detected = yinFrame(sine(hz, FRAME), SR);
      expect(detected).not.toBeNull();
      expect(detected ?? 0).toBeGreaterThan(hz * 0.99);
      expect(detected ?? 0).toBeLessThan(hz * 1.01);
    }
  });

  it("stays accurate on a noisy sine (voice-like)", () => {
    const clean = sine(196, FRAME, SR, 0.35);
    const dirt = noise(FRAME, 0.05, 7);
    const mixed = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) mixed[i] = (clean[i] ?? 0) + (dirt[i] ?? 0);
    const detected = yinFrame(mixed, SR);
    expect(detected).not.toBeNull();
    expect(Math.abs((detected ?? 0) - 196)).toBeLessThan(2);
  });

  it("reports unvoiced for silence", () => {
    expect(yinFrame(new Float32Array(FRAME), SR)).toBeNull();
  });

  it("reports unvoiced for broadband noise", () => {
    expect(yinFrame(noise(FRAME, 0.3), SR)).toBeNull();
  });

  it("ignores out-of-range fundamentals", () => {
    // 40 Hz is below the default 70 Hz floor
    expect(yinFrame(sine(40, FRAME), SR)).toBeNull();
  });

  it("measures input level", () => {
    expect(rmsOf(new Float32Array(FRAME))).toBe(0);
    const s = sine(440, FRAME, SR, 0.5);
    expect(rmsOf(s)).toBeGreaterThan(0.3);
    expect(rmsOf(s)).toBeLessThan(0.4);
  });
});

describe("midi / Hz conversion", () => {
  it("round-trips", () => {
    for (const midi of [40, 55, 60, 69, 76, 88]) {
      expect(midiFromHz(hzFromMidi(midi))).toBeCloseTo(midi, 6);
    }
  });

  it("anchors A4 = 440 Hz", () => {
    expect(midiFromHz(440)).toBeCloseTo(69, 6);
    expect(hzFromMidi(69)).toBeCloseTo(440, 6);
  });
});

describe("PitchStream", () => {
  it("emits frames on a fixed hop with a running clock", () => {
    const stream = new PitchStream({ sampleRate: SR, windowSize: 1024, hopSize: 512 });
    const frames = stream.push(sine(220, 4096));
    expect(frames.length).toBeGreaterThan(4);
    // first frame is complete only after one full window
    expect(frames[0]?.tSec).toBeCloseTo(0, 3);
    const hop = 512 / SR;
    expect(frames[1]!.tSec - frames[0]!.tSec).toBeCloseTo(hop, 6);
    expect(frames[0]?.hz).toBeGreaterThan(215);
    expect(frames[0]?.hz).toBeLessThan(225);
  });

  it("is independent of how the signal is chunked", () => {
    const whole = sine(220, 8192);
    const a = new PitchStream({ sampleRate: SR, windowSize: 1024, hopSize: 512 });
    const fa = a.push(whole).map((f) => f.hz);
    const b = new PitchStream({ sampleRate: SR, windowSize: 1024, hopSize: 512 });
    const fb: (number | null)[] = [];
    for (let i = 0; i < whole.length; i += 137) {
      for (const f of b.push(whole.subarray(i, Math.min(i + 137, whole.length)))) fb.push(f.hz);
    }
    expect(fb.length).toBe(fa.length);
    for (let i = 0; i < fa.length; i++) {
      expect(fb[i]).toBeCloseTo(fa[i] ?? 0, 3);
    }
  });

  it("flushes the tail on stop", () => {
    const stream = new PitchStream({ sampleRate: SR, windowSize: 1024, hopSize: 512 });
    const before = stream.push(sine(220, 3000)).length;
    const tail = stream.flush();
    expect(before + tail.length).toBeGreaterThan(3);
  });
});

function seq(spec: { hz: number | null; frames: number; t0?: number; hop?: number }[]): PitchFrame[] {
  const out: PitchFrame[] = [];
  const hop = 0.005;
  let t = spec[0]?.t0 ?? 0;
  for (const s of spec) {
    for (let i = 0; i < s.frames; i++) {
      out.push({ tSec: t, hz: s.hz, rms: s.hz === null ? 0 : 0.1 });
      t += hop;
    }
  }
  return out;
}

describe("segmentHumNotes", () => {
  it("turns one steady pitch into one note", () => {
    const notes = segmentHumNotes(seq([{ hz: 220, frames: 20 }]));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.midi).toBe(57); // A3
    expect(notes[0]?.startSec).toBeCloseTo(0, 3);
  });

  it("splits two distinct sung pitches", () => {
    const notes = segmentHumNotes(
      seq([
        { hz: 220, frames: 20 },
        { hz: 261.63, frames: 20 },
      ]),
    );
    expect(notes).toHaveLength(2);
    expect(notes[0]?.midi).toBe(57); // A3
    expect(notes[1]?.midi).toBe(60); // C4
  });

  it("keeps vibrato as a single note", () => {
    // wobble ±1 semitone around A3 faster than the hold window
    const frames: PitchFrame[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) {
      const hz = 220 * Math.pow(2, (i % 2 === 0 ? 0.6 : -0.6) / 12);
      frames.push({ tSec: t, hz, rms: 0.1 });
      t += 0.005;
    }
    const notes = segmentHumNotes(frames);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.midi).toBe(57);
  });

  it("bridges a short consonant gap inside a note", () => {
    const notes = segmentHumNotes(
      seq([
        { hz: 220, frames: 12 },
        { hz: null, frames: 2 },
        { hz: 220, frames: 12 },
      ]),
    );
    expect(notes).toHaveLength(1);
  });

  it("splits at a real silence", () => {
    const notes = segmentHumNotes(
      seq([
        { hz: 220, frames: 16 },
        { hz: null, frames: 10 },
        { hz: 220, frames: 16 },
      ]),
    );
    expect(notes).toHaveLength(2);
  });

  it("drops sub-minimum blips", () => {
    const notes = segmentHumNotes(
      seq([
        { hz: 220, frames: 2 },
        { hz: null, frames: 12 },
        { hz: 220, frames: 30 },
      ]),
    );
    expect(notes).toHaveLength(1);
  });

  it("returns nothing for an unvoiced capture", () => {
    expect(segmentHumNotes(seq([{ hz: null, frames: 40 }]))).toEqual([]);
    expect(segmentHumNotes([])).toEqual([]);
  });
});
