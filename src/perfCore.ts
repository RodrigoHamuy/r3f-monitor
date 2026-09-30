import { addAfterEffect, addEffect, addTail } from "@react-three/fiber";
import * as THREE from "three";

import { PerfSampler, type SampleChart, type SampleLog } from "./sampler";
import { createBackend, type AnyRenderer } from "./backends/detect";
import type { PerfBackend } from "./backends/types";
import { getPerf, setPerf } from "./store";
import type { PerfProps } from "./types";
import { emitEvent } from "./events/vanilla";

const updateMatrixWorldTemp = THREE.Object3D.prototype.updateMatrixWorld;
const updateWorldMatrixTemp = THREE.Object3D.prototype.updateWorldMatrix;
const updateMatrixTemp = THREE.Object3D.prototype.updateMatrix;

const maxGl = ["calls", "triangles", "points", "lines"] as const;
const maxLog = ["gpu", "cpu", "mem", "fps"] as const;

export const matriceWorldCount = { value: 0 };
export const matriceCount = { value: 0 };

/**
 * Perf measurement core — ref-counted singleton, React-agnostic.
 *
 * The first `acquirePerf()` picks a backend for the active renderer
 * (WebGLRenderer / WebGPURenderer) and hooks into the render loop; later calls
 * only bump the ref count. The returned release decrements it and disposes at 0,
 * so <PerfHeadless /> and <PerfMonitor /> mounted together share ONE core.
 */
let refCount = 0;
let current: {
  gl: AnyRenderer;
  options: PerfProps;
  dispose: () => void;
} | null = null;

export function acquirePerf(
  gl: AnyRenderer,
  scene: THREE.Scene,
  options: PerfProps = {},
): () => void {
  refCount++;

  if (!current) {
    current = { gl, options, dispose: createCore(gl, scene, options) };
  } else {
    if (current.gl !== gl) {
      console.warn(
        "[r3f-monitor] acquirePerf: core is already bound to another renderer — multi-canvas is not supported, reusing the existing core.",
      );
    } else if (
      current.options.logsPerSecond !== options.logsPerSecond ||
      current.options.deepAnalyze !== options.deepAnalyze ||
      current.options.matrixUpdate !== options.matrixUpdate ||
      current.options.chart?.length !== options.chart?.length ||
      current.options.chart?.hz !== options.chart?.hz
    ) {
      console.warn(
        "[r3f-monitor] acquirePerf: core is already running with different options — keeping the first instance's options.",
      );
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount--;
    if (refCount === 0 && current) {
      current.dispose();
      current = null;
    }
  };
}

/** Initializes the measurement core. Returns a dispose function. */
function createCore(
  gl: AnyRenderer,
  scene: THREE.Scene,
  { logsPerSecond, chart, deepAnalyze, matrixUpdate }: PerfProps,
): () => void {
  setPerf({ gl, scene });

  const backend: PerfBackend = createBackend(gl, scene);
  backend.start();

  const memoryUpdateRate = 1000;
  let lastMemoryUpdate = 0;
  let disposed = false;

  if (deepAnalyze && !backend.supportsProgramAnalysis) {
    console.warn(
      "[r3f-monitor] deepAnalyze is not supported on WebGPURenderer: node materials compile " +
        "straight to WGSL pipelines, with no program list to map back to materials. " +
        "All other metrics still work.",
    );
  }

  const sampler = new PerfSampler({
    chartLen: chart ? chart.length : 120,
    chartHz: chart ? chart.hz : 60,
    logsPerSecond: logsPerSecond || 10,

    chartLogger: (chart: SampleChart) => {
      setPerf({ chart });
    },

    paramLogger: (logger: SampleLog) => {
      const log = {
        maxMemory: logger.maxMemory,
        gpu: logger.gpu,
        gpuCompute: logger.gpuCompute,
        cpu: logger.cpu,
        mem: logger.mem,
        fps: logger.fps,
        rawFps: logger.rawFps,
        totalTime: logger.duration,
        frameCount: logger.frameCount,
      };

      setPerf({ log });

      const glStats = backend.readFrameStats();
      const { accumulated }: any = getPerf();

      accumulated.totalFrames++;
      accumulated.gl.calls += glStats.calls;
      accumulated.gl.triangles += glStats.triangles;
      accumulated.gl.points += glStats.points;
      accumulated.gl.lines += glStats.lines;

      accumulated.log.gpu += logger.gpu;
      accumulated.log.gpuCompute += logger.gpuCompute;
      accumulated.log.cpu += logger.cpu;
      accumulated.log.mem += logger.mem;
      accumulated.log.fps += logger.fps;

      for (let i = 0; i < maxGl.length; i++) {
        const key = maxGl[i];
        const value = glStats[key];
        if (value > accumulated.max.gl[key]) accumulated.max.gl[key] = value;
      }

      for (let i = 0; i < maxLog.length; i++) {
        const key = maxLog[i];
        const value = logger[key];
        if (value > accumulated.max.log[key]) accumulated.max.log[key] = value;
      }

      setPerf({ accumulated, glStats });

      emitEvent("log", [
        log,
        { ...glStats, matrices: matriceCount.value + matriceWorldCount.value },
      ]);
    },
  });

  // Vendor/renderer info is async on WebGPU (adapter query); showing it a tick
  // late is fine and keeps acquirePerf synchronous for useEffect cleanup.
  setPerf({ startTime: window.performance.now() });
  backend
    .readInfos()
    .then((infos) => {
      if (!disposed) setPerf({ infos });
    })
    .catch(() => {});

  // optional: matrix update counting
  if (matrixUpdate) {
    THREE.Object3D.prototype.updateMatrixWorld = function (
      ...args: Parameters<typeof updateMatrixWorldTemp>
    ) {
      if (this.matrixWorldNeedsUpdate || args[0]) matriceWorldCount.value++;
      return updateMatrixWorldTemp.apply(this, args);
    };

    THREE.Object3D.prototype.updateWorldMatrix = function (
      ...args: Parameters<typeof updateWorldMatrixTemp>
    ) {
      matriceWorldCount.value++;
      return updateWorldMatrixTemp.apply(this, args);
    };

    THREE.Object3D.prototype.updateMatrix = function (
      ...args: Parameters<typeof updateMatrixTemp>
    ) {
      matriceCount.value++;
      return updateMatrixTemp.apply(this, args);
    };
  }

  // PRE frame: reset stats + start CPU/GPU timing
  const unsubEffect = addEffect(() => {
    if (sampler.paused) {
      sampler.paused = false;
      sampler.resume();
    }
    if (getPerf().paused) setPerf({ paused: false });

    sampler.begin();
    backend.beginFrame();

    matriceWorldCount.value = 0;
    matriceCount.value = 0;
  });

  // AFTER frame: stop timing + commit frame + deepAnalyze
  const unsubAfter = addAfterEffect(() => {
    backend.endFrame();
    sampler.end();

    if (!sampler.paused) {
      const gpu = backend.readGpuTiming();
      sampler.nextFrame(window.performance.now(), gpu.render, gpu.compute);
    }

    const now = window.performance.now();

    if (now - lastMemoryUpdate > memoryUpdateRate) {
      lastMemoryUpdate = now;

      const memory = backend.readMemory();

      setPerf({
        estimatedMemory: {
          vram: memory.vram,
          tex: memory.tex,
          geo: memory.geo,
          ram: sampler.currentMem, // MB
          source: memory.source,
        },
      });
    }

    if (!deepAnalyze || !backend.supportsProgramAnalysis) return;

    const programs = backend.analyzePrograms();
    if (programs) {
      setPerf({
        programs,
        triggerProgramsUpdate: getPerf().triggerProgramsUpdate + 1,
      });
    }
  });

  // tail: when r3f stops rendering
  const unsubTail = addTail(() => {
    sampler.paused = true;
    matriceCount.value = 0;
    matriceWorldCount.value = 0;

    setPerf({
      paused: true,
      log: {
        maxMemory: 0,
        gpu: 0,
        gpuCompute: 0,
        mem: 0,
        cpu: 0,
        fps: 0,
        totalTime: 0,
        frameCount: 0,
      },
    });
    return false;
  });

  return () => {
    disposed = true;

    backend.dispose();
    sampler.dispose();

    // restore matrix prototypes
    if (matrixUpdate) {
      THREE.Object3D.prototype.updateMatrixWorld = updateMatrixWorldTemp;
      THREE.Object3D.prototype.updateWorldMatrix = updateWorldMatrixTemp;
      THREE.Object3D.prototype.updateMatrix = updateMatrixTemp;
    }

    unsubEffect();
    unsubAfter();
    unsubTail();
  };
}
