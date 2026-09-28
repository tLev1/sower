import { describe, expect, it } from "vitest";
import { STANDARD_GUITAR_TUNING } from "../src/model/index.js";
import { chordSymbol, diatonicChords, enumerateVoicings, spellRoot, voiceChord } from "../src/operations/index.js";

describe("chord sheet theory", () => {
  it("spells roots per the key signature (sharps in sharp keys, flats elsewhere)", () => {
    expect(spellRoot(6, 2)).toBe("F♯"); // D major → F#
    expect(spellRoot(1, 0)).toBe("D♭"); // C major → Db
    expect(spellRoot(10, -2)).toBe("B♭"); // Bb major → Bb
    expect(chordSymbol(2, "major", 2)).toBe("D");
    expect(chordSymbol(11, "min7", 2)).toBe("Bm7");
    expect(chordSymbol(6, "maj7", -1)).toBe("G♭maj7");
  });

  it("offers the diatonic chord map of a key first", () => {
    const dMajor = diatonicChords({ fifths: 2, mode: "major" });
    expect(dMajor[0]).toMatchObject({ symbol: "D", degree: "I" });
    expect(dMajor.find((c) => c.degree === "ii")).toMatchObject({ symbol: "Em" });
    expect(dMajor.find((c) => c.degree === "V7")).toMatchObject({ symbol: "A7" });
    const aMinor = diatonicChords({ fifths: 0, mode: "minor" });
    expect(aMinor[0]).toMatchObject({ symbol: "Am", degree: "i" });
  });

  it("voices chords as playable guitar shapes (D major)", () => {
    const notes = voiceChord(2, "major", STANDARD_GUITAR_TUNING);
    expect(notes.length).toBeGreaterThanOrEqual(3);
    const pitches = notes.map((n) => n.pitch).sort((a, b) => a - b);
    // D major triad tones only (D F# A), ascending on higher strings
    for (const p of pitches) expect([2, 6, 9]).toContain(((p % 12) + 12) % 12);
    expect(notes.every((n) => n.fret >= 0 && n.fret <= 12)).toBe(true);
    const lowToHigh = [...notes].sort((a, b) => b.string - a.string); // lowest string first
    for (let i = 1; i < lowToHigh.length; i++) {
      expect(lowToHigh[i]!.pitch).toBeGreaterThan(lowToHigh[i - 1]!.pitch);
    }
  });

  it("enumerates all positions and inversions of a chord", () => {
    const voicings = enumerateVoicings(0, "major", STANDARD_GUITAR_TUNING); // C major
    expect(voicings.length).toBeGreaterThanOrEqual(8); // many positions up the neck
    const labels = new Set(voicings.map((v) => v.label));
    expect(labels.has("Root")).toBe(true);
    expect(labels.has("1st inv.")).toBe(true);
    expect(labels.has("2nd inv.")).toBe(true);
    // every voicing: all chord tones, playable span, no duplicate shapes
    const patterns = new Set(voicings.map((v) => v.frets));
    expect(patterns.size).toBe(voicings.length);
    for (const v of voicings) {
      const pcs = new Set(v.notes.map((n) => ((n.pitch % 12) + 12) % 12));
      for (const pc of [0, 4, 7]) expect(pcs.has(pc)).toBe(true);
    }
  });
});
