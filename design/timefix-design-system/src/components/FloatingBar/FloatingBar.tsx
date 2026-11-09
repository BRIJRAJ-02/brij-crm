import { Button as AriaButton, Toolbar, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button } from '../Button/Button.tsx';
import { NumberRoll, Spinner, SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import './FloatingBar.css';

/** Reads a duration token (in ms) from the root, or 0 when the user asks for reduced motion. */
export function motionMs(token: string, fallback: number): number {
  if (typeof window === 'undefined') return 0;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || fallback;
}

/** Keeps something mounted while it plays its exit. `isExiting` is true for `exitToken`'s duration after `isVisible` turns false. */
export function usePresence(isVisible: boolean, exitToken = '--duration-fast'): { readonly isMounted: boolean; readonly isExiting: boolean } {
  const [mounted, setMounted] = useState(isVisible);
  if (isVisible && !mounted) setMounted(true);
  useEffect(() => {
    if (isVisible || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), motionMs(exitToken, 250));
    return () => window.clearTimeout(t);
  }, [isVisible, mounted, exitToken]);
  return { isMounted: mounted, isExiting: mounted && !isVisible };
}

/** Props for BarButton. */
export interface BarButtonProps extends Omit<AriaButtonProps, 'children' | 'className'> {
  /** `solid` is the light pill that carries the bar's one main action; `ghost` is every other action. */
  readonly variant?: 'solid' | 'ghost';
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
  /** Icon-only buttons need a label. */
  readonly label?: string;
  readonly size?: 'sm' | 'md';
}

/** A pill button for ink surfaces (floating bars, toasts), where the regular Button would vanish. */
export function BarButton({ variant = 'ghost', icon, children, label, size = 'md', ...rest }: BarButtonProps) {
  return (
    <AriaButton {...rest} aria-label={label} className={cx('tf-barbtn', `tf-barbtn--${variant}`, `tf-barbtn--${size}`, children === undefined && 'tf-barbtn--icon')}>
      {icon}{children !== undefined && <span className="tf-barbtn__label">{children}</span>}
    </AriaButton>
  );
}

/** Props for FloatingBar. */
export interface FloatingBarProps {
  readonly isVisible: boolean;
  /** `ink` for actions on a selection and unsaved work; `white` for calmer status bars (publish, visitor). */
  readonly tone?: 'ink' | 'white';
  /** Bottom centre of the region (default) or its bottom end. */
  readonly placement?: 'center' | 'end';
  /** Names the toolbar ("Bulk actions"). */
  readonly 'aria-label': string;
  readonly children: ReactNode;
  /** Esc anywhere in the bar (clears a selection). */
  readonly onEscape?: () => void;
}

/** A pill that floats at the bottom of its region (the region sets `position: relative`). Rises in with the toast motion (350ms, 16px, 2px blur) and drops away in 250ms. Arrow keys move between its buttons. */
export function FloatingBar({ isVisible, tone = 'ink', placement = 'center', 'aria-label': ariaLabel, children, onEscape }: FloatingBarProps) {
  const { isMounted, isExiting } = usePresence(isVisible);
  if (!isMounted) return null;
  return (
    <div className={cx('tf-floatbar-anchor', `tf-floatbar-anchor--${placement}`)} inert={isExiting} onKeyDown={(e) => { if (e.key === 'Escape' && onEscape) { e.stopPropagation(); onEscape(); } }}>
      <Toolbar aria-label={ariaLabel} className={cx('tf-floatbar', `tf-floatbar--${tone}`)} data-exiting={isExiting || undefined}>
        {children}
      </Toolbar>
    </div>
  );
}

/** Props for BulkActionBar. */
export interface BulkActionBarProps {
  /** How many rows are selected; the bar shows while it is above 0. */
  readonly count: number;
  /** The actions, as BarButtons. Three at most, then a More menu. */
  readonly children: ReactNode;
  /** Clears the selection (× and Esc). */
  readonly onClear: () => void;
}

/** Actions on the selected rows: "3 selected", up to three actions and ×. Esc inside the bar clears the selection. */
export function BulkActionBar({ count, children, onClear }: BulkActionBarProps) {
  const [last, setLast] = useState(count);
  if (count > 0 && count !== last) setLast(count);
  return (
    <FloatingBar isVisible={count > 0} aria-label="Bulk actions" onEscape={onClear}>
      <span className="tf-floatbar__count">
        <span className="tf-floatbar__chip tf-num"><NumberRoll value={last} /></span><span>selected</span>
      </span>
      <span className="tf-floatbar__sep" aria-hidden="true" />
      {children}
      <BarButton label="Clear selection" icon={<X size={16} strokeWidth={1.75} />} onPress={onClear} />
    </FloatingBar>
  );
}

/** Where unsaved work stands. `hidden` hides the bar. */
export type SaveBarStatus = 'hidden' | 'unsaved' | 'saving' | 'saved';

/** Props for SaveBar. */
export interface SaveBarProps {
  readonly status: SaveBarStatus;
  /** Saves; ⌘S presses it from anywhere on the page while there are changes. */
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  /** What the changes affect, when it matters ("Everyone sees this view"). */
  readonly note?: string;
}

/** Unsaved changes on a settings page or editor: Discard and Save. Save swaps to a spinner, then a drawn tick and "Saved" before the bar drops away. */
export function SaveBar({ status, onSave, onDiscard, note }: SaveBarProps) {
  useEffect(() => {
    if (status !== 'unsaved') return;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, onSave]);
  const busy = status === 'saving' || status === 'saved';
  return (
    <FloatingBar isVisible={status !== 'hidden'} aria-label="Unsaved changes">
      <span className="tf-floatbar__msg" aria-live="polite">
        <span className="tf-floatbar__dot" data-saved={status === 'saved' || undefined} aria-hidden="true" />
        <TextSwap swapKey={status === 'saved' ? 'saved' : 'unsaved'}>{status === 'saved' ? 'All changes saved' : note ?? 'Unsaved changes'}</TextSwap>
      </span>
      <BarButton onPress={onDiscard} isDisabled={busy}>Discard</BarButton>
      <BarButton variant="solid" onPress={onSave} isDisabled={busy} aria-keyshortcuts="Meta+S">
        <TextSwap swapKey={status === 'saving' ? 'saving' : status === 'saved' ? 'saved' : 'save'}>
          {status === 'saving' ? <><Spinner size={14} label="Saving" />Saving</> : status === 'saved' ? <><SuccessCheck size={14} />Saved</> : 'Save'}
        </TextSwap>
      </BarButton>
    </FloatingBar>
  );
}

/** Where a page stands against what guests see. `live` hides the bar. */
export type PublishBarStatus = 'live' | 'draft' | 'publishing' | 'published';

/** Props for PublishBar. */
export interface PublishBarProps {
  readonly status: PublishBarStatus;
  /** How many changes guests have not seen. */
  readonly changes: number;
  readonly onPublish: () => void;
  /** Throws the draft away and goes back to the live page. */
  readonly onDiscard?: () => void;
  readonly onPreview?: () => void;
}

/** A page's draft against its live version: "3 unpublished changes", Preview, Publish. White, so it reads as status rather than alarm. */
export function PublishBar({ status, changes, onPublish, onDiscard, onPreview }: PublishBarProps) {
  const busy = status === 'publishing' || status === 'published';
  return (
    <FloatingBar isVisible={status !== 'live'} tone="white" aria-label="Publish">
      <span className="tf-floatbar__msg" aria-live="polite">
        <span className="tf-floatbar__dot tf-floatbar__dot--draft" data-saved={status === 'published' || undefined} aria-hidden="true" />
        <TextSwap swapKey={status === 'published' ? 'p' : 'd'}>{status === 'published' ? 'Guests see the new page' : `${changes} unpublished ${changes === 1 ? 'change' : 'changes'}`}</TextSwap>
      </span>
      {onDiscard && <Button variant="ghost" onPress={onDiscard} isDisabled={busy}>Discard</Button>}
      {onPreview && <Button variant="secondary" onPress={onPreview}>Preview</Button>}
      <Button variant="primary" onPress={onPublish} isDisabled={busy}>
        <TextSwap swapKey={status}>{status === 'publishing' ? <><Spinner size={14} label="Publishing" />Publishing</> : status === 'published' ? <><SuccessCheck size={14} />Published</> : 'Publish'}</TextSwap>
      </Button>
    </FloatingBar>
  );
}
