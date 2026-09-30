# Roadmap

Current: **v3.0** → next release **v3.1** (fixes + WebGPU deepAnalyze, ready to ship).

```
v3.1  demand-mode fixes (#13) + deepAnalyze on WebGPU + per-pass timing   ← release
v3.2  WebGPU-only wins: GPU error panel, full info.memory
any   small independent items (getReport, chart panels, multi-canvas)
next  monitoring over time (session export, perf budgets, marks)
```

---

## v3.1 — Fixes + WebGPU parity (done - 30-09-2026)

### Release checklist

- [ ] Bump `package.json` to `3.1.0`
- [ ] Set the date on `## 3.1.0` in `CHANGELOG.md`
- [ ] `pnpm build` + `pnpm build-storybook`, publish

### frameloop="demand"

- [x] **#13** — no data with `frameloop="demand"`: `addTail` set
      `sampler.paused = true`, `addEffect` only cleared the store flag.
- [x] `sampler.resume()` on wake-up (#14): rebases timestamps, drops stale
      accumulators — no chart backfill burst, idle gap not logged.
- [x] Line chart: own `frameloop="never"` root driven by a 30 Hz rAF
      (`advance(t, false)`), no longer keeps R3F's global loop alive.
- [x] Bar chart: no rAF while paused.
- [x] `always → demand → always` no longer kills the monitor.
- [x] Verified in browser (demand / always × bar / line).
- [ ] Decide: `addTail` resets `log` to zeros → numbers flash 0 between
      interactions in demand mode. Keep last values (dimmed while `paused`)?

### Multiple instances

- [x] Options normalized before comparing — no false "different options" warning
      for `undefined` vs default (`<PerfHeadless />` + `<PerfMonitor />`).
- [x] `deepAnalyze` / `matrixUpdate` are live and ON if any instance enables them;
      toggling in the settings panel works while another instance holds the core.
      `logsPerSecond` / `chart` still come from the first instance (warns).

### deepAnalyze on WebGPU (the one real v3 regression)

`renderer.inspector` exposes no materials/pipelines (only per-pass hooks), so the
per-material list comes from the scene; the inspector adds per-pass timing on top.

- [x] Per-material breakdown on WebGPU (group meshes by `material.uuid`), no three
      internals → any three version with `WebGPURenderer`.
- [x] Per-pass timing (render + compute, CPU + GPU ms) via `renderer.inspector`,
      only while deepAnalyze is on. Wraps the existing inspector (a user-installed
      one keeps working), re-hooks if swapped, restores on stop/dispose.
- [x] Removed the "not supported on WebGPURenderer" warning.
- [x] Errors isolated: deepAnalyze disables itself with one warning, core keeps
      measuring.
- [x] Works with `frameloop="demand"`: enabling it requests a few frames; panel
      actions (hide / wireframe) call `invalidate()`. Verified in browser.
- [x] Storybook: **Guides / Deep Analyze** (WebGL, WebGPU, Demand + Headless).
- [ ] Verify three r180 (no Passes, rest works), r181–r183 (pool-map GPU
      fallback), newest (`hasTimestampQuery`).
- [ ] Verify wireframe-on-hover with node materials.

| Feature                           | three                                                |
| --------------------------------- | ---------------------------------------------------- |
| WebGPU core metrics + deepAnalyze | any version with `WebGPURenderer`                    |
| Per-pass CPU time                 | r181+ (`InspectorBase`)                              |
| Per-pass GPU time                 | r181+ (`hasTimestampQuery` on newer; absent in r183) |

### Housekeeping

- [x] Comments + `console.warn` strings → English (core, backends, performance,
      hooks, events, store, charts).
- [ ] Remaining Vietnamese comments: `components/PerfTab.tsx`, `PerfClassic.tsx`,
      `Program.tsx`, `hooks/useHasCompute.ts`, `helpers/estimateMemory.ts`,
      `helpers/countGeoDrawCalls.ts`, `style/classic.module.css`, `vite-env.d.ts`.

---

## v3.2 — Things WebGL can't do

### GPU error panel

- [ ] Hook `renderer.onError` / `onDeviceLost`. Validation / OOM errors currently
      hit the console and vanish.
- [ ] Surface them in the UI (panel/badge) + emit an event for headless users.
- [ ] WebGPU-only by design: WebGL would need to poll `getError()`, which stalls
      the pipeline.

### Full `info.memory` in the RES tab

- [ ] Map all ~18 fields (only 3 today). Priority: `uniformBuffers`,
      `renderTargets`, `storageAttributes`.
- [ ] Keep `MemorySource` labeling (`measured` vs `estimated`) consistent.

---

## Small, independent (ship whenever)

- [ ] **Export `getReport()`** from `index.ts` — already implemented in `store.ts`
      (session time, averages, max, total frames) but unreachable. One line.
- [ ] **Configurable chart panels.** `PanelKey` is hardcoded `"fps" | "cpu" | "gpu"`
      → allow `gpuCompute`, `mem`, …
- [ ] **Expose `passes`** through `usePerfData()` for headless users.
- [ ] **Multi-canvas.** `acquirePerf` warns and measures the wrong renderer. Key the
      core per renderer; note `addEffect`/`addAfterEffect` are global, so per-canvas
      timing needs per-root hooks (e.g. `useFrame` at min/max priority).

---

## Next — Monitoring over time

The library measures well, then discards everything when the tab closes. The
natural step for a "monitor" is time, not a 20th metric.

- [ ] **Session export** to JSON (builds on `getReport()`).
- [ ] **Perf budgets** — declare thresholds, assert in CI via headless mode.
- [ ] **`mark("loaded model")`** — annotate the timeline to correlate spikes with
      app events.
- [ ] **Self-applying quality (opt-in)** — `PerfAdaptive` only suggests a factor
      today; applying it (DPR, etc.) touches the renderer, so it must be opt-in.

---

## Cross-cutting — Tests

No tests yet, and two measurement paths must stay in sync. Recent bugs (the
`analyzePrograms` gate blocking the second scan, `Points` invisible on WebGPU,
#13) were not caught by TypeScript — they needed a real browser.

- [ ] `PerfSampler`: FPS window, EMA, `logsPerSecond` throttle, `pushChart` slot
      count, `resume()` after idle.
- [ ] `AdaptiveEngine`: incline / decline / flipflop fallback.
- [ ] `acquirePerf`: option normalization, live flag merging across instances.
- [ ] Adapters: `readFrameStats` / `readMemory` against mocked WebGL / WebGPU `info`.
- [ ] Regression tests for the bugs above.
