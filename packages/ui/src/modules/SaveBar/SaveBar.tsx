// The bar a page shows while it holds unsaved changes: where they stand, Discard and Save.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { FloatingBar } from '../../molecules/FloatingBar/FloatingBar.tsx';
import { Modal, ModalTrigger } from '../../molecules/Modal/Modal.tsx';
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
  /**
   * Puts the page back as it was saved, once the person says so in Discard's
   * confirm (what it throws away can't come back). Left out, the bar has no
   * Discard.
   */
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
 * on the page; Esc never discards, and Discard asks first.
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
    // While the bar is up, ⌘S is always the page's (never the browser's Save Page), and saves when it can.
    if (!isMounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
      if (!mod || event.isComposing || event.altKey || event.shiftKey || event.defaultPrevented) return;
      // A dialog or popover over the page keeps its keys: ⌘S there must not save the page under it.
      const target = event.target instanceof Element ? event.target : null;
      const layer = target?.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="listbox"]');
      if (layer !== null && layer !== undefined) return;
      if (event.key.toLowerCase() !== 's' && event.key !== 'Enter') return;
      event.preventDefault();
      if (canSave) save.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMounted, canSave, platform]);

  // Focus on Discard or Save when they go (a discard, a save that landed) is handed on, never dropped.
  const hadFocus = useRef(false);
  const focusAway = useRef(onFocusAway);
  useEffect(() => {
    focusAway.current = onFocusAway;
  }, [onFocusAway]);

  // Discard asks first: the changes it throws away can't come back.
  const [isAsking, setAsking] = useState(false);
  const discard = () => {
    setAsking(false);
    onDiscard?.();
    // The Discard the confirm would hand focus back to leaves with the bar: once the confirm has gone, focus goes
    // where the page says, unless it already found a place of its own.
    focusLater(() => {
      const active = document.activeElement;
      if (active === null || active === document.body || active.closest('[inert]') !== null) focusAway.current?.();
      return undefined;
    });
  };
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
            <ModalTrigger isOpen={isAsking} onOpenChange={setAsking}>
              <Button variant="ghost" isDisabled={shown === 'saving'}>
                {strings.discard}
              </Button>
              <Modal
                title={strings.discardTitle}
                tone="danger"
                actions={
                  <>
                    <Button slot="close" kbd="ESC">
                      {strings.keepEditing}
                    </Button>
                    <Button variant="danger-solid" icon="undo-2" onPress={discard}>
                      {strings.discardChanges}
                    </Button>
                  </>
                }
              >
                {strings.discardText}
              </Modal>
            </ModalTrigger>
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
