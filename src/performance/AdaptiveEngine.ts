export type AdaptiveCallbacks = {
  /** Called when performance is above the upper bound (good) */
  onIncline?: (engine: AdaptiveEngine) => void;
  /** Called when performance is below the lower bound (bad) */
  onDecline?: (engine: AdaptiveEngine) => void;
  /** Called when factor changes (via incline/decline) */
  onChange?: (engine: AdaptiveEngine) => void;
  /** Called when flipflops exceed the limit — unstable, pin a fixed baseline */
  onFallback?: (engine: AdaptiveEngine) => void;
};

export type AdaptiveEngineOptions = AdaptiveCallbacks & {
  /** FPS samples collected per decision, default 10 */
  iterations?: number;
  /** Fraction of samples that must cross a bound to incline/decline, default 0.75 */
  threshold?: number;
  /** Factor step per incline/decline, default 0.1 */
  step?: number;
  /** Initial factor (0-1), default 0.5 */
  factor?: number;
  /** Max incline/decline flips before fallback, default Infinity */
  flipflops?: number;
  /** Maps refresh rate to [lower, upper]; between the bounds is the stable zone */
  bounds?: (refreshrate: number) => [lower: number, upper: number];
};

/**
 * Pure adaptive-quality logic (no React, no measuring).
 * Takes FPS samples via `addSample()`, decides incline/decline and updates
 * `factor` (0-1). Ported from drei <PerformanceMonitor>.
 */
export class AdaptiveEngine {
  iterations: number;
  threshold: number;
  step: number;
  flipflops: number;
  bounds: (refreshrate: number) => [lower: number, upper: number];

  onIncline?: (engine: AdaptiveEngine) => void;
  onDecline?: (engine: AdaptiveEngine) => void;
  onChange?: (engine: AdaptiveEngine) => void;
  onFallback?: (engine: AdaptiveEngine) => void;

  /** FPS of the latest sample */
  fps = 0;
  /** GPU time (ms) of the latest sample — compare with `cpu` for GPU- vs CPU-bound */
  gpu = 0;
  /** CPU time (ms) of the latest sample */
  cpu = 0;
  /** Current quality factor, 0-1 */
  factor: number;
  /** Estimated display refresh rate: max(detectRefreshRate seed, highest FPS seen) */
  refreshrate = 0;
  /** FPS samples in the current evaluation window */
  averages: number[] = [];
  index = 0;
  flipped = 0;
  fallback = false;

  private lastFactor: number;
  private subscriptions = new Map<symbol, AdaptiveCallbacks>();

  constructor({
    iterations = 10,
    threshold = 0.75,
    step = 0.1,
    factor = 0.5,
    flipflops = Infinity,
    bounds = (refreshrate) => (refreshrate > 100 ? [60, 100] : [40, 60]),
    onIncline,
    onDecline,
    onChange,
    onFallback,
  }: AdaptiveEngineOptions = {}) {
    this.iterations = iterations;
    this.threshold = threshold;
    this.step = step;
    this.factor = factor;
    this.lastFactor = factor;
    this.flipflops = flipflops;
    this.bounds = bounds;
    this.onIncline = onIncline;
    this.onDecline = onDecline;
    this.onChange = onChange;
    this.onFallback = onFallback;
  }

  /** Seeds refresh rate from an external source (e.g. detectRefreshRate) — only increases. */
  seedRefreshrate(hz: number) {
    this.refreshrate = Math.max(this.refreshrate, hz);
  }

  /** Registers extra callbacks (for hooks). Returns an unsubscribe function. */
  subscribe(callbacks: AdaptiveCallbacks) {
    const key = Symbol();
    this.subscriptions.set(key, callbacks);
    return () => void this.subscriptions.delete(key);
  }

  /** Adds a sample; evaluates and resets once `iterations` is reached. gpu/cpu (ms) are optional, informational only. */
  addSample(fps: number, gpu = 0, cpu = 0) {
    if (this.fallback) return;

    this.fps = fps;
    this.gpu = gpu;
    this.cpu = cpu;
    this.refreshrate = Math.max(this.refreshrate, fps);
    this.averages[this.index++ % this.iterations] = fps;

    if (this.averages.length < this.iterations) return;

    const [lower, upper] = this.bounds(this.refreshrate);
    const upperCount = this.averages.filter((v) => v >= upper).length;
    const lowerCount = this.averages.filter((v) => v < lower).length;

    // Incline: most samples above upper bound -> raise quality
    if (upperCount > this.iterations * this.threshold) {
      this.factor = Math.min(1, this.factor + this.step);
      this.flipped++;
      this.emit("onIncline");
    }
    // Decline: most samples below lower bound -> lower quality
    if (lowerCount > this.iterations * this.threshold) {
      this.factor = Math.max(0, this.factor - this.step);
      this.flipped++;
      this.emit("onDecline");
    }

    if (this.lastFactor !== this.factor) {
      this.lastFactor = this.factor;
      this.emit("onChange");
    }

    if (this.flipped > this.flipflops && !this.fallback) {
      this.fallback = true;
      this.emit("onFallback");
    }

    this.averages = [];
  }

  private emit(name: keyof AdaptiveCallbacks) {
    this[name]?.(this);
    this.subscriptions.forEach((callbacks) => callbacks[name]?.(this));
  }
}
