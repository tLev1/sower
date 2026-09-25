import type { Score } from "@sower/core";
import { TICKS_PER_QUARTER, tempoUnitOf, ticksPerBar } from "@sower/core";
import type { ScorePlayer } from "../renderer.js";

/**
 * WebAudio playback engine (v1).
 *
 * Sound: Karplus-Strong plucked-string synthesis — articulation-aware
 * (palm-mute shortens/darkens the pluck, let-ring extends it, ghost notes
 * play quieter) through a master bus with compressor and a small
 * generated-impulse reverb send.
 *
 * Timing: note events are flattened to absolute seconds via the score's
 * tempo map; a lookahead scheduler fires them off the audio clock, and the
 * playhead position is reported every animation frame.
 */

export interface PlaybackPosition {
  readonly barIndex: number;
  readonly tick: number;
  /** Absolute tick across the whole score (bar start + tick) — drives the playhead. */
  readonly absTick: number;
  readonly seconds: number;
  readonly totalSeconds: number;
}

type PluckStyle = "normal" | "palmMute" | "letRing" | "staccato";

interface NoteEvent {
  readonly sec: number;
  readonly durSec: number;
  readonly pitch: number;
  readonly velocity: number;
  readonly strum: number;
  readonly style: PluckStyle;
  readonly trackId: number;
  /** Visual string index (0 = highest) — enforces per-string monophony. */
  readonly string: number | null;
}

interface ClickEvent {
  readonly sec: number;
  readonly accent: boolean;
}

const LOOKAHEAD_SEC = 0.4;
const SCHEDULER_TICK_MS = 80;

export class WebAudioPlayer implements ScorePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbInput: AudioNode | null = null;
  private readonly buses = new Map<number, GainNode>();
  private events: readonly NoteEvent[] = [];
  private clicks: readonly ClickEvent[] = [];
  private barStarts: readonly number[] = [];
  private barStartTicks: readonly number[] = [];
  private barTicks: readonly number[] = [];
  private barSeconds: readonly number[] = [];
  private totalSec = 0.001;
  private pointer = 0;
  private clickPointer = 0;
  /** Score the current timeline was built from (avoids redundant rebuilds). */
  private timelineScore: Score | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private positionRaf: number | null = null;
  private startCtxTime = 0;
  private offsetSec = 0;
  private playing = false;
  private startPosition: { readonly barIndex: number; readonly tick: number } | null = null;
  private metronomeOn = false;
  private readonly stateListeners = new Set<(isPlaying: boolean) => void>();
  private readonly positionListeners = new Set<(pos: PlaybackPosition | null) => void>();
  private readonly bufferCache = new Map<string, AudioBuffer>();
  /** Sustain-loop start (seconds) per buffer key — clickless loop window. */
  private readonly loopStarts = new Map<string, number>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  /** Sounding source per (track, string) — a new note chokes the previous. */
  private readonly activeByString = new Map<string, { src: AudioBufferSourceNode; env: GainNode }>();

  constructor(private readonly getScore: () => Score | null) {}

  // -- ScorePlayer API ---------------------------------------------------------

  /**
   * Where playback begins when nothing is paused (caret position).
   * A changed selection also clears the pause-resume memory, so the next
   * play always starts from the freshly selected spot.
   */
  setStartPosition(pos: { readonly barIndex: number; readonly tick: number } | null): void {
    const prev = this.startPosition;
    const changed =
      (!prev && pos !== null) ||
      (prev !== null && (pos === null || prev.barIndex !== pos.barIndex || prev.tick !== pos.tick));
    if (changed) this.offsetSec = 0;
    this.startPosition = pos;
  }

  onStateChange(listener: (isPlaying: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onPosition(listener: (pos: PlaybackPosition | null) => void): () => void {
    this.positionListeners.add(listener);
    return () => {
      this.positionListeners.delete(listener);
    };
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isMetronomeOn(): boolean {
    return this.metronomeOn;
  }

  /**
   * Toggles the click track. Clicks follow the musical sheet only — the
   * notated beat grid of the score (accented downbeats), its tempo map and
   * meter changes, during playback. No free-running clicks of its own.
   */
  setMetronome(on: boolean): void {
    this.metronomeOn = on;
  }

  /**
   * Rebuilds the timeline from the current score while preserving the
   * musical position (absolute tick). Tempo / meter edits take effect
   * immediately — even mid-playback.
   */
  refreshTimeline(): void {
    const score = this.getScore();
    if (!score || score === this.timelineScore) return;
    const wasPlaying = this.playing;
    const absTick = this.locate(wasPlaying ? this.virtualNow() : this.offsetSec).absTick;
    this.rebuildTimeline(score);
    this.timelineScore = score;
    this.offsetSec = this.secondsOfAbsTick(absTick);
    if (wasPlaying && this.ctx) {
      this.startCtxTime = this.ctx.currentTime;
      this.pointer = this.findIndexAt(this.offsetSec);
      this.clickPointer = this.findClickIndexAt(this.offsetSec);
    }
  }

  play(): void {
    if (this.playing) return;
    const pausedOffset = this.offsetSec > 0.02 ? this.offsetSec : null;
    void this.ensureContext().then(() => {
      if (!this.playing) this.beginAt(pausedOffset);
    });
  }

  /**
   * Pre-arms audio before the play press: creates + resumes the AudioContext
   * (autoplay policies only allow this inside a user gesture) and generates
   * the pluck buffers ahead of time, so hitting play produces sound in a few
   * milliseconds. Call from any user gesture on the score surface.
   */
  prewarm(): void {
    if (this.playing) return;
    void this.ensureContext().then(() => {
      const ctx = this.ctx;
      if (ctx && ctx.state === "suspended") void ctx.resume();
      const score = this.getScore();
      if (!score) return;
      if (this.timelineScore !== score) {
        this.rebuildTimeline(score);
        this.timelineScore = score;
      }
      this.primeUpcoming(0, 1.0);
      this.primeRestAsync();
    });
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetSec = this.virtualNow();
    this.stopTimers();
    this.fadeOutAndStop();
    this.playing = false;
    this.emitState();
  }

  stop(): void {
    this.stopTimers();
    this.fadeOutAndStop();
    this.playing = false;
    this.offsetSec = 0;
    this.pointer = 0;
    this.clickPointer = 0;
    this.emitPosition(null);
    this.emitState();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  dispose(): void {
    this.stopTimers();
    this.stopAllSources();
    this.playing = false;
    this.timelineScore = null;
    void this.ctx?.close();
    this.ctx = null;
    this.stateListeners.clear();
    this.positionListeners.clear();
  }

  // -- scheduling core -----------------------------------------------------------

  /**
   * Builds the audio timeline and starts the scheduler. Runs synchronously —
   * by the time the user presses play the context is prewarmed, buffers are
   * cached, so the first note sounds within a few milliseconds.
   */
  private beginAt(pausedOffset: number | null): void {
    const score = this.getScore();
    const ctx = this.ctx;
    if (!score || !ctx) return;
    this.rebuildTimeline(score);
    this.timelineScore = score;
    const from = pausedOffset ?? this.positionSecondsOf(this.startPosition);
    this.primeUpcoming(from, 1.2);
    this.primeRestAsync();
    const master = this.master;
    if (master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.85, ctx.currentTime);
    }
    this.offsetSec = Math.min(Math.max(0, from), Math.max(0, this.totalSec - 0.05));
    this.pointer = this.findIndexAt(this.offsetSec);
    this.clickPointer = this.findClickIndexAt(this.offsetSec);
    this.startCtxTime = ctx.currentTime + 0.03;
    this.playing = true;
    this.emitState();
    // playhead at the selection immediately — first frame should already
    // show the start position, not one frame of stale/zero position
    this.emitPosition(this.locate(this.offsetSec));
    // notes already sounding at the start point join in (mid-phrase play):
    // they sound right away with their remaining duration instead of silence
    this.fireCarryOverNotes(this.offsetSec);
    this.interval = setInterval(() => {
      this.scheduleWindow();
    }, SCHEDULER_TICK_MS);
    this.scheduleWindow();
    const tick = (): void => {
      if (!this.playing) return;
      const pos = this.virtualNow();
      if (pos >= this.totalSec) {
        this.stopTimers();
        this.fadeOutAndStop();
        this.playing = false;
        this.offsetSec = 0;
        this.pointer = 0;
        this.clickPointer = 0;
        this.emitPosition(null);
        this.emitState();
        return;
      }
      // the playhead moves on the NOTATED grid starting at the selection —
      // it must not lag behind by the device's output latency (which made it
      // appear to wait on long notes before moving on)
      const clamped = Math.max(this.offsetSec, Math.min(pos, this.totalSec));
      this.emitPosition(this.locate(clamped));
      this.positionRaf = requestAnimationFrame(tick);
    };
    this.positionRaf = requestAnimationFrame(tick);
  }

  /**
   * Notes whose span covers the start position but began earlier: sounding
   * when the user hits play mid-phrase, shortened to what remains of them.
   */
  private fireCarryOverNotes(fromSec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const ev of this.events) {
      if (ev.sec >= fromSec) break; // events are sorted by start time
      const remaining = ev.durSec - (fromSec - ev.sec);
      if (remaining <= 0.02) continue;
      this.fireNote(
        { ...ev, durSec: remaining, strum: 0 },
        ctx.currentTime + 0.025,
      );
    }
  }

  /** Synchronously generates every pluck buffer needed in `[from, from+sec)`. */
  private primeUpcoming(fromSec: number, sec: number): void {
    const until = fromSec + sec;
    for (const ev of this.events) {
      if (ev.sec >= until) break;
      this.pluckBuffer(ev.pitch, ev.style);
    }
  }

  /**
   * Generates the remaining pluck buffers in small async chunks so no single
   * frame stalls — playback never hitches on a cache miss.
   */
  private primeRestAsync(): void {
    const pending: { pitch: number; style: PluckStyle }[] = [];
    const seen = new Set<string>();
    for (const ev of this.events) {
      const key = `${ev.pitch}:${ev.style}`;
      if (seen.has(key) || this.bufferCache.has(key)) continue;
      seen.add(key);
      pending.push({ pitch: ev.pitch, style: ev.style });
    }
    let i = 0;
    const CHUNK = 6;
    const step = (): void => {
      if (!this.ctx) return; // disposed
      const end = Math.min(i + CHUNK, pending.length);
      for (; i < end; i++) {
        const ev = pending[i];
        if (ev) this.pluckBuffer(ev.pitch, ev.style);
      }
      if (i < pending.length) setTimeout(step, 0);
    };
    if (i < pending.length) setTimeout(step, 0);
  }

  private scheduleWindow(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const horizon = this.virtualNow() + LOOKAHEAD_SEC;
    while (this.pointer < this.events.length) {
      const ev = this.events[this.pointer];
      if (!ev || ev.sec + ev.strum >= horizon) break;
      this.pointer++;
      // `startCtxTime` is the audio-clock time of position `offsetSec`, so the
      // event's score-seconds must be offset-relative — without the
      // subtraction every sound arrived `offsetSec` seconds late (playhead
      // far ahead of the audio when starting from a selection)
      const at = this.startCtxTime + (ev.sec + ev.strum - this.offsetSec);
      if (at < ctx.currentTime - 0.05) continue;
      this.fireNote(ev, at);
    }
    while (this.clickPointer < this.clicks.length) {
      const click = this.clicks[this.clickPointer];
      if (!click || click.sec >= horizon) break;
      this.clickPointer++;
      if (!this.metronomeOn) continue;
      const at = this.startCtxTime + (click.sec - this.offsetSec);
      if (at < ctx.currentTime - 0.02) continue;
      this.fireClick(click.accent, at);
    }
  }

  private fireNote(ev: NoteEvent, at: number): void {
    const ctx = this.ctx;
    const bus = this.busFor(ev.trackId);
    if (!ctx || !bus) return;
    // per-string monophony: a new note on a string ends the previous one
    // there (guitar behavior — sequential notes never overlap)
    if (ev.string !== null) this.chokeString(ev.trackId, ev.string, at);
    // staccato shares the normal pluck timbre — only its length differs
    const style = ev.style === "staccato" ? "normal" : ev.style;
    const key = `${ev.pitch}:${style}`;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(ev.pitch, style);
    // sustain loop (SF2-style): hold any note length at any pitch
    src.loop = true;
    src.loopStart = this.loopStarts.get(key) ?? 0;
    src.loopEnd = src.buffer.duration;
    src.playbackRate.value = Math.pow(2, ((Math.random() * 2 - 1) * 5) / 1200);
    const env = ctx.createGain();
    const level = this.gainFor(ev.velocity);
    // alphaTab note-length semantics: the note SOUNDS its full notated
    // duration, then a short natural release; articulations shorten the
    // length (palm-mute ≈ fixed short, staccato = half, let-ring extends)
    const soundDur =
      ev.style === "palmMute" ? Math.min(ev.durSec, 0.1) :
      ev.style === "staccato" ? Math.max(ev.durSec * 0.5, 0.05) :
      ev.style === "letRing" ? ev.durSec + 0.35 :
      ev.durSec;
    const release = ev.style === "letRing" ? 0.28 : ev.style === "palmMute" ? 0.06 : 0.12;
    env.gain.setValueAtTime(level, at);
    env.gain.setValueAtTime(level, at + soundDur);
    env.gain.linearRampToValueAtTime(0.0001, at + soundDur + release);
    src.connect(env);
    env.connect(bus);
    src.start(at);
    src.stop(at + soundDur + release + 0.12);
    this.activeSources.add(src);
    const entry = { src, env };
    const stringKey = ev.string === null ? null : `${ev.trackId}:${ev.string}`;
    if (stringKey !== null) this.activeByString.set(stringKey, entry);
    src.onended = () => {
      this.activeSources.delete(src);
      if (stringKey !== null && this.activeByString.get(stringKey)?.src === src) {
        this.activeByString.delete(stringKey);
      }
      try {
        src.disconnect();
        env.disconnect();
      } catch {
        /* graph already torn down */
      }
    };
  }

  /** Cuts the sounding note on a string (fast fade + stop) — no overlap. */
  private chokeString(trackId: number, string: number, at: number): void {
    const key = `${trackId}:${string}`;
    const prev = this.activeByString.get(key);
    if (!prev) return;
    this.activeByString.delete(key);
    try {
      prev.env.gain.cancelScheduledValues(at);
      prev.env.gain.setValueAtTime(prev.env.gain.value, at);
      prev.env.gain.linearRampToValueAtTime(0.0001, at + 0.015);
      prev.src.stop(at + 0.05);
    } catch {
      /* already ended */
    }
  }

  private gainFor(velocity: number): number {
    const v = Math.min(1, Math.max(0, velocity / 127));
    return 0.22 + 0.6 * Math.pow(v, 1.35);
  }

  // -- metronome ---------------------------------------------------------------------

  /** Short woodblock-ish ping (accent = downbeat). */
  private clickBuffer(accent: boolean): AudioBuffer {
    const key = accent ? "click:accent" : "click:normal";
    const cached = this.bufferCache.get(key);
    if (cached) return cached;
    const ctx = this.ctx;
    if (!ctx) throw new Error("no audio context");
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.05);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const f = accent ? 1660 : 1100;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * (accent ? 85 : 110));
      const tick = i < 24 ? (Math.random() * 2 - 1) * (1 - i / 24) * 0.35 : 0;
      data[i] = Math.sin(2 * Math.PI * f * t) * env * (accent ? 0.5 : 0.34) + tick * env;
    }
    this.bufferCache.set(key, buf);
    return buf;
  }

  private fireClick(accent: boolean, at: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.clickBuffer(accent);
    src.connect(master);
    src.start(at);
    this.activeSources.add(src);
    src.onended = () => {
      this.activeSources.delete(src);
      try {
        src.disconnect();
      } catch {
        /* graph already torn down */
      }
    };
  }

  // -- audio graph -----------------------------------------------------------------

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;
      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      this.master = master;
      const convolver = ctx.createConvolver();
      convolver.buffer = this.impulseResponse(ctx, 2.0);
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      convolver.connect(wet);
      wet.connect(compressor);
      this.reverbInput = convolver;
    }
    // playback must never schedule against a suspended (frozen) clock
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  private impulseResponse(ctx: AudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.6);
        const noise = Math.random() * 2 - 1;
        lp = lp + 0.24 * (noise - lp);
        data[i] = lp * decay * 0.5;
      }
    }
    return buf;
  }

  private busFor(trackId: number): GainNode | null {
    const existing = this.buses.get(trackId);
    if (existing) return existing;
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const input = ctx.createGain();
    input.gain.value = 1;
    input.connect(this.master);
    if (this.reverbInput) {
      const send = ctx.createGain();
      send.gain.value = 0.35;
      input.connect(send);
      send.connect(this.reverbInput);
    }
    this.buses.set(trackId, input);
    return input;
  }

  // -- plucked-string synthesis (Karplus-Strong) --------------------------------------

  /**
   * Karplus-Strong pluck with alphaTab/SF2-style sustain semantics: the ring
   * length is pitch-INDEPENDENT (2 s, gently decaying) and the periodic tail
   * is looped by the source (`loopStarts`), so every note can hold its full
   * notated duration at any pitch — note length comes from the note-off,
   * never from how fast a pitch's buffer happens to run out.
   */
  private pluckBuffer(pitch: number, style: PluckStyle): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("no audio context");
    const key = `${pitch}:${style}`;
    const cached = this.bufferCache.get(key);
    if (cached) return cached;

    const sr = ctx.sampleRate;
    const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
    const period = Math.max(2, Math.round(sr / f0));
    // exponential amplitude decay: exp(-t/τ) — pluck-like, τ per style
    const tau = style === "palmMute" ? 0.16 : style === "letRing" ? 4.5 : 2.6;
    const decay = Math.exp(-period / (sr * tau));
    const len = Math.floor(sr * 2.0);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    // excitation: lowpass-filtered noise burst
    const burstLp = style === "palmMute" ? 0.16 : 0.32;
    let lp = 0;
    for (let i = 0; i < period; i++) {
      const noise = Math.random() * 2 - 1;
      lp = lp + burstLp * (noise - lp);
      data[i] = lp;
    }
    for (let i = period; i < len; i++) {
      const prev = data[i - period] ?? 0;
      const prev2 = data[i - period - 1] ?? 0;
      data[i] = decay * 0.5 * (prev + prev2);
    }
    // normalize peak to 0.5
    let peak = 1e-6;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(data[i] ?? 0);
      if (a > peak) peak = a;
    }
    const scale = 0.5 / peak;
    for (let i = 0; i < len; i++) {
      const v = data[i] ?? 0;
      data[i] = v * scale;
    }

    // seamless sustain loop: an exact integer number of periods from the
    // steady tail — the KS tail is period-continuous, so looping it is clickless
    const loopPeriods = Math.max(1, Math.ceil(0.08 * sr / period));
    this.loopStarts.set(key, Math.max(0, len - loopPeriods * period) / sr);
    this.bufferCache.set(key, buf);
    return buf;
  }

  // -- timeline -------------------------------------------------------------------------

  private positionSecondsOf(pos: { readonly barIndex: number; readonly tick: number } | null): number {
    if (!pos) return 0;
    const score = this.getScore();
    const lastBar = Math.max(0, (score?.bars.length ?? 1) - 1);
    const barIndex = Math.min(Math.max(0, pos.barIndex), lastBar);
    const barStart = this.barStarts[barIndex] ?? 0;
    const barSec = this.barSeconds[barIndex] ?? 0;
    const ticks = this.barTicks[barIndex] ?? TICKS_PER_QUARTER * 4;
    const secPerTick = barSec / Math.max(ticks, 1);
    return barStart + Math.min(Math.max(0, pos.tick), ticks - 1) * secPerTick;
  }

  private locate(pos: number): PlaybackPosition {
    let barIndex = 0;
    for (let i = 0; i < this.barStarts.length; i++) {
      const start = this.barStarts[i];
      if (start !== undefined && start <= pos) barIndex = i;
      else break;
    }
    const barStart = this.barStarts[barIndex] ?? 0;
    const ticks = this.barTicks[barIndex] ?? TICKS_PER_QUARTER * 4;
    const barSec = this.barSeconds[barIndex] ?? 0;
    const secPerTick = barSec / Math.max(ticks, 1);
    // fractional ticks keep the playhead motion continuous between beats
    const tick = (pos - barStart) / Math.max(secPerTick, 1e-6);
    return {
      barIndex,
      tick: Math.min(Math.max(0, tick), Math.max(0, ticks - 1)),
      absTick: (this.barStartTicks[barIndex] ?? 0) + Math.min(Math.max(0, tick), Math.max(0, ticks - 1)),
      seconds: pos,
      totalSeconds: this.totalSec,
    };
  }

  private emitState(): void {
    const playing = this.playing;
    for (const listener of this.stateListeners) listener(playing);
  }

  private emitPosition(pos: PlaybackPosition | null): void {
    for (const listener of this.positionListeners) listener(pos);
  }

  private virtualNow(): number {
    if (!this.playing || !this.ctx) return this.offsetSec;
    return this.offsetSec + (this.ctx.currentTime - this.startCtxTime);
  }

  /** Short master fade, then hard-stop pending sources (no abrupt click). */
  private fadeOutAndStop(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.025);
      setTimeout(() => {
        this.stopAllSources();
        const c = this.ctx;
        if (c && this.master) {
          this.master.gain.cancelScheduledValues(c.currentTime);
          this.master.gain.setValueAtTime(0.85, c.currentTime);
        }
      }, 110);
    } else {
      this.stopAllSources();
    }
  }

  private stopTimers(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.positionRaf !== null) {
      cancelAnimationFrame(this.positionRaf);
      this.positionRaf = null;
    }
  }

  private stopAllSources(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        /* not started yet */
      }
    }
    this.activeSources.clear();
    this.activeByString.clear();
  }

  private findIndexAt(sec: number): number {
    const events = this.events;
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const ev = events[mid];
      if (ev && ev.sec + ev.strum < sec) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private findClickIndexAt(sec: number): number {
    let i = 0;
    while (i < this.clicks.length && (this.clicks[i]?.sec ?? 0) < sec) i++;
    return i;
  }

  /** Inverse of `locate`'s absolute-tick mapping, on the current bar map. */
  private secondsOfAbsTick(absTick: number): number {
    let barIndex = 0;
    for (let i = 0; i < this.barStartTicks.length; i++) {
      const start = this.barStartTicks[i];
      if (start !== undefined && start <= absTick) barIndex = i;
      else break;
    }
    const barStart = this.barStarts[barIndex] ?? 0;
    const barAbs = this.barStartTicks[barIndex] ?? 0;
    const ticks = this.barTicks[barIndex] ?? TICKS_PER_QUARTER * 4;
    const barSec = this.barSeconds[barIndex] ?? 0;
    const secPerTick = barSec / Math.max(ticks, 1);
    const tick = Math.min(Math.max(0, absTick - barAbs), Math.max(0, ticks - 1));
    return barStart + tick * secPerTick;
  }

  /** Rebuilds flattened note events + bar timing from the current score. */
  private rebuildTimeline(score: Score): void {
    const barStarts: number[] = [];
    const barStartTicks: number[] = [];
    const barTicks: number[] = [];
    const barSeconds: number[] = [];
    let t = 0;
    let ticksAcc = 0;
    let tempo = 120; // quarter-BPM, updated by notated marks (with beat units)
    for (const bar of score.bars) {
      if (bar.tempo !== null) {
        tempo = (bar.tempo * tempoUnitOf(bar)) / TICKS_PER_QUARTER;
      }
      const ticks = ticksPerBar(bar.timeSignature);
      const secPerTick = 60 / (tempo * TICKS_PER_QUARTER);
      barStarts.push(t);
      barStartTicks.push(ticksAcc);
      barTicks.push(ticks);
      barSeconds.push(ticks * secPerTick);
      ticksAcc += ticks;
      t += ticks * secPerTick;
    }
    this.barStarts = barStarts;
    this.barStartTicks = barStartTicks;
    this.barTicks = barTicks;
    this.barSeconds = barSeconds;

    const anySolo = score.tracks.some((tr) => tr.solo);
    const audible = (tr: Score["tracks"][number]): boolean => (anySolo ? tr.solo : !tr.muted);

    const grouped = new Map<string, NoteEvent[]>();
    const events: NoteEvent[] = [];
    score.tracks.forEach((track, trackIndex) => {
      if (!audible(track)) return;
      score.bars.forEach((bar, barIndex) => {
        const barSec = barSeconds[barIndex] ?? 0;
        const ticks = barTicks[barIndex] ?? TICKS_PER_QUARTER * 4;
        const secPerTick = barSec / Math.max(ticks, 1);
        const barStart = barStarts[barIndex] ?? 0;
        for (const note of bar.voices[0]?.notes ?? []) {
          const ghost = note.articulations.some((a) => a.kind === "ghost");
          const style: PluckStyle = note.articulations.some((a) => a.kind === "palmMute")
            ? "palmMute"
            : note.articulations.some((a) => a.kind === "letRing")
              ? "letRing"
              : note.articulations.some((a) => a.kind === "staccato")
                ? "staccato"
                : "normal";
          const ev: NoteEvent = {
            sec: barStart + note.start * secPerTick,
            durSec: note.duration * secPerTick,
            pitch: note.pitch,
            velocity: note.velocity * (ghost ? 0.42 : 1),
            strum: 0,
            style,
            trackId: trackIndex,
            string: note.string,
          };
          events.push(ev);
          const key = `${barIndex}:${note.start}`;
          const arr = grouped.get(key) ?? [];
          arr.push(ev);
          grouped.set(key, arr);
        }
      });
    });

    // metronome clicks on the notated beat grid (accent = downbeat)
    const clicks: ClickEvent[] = [];
    for (let barIndex = 0; barIndex < barSeconds.length; barIndex++) {
      const bar = score.bars[barIndex];
      if (!bar) continue;
      const ticks = barTicks[barIndex] ?? TICKS_PER_QUARTER * 4;
      const barSec = barSeconds[barIndex] ?? 0;
      const secPerTick = barSec / Math.max(ticks, 1);
      const beatTicks = metronomeBeatTicks(bar.timeSignature);
      const beats = Math.max(1, Math.round(ticks / beatTicks));
      for (let k = 0; k < beats; k++) {
        clicks.push({
          sec: (barStarts[barIndex] ?? 0) + k * beatTicks * secPerTick,
          accent: k === 0,
        });
      }
    }
    this.clicks = clicks;

    // strum stagger: lowest pitch first, ~11ms apart
    for (const arr of grouped.values()) {
      arr.sort((a, b) => a.pitch - b.pitch);
      arr.forEach((ev, i) => {
        (ev as { strum: number }).strum = i * 0.011 + Math.random() * 0.005;
      });
    }
    events.sort((a, b) => a.sec + a.strum - (b.sec + b.strum));
    this.events = events;
    // playback runs to the END OF THE LAST MEASURE (rests count — the
    // metronome must click every beat of the bar, not stop at the last note)
    const lastBar = barSeconds.length - 1;
    const barEnd = (barStarts[lastBar] ?? 0) + (barSeconds[lastBar] ?? 0);
    this.totalSec = barEnd > 0 ? barEnd + 0.35 : 0.001;
  }
}

/**
 * Metronome pulse per meter: the notated beat unit (denominator note in
 * simple meters) or the dotted-quarter pulse in compound x/8 / x/16 meters.
 */
function metronomeBeatTicks(ts: { readonly numerator: number; readonly denominator: number }): number {
  const unit = (TICKS_PER_QUARTER * 4) / ts.denominator;
  if ((ts.denominator === 8 || ts.denominator === 16) && ts.numerator % 3 === 0) return unit * 3;
  return unit;
}
