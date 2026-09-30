import type { ProgramsPerfs } from "../store";

/** Renderer class the core is attached to. */
export type BackendKind = "webgl" | "webgpu";

/**
 * Underlying GPU API.
 *
 * Note: `kind === "webgpu"` does NOT imply `api === "webgpu"`. three's
 * WebGPURenderer ships a WebGL2 backend and falls back to it when
 * `navigator.gpu` is missing — the default path, not an edge case.
 */
export type BackendApi = "webgl2" | "webgpu";

/** Per-frame render stats, normalized across backends. */
export type FrameStats = {
  /** Draw calls this frame. WebGL: `info.render.calls`. WebGPU: `info.render.drawCalls`. */
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Compute dispatches this frame. Always 0 on WebGL. */
  computeCalls: number;
};

/**
 * Whether VRAM is measured or estimated.
 *
 * WebGPURenderer tracks real bytes (`info.memory.*Size`); WebGLRenderer doesn't,
 * so VRAM is estimated by traversing the scene. The two differ for the same
 * scene — the UI uses this to label the source.
 */
export type MemorySource = "measured" | "estimated";

export type MemoryStats = {
  /** MB */
  vram: number;
  tex: number;
  geo: number;
  source: MemorySource;
};

export type GpuTiming = {
  /** Render pass time in ms. 0 when unavailable. */
  render: number;
  /** Compute pass time in ms. Always 0 on WebGL. */
  compute: number;
};

/** One render/compute pass of a frame (WebGPU + `renderer.inspector`, three r181+). */
export type PassStats = {
  type: "render" | "compute";
  name: string;
  /** CPU encode time in ms. Nested passes (e.g. shadows) also count toward their parent. */
  cpu: number;
  /** GPU time in ms; `null` when not resolved yet or timestamps are unavailable. */
  gpu: number | null;
};

export type RendererInfos = {
  version: string;
  renderer: string;
  vendor: string;
  backend: BackendKind;
  api: BackendApi;
};

/**
 * Adapter over WebGLRenderer / WebGPURenderer differences.
 *
 * Shared math (FPS, CPU, throttling, chart) lives in `sampler.ts`;
 * backends only read numbers from the renderer.
 */
export interface PerfBackend {
  readonly kind: BackendKind;

  /** Whether GPU timing is available. On WebGPU, only known after `start()`. */
  readonly gpuTimingAvailable: boolean;

  /** Enables what the renderer needs. Sync — async work goes through `readInfos()`. */
  start(): void;

  /**
   * Vendor/renderer/version. Async because WebGPU needs `navigator.gpu.requestAdapter()`.
   * Display-only, so arriving a tick late is fine.
   */
  readInfos(): Promise<RendererInfos>;

  /** Called before r3f renders a frame. */
  beginFrame(): void;

  /** Called after r3f finishes rendering a frame. */
  endFrame(): void;

  readFrameStats(): FrameStats;
  readGpuTiming(): GpuTiming;
  readMemory(): MemoryStats;

  /** Whether deepAnalyze (per-material breakdown) is supported. */
  readonly supportsProgramAnalysis: boolean;

  /**
   * Rescans programs. Returns `null` if nothing changed since the last scan —
   * `countGeoDrawCalls` is expensive, so it only runs when the program count
   * changes (same as v2).
   */
  analyzePrograms(): ProgramsPerfs | null;

  /** Per-pass timings of a recent frame. Empty when unsupported (WebGL, three < r181). */
  readPasses(): PassStats[];

  /** deepAnalyze turned off: drop hooks and caches so re-enabling rescans. */
  stopAnalysis(): void;

  dispose(): void;
}
