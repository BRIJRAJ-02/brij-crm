// The icons Icon always holds, with no scope around it: the few the hosted form (spec 0023) draws, on a page that
// loads none of the rest. Its first load is held to its own budget (apps/web/.size-limit.js), and the whole
// registry (icons.ts, about 250 icons) cost it about 20 kB gzipped. UiProvider brings the registry for every other
// page, so the app, the booking pages and Storybook draw every icon at once, as before. Like icons.ts, this file may
// import lucide-react. Each name here is in the registry too (icons.test.ts checks), so it type checks the same.
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Copy,
  GripVertical,
  Info,
  Lock,
  Minus,
  Plus,
  Search,
  Star,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';

/** The icons drawn with no registry around them: the hosted form's controls (Rating's star and a Ranking row's grip among them), its alerts, its toasts and its upload. */
export const baseIcons = {
  'arrow-left': ArrowLeft,
  // One at a time's question number and its up and down arrows (T42).
  'arrow-right': ArrowRight,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  copy: Copy,
  'grip-vertical': GripVertical,
  info: Info,
  lock: Lock,
  minus: Minus,
  plus: Plus,
  search: Search,
  star: Star,
  'triangle-alert': TriangleAlert,
  upload: Upload,
  x: X,
} as const;
