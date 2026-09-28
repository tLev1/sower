import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  acceptedBindings,
  bindingsEqual,
  currentBindings,
  displayCode,
  effectiveBinding,
  findConflicts,
  formatBinding,
  parseBinding,
  resolveShortcut,
  shortcutDef,
  type KeyLike,
} from "./shortcuts";

function key(code: string, mods: Partial<KeyLike> = {}): KeyLike {
  return {
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  };
}

describe("shortcut registry", () => {
  it("registers every shortcut with a unique id", () => {
    const ids = SHORTCUTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(15);
  });

  it("groups every shortcut under a known group", () => {
    const groups = new Set([
      "Note entry",
      "Articulations",
      "Navigation",
      "Editing",
      "Transport",
      "Input",
      "Application",
    ]);
    for (const def of SHORTCUTS) expect(groups.has(def.group)).toBe(true);
  });

  it("has no default binding conflicts", () => {
    expect(findConflicts({}).size).toBe(0);
  });
});

describe("binding format", () => {
  it("round-trips a binding through its text form", () => {
    // the text form is the readable one the settings page stores
    for (const text of ["B", "Ctrl+Z", "Ctrl+Shift+Z", "Space", "Ctrl+1", "Shift+1", "←", "↑"]) {
      const parsed = parseBinding(text);
      expect(parsed).not.toBeNull();
      if (parsed) expect(formatBinding(parsed)).toBe(text);
    }
  });

  it("accepts raw codes as well as readable names", () => {
    expect(parseBinding("ArrowLeft")).toEqual({ code: "ArrowLeft" });
    expect(parseBinding("Digit1")).toEqual({ code: "Digit1" });
    expect(parseBinding("KeyB")).toEqual({ code: "KeyB" });
  });

  it("writes bindings in the readable form the panel stores", () => {
    expect(formatBinding({ code: "Digit1", ctrl: true })).toBe("Ctrl+1");
    expect(formatBinding({ code: "Digit1", shift: true })).toBe("Shift+1");
    expect(parseBinding("Ctrl+1")).toEqual({ code: "Digit1", ctrl: true });
    expect(parseBinding("Shift+1")).toEqual({ code: "Digit1", shift: true });
  });

  it("renders physical codes as readable keys", () => {
    expect(displayCode("KeyB")).toBe("B");
    expect(displayCode("Digit1")).toBe("1");
    expect(displayCode("ArrowLeft")).toBe("←");
    expect(displayCode("Space")).toBe("Space");
    expect(displayCode("Slash")).toBe("/");
    expect(displayCode("F5")).toBe("F5");
  });

  it("orders modifiers consistently", () => {
    expect(formatBinding({ code: "KeyZ", ctrl: true, shift: true })).toBe("Ctrl+Shift+Z");
    expect(formatBinding({ code: "KeyZ", shift: true, ctrl: true })).toBe("Ctrl+Shift+Z");
  });

  it("rejects modifier-only chords", () => {
    expect(parseBinding("Ctrl+")).toBeNull();
    expect(parseBinding("")).toBeNull();
  });
});

describe("resolveShortcut", () => {
  it("resolves the default bindings", () => {
    expect(resolveShortcut(key("KeyB"), {})).toBe("entry.rest");
    expect(resolveShortcut(key("KeyM"), {})).toBe("artic.palmMute");
    expect(resolveShortcut(key("ArrowRight"), {})).toBe("nav.right");
    expect(resolveShortcut(key("Space"), {})).toBe("transport.playPause");
    expect(resolveShortcut(key("Digit3"), {})).toBe("fret.3");
    expect(resolveShortcut(key("Backspace"), {})).toBe("edit.deleteNote");
  });

  it("separates undo from redo by modifier", () => {
    expect(resolveShortcut(key("KeyZ", { ctrlKey: true }), {})).toBe("edit.undo");
    expect(resolveShortcut(key("KeyZ", { ctrlKey: true, shiftKey: true }), {})).toBe("edit.redo");
    expect(resolveShortcut(key("KeyY", { ctrlKey: true }), {})).toBe("edit.redo");
  });

  it("does not fire a binding without its modifiers", () => {
    expect(resolveShortcut(key("Digit1"), {})).toBe("fret.1");
    expect(resolveShortcut(key("Digit1", { ctrlKey: true }), {})).toBe("fret.tens.1");
    expect(resolveShortcut(key("Digit1", { shiftKey: true }), {})).toBeNull();
  });

  it("honours a user rebind", () => {
    const overrides = { "entry.rest": "Shift+1" };
    expect(resolveShortcut(key("KeyB"), overrides)).toBeNull();
    expect(resolveShortcut(key("Digit1", { shiftKey: true }), overrides)).toBe("entry.rest");
    expect(resolveShortcut(key("Digit1"), overrides)).toBe("fret.1");
  });

  it("keeps aliases working alongside the primary binding", () => {
    // redo still works on Ctrl+Y (alias of Ctrl+Shift+Z)
    expect(resolveShortcut(key("KeyY", { ctrlKey: true }), {})).toBe("edit.redo");
    // numpad digits are aliases of the digit row
    expect(resolveShortcut(key("Numpad7"), {})).toBe("fret.7");
  });

  it("returns null for unbound chords", () => {
    expect(resolveShortcut(key("KeyQ"), {})).toBeNull();
    expect(resolveShortcut(key("F6"), {})).toBeNull();
  });

  it("looks up a definition by id", () => {
    expect(shortcutDef("entry.rest")?.label).toBe("Write a rest");
    expect(shortcutDef("nope")).toBeNull();
  });
});

describe("effective bindings + conflicts", () => {
  const rest = SHORTCUTS.find((d) => d.id === "entry.rest");
  const mute = SHORTCUTS.find((d) => d.id === "artic.palmMute");

  it("falls back to the default when no override exists", () => {
    if (!rest) return;
    expect(effectiveBinding(rest, {})).toEqual(rest.binding);
  });

  it("applies an override", () => {
    if (!rest) return;
    expect(effectiveBinding(rest, { "entry.rest": "KeyN" })).toEqual({ code: "KeyN" });
  });

  it("ignores a malformed override", () => {
    if (!rest) return;
    expect(effectiveBinding(rest, { "entry.rest": "Ctrl+" })).toEqual(rest.binding);
  });

  it("always includes the aliases", () => {
    const undo = SHORTCUTS.find((d) => d.id === "edit.redo");
    if (!undo) return;
    expect(acceptedBindings(undo, {})).toHaveLength(2);
  });

  it("surfaces a chord bound to two actions", () => {
    if (!rest || !mute) return;
    const conflicts = findConflicts({ "artic.palmMute": formatBinding(rest.binding) });
    expect(conflicts.size).toBe(1);
    const ids = [...conflicts.values()][0] ?? [];
    expect(ids).toContain("entry.rest");
    expect(ids).toContain("artic.palmMute");
  });

  it("compares chords by modifiers", () => {
    expect(bindingsEqual({ code: "KeyZ", ctrl: true }, { code: "KeyZ", ctrl: true, shift: false })).toBe(true);
    expect(bindingsEqual({ code: "KeyZ", ctrl: true }, { code: "KeyZ", ctrl: true, shift: true })).toBe(false);
  });

  it("starts from an empty override set", () => {
    expect(Object.keys(currentBindings())).toEqual([]);
  });
});
