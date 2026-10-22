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
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
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
      // Strongest in the outer foot, gone well before the window and the headline.
      const place = down ** 1.8 * (1 - toward) ** 1.6 * (0.55 + grain * 0.45);
      const length = DASH_WIDTH - 2 + Math.round(noise(column, row) * 6);
      // Two waves: one climbing the rows, one drifting across the columns.
      const wave =
        0.5 +
        0.3 * Math.sin(row * 0.45 - drift * 1.8 + column * 0.08) +
        0.2 * Math.sin(column * 0.3 + drift * 0.7 - row * 0.1);
      const x = column * STEP_X + (STEP_X - length) / 2;
      const y = row * STEP_Y + (STEP_Y - DASH_HEIGHT) / 2;
      const alpha = Math.min(1, place * wave) * STRENGTH;
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
 * from the foot up, then slow waves drift across them (the pointer glow came and went, the owner, 23 October 2026).
 * It draws only while on screen and the page is visible,
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
    const start = performance.now();
    const color = () => getComputedStyle(canvas).getPropertyValue('--accent').trim();

    // Each frame measures the canvas itself: the earlier observers (resize and intersection) were set up while the
    // canvas was still hidden behind the still field, and now and then the intersection one never reported it on
    // screen, so the field stayed blank for the whole visit (the owner, 23 October 2026: "sometimes it goes blank").
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.visibilityState === 'hidden' || now - last < FRAME_MS) return;
      const { width, height, top, bottom } = canvas.getBoundingClientRect();
      if (width === 0 || height === 0 || bottom <= 0 || top >= window.innerHeight) return;
      last = now;
      // Setting the size clears the canvas, so it is set only when the size (or the screen's density) changed.
      const scale = Math.min(window.devicePixelRatio, 2);
      const pixelWidth = Math.round(width * scale);
      const pixelHeight = Math.round(height * scale);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      draw(context, width, height, side, color(), now - start);
    };

    frame = requestAnimationFrame(tick);
    // The canvas replaces the still field one frame later, once it has drawn.
    const show = requestAnimationFrame(() => setIsLive(true));
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(show);
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
