import type { Score } from "../model/index.js";
import { applyCommand, type Command } from "./commands.js";
import { createIdAllocator, type IdAllocator } from "../operations/index.js";

interface HistoryEntry {
  readonly command: Command;
  readonly scoreAfter: Score;
}

export interface ScoreDocumentOptions {
  readonly initialScore: Score;
  readonly maxHistory?: number;
}

/**
 * Editing session over an immutable Score.
 * Every edit is a Command; history keeps command + resulting snapshot so
 * undo/redo is exact (ids are preserved across undo/redo cycles).
 */
export class ScoreDocument {
  private current: Score;
  private initial: Score;
  private history: HistoryEntry[] = [];
  private cursor = -1;
  private readonly maxHistory: number;
  private readonly listeners = new Set<() => void>();
  private readonly ctx: IdAllocator;

  constructor(options: ScoreDocumentOptions) {
    this.ctx = createIdAllocator(options.initialScore);
    this.initial = options.initialScore;
    this.current = options.initialScore;
    this.maxHistory = options.maxHistory ?? 500;
  }

  get score(): Score {
    return this.current;
  }

  get canUndo(): boolean {
    return this.cursor >= 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.history.length - 1;
  }

  execute(command: Command): void {
    const scoreAfter = applyCommand(this.current, command, this.ctx);
    this.history = [...this.history.slice(0, this.cursor + 1), { command, scoreAfter }];
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(this.history.length - this.maxHistory);
    }
    this.cursor = this.history.length - 1;
    this.current = scoreAfter;
    this.emit();
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.cursor -= 1;
    const previous = this.history[this.cursor];
    this.current = previous ? previous.scoreAfter : this.initial;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.cursor += 1;
    const entry = this.history[this.cursor];
    if (!entry) return false;
    this.current = entry.scoreAfter;
    this.emit();
    return true;
  }

  /** Replaces the whole score (file load, restore); clears history. */
  reset(score: Score): void {
    this.initial = score;
    this.history = [];
    this.cursor = -1;
    this.current = score;
    this.ctx.sync(score);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
