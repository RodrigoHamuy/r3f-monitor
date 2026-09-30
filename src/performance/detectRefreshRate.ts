/**
 * Estimates display refresh rate (Hz) from requestAnimationFrame timing.
 *
 * No browser API exposes refresh rate, so it's inferred from rAF intervals.
 * Uses the median of the SHORTEST intervals instead of the mean: even with a
 * busy main thread (app mount, shader compile), a few on-time frame pairs reveal
 * the real period, and the median rejects jitter outliers.
 *
 * Note: hidden tabs / power saving throttle rAF -> readings come out low.
 * Combine with another source (e.g. max FPS seen) rather than trusting it alone.
 */
export function detectRefreshRate(samples = 30): Promise<number> {
  return new Promise((resolve) => {
    const skip = 5; // skip warm-up frames — early rAF is jittery
    const intervals: number[] = [];
    let last = 0;
    let count = 0;

    const loop = (t: number) => {
      count++;
      if (count > skip && last > 0) intervals.push(t - last);
      last = t;

      if (intervals.length < samples) {
        window.requestAnimationFrame(loop);
        return;
      }

      intervals.sort((a, b) => a - b);
      const k = Math.min(5, intervals.length);
      const median = intervals[Math.floor(k / 2)];
      resolve(median > 0 ? 1000 / median : 60);
    };

    window.requestAnimationFrame(loop);
  });
}
