// How many chips a grid cell can show before "+N" (the conventions' overflow
// rule: cells measure). Pure, so the unit tests run it without a browser.

/**
 * How many chips fit in `available`, given each chip's natural width, the gap
 * between them and the "+N" chip's width: every chip when all fit, otherwise
 * as many as fit beside "+N", and always at least one (the last shown one
 * truncates). Pure, so it is tested without a browser.
 */
export function chipsThatFit(widths: readonly number[], gap: number, more: number, available: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return widths.length;
  let used = more;
  let count = 0;
  for (const width of widths) {
    if (used + gap + width > available) break;
    used += gap + width;
    count += 1;
  }
  return Math.max(1, count);
}
