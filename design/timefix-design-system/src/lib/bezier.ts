// The one cubic-bezier sampler: frame-by-frame motion (SearchField's clear, Chart's tweens) eases with the CSS tokens.

/**
 * Turns a CSS `cubic-bezier(x1, y1, x2, y2)` string (an `--ease-*` token's value) into an easing function of 0..1.
 * When the string is not a cubic-bezier, `fallback` is parsed instead; with no fallback the easing is linear.
 */
export function bezier(css: string, fallback?: string): (t: number) => number {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(css);
  if (!m) return fallback === undefined ? (t) => t : bezier(fallback);
  const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
  const at = (u: number, a: number, b: number) => 3 * u * (1 - u) * (1 - u) * a + 3 * u * u * (1 - u) * b + u * u * u;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // x(u) is monotonic for easing curves, so bisect for the u whose x is t, then read y there.
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 24; i++) {
      u = (lo + hi) / 2;
      if (at(u, x1, x2) < t) lo = u; else hi = u;
    }
    return at(u, y1, y2);
  };
}
