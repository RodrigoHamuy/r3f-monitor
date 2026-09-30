import type * as THREE from "three";

import type { WebGpuRendererLike } from "./detect";
import type {
  FrameStats,
  GpuTiming,
  MemoryStats,
  PerfBackend,
  RendererInfos,
} from "./types";

/** three's `TimestampQuery.RENDER` / `.COMPUTE` are just these strings. */
const RENDER = "render" as const;
const COMPUTE = "compute" as const;

type GpuAdapterInfo = {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
};

/**
 * Adapter for `WebGPURenderer` — covers BOTH its WebGPU and WebGL2 backends,
 * since three exposes one API for both (`WebGLTimestampQueryPool` uses
 * `EXT_disjoint_timer_query_webgl2` underneath but surfaces the same
 * `resolveTimestampsAsync()` / `info.render.timestamp`).
 */
export class WebGpuPerfBackend implements PerfBackend {
  readonly kind = "webgpu" as const;

  /**
   * Node materials compile straight to WGSL pipelines; `info.memory.programs` is
   * just a count, with no `cacheKey` array to map back to materials. The path
   * forward is `renderer.inspector` (three r185+).
   */
  readonly supportsProgramAnalysis = false;

  private gl: WebGpuRendererLike;
  private timingOn = false;

  // `_scene` is unused for now: program analysis via `renderer.inspector` will
  // need it; keeps the signature in line with WebGLPerfBackend for `createBackend`.
  constructor(gl: WebGpuRendererLike, _scene: THREE.Scene) {
    this.gl = gl;
  }

  get gpuTimingAvailable() {
    return this.timingOn;
  }

  start() {
    this.gl.info.autoReset = false;

    // `trackTimestamp` defaults to false and is usually set in `new WebGPURenderer()`.
    // Enabling it after `init()` works because three requests ALL adapter-supported
    // features at device creation (`requiredFeatures: supportedFeatures`), not gated
    // by this flag — so `timestamp-query` is already available. Users don't need to
    // change renderer setup to get GPU timing.
    try {
      if (this.gl.hasFeature("timestamp-query")) {
        this.gl.backend.trackTimestamp = true;
        this.timingOn = true;
      }
    } catch {
      this.timingOn = false;
    }
  }

  async readInfos(): Promise<RendererInfos> {
    const isWebGpu = this.gl.backend.isWebGPUBackend === true;

    if (!isWebGpu) {
      // On the WebGL2 fallback there's a real WebGL context to query — use it rather
      // than returning "Unknown", since this is the default path without WebGPU.
      const ctx = this.gl.backend.gl;
      const debugInfo: any = ctx?.getExtension("WEBGL_debug_renderer_info");

      return {
        version: ctx
          ? ctx.getParameter(ctx.VERSION)
          : "WebGPURenderer (WebGL 2 backend)",
        renderer:
          (debugInfo &&
            ctx?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) ||
          ctx?.getParameter(ctx.RENDERER) ||
          "Unknown renderer",
        vendor:
          (debugInfo && ctx?.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) ||
          "Unknown vendor",
        backend: "webgpu",
        api: "webgl2",
      };
    }

    // Renderer's `getContext()` returns `unknown`, no WEBGL_debug_renderer_info.
    // Adapter info is the only source for vendor/device.
    let info: GpuAdapterInfo = {};
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      info = ((adapter as unknown as { info?: GpuAdapterInfo })?.info ??
        {}) as GpuAdapterInfo;
    } catch {
      /* keep the defaults below */
    }

    const renderer =
      info.description ||
      [info.vendor, info.architecture].filter(Boolean).join(" ") ||
      "Unknown renderer";

    return {
      version: "WebGPU",
      renderer,
      vendor: info.vendor || "Unknown vendor",
      backend: "webgpu",
      api: "webgpu",
    };
  }

  beginFrame() {
    this.gl.info.reset();
  }

  endFrame() {
    if (!this.timingOn) return;

    // three does NOT auto-resolve: `info[type].timestamp` is only written inside
    // `resolveTimestampsAsync()`. Without calling it the query pool fills (2048) and warns.
    // Fire-and-forget — three guards overlapping calls via `pendingResolve`, so
    // results lag a few frames. Fine for a HUD.
    void this.gl.resolveTimestampsAsync(RENDER).catch(() => {});
    if (this.gl.info.compute.frameCalls > 0) {
      void this.gl.resolveTimestampsAsync(COMPUTE).catch(() => {});
    }
  }

  readFrameStats(): FrameStats {
    const { render, compute, memory } = this.gl.info;
    return {
      // `render.calls` is cumulative since start; the per-FRAME count is `drawCalls`.
      calls: render.drawCalls,
      triangles: render.triangles,
      points: render.points,
      lines: render.lines,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: memory.programs,
      computeCalls: compute.frameCalls,
    };
  }

  readGpuTiming(): GpuTiming {
    return {
      render: this.gl.info.render.timestamp,
      compute: this.gl.info.compute.timestamp,
    };
  }

  /** Real bytes tracked by three — not an estimate like the WebGL path. */
  readMemory(): MemoryStats {
    const memory = this.gl.info.memory;
    const geo = memory.attributesSize + memory.indexAttributesSize;

    return {
      vram: memory.total / 1024 / 1024,
      tex: memory.texturesSize / 1024 / 1024,
      geo: geo / 1024 / 1024,
      source: "measured",
    };
  }

  analyzePrograms(): null {
    return null;
  }

  dispose() {
    this.timingOn = false;
  }
}
