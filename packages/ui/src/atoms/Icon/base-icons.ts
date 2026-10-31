// The icons Icon always holds, with no scope around it: the few the hosted form (spec 0023) draws, on a page that
// loads none of the rest. Its first load is held to its own budget (apps/web/.size-limit.js), and the whole
// registry (icons.ts, about 250 icons) cost it about 20 kB gzipped. UiProvider brings the registry for every other
// page, so the app, the booking pages and Storybook draw every icon at once, as before. Like icons.ts, this file may
// import lucide-react. Each name here is in the registry too (icons.test.ts checks), so it type checks the same.
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  Info,
  Lock,
  Minus,
  Plus,
  Search,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';

/** The icons drawn with no registry around them: the hosted form's controls, its alerts, its toasts and its upload. */
export const baseIcons = {
  'arrow-left': ArrowLeft,
  check: Check,
  'chevron-down': ChevronDown,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  copy: Copy,
  info: Info,
  lock: Lock,
  minus: Minus,
  plus: Plus,
  search: Search,
  'triangle-alert': TriangleAlert,
  upload: Upload,
  x: X,
} as const;
