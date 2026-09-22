/**
 * Adapter contracts for audio playback. Implementations are swappable:
 * soundfont engine first, premium sampled instruments / physical modeling later.
 */
export interface SynthVoice {
  noteOn(pitch: number, velocity: number, when: number, duration: number | null): void;
  noteOff(pitch: number, when: number): void;
}

export interface SynthEngine {
  /** Must be called from a user gesture (browser autoplay policy). */
  initialize(): Promise<void>;
  getTrack(trackId: number): SynthVoice;
  setTrackVolume(trackId: number, volume: number): void;
  setTrackPan(trackId: number, pan: number): void;
  dispose(): Promise<void>;
}

/**
 * Latency measurement — the live-input feature depends on knowing the
 * device's actual input/output latency to timestamp recorded notes correctly.
 */
export interface LatencyProbe {
  /** Estimated round-trip latency in milliseconds. */
  roundTripMs(): number;
  /** One-time interactive calibration (user plays when prompted). */
  calibrate(): Promise<number>;
}
