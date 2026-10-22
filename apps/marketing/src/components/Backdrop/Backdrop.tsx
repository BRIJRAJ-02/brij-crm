import { useEffect, useId, useRef, useState } from 'react';
import styles from './Backdrop.module.css';

/** Props for Backdrop. */
export interface BackdropProps {
  /** Which foot of the fold the field sits in. */
  readonly side: 'start' | 'end';
}

const STEP_X = 14;
const STEP_Y = 12;
const DASH_WIDTH = 6;
const DASH_HEIGHT = 2;
/** The reveal from the foot up, in milliseconds, then the slow drift. */
const REVEAL_MS = 1400;
const FRAME_MS = 1000 / 30;
/** The field's strength: the accent at 70%. */
const STRENGTH = 0.85;
/** How far the pointer's glow reaches, in CSS pixels, and how fast the glow follows it. */
const GLOW_RADIUS = 150;
const GLOW_EASE = 0.18;

interface Point {
  x: number;
  y: number;
}

/** A fixed pseudo random number for a cell, 0 to 1, the same every frame, so the pattern holds still as it moves. */
function noise(row: number, column: number) {
  const value = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Draws the field once for a moment in time: each dash's alpha is its place (fading upward and toward the window)
 * times a slow wave that drifts across the rows, times the reveal, which uncovers the rows from the foot up.
 */
function draw(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  side: BackdropProps['side'],
  color: string,
  elapsed: number,
  glow: Point | undefined,
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  const reach = 2 * GLOW_RADIUS * GLOW_RADIUS;
  const columns = Math.ceil(width / STEP_X);
  const rows = Math.ceil(height / STEP_Y);
  const reveal = Math.min(1, elapsed / REVEAL_MS);
  const eased = 1 - (1 - reveal) ** 3;
  const drift = elapsed / 1000;
  for (let row = 0; row < rows; row += 1) {
    const down = row / rows;
    // Rows are uncovered from the foot up.
    if (down < 1 - eased) continue;
    for (let column = 0; column < columns; column += 1) {
      // A random pattern: a third of the cells are empty, and the dashes differ in length and weight.
      const grain = noise(row, column);
      if (grain < 0.34) continue;
      const across = column / columns;
      const toward = side === 'start' ? across : 1 - across;
      const place = down ** 1.3 * (1 - toward * toward) * (0.55 + grain * 0.45);
      const length = DASH_WIDTH - 2 + Math.round(noise(column, row) * 6);
      // Two waves: one climbing the rows, one drifting across the columns.
      const wave =
        0.5 +
        0.3 * Math.sin(row * 0.45 - drift * 1.8 + column * 0.08) +
        0.2 * Math.sin(column * 0.3 + drift * 0.7 - row * 0.1);
      const x = column * STEP_X + (STEP_X - length) / 2;
      const y = row * STEP_Y + (STEP_Y - DASH_HEIGHT) / 2;
      // Under the pointer the dashes light up, the nearest fully, fading out over the glow's reach.
      let lift = 0;
      if (glow !== undefined) {
        const dx = x + length / 2 - glow.x;
        const dy = y + DASH_HEIGHT / 2 - glow.y;
        lift = Math.exp(-(dx * dx + dy * dy) / reach) * eased;
      }
      const alpha = Math.min(1, place * wave + lift) * STRENGTH;
      if (alpha < 0.015) continue;
      context.globalAlpha = alpha;
      context.fillRect(x, y, length, DASH_HEIGHT);
    }
  }
  context.globalAlpha = 1;
}

/**
 * The fold's decoration: a field of short accent dashes in each foot of the fold, behind the window, fading toward
 * the window and upward (Twenty's home draws its own with three.js; the owner's reference, 23 October 2026, kept
 * but quieter: the window stays the one bright thing). The page is prerendered with an SVG pattern of the field,
 * so it is there before any script; once hydrated, a canvas takes over and animates it: the rows are uncovered
 * from the foot up, then a slow wave drifts across them, and the dashes under the pointer light up. It draws only
 * while on screen and the page is visible,
 * never under reduced motion, and never on a phone, where the window takes the width.
 */
export function Backdrop({ side }: BackdropProps) {
  const patternId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (!window.matchMedia('(width >= 1024px)').matches) return undefined;
    const context = canvas.getContext('2d');
    if (context === null) return undefined;

    let frame = 0;
    let last = 0;
    let isOnScreen = true;
    let pointer: Point | undefined;
    let glow: Point | undefined;
    const start = performance.now();
    const scale = Math.min(window.devicePixelRatio, 2);
    const color = () => getComputedStyle(canvas).getPropertyValue('--accent').trim();
    const follow = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const leave = () => {
      pointer = undefined;
    };

    const fit = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!isOnScreen || document.visibilityState === 'hidden' || now - last < FRAME_MS) return;
      last = now;
      const { width, height } = canvas.getBoundingClientRect();
      // The glow eases after the pointer, and drifts off the field when the pointer leaves the window.
      const target = pointer ?? (glow === undefined ? undefined : { x: glow.x, y: glow.y + GLOW_RADIUS * 4 });
      if (target !== undefined) {
        glow =
          glow === undefined
            ? target
            : { x: glow.x + (target.x - glow.x) * GLOW_EASE, y: glow.y + (target.y - glow.y) * GLOW_EASE };
        if (pointer === undefined && glow.y > height + GLOW_RADIUS * 3) glow = undefined;
      }
      draw(context, width, height, side, color(), now - start, glow);
    };

    fit();
    const watchSize = new ResizeObserver(fit);
    watchSize.observe(canvas);
    const watchView = new IntersectionObserver(([entry]) => {
      isOnScreen = entry?.isIntersecting ?? true;
    });
    watchView.observe(canvas);
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('pointerleave', leave);
    document.addEventListener('pointerleave', leave);
    frame = requestAnimationFrame(tick);
    const show = requestAnimationFrame(() => setIsLive(true));
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(show);
      watchSize.disconnect();
      watchView.disconnect();
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerleave', leave);
      document.removeEventListener('pointerleave', leave);
    };
  }, [side]);

  return (
    <div className={styles.root} data-side={side} data-live={isLive || undefined} aria-hidden="true">
      <svg className={styles.still} focusable="false">
        <defs>
          <pattern id={patternId} width={STEP_X} height={STEP_Y} patternUnits="userSpaceOnUse">
            <rect
              x={(STEP_X - DASH_WIDTH) / 2}
              y={(STEP_Y - DASH_HEIGHT) / 2}
              width={DASH_WIDTH}
              height={DASH_HEIGHT}
              rx={DASH_HEIGHT / 2}
            />
          </pattern>
        </defs>
        <rect className={styles.field} width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <canvas className={styles.live} ref={canvasRef} />
    </div>
  );
}
