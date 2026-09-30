import type * as THREE from "three";

import type { PerfBackend } from "./types";
import { WebGLPerfBackend } from "./webgl";
import { WebGpuPerfBackend } from "./webgpu";

/**
 * The subset of `WebGPURenderer` that r3f-monitor reads.
 *
 * Imports NO values from `three/webgpu`: a static import would pull the whole
 * WebGPU build (~1MB) into WebGL-only bundles. Only instance properties are
 * read, and `TimestampQuery.RENDER` is just the string `"render"`.
 */
export type WebGpuRendererLike = {
  isWebGPURenderer: true;
  backend: {
    isWebGPUBackend?: boolean;
    trackTimestamp?: boolean;
    /** Only present on WebGPURenderer's WebGL2 backend. */
    gl?: WebGL2RenderingContext;
  };
  info: {
    autoReset: boolean;
    render: {
      calls: number;
      frameCalls: number;
      drawCalls: number;
      triangles: number;
      points: number;
      lines: number;
      timestamp: number;
    };
    compute: {
      calls: number;
      frameCalls: number;
      timestamp: number;
    };
    memory: {
      geometries: number;
      textures: number;
      texturesSize: number;
      attributes: number;
      attributesSize: number;
      indexAttributesSize: number;
      programs: number;
      total: number;
    };
    reset(): void;
  };
  hasFeature(name: string): boolean;
  resolveTimestampsAsync(type?: "render" | "compute"): Promise<number | undefined>;
};

export type AnyRenderer = THREE.WebGLRenderer | WebGpuRendererLike;

/**
 * Runtime check, not a type check.
 *
 * r3f 9.x types `useThree().gl` as `THREE.WebGLRenderer` even when it's a
 * WebGPURenderer at runtime, so the static type can't be trusted.
 */
export function isWebGpuRenderer(gl: unknown): gl is WebGpuRendererLike {
  return (
    typeof gl === "object" &&
    gl !== null &&
    (gl as { isWebGPURenderer?: boolean }).isWebGPURenderer === true
  );
}

/** Picks the adapter for the active renderer. */
export function createBackend(
  gl: AnyRenderer,
  scene: THREE.Scene,
): PerfBackend {
  return isWebGpuRenderer(gl)
    ? new WebGpuPerfBackend(gl, scene)
    : new WebGLPerfBackend(gl as THREE.WebGLRenderer, scene);
}
