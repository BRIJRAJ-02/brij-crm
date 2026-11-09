import { UNSTABLE_Toast as AriaToast, UNSTABLE_ToastContent as AriaToastContent, UNSTABLE_ToastQueue as ToastQueue, UNSTABLE_ToastRegion as AriaToastRegion, Text } from 'react-aria-components';
import { createContext, useContext, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { CircleAlert, Info, X } from 'lucide-react';
import { BarButton, motionMs } from '../FloatingBar/FloatingBar.tsx';
import { SuccessCheck } from '../Motion/Motion.tsx';
import './Toast.css';

/** A confirmation stays 5 seconds. */
export const TOAST_TIMEOUT_MS = 5_000;
/** A toast with an action (Undo) stays 8 seconds. */
export const ACTION_TOAST_TIMEOUT_MS = 8_000;
/** At most three show at once; older ones wait, then expire. */
export const MAX_VISIBLE_TOASTS = 3;

/** The toast's icon: a drawn tick, an alert, an info mark, or none. */
export type ToastTone = 'success' | 'danger' | 'info' | 'neutral';

/** What a toast says. One short past-tense line ("Jo Mendes deleted"). */
export interface ToastContent {
  readonly message: string;
  readonly tone?: ToastTone;
  /** One action, usually Undo. Pressing it also closes the toast. */
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

/** The app's toasts: raise and dismiss them. Made once by ToastProvider. */
export interface Toaster {
  /** Shows a toast and returns its key. 5s, or 8s with an action, unless `timeout` says otherwise. */
  readonly toast: (content: ToastContent, options?: { readonly timeout?: number }) => string;
  /** Closes a toast, playing its exit first. */
  readonly dismiss: (key: string) => void;
  /** React Aria's queue the region draws from. */
  readonly queue: ToastQueue<ToastContent>;
  readonly subscribe: (fn: () => void) => () => void;
  readonly getVersion: () => number;
  readonly isLeaving: (key: string) => boolean;
}

interface Timer { remaining: number; start: number; id: number | undefined }

/** Makes a toast queue whose timers pause while the region is hovered or focused, and whose toasts animate out before React Aria removes them. */
export function createToaster(): Toaster {
  const queue = new ToastQueue<ToastContent>({ maxVisibleToasts: MAX_VISIBLE_TOASTS });
  const timers = new Map<string, Timer>();
  const leaving = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  let paused = false;
  const emit = () => { version += 1; listeners.forEach((fn) => fn()); };
  const run = (key: string, t: Timer) => { t.start = Date.now(); t.id = window.setTimeout(() => dismiss(key), t.remaining); };
  const dismiss = (key: string) => {
    if (leaving.has(key)) return;
    const t = timers.get(key);
    if (t?.id !== undefined) window.clearTimeout(t.id);
    timers.delete(key);
    leaving.add(key);
    emit();
    window.setTimeout(() => { queue.close(key); leaving.delete(key); emit(); }, motionMs('--duration-fast', 250));
  };
  const pauseAll = () => {
    paused = true;
    timers.forEach((t) => { if (t.id !== undefined) { window.clearTimeout(t.id); t.id = undefined; t.remaining -= Date.now() - t.start; } });
  };
  const resumeAll = () => { paused = false; timers.forEach((t, key) => { if (t.id === undefined) run(key, t); }); };
  // React Aria's region calls these on hover and focus within; route them to our timers.
  Object.assign(queue, { pauseAll, resumeAll });
  queue.subscribe(() => { if (queue.visibleToasts.length === 0) paused = false; });
  return {
    queue,
    dismiss,
    toast: (content, options) => {
      const key = queue.add(content);
      const t: Timer = { remaining: options?.timeout ?? (content.action ? ACTION_TOAST_TIMEOUT_MS : TOAST_TIMEOUT_MS), start: Date.now(), id: undefined };
      timers.set(key, t);
      if (!paused) run(key, t);
      emit();
      return key;
    },
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getVersion: () => version,
    isLeaving: (key) => leaving.has(key),
  };
}

const ToasterContext = createContext<Toaster | undefined>(undefined);

/** Gives everything inside it `useToast()`, and draws the region once. Put it at the app's root. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toaster] = useState(createToaster);
  return <ToasterContext.Provider value={toaster}>{children}<ToastRegion toaster={toaster} /></ToasterContext.Provider>;
}

/** The toaster from the nearest ToastProvider: `const { toast } = useToast(); toast({ message: 'Saved', tone: 'success' })`. */
export function useToast(): Toaster {
  const t = useContext(ToasterContext);
  if (!t) throw new Error('useToast needs a ToastProvider above it.');
  return t;
}

const ICON = {
  success: <SuccessCheck size={16} />,
  danger: <CircleAlert size={16} strokeWidth={1.75} />,
  info: <Info size={16} strokeWidth={1.75} />,
} as const;

/** Draws the toasts as ink pills at the bottom centre. Several stack like banners (transitions.dev 32): the newest in front, older ones peek 12px above, smaller and fainter; hovering or focusing spreads them out and pauses their timers. */
export function ToastRegion({ toaster }: { readonly toaster: Toaster }) {
  useSyncExternalStore(toaster.subscribe, toaster.getVersion, toaster.getVersion);
  const live = toaster.queue.visibleToasts.filter((t) => !toaster.isLeaving(t.key));
  return (
    <AriaToastRegion queue={toaster.queue} aria-label="Notifications" className="tf-toasts tf-overlay" style={{ '--tf-toast-count': Math.max(1, live.length) } as CSSProperties}>
      {({ toast }) => {
        const depth = live.findIndex((t) => t.key === toast.key);
        const tone = toast.content.tone ?? 'neutral';
        return (
          <AriaToast toast={toast} className="tf-toast" data-depth={depth === -1 ? 'leaving' : String(depth)} data-tone={tone}>
            {tone !== 'neutral' && <span className="tf-toast__icon" aria-hidden="true">{ICON[tone]}</span>}
            <AriaToastContent className="tf-toast__content"><Text slot="title">{toast.content.message}</Text></AriaToastContent>
            {toast.content.action && (
              <BarButton variant="solid" size="sm" onPress={() => { toast.content.action?.onAction(); toaster.dismiss(toast.key); }}>{toast.content.action.label}</BarButton>
            )}
            <BarButton size="sm" label="Dismiss" icon={<X size={14} strokeWidth={1.75} />} onPress={() => toaster.dismiss(toast.key)} />
          </AriaToast>
        );
      }}
    </AriaToastRegion>
  );
}
