// Finish later (spec 0063, AC-6319): the one affordance a visitor has for
// coming back to a half filled form. Pressing it keeps what they have typed
// and shows the link that brings them back; the link carries an opaque token
// and nothing else (AC-6330), so it is safe to copy, and safe to email to the
// address the form already holds.
//
// It draws nothing on a form that keeps nothing, which is every form whose
// page gave no `onSave`, and the builder's preview.
import { useState } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import styles from './FinishLater.module.css';
import type { HostedFormState } from './use-hosted-form.ts';

/** The day a link stops working, in the visitor's own language and zone. */
function dayOf(iso: string, language: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(when);
}

/** The time a save landed, to the minute: a visitor wants "just now", not a timestamp. */
function timeOf(language: string): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(new Date());
}

export interface FinishLaterProps {
  readonly state: HostedFormState;
  /** The form's language, for the day and the time. */
  readonly language: string;
  /** The step the visitor is on, so the link reopens there. */
  readonly stepId?: string | undefined;
}

export function FinishLater({ state, language, stepId }: FinishLaterProps) {
  const { words, save } = state;
  const [isAsked, setAsked] = useState(false);
  const [emailed, setEmailed] = useState<'none' | 'sending' | 'sent' | 'needs-address'>('none');
  const [isCopied, setCopied] = useState(false);
  if (!state.savesFills) return null;

  const kept = save.kind === 'kept' ? save.kept : undefined;
  // The quiet line: only ever one of these, and never while nothing has happened yet.
  const note =
    save.kind === 'saving'
      ? words.saving
      : save.kind === 'failed'
        ? words.saveFailed
        : kept === undefined
          ? undefined
          : words.savedOn(timeOf(language));

  return (
    <div className={styles.wrap}>
      {!isAsked && (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            setAsked(true);
            state.keepNow(stepId);
          }}
        >
          {words.finishLater}
        </Button>
      )}
      {/* Polite, not assertive: a save is news a visitor can read when they look, never an interruption. */}
      <p className={styles.line} aria-live="polite">
        {note ?? ''}
      </p>
      {isAsked && kept !== undefined && (
        <div className={styles.panel}>
          <p className={styles.line}>
            <strong>{words.resumeHeading}</strong>
          </p>
          <p className={styles.line}>{words.resumeLine(dayOf(kept.expiresAt, language))}</p>
          <p className={styles.line}>{kept.resumeUrl}</p>
          <div className={styles.row}>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => {
                void navigator.clipboard.writeText(kept.resumeUrl).then(
                  () => setCopied(true),
                  // Where the browser refuses the clipboard the link is on screen to copy by hand, so there is
                  // nothing to say: claiming "Copied" when nothing was copied is worse than saying nothing.
                  () => undefined,
                );
              }}
            >
              {isCopied ? words.copiedLink : words.copyLink}
            </Button>
            {state.emailResume !== undefined && (
              <Button
                variant="secondary"
                size="sm"
                isDisabled={emailed === 'sending' || emailed === 'sent'}
                onPress={() => {
                  const send = state.emailResume;
                  if (send === undefined) return;
                  setEmailed('sending');
                  void send(kept.resumeToken).then(
                    (sent) => setEmailed(sent ? 'sent' : 'needs-address'),
                    () => setEmailed('needs-address'),
                  );
                }}
              >
                {words.emailLink}
              </Button>
            )}
          </div>
          {emailed !== 'none' && emailed !== 'sending' && (
            <p className={styles.line} aria-live="polite">
              {emailed === 'sent' ? words.emailSent : words.emailNeedsAddress}
            </p>
          )}
          <div className={styles.row}>
            <Button variant="ghost" size="sm" onPress={() => setAsked(false)}>
              {words.keepFilling}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
