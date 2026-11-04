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
import { Icon } from '../atoms/Icon/Icon.tsx';
import styles from './FinishLater.module.css';
import type { HostedFormState } from './use-hosted-form.ts';

/** The day a link stops working, in the visitor's own language and zone. */
function dayOf(iso: string, language: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(when);
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
  const [emailed, setEmailed] = useState<'none' | 'sending' | 'sent' | 'needs-address' | 'failed'>('none');
  const [isCopied, setCopied] = useState(false);
  if (!state.savesFills) return null;

  const kept = save.kind === 'kept' ? save.kept : undefined;
  const isFailed = save.kind === 'failed';
  return (
    <div className={styles.wrap}>
      {/* One quiet line (T23, after Typeform): a tick and Saved once something is kept, and Finish later as a link
          that opens the ways back only when pressed. A failed save says so, with Try again, never a promise. */}
      <div className={styles.row}>
        {/* Polite, not assertive: a save is news a visitor can read when they look, never an interruption. */}
        <span className={styles.line} aria-live="polite">
          {save.kind === 'saving' ? (
            words.saving
          ) : isFailed ? (
            words.saveFailed
          ) : kept === undefined ? (
            ''
          ) : (
            <span className={styles.saved}>
              <Icon name="check" size="xs" />
              {words.savedOn('')}
            </span>
          )}
        </span>
        {isFailed ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              state.keepNow(stepId);
            }}
          >
            {words.tryAgain}
          </Button>
        ) : (
          !isAsked && (
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
          )
        )}
      </div>
      {isAsked && kept !== undefined && (
        <div className={styles.panel}>
          <p className={styles.line}>{words.resumeLine(dayOf(kept.expiresAt, language))}</p>
          {/* No raw link on screen: Copy link carries it, and the email sends it. */}
          <div className={styles.row}>
            <Button
              variant="secondary"
              size="sm"
              icon={isCopied ? 'check' : 'copy'}
              onPress={() => {
                void navigator.clipboard.writeText(kept.resumeUrl).then(
                  () => setCopied(true),
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
                    // A failed request is the network's or the server's, not a missing address.
                    () => setEmailed('failed'),
                  );
                }}
              >
                {words.emailLink}
              </Button>
            )}
            <Button variant="ghost" size="sm" onPress={() => setAsked(false)}>
              {words.keepFilling}
            </Button>
          </div>
          {emailed !== 'none' && emailed !== 'sending' && (
            <p className={styles.line} aria-live="polite">
              {emailed === 'sent'
                ? words.emailSent
                : emailed === 'failed'
                  ? words.emailFailed
                  : words.emailNeedsAddress}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
