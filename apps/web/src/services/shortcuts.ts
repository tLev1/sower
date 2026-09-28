/**
 * Central keyboard-shortcut registry.
 *
 * EVERY shortcut in the app registers here — this is the single source of
 * truth the config page reads and the editor resolves against. Adding a new
 * shortcut means adding one `ShortcutDef` to `SHORTCUTS`; it automatically
 * appears in the settings page and becomes rebindable.
 *
 * Bindings are keyed by the physical `KeyboardEvent.code` (not `key`) so
 * modifiers work predictably: `Shift+Digit1` is "1 with shift", never "!".
 */

export type ShortcutGroup =
  | "Note entry"
  | "Articulations"
  | "Navigation"
  | "Editing"
  | "Transport"
  | "Input"
  | "Application";

export interface ShortcutBinding {
  /** Physical key code, e.g. "KeyB", "Digit1", "Space", "ArrowLeft". */
  readonly code: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
}

export interface ShortcutDef {
  readonly id: string;
  readonly label: string;
  readonly group: ShortcutGroup;
  readonly binding: ShortcutBinding;
  /** Alternative bindings accepted alongside the primary one (not shown as the main key). */
  readonly aliases?: readonly ShortcutBinding[];
  /** Fires even while a text field has focus. */
  readonly global?: boolean;
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  "Note entry",
  "Articulations",
  "Navigation",
  "Editing",
  "Transport",
  "Input",
  "Application",
];

const DIGIT_LABEL = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Every shortcut the app knows about. Order defines the settings page order. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  // -- note entry -----------------------------------------------------------
  ...DIGIT_LABEL.map(
    (digit, index): ShortcutDef => ({
      id: `fret.${String(index)}`,
      label: `Fret ${digit}`,
      group: "Note entry",
      binding: { code: `Digit${digit}` },
      aliases: [{ code: `Numpad${digit}` }],
    }),
  ),
  {
    id: "fret.tens.1",
    label: "Two-digit fret 10-19",
    group: "Note entry",
    binding: { code: "Digit1", ctrl: true },
  },
  {
    id: "fret.tens.2",
    label: "Two-digit fret 20-24",
    group: "Note entry",
    binding: { code: "Digit2", ctrl: true },
  },
  {
    id: "entry.rest",
    label: "Write a rest",
    group: "Note entry",
    binding: { code: "KeyB" },
  },

  // -- articulations --------------------------------------------------------
  {
    id: "artic.palmMute",
    label: "Palm mute",
    group: "Articulations",
    binding: { code: "KeyM" },
  },
  {
    id: "artic.staccato",
    label: "Staccato",
    group: "Articulations",
    binding: { code: "KeyS" },
  },
  {
    id: "artic.letRing",
    label: "Let ring",
    group: "Articulations",
    binding: { code: "KeyR" },
  },
  {
    id: "artic.ghost",
    label: "Ghost note",
    group: "Articulations",
    binding: { code: "KeyG" },
  },
  {
    id: "artic.accent",
    label: "Accent",
    group: "Articulations",
    binding: { code: "KeyA" },
  },

  // -- navigation -----------------------------------------------------------
  {
    id: "nav.left",
    label: "Caret left",
    group: "Navigation",
    binding: { code: "ArrowLeft" },
  },
  {
    id: "nav.right",
    label: "Caret right",
    group: "Navigation",
    binding: { code: "ArrowRight" },
  },
  {
    id: "nav.up",
    label: "Higher string",
    group: "Navigation",
    binding: { code: "ArrowUp" },
  },
  {
    id: "nav.down",
    label: "Lower string",
    group: "Navigation",
    binding: { code: "ArrowDown" },
  },

  // -- editing --------------------------------------------------------------
  {
    id: "edit.deleteNote",
    label: "Delete note / rest",
    group: "Editing",
    binding: { code: "Backspace" },
  },
  {
    id: "edit.deleteBeat",
    label: "Delete the whole beat",
    group: "Editing",
    binding: { code: "Delete" },
  },
  {
    id: "edit.undo",
    label: "Undo",
    group: "Editing",
    binding: { code: "KeyZ", ctrl: true },
    global: true,
  },
  {
    id: "edit.redo",
    label: "Redo",
    group: "Editing",
    binding: { code: "KeyZ", ctrl: true, shift: true },
    aliases: [{ code: "KeyY", ctrl: true }],
    global: true,
  },

  // -- transport ------------------------------------------------------------
  {
    id: "transport.playPause",
    label: "Play / pause",
    group: "Transport",
    binding: { code: "Space" },
    global: true,
  },

  // -- input ----------------------------------------------------------------
  {
    id: "input.hum",
    label: "Hum / sing input",
    group: "Input",
    binding: { code: "KeyH" },
  },

  // -- application ----------------------------------------------------------
  {
    id: "app.shortcuts",
    label: "Keyboard shortcuts",
    group: "Application",
    binding: { code: "Slash", ctrl: true },
    global: true,
  },
];

// ---------------------------------------------------------------------------
// Binding serialisation + matching
// ---------------------------------------------------------------------------

/**
 * Minimal structural key event — satisfied by both DOM KeyboardEvents and the
 * React synthetic events the editor handles.
 */
export interface KeyLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const MODIFIER_NAMES = ["Ctrl", "Shift", "Alt", "Meta"] as const;

/** Canonical text form of a binding, e.g. "Ctrl+Shift+Z", "Space", "B". */
export function formatBinding(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push(MODIFIER_NAMES[0]);
  if (binding.alt) parts.push(MODIFIER_NAMES[2]);
  if (binding.shift) parts.push(MODIFIER_NAMES[1]);
  if (binding.meta) parts.push(MODIFIER_NAMES[3]);
  parts.push(displayCode(binding.code));
  return parts.join("+");
}

/** Human name of a physical key code ("KeyB" → "B", "ArrowLeft" → "←"). */
export function displayCode(code: string): string {
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad") && code.length === 7) return `Numpad ${code.slice(6)}`;
  switch (code) {
    case "Space":
      return "Space";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "Escape":
      return "Esc";
    case "Slash":
      return "/";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Backslash":
      return "\\";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "Backquote":
      return "`";
    default:
      return code;
  }
}

/** Parses the canonical text form back into a binding (for persistence). */
export function parseBinding(text: string): ShortcutBinding | null {
  const parts = text.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const binding: {
    code: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  } = { code: "" };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") binding.ctrl = true;
    else if (lower === "shift") binding.shift = true;
    else if (lower === "alt") binding.alt = true;
    else if (lower === "meta" || lower === "cmd" || lower === "super") binding.meta = true;
    else binding.code = codeFromDisplay(part);
  }
  if (!binding.code) return null;
  return binding;
}

function codeFromDisplay(name: string): string {
  const single = name.length === 1 ? name.toUpperCase() : name;
  if (/^[A-Z]$/.test(single)) return `Key${single}`;
  if (/^[0-9]$/.test(single)) return `Digit${single}`;
  switch (name) {
    case "Space":
      return "Space";
    case "←":
      return "ArrowLeft";
    case "→":
      return "ArrowRight";
    case "↑":
      return "ArrowUp";
    case "↓":
      return "ArrowDown";
    case "/":
      return "Slash";
    case ",":
      return "Comma";
    case ".":
      return "Period";
    case ";":
      return "Semicolon";
    case "'":
      return "Quote";
    case "[":
      return "BracketLeft";
    case "]":
      return "BracketRight";
    case "\\":
      return "Backslash";
    case "-":
      return "Minus";
    case "=":
      return "Equal";
    case "`":
      return "Backquote";
    default:
      return name;
  }
}

/** Canonical binding of a keyboard event (physical code + modifiers). */
export function bindingFromEvent(event: KeyLike): ShortcutBinding {
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

/** True when two bindings are the same chord. */
export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return (
    a.code === b.code &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.shift) === Boolean(b.shift) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.meta) === Boolean(b.meta)
  );
}

// ---------------------------------------------------------------------------
// User overrides
// ---------------------------------------------------------------------------

const STORAGE_KEY = "sower.shortcuts.v1";

/** localStorage, or null when the environment blocks it (private mode, tests). */
function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** User overrides: shortcut id → canonical binding text. */
export type ShortcutOverrides = Readonly<Record<string, string>>;

export function loadBindings(): ShortcutOverrides {
  try {
    const raw = safeStorage()?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveBindings(overrides: ShortcutOverrides): void {
  try {
    safeStorage()?.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable — bindings stay for this session only */
  }
}

export function clearBindings(): void {
  try {
    safeStorage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Live binding store (the settings page edits this; the keymap follows)
// ---------------------------------------------------------------------------

let cachedOverrides: ShortcutOverrides | null = null;
const bindingListeners = new Set<() => void>();

/** The bindings currently in force (user overrides, cached for fast lookup). */
export function currentBindings(): ShortcutOverrides {
  if (cachedOverrides === null) cachedOverrides = loadBindings();
  return cachedOverrides;
}

/** Applies and persists new bindings; every keymap picks them up at once. */
export function setBindings(overrides: ShortcutOverrides): void {
  cachedOverrides = overrides;
  saveBindings(overrides);
  emitBindings();
}

/** Restores every shortcut to its default binding. */
export function resetBindings(): void {
  cachedOverrides = {};
  clearBindings();
  emitBindings();
}

/** Subscribes to binding changes (used by the keymap hooks). */
export function subscribeBindings(listener: () => void): () => void {
  bindingListeners.add(listener);
  return () => {
    bindingListeners.delete(listener);
  };
}

function emitBindings(): void {
  for (const listener of [...bindingListeners]) listener();
}

/** The binding a shortcut actually uses, after user overrides. */
export function effectiveBinding(def: ShortcutDef, overrides: ShortcutOverrides): ShortcutBinding {
  const text = overrides[def.id];
  if (!text) return def.binding;
  return parseBinding(text) ?? def.binding;
}

/** Every binding a shortcut accepts (effective primary + its aliases). */
export function acceptedBindings(def: ShortcutDef, overrides: ShortcutOverrides): ShortcutBinding[] {
  return [effectiveBinding(def, overrides), ...(def.aliases ?? [])];
}

/** Resolves a key event to a shortcut id, or null when it matches nothing. */
export function resolveShortcut(event: KeyLike, overrides: ShortcutOverrides): string | null {
  const pressed = bindingFromEvent(event);
  for (const def of SHORTCUTS) {
    for (const candidate of acceptedBindings(def, overrides)) {
      if (bindingsEqual(pressed, candidate)) return def.id;
    }
  }
  return null;
}

/** The definition with `id`, if the registry knows it. */
export function shortcutDef(id: string): ShortcutDef | null {
  return SHORTCUTS.find((def) => def.id === id) ?? null;
}

/**
 * Ids whose effective bindings collide. A chord bound to two actions is a
 * configuration error the settings page must surface (and refuse to save).
 */
export function findConflicts(overrides: ShortcutOverrides): ReadonlyMap<string, string[]> {
  const byChord = new Map<string, string[]>();
  for (const def of SHORTCUTS) {
    const chord = formatBinding(effectiveBinding(def, overrides));
    const list = byChord.get(chord);
    if (list) list.push(def.id);
    else byChord.set(chord, [def.id]);
  }
  const conflicts = new Map<string, string[]>();
  for (const [chord, ids] of byChord) {
    if (ids.length > 1) conflicts.set(chord, ids);
  }
  return conflicts;
}
