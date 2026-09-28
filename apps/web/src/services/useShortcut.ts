import { useEffect, useRef, useState } from "react";
import {
  currentBindings,
  resolveShortcut,
  shortcutDef,
  subscribeBindings,
} from "./shortcuts";

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Runs `handler` when the user presses the key currently bound to `id`.
 * The binding comes from the central shortcut registry (and the user's
 * overrides), so a rebind takes effect here with no further wiring.
 */
export function useShortcut(id: string, handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  // re-subscribe when the user rebinds anything (the resolved chord changes)
  const [stamp, setStamp] = useState(0);
  useEffect(() => subscribeBindings(() => { setStamp((s) => s + 1); }), []);

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent): void => {
      const def = shortcutDef(id);
      if (!def) return;
      if (isTextEntry(event.target) && !def.global) return;
      if (resolveShortcut(event, currentBindings()) !== id) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [id, enabled, stamp]);
}
