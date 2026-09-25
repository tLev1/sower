import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from "react";
import { TICKS_PER_QUARTER, type Score } from "@stdbd/core";
import { tempoMarkAt } from "@stdbd/core";
import { G } from "@stdbd/render";
import {
  DURATION_VALUES,
  durationIsDotted,
  durationTicks,
  durationValueOfTicks,
  type DurationChoice,
  type DurationValue,
} from "./caret";

export interface SheetMenuState {
  readonly kind: "context" | "tempo" | "timesig" | "notelen";
  readonly barIndex: number;
  /** Viewport coordinates the menu/popover anchors to. */
  readonly x: number;
  readonly y: number;
  /** Clicked score position (context menu) — targets a written note. */
  readonly tick?: number | undefined;
  readonly stringIndex?: number | null | undefined;
}

interface SheetMenuProps {
  readonly menu: SheetMenuState;
  readonly score: Score;
  readonly entryDuration: DurationChoice;
  readonly onClose: () => void;
  readonly onMenuAction: (state: SheetMenuState) => void;
  readonly onTempoChange: (barIndex: number, bpm: number, unitTicks: number) => void;
  readonly onRemoveTempo: (barIndex: number) => void;
  readonly onTimeSignatureChange: (barIndex: number, numerator: number, denominator: number) => void;
  readonly onNoteLength: (value: DurationValue, dotted: boolean) => void;
  readonly onInsertMeasure: (barIndex: number) => void;
  readonly onDeleteMeasure: (barIndex: number) => boolean;
}

/** Bravura metronome glyphs per note value. */
const UNIT_GLYPH: Record<DurationValue, number> = {
  whole: G.metNoteWhole,
  half: G.metNoteHalfUp,
  quarter: G.metNoteQuarterUp,
  eighth: G.metNote8thUp,
  "16th": G.metNote16thUp,
  "32nd": G.metNote32ndUp,
};

const UNIT_LABEL: Record<DurationValue, string> = {
  whole: "Whole note",
  half: "Half note",
  quarter: "Quarter note",
  eighth: "Eighth note",
  "16th": "16th note",
  "32nd": "32nd note",
};

const PRESET_METERS: readonly { readonly n: number; readonly d: number }[] = [
  { n: 4, d: 4 },
  { n: 3, d: 4 },
  { n: 2, d: 4 },
  { n: 5, d: 4 },
  { n: 7, d: 4 },
  { n: 2, d: 2 },
  { n: 3, d: 2 },
  { n: 4, d: 2 },
  { n: 3, d: 8 },
  { n: 5, d: 8 },
  { n: 6, d: 8 },
  { n: 7, d: 8 },
  { n: 9, d: 8 },
  { n: 12, d: 8 },
  { n: 6, d: 16 },
  { n: 9, d: 16 },
  { n: 12, d: 16 },
];

function glyph(codepoint: number): string {
  return String.fromCodePoint(codepoint);
}

/** Clicks outside the floating surface close it; Esc and score scrolls do too. */
function useDismiss(surfaceRef: RefObject<HTMLDivElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const surface = surfaceRef.current;
      if (surface && event.target instanceof Node && surface.contains(event.target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = (): void => {
      onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    const scroller = surfaceRef.current?.closest(".score-scroll");
    scroller?.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [surfaceRef, onClose]);
}

/** Clamps a fixed-position anchor so the card stays inside the viewport. */
function anchorStyle(x: number, y: number, width: number): CSSProperties {
  const margin = 10;
  const left = Math.min(Math.max(margin, x - width / 2), Math.max(margin, window.innerWidth - width - margin));
  const top = Math.min(y + 16, Math.max(margin, window.innerHeight - 240));
  return { left, top };
}

export function SheetMenu(props: SheetMenuProps): ReactElement | null {
  if (props.menu.kind === "context") return <ContextMenu {...props} menu={props.menu} />;
  return <MarkPopover {...props} menu={props.menu} />;
}

function ContextMenu(props: SheetMenuProps & { menu: SheetMenuState }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, props.onClose);
  const canDelete = props.score.bars.length > 1;
  const style = anchorStyle(props.menu.x, props.menu.y, 224);
  return (
    <div className="sheet-menu" style={style} ref={ref} role="menu">
      <div className="sheet-menu-title">Measure {props.menu.barIndex + 1}</div>
      <button
        className="sheet-menu-item"
        role="menuitem"
        onClick={() => {
          props.onMenuAction({
            kind: "tempo",
            barIndex: props.menu.barIndex,
            x: props.menu.x,
            y: props.menu.y,
            tick: props.menu.tick,
            stringIndex: props.menu.stringIndex,
          });
        }}
      >
        <span className="sheet-menu-glyph" aria-hidden>{glyph(G.metNoteQuarterUp)}</span>
        Tempo…
      </button>
      <button
        className="sheet-menu-item"
        role="menuitem"
        onClick={() => {
          props.onMenuAction({
            kind: "notelen",
            barIndex: props.menu.barIndex,
            x: props.menu.x,
            y: props.menu.y,
            tick: props.menu.tick,
            stringIndex: props.menu.stringIndex,
          });
        }}
      >
        <span className="sheet-menu-glyph" aria-hidden>{glyph(G.metNote8thUp)}</span>
        Note length…
      </button>
      <button
        className="sheet-menu-item"
        role="menuitem"
        onClick={() => {
          props.onMenuAction({
            kind: "timesig",
            barIndex: props.menu.barIndex,
            x: props.menu.x,
            y: props.menu.y,
            tick: props.menu.tick,
            stringIndex: props.menu.stringIndex,
          });
        }}
      >
        <span className="sheet-menu-glyph" aria-hidden>{glyph(G.timeSigCommon)}</span>
        Time signature…
      </button>
      <div className="sheet-menu-sep" />
      <button
        className="sheet-menu-item"
        role="menuitem"
        onClick={() => {
          props.onInsertMeasure(props.menu.barIndex);
          props.onClose();
        }}
      >
        <span className="sheet-menu-glyph" aria-hidden>+</span>
        Insert measure after
      </button>
      <button
        className="sheet-menu-item"
        role="menuitem"
        disabled={!canDelete}
        onClick={() => {
          if (props.onDeleteMeasure(props.menu.barIndex)) props.onClose();
        }}
      >
        <span className="sheet-menu-glyph" aria-hidden>−</span>
        Delete measure
      </button>
    </div>
  );
}

function MarkPopover(props: SheetMenuProps & { menu: SheetMenuState }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, props.onClose);
  const width = props.menu.kind === "tempo" ? 256 : props.menu.kind === "notelen" ? 252 : 280;
  return (
    <div className="sheet-popover" style={anchorStyle(props.menu.x, props.menu.y, width)} ref={ref}>
      {props.menu.kind === "tempo" ? (
        <TempoEditor
          barIndex={props.menu.barIndex}
          score={props.score}
          onTempoChange={props.onTempoChange}
          onRemoveTempo={props.onRemoveTempo}
          onClose={props.onClose}
        />
      ) : props.menu.kind === "notelen" ? (
        <NoteLengthEditor
          barIndex={props.menu.barIndex}
          entry={props.entryDuration}
          onNoteLength={props.onNoteLength}
        />
      ) : (
        <TimeSigEditor
          barIndex={props.menu.barIndex}
          score={props.score}
          onTimeSignatureChange={props.onTimeSignatureChange}
        />
      )}
    </div>
  );
}

/**
 * Note-length picker (same shape as the tempo popover, without the BPM box).
 * Selecting a value:
 *  - sets the entry duration for notes written from that point on
 *  - if a written note sits at the clicked position, changes THAT note only
 *    (following notes are untouched; the measure re-lays out around it)
 */
function NoteLengthEditor(props: {
  readonly barIndex: number;
  readonly entry: DurationChoice;
  readonly onNoteLength: (value: DurationValue, dotted: boolean) => void;
}): ReactElement {
  const [unit, setUnit] = useState<DurationChoice>(props.entry);
  return (
    <div className="tempo-editor">
      <div className="sheet-popover-title">Note length · measure {props.barIndex + 1}</div>
      <div className="tempo-units" role="radiogroup" aria-label="Note length">
        {DURATION_VALUES.map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={v === unit.value}
            className={v === unit.value ? "glyph-btn active" : "glyph-btn"}
            title={UNIT_LABEL[v]}
            onClick={() => {
              setUnit({ value: v, dotted: unit.dotted });
              props.onNoteLength(v, unit.dotted);
            }}
          >
            {glyph(UNIT_GLYPH[v])}
          </button>
        ))}
        <button
          className={unit.dotted ? "glyph-btn dot active" : "glyph-btn dot"}
          aria-pressed={unit.dotted}
          title="Dotted"
          onClick={() => {
            setUnit({ value: unit.value, dotted: !unit.dotted });
            props.onNoteLength(unit.value, !unit.dotted);
          }}
        >
          {glyph(G.metAugmentationDot)}
        </button>
      </div>
      <div className="tempo-row">
        <span className="glyph-preview" aria-hidden>
          {glyph(UNIT_GLYPH[unit.value])}
          {unit.dotted ? glyph(G.metAugmentationDot) : ""}
        </span>
        <span className="sheet-popover-unit">
          {unit.dotted ? "dotted " : ""}
          {UNIT_LABEL[unit.value].toLowerCase()}
        </span>
      </div>
    </div>
  );
}

function TempoEditor(props: {
  readonly barIndex: number;
  readonly score: Score;
  readonly onTempoChange: (barIndex: number, bpm: number, unitTicks: number) => void;
  readonly onRemoveTempo: (barIndex: number) => void;
  readonly onClose: () => void;
}): ReactElement {
  const { barIndex, score } = props;
  const bar = score.bars[barIndex];
  const hasMark = bar !== undefined && bar.tempo !== null;
  // prefill with the tempo sounding at this measure so editing feels continuous
  const effective = tempoMarkAt(score, barIndex) ?? { bpm: 96, unitTicks: TICKS_PER_QUARTER };
  const [bpmText, setBpmText] = useState(String(effective.bpm));
  const [unit, setUnit] = useState<DurationChoice>(() => ({
    value: durationValueOfTicks(effective.unitTicks),
    dotted: durationIsDotted(effective.unitTicks),
  }));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const parsedBpm = (): number => {
    const parsed = Math.round(Number(bpmText));
    return Number.isFinite(parsed) ? Math.min(400, Math.max(20, parsed)) : effective.bpm;
  };

  const commitBpm = (): void => {
    const parsed = Math.round(Number(bpmText));
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 400) {
      setBpmText(String(effective.bpm));
      return;
    }
    props.onTempoChange(barIndex, parsed, durationTicks(unit.value, unit.dotted));
  };

  const setUnitAndApply = (value: DurationValue, dotted: boolean): void => {
    setUnit({ value, dotted });
    props.onTempoChange(barIndex, parsedBpm(), durationTicks(value, dotted));
  };

  return (
    <div className="tempo-editor">
      <div className="sheet-popover-title">Tempo · measure {barIndex + 1}</div>
      <div className="tempo-units" role="radiogroup" aria-label="Beat unit">
        {DURATION_VALUES.map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={v === unit.value}
            className={v === unit.value ? "glyph-btn active" : "glyph-btn"}
            title={UNIT_LABEL[v]}
            onClick={() => { setUnitAndApply(v, unit.dotted); }}
          >
            {glyph(UNIT_GLYPH[v])}
          </button>
        ))}
        <button
          className={unit.dotted ? "glyph-btn dot active" : "glyph-btn dot"}
          aria-pressed={unit.dotted}
          title="Dotted"
          onClick={() => { setUnitAndApply(unit.value, !unit.dotted); }}
        >
          {glyph(G.metAugmentationDot)}
        </button>
      </div>
      <div className="tempo-row">
        <span className="glyph-preview" aria-hidden>
          {glyph(UNIT_GLYPH[unit.value])}
          {unit.dotted ? glyph(G.metAugmentationDot) : ""}
        </span>
        <span className="tempo-eq" aria-hidden>=</span>
        <input
          ref={inputRef}
          className="sheet-popover-input"
          type="number"
          min={20}
          max={400}
          value={bpmText}
          onChange={(e) => { setBpmText(e.target.value); }}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitBpm();
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Tempo BPM"
        />
        <span className="sheet-popover-unit">BPM</span>
      </div>
      {hasMark ? (
        <button
          className="sheet-popover-secondary"
          onClick={() => {
            props.onRemoveTempo(barIndex);
            props.onClose();
          }}
        >
          Remove tempo mark
        </button>
      ) : null}
    </div>
  );
}

function TimeSigEditor(props: {
  readonly barIndex: number;
  readonly score: Score;
  readonly onTimeSignatureChange: (barIndex: number, numerator: number, denominator: number) => void;
}): ReactElement {
  const { barIndex, score, onTimeSignatureChange } = props;
  const bar = score.bars[barIndex];
  const sig = bar?.timeSignature ?? { numerator: 4, denominator: 4 };
  const [numText, setNumText] = useState(String(sig.numerator));
  const [denominator, setDenominator] = useState(String(sig.denominator));

  const apply = (n: number, d: number): void => {
    onTimeSignatureChange(barIndex, n, d);
  };

  const commitCustom = (): void => {
    const n = Math.round(Number(numText));
    const d = Number(denominator);
    if (Number.isInteger(n) && n >= 1 && n <= 32 && [2, 4, 8, 16].includes(d)) apply(n, d);
  };

  return (
    <div className="timesig-editor">
      <div className="sheet-popover-title">Meter · from measure {barIndex + 1} onward</div>
      <div className="timesig-presets">
        {PRESET_METERS.map((ts) => {
          const active = ts.n === sig.numerator && ts.d === sig.denominator;
          return (
            <button
              key={`${ts.n}/${ts.d}`}
              className={active ? "meter-chip active" : "meter-chip"}
              onClick={() => { apply(ts.n, ts.d); }}
            >
              {ts.n}/{ts.d}
            </button>
          );
        })}
      </div>
      <div className="timesig-custom">
        <input
          className="sheet-popover-input"
          type="number"
          min={1}
          max={32}
          value={numText}
          onChange={(e) => { setNumText(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCustom();
          }}
          aria-label="Time signature numerator"
        />
        <span className="timesig-slash">/</span>
        <select
          className="sheet-popover-select"
          value={denominator}
          onChange={(e) => { setDenominator(e.target.value); }}
          aria-label="Time signature denominator"
        >
          {["2", "4", "8", "16"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button className="sheet-popover-apply" onClick={commitCustom}>Apply</button>
      </div>
    </div>
  );
}
