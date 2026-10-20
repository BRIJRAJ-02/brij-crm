// The bar a page shows while it holds unsaved changes: where they stand, Discard and Save.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { FloatingBar } from '../../molecules/FloatingBar/FloatingBar.tsx';
import { useKeyboardPlatform } from '../../provider/context.ts';
import styles from './SaveBar.module.css';
import { strings } from './strings.ts';

/**
 * Where a page's changes stand: `hidden` (nothing to save), `unsaved`,
 * `saving`, `saved` (said for a moment, then the bar leaves) or `error`
 * (the save failed; `error` says why).
 */
export type SaveBarStatus = 'hidden' | 'unsaved' | 'saving' | 'saved' | 'error';

/** Props for SaveBar. */
export interface SaveBarProps {
  readonly status: SaveBarStatus;
  /** Why the save failed, said in the bar while `status` is `error`. */
  readonly error?: string;
  /** Saves; ⌘S (and ⌘↵ outside a form) press it from anywhere on the page. */
  readonly onSave: () => void;
  /** Puts the page back as it was saved. Left out, the bar has no Discard. */
  readonly onDiscard?: () => void;
  /**
   * The changes can't be saved yet: Save waits, and the bar says this in
   * place of "Unsaved changes" ("Fix the hours marked in red to save.").
   */
  readonly blockedReason?: string;
  /**
   * Where focus goes when the bar's buttons go (after a save, or a discard)
   * while focus was on them, so it never falls to the page.
   */
  readonly onFocusAway?: () => void;
}

// How long "Saved" stays before the bar leaves.
const SAVED_MS = 1600;

/**
 * A page's save bar (the owner's design, 20 October 2026): the bulk bar's
 * floating shell, a quiet status at the start, then Discard and Save. Save
 * keeps its place and width while it saves; a save that fails says why in the
 * bar and Save becomes Try again; one that lands says Saved for a moment, then
 * the bar sinks out. Status changes are said politely. ⌘S saves from anywhere
 * on the page; Esc never discards.
 */
export function SaveBar({ status, error, onSave, onDiscard, blockedReason, onFocusAway }: SaveBarProps) {
  const platform = useKeyboardPlatform();
  const [savedExpired, setSavedExpired] = useState(false);
  const [lastStatus, setLastStatus] = useState(status);
  // A new status starts its own "Saved" moment afresh.
  if (status !== lastStatus) {
    setLastStatus(status);
    setSavedExpired(false);
  }
  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => setSavedExpired(true), SAVED_MS);
    return () => clearTimeout(timer);
  }, [status]);
  const isWanted = status !== 'hidden' && !(status === 'saved' && savedExpired);
  const [isMounted, setMounted] = useState(isWanted);
  if (isWanted && !isMounted) setMounted(true);
  // What the bar says while it leaves: the last state it showed.
  const [shown, setShown] = useState<Exclude<SaveBarStatus, 'hidden'>>(status === 'hidden' ? 'unsaved' : status);
  if (status !== 'hidden' && status !== shown) setShown(status);
  const canSave = blockedReason === undefined && (status === 'unsaved' || status === 'error');

  // ⌘S (Ctrl+S elsewhere) saves from anywhere on the page; ⌘↵ too, unless a form takes it for its own submit.
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);
  useEffect(() => {
    if (!isWanted || status === 'saved') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
      if (!mod || event.isComposing || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 's' && event.key !== 'Enter') return;
      event.preventDefault();
      if (canSave) save.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isWanted, status, canSave, platform]);

  // Focus on Discard or Save when they go (a discard, a save that landed) is handed on, never dropped.
  const hadFocus = useRef(false);
  const focusAway = useRef(onFocusAway);
  useEffect(() => {
    focusAway.current = onFocusAway;
  }, [onFocusAway]);
  useEffect(() => {
    if (status !== 'saved' && status !== 'hidden') return;
    const active = document.activeElement;
    // Fallen to the page, or still on a button the leaving bar has made inert (the browser lets go a moment later).
    if (hadFocus.current && (active === null || active === document.body || active.closest('[inert]') !== null)) {
      hadFocus.current = false;
      focusAway.current?.();
    }
  }, [status]);

  if (!isMounted) return null;
  const isError = shown === 'error';
  const message =
    shown === 'saved' ? strings.saved : isError ? (error ?? strings.unsaved) : (blockedReason ?? strings.unsaved);
  return (
    <FloatingBar
      placement="footer"
      isLeaving={!isWanted}
      onLeft={() => setMounted(false)}
      frameProps={{
        onFocus: () => {
          hadFocus.current = true;
        },
        onBlur: (event) => {
          // Focus going nowhere (its button gone, or made inert as the bar leaves) still counts as the bar's.
          if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget))
            hadFocus.current = false;
        },
      }}
    >
      <span className={styles.status} data-tone={isError ? 'danger' : shown === 'saved' ? 'success' : undefined}>
        {shown === 'saved' && <Icon name="circle-check" size="sm" />}
        {isError && <Icon name="circle-alert" size="sm" />}
        {/* Born with its words, so the first "Unsaved changes" is quiet; what changes after is said. */}
        <span className={styles.message} role="status">
          {message}
        </span>
      </span>
      {shown !== 'saved' && (
        <span className={styles.actions}>
          {onDiscard !== undefined && (
            <Button variant="ghost" isDisabled={shown === 'saving'} onPress={onDiscard}>
              {strings.discard}
            </Button>
          )}
          {/* The check's place takes the spinner while it saves, so Save never changes width. */}
          <Button
            variant="primary"
            icon="check"
            kbd="⌘S"
            isPending={shown === 'saving'}
            isDisabled={blockedReason !== undefined}
            onPress={onSave}
          >
            {isError ? strings.tryAgain : strings.save}
          </Button>
        </span>
      )}
    </FloatingBar>
  );
}
