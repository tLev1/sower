import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  bindingFromEvent,
  effectiveBinding,
  formatBinding,
  parseBinding,
  type ShortcutBinding,
  type ShortcutDef,
  type ShortcutGroup,
  type ShortcutOverrides,
} from "../../services/shortcuts";

export interface ShortcutsPanelProps {
  readonly open: boolean;
  readonly overrides: ShortcutOverrides;
  readonly conflicts: ReadonlyMap<string, string[]>;
  readonly onChange: (overrides: ShortcutOverrides) => void;
  readonly onResetAll: () => void;
  readonly onClose: () => void;
}

/**
 * Keyboard shortcuts configuration: every registered shortcut, its current
 * binding, click-to-rebind, per-row reset and conflict surfacing. Rebinding
 * writes to the shared binding store so every keymap follows immediately.
 */
export function ShortcutsPanel({
  open,
  overrides,
  conflicts,
  onChange,
  onResetAll,
  onClose,
}: ShortcutsPanelProps): ReactElement | null {
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // capture keys while recording a binding (before any other handler)
  useEffect(() => {
    if (!open) {
      setRecording(null);
      return;
    }
    if (recording === null) return;
    const listener = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        setError(null);
        return;
      }
      // a bare modifier is not a binding yet — wait for the real key
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
      const binding = bindingFromEvent(event);
      const clash = findClash(binding, recording, overrides);
      if (clash) {
        setError(`${formatBinding(binding)} is already bound to ${clash}`);
        return;
      }
      setError(null);
      onChange({ ...overrides, [recording]: formatBinding(binding) });
      setRecording(null);
    };
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, [open, recording, overrides, onChange]);

  const resetRow = useCallback(
    (id: string): void => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(overrides)) {
        if (key !== id) next[key] = value;
      }
      onChange(next);
      setError(null);
    },
    [overrides, onChange],
  );

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose} role="presentation">
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <header className="settings-header">
          <div>
            <h2>Keyboard shortcuts</h2>
            <p>Click a key to rebind it. Every shortcut in Sower is here.</p>
          </div>
          <div className="settings-actions">
            <button type="button" className="tool-btn" onClick={onResetAll}>
              Reset all
            </button>
            <button type="button" className="tool-btn" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        </header>

        {error ? <p className="settings-error">{error}</p> : null}
        {conflicts.size > 0 && error === null ? (
          <p className="settings-error">
            {[...conflicts.entries()]
              .map(([chord, ids]) => `${chord} is bound to ${ids.length} actions`)
              .join(" · ")}
          </p>
        ) : null}

        <div className="settings-body">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} className="settings-group">
              <h3>{group}</h3>
              <div className="settings-rows">
                {SHORTCUTS.filter((def) => def.group === group).map((def) => (
                  <ShortcutRow
                    key={def.id}
                    def={def}
                    binding={effectiveBinding(def, overrides)}
                    overridden={overrides[def.id] !== undefined}
                    conflicted={isConflicted(def.id, conflicts)}
                    recording={recording === def.id}
                    onRecord={() => {
                      setError(null);
                      setRecording(def.id);
                    }}
                    onReset={() => { resetRow(def.id); }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({
  def,
  binding,
  overridden,
  conflicted,
  recording,
  onRecord,
  onReset,
}: {
  def: ShortcutDef;
  binding: ShortcutBinding;
  overridden: boolean;
  conflicted: boolean;
  recording: boolean;
  onRecord: () => void;
  onReset: () => void;
}): ReactElement {
  return (
    <div className={conflicted ? "settings-row conflict" : "settings-row"}>
      <span className="settings-label">{def.label}</span>
      <button
        type="button"
        className={recording ? "settings-key recording" : "settings-key"}
        onClick={onRecord}
        title="Click to rebind"
      >
        {recording ? "Press a key…" : formatBinding(binding)}
      </button>
      <button
        type="button"
        className="settings-reset"
        onClick={onReset}
        disabled={!overridden}
        title="Restore the default key"
      >
        Reset
      </button>
    </div>
  );
}

function isConflicted(id: string, conflicts: ReadonlyMap<string, string[]>): boolean {
  for (const ids of conflicts.values()) {
    if (ids.includes(id)) return true;
  }
  return false;
}

function findClash(
  binding: ShortcutBinding,
  selfId: string,
  overrides: ShortcutOverrides,
): string | null {
  for (const def of SHORTCUTS) {
    if (def.id === selfId) continue;
    const text = overrides[def.id];
    const current = (text ? parseBinding(text) : null) ?? def.binding;
    if (formatBinding(current) === formatBinding(binding)) return def.label;
  }
  return null;
}

export type { ShortcutGroup };
