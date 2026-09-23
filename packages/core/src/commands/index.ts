export type { Command, CommandContext } from "./commands.js";
export { applyCommand } from "./commands.js";
export type {
  AddBar,
  AddNote,
  RemoveBar,
  RemoveNote,
  SetBarTempo,
  SetNoteDuration,
  SetNotePitch,
  SetTimeSignature,
  SetTrackInstrument,
} from "./commands.js";
export { ScoreDocument } from "./score-document.js";
export type { ScoreDocumentOptions } from "./score-document.js";
