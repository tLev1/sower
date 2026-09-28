import { PitchStream, segmentHumNotes, type HumNote, type PitchFrame } from "./pitch.js";

/**
 * Microphone capture for the hum / sing / play correction input.
 *
 * Adapter over Web Audio: an AudioWorklet streams 128-sample blocks off the
 * audio thread (the latency architecture in docs/ARCHITECTURE.md), the main
 * thread runs the detector (`PitchStream`) and the segmenter. When
 * AudioWorklet is unavailable the capture falls back to a
 * MediaStreamAudioSourceNode tapped with an AnalyserNode polled on a timer —
 * same `PitchFrame` stream, just a coarser cadence.
 *
 * The worklet source ships as a string and is instantiated from a Blob URL so
 * this package stays bundler-agnostic (no asset pipeline, works in tests).
 */

export type HumState = "idle" | "requesting" | "listening" | "denied" | "unsupported" | "error";

export interface HumInputOptions {
  readonly sampleRate?: number;
  /** Called whenever the capture state changes. */
  readonly onState?: (state: HumState) => void;
  /** Called for every analysis frame (level metering + live pitch readout). */
  readonly onFrame?: (frame: PitchFrame) => void;
  /** Called with the notes segmented so far (live preview while singing). */
  readonly onNotes?: (notes: readonly HumNote[]) => void;
}

/** Accumulates whole input blocks and posts them to the main thread. */
const WORKLET_SOURCE = `
class SowerHumProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(this.size - this.fill, channel.length - offset);
        this.buf.set(channel.subarray(offset, offset + take), this.fill);
        this.fill += take;
        offset += take;
        if (this.fill === this.size) {
          // one small copy per ~21 ms @ 48 kHz — the audio thread never
          // allocates per sample and never blocks on the detector
          this.port.postMessage(this.buf.slice(0));
          this.fill = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("sower-hum", SowerHumProcessor);
`;

const MIN_SAMPLE_RATE = 8000;

export class HumInput {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private blobUrl: string | null = null;
  private readonly pitch: PitchStream;
  private readonly frames: PitchFrame[] = [];
  private readonly options: HumInputOptions;
  private _state: HumState = "idle";

  constructor(options: HumInputOptions = {}) {
    this.options = options;
    this.pitch = new PitchStream({ sampleRate: options.sampleRate ?? 48000 });
  }

  get state(): HumState {
    return this._state;
  }

  /** The pitch frames captured so far (analysis timeline). */
  get captured(): readonly PitchFrame[] {
    return this.frames;
  }

  /** Notes segmented from the capture so far (live while singing). */
  get notes(): readonly HumNote[] {
    return segmentHumNotes(this.frames);
  }

  static isSupported(): boolean {
    if (typeof navigator === "undefined" || typeof AudioContext === "undefined") return false;
    const media = navigator.mediaDevices as MediaDevices | undefined;
    return typeof media?.getUserMedia === "function";
  }

  async start(): Promise<void> {
    if (this._state === "listening" || this._state === "requesting") return;
    if (!HumInput.isSupported()) {
      this.setState("unsupported");
      return;
    }
    this.setState("requesting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      this.setState("denied");
      return;
    }
    try {
      this.context = new AudioContext();
      if (this.context.sampleRate < MIN_SAMPLE_RATE) {
        throw new Error("sample rate too low");
      }
      const source = this.context.createMediaStreamSource(this.stream);
      this.node = source;
      const workletOk = await this.connectWorklet(source);
      if (!workletOk) this.connectAnalyserFallback(source);
      if (this.context.state === "suspended") await this.context.resume();
      this.setState("listening");
    } catch {
      this.setState("error");
      this.stop();
    }
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    try {
      this.worklet?.port.close();
    } catch {
      /* already closed */
    }
    this.worklet = null;
    this.analyser = null;
    try {
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.node = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    for (const frame of this.pitch.flush()) this.pushFrame(frame);
    if (this._state !== "denied" && this._state !== "unsupported") this.setState("idle");
  }

  private setState(state: HumState): void {
    if (this._state === state) return;
    this._state = state;
    this.options.onState?.(state);
  }

  private pushFrame(frame: PitchFrame): void {
    this.frames.push(frame);
    this.options.onFrame?.(frame);
    this.options.onNotes?.(this.notes);
  }

  private async connectWorklet(source: MediaStreamAudioSourceNode): Promise<boolean> {
    const context = this.context;
    if (!context?.audioWorklet) return false;
    try {
      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      this.blobUrl = URL.createObjectURL(blob);
      await context.audioWorklet.addModule(this.blobUrl);
      const node = new AudioWorkletNode(context, "sower-hum", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      node.port.onmessage = (event: MessageEvent): void => {
        const data: unknown = event.data;
        if (!(data instanceof Float32Array)) return;
        for (const frame of this.pitch.push(data)) this.pushFrame(frame);
      };
      source.connect(node);
      // keep the graph pulling without routing audio to the speakers
      const mute = context.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(context.destination);
      this.worklet = node;
      return true;
    } catch {
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
      }
      return false;
    }
  }

  private connectAnalyserFallback(source: MediaStreamAudioSourceNode): void {
    const context = this.context;
    if (!context) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    this.analyser = analyser;
    const buf = new Float32Array(analyser.fftSize);
    this.pollTimer = setInterval(() => {
      const target = this.analyser;
      if (!target) return;
      target.getFloatTimeDomainData(buf);
      for (const frame of this.pitch.push(buf.slice(0))) this.pushFrame(frame);
    }, 20);
  }
}
