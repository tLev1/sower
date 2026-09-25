import { type ReactElement } from "react";
import { G } from "@sower/render";
import { DURATION_VALUES, type DurationValue } from "./caret";

/** Bravura glyphs for the entry-palette note values (whole → 32nd). */
const VALUE_GLYPH: Record<DurationValue, number> = {
  whole: G.metNoteWhole,
  half: G.metNoteHalfUp,
  quarter: G.metNoteQuarterUp,
  eighth: G.metNote8thUp,
  "16th": G.metNote16thUp,
  "32nd": G.metNote32ndUp,
};

const VALUE_LABEL: Record<DurationValue, string> = {
  whole: "Whole note",
  half: "Half note",
  quarter: "Quarter note",
  eighth: "Eighth note",
  "16th": "16th note",
  "32nd": "32nd note",
};

export interface DurationPickerProps {
  readonly value: DurationValue;
  readonly dotted: boolean;
  readonly onSelect: (value: DurationValue, dotted: boolean) => void;
}

/**
 * Persistent note-value palette: every placed note uses the selected value
 * (and dot state) until another one is chosen — Guitar-Pro style entry.
 */
export function DurationPicker({ value, dotted, onSelect }: DurationPickerProps): ReactElement {
  return (
    <div className="duration-picker" role="radiogroup" aria-label="Entry note value">
      {DURATION_VALUES.map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={v === value}
          className={v === value ? "duration-btn active" : "duration-btn"}
          title={VALUE_LABEL[v]}
          onClick={() => { onSelect(v, dotted); }}
        >
          {String.fromCodePoint(VALUE_GLYPH[v])}
        </button>
      ))}
      <button
        className={dotted ? "duration-btn dot active" : "duration-btn dot"}
        aria-pressed={dotted}
        title="Dotted"
        onClick={() => { onSelect(value, !dotted); }}
      >
        {String.fromCodePoint(G.metAugmentationDot)}
      </button>
    </div>
  );
}
