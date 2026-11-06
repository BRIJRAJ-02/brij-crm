// Brief
// Purpose: the embedded frame's own page while a screen opens, or when it can't (spec 0070, AC-7031).
// Main task: say in a few words what happened and offer the one way on: open again, or open in a new tab.
// Leaves out: any link into Timefix itself; the way on is always a fresh launch from the partner's own app.
import { Button, EmptyState, PageColumn, TopBar } from '@crm/ui';
import { useEffect, useState } from 'react';
import { EmbeddedLayout, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { isFramed, tellPartner } from './messages.ts';
import { embedStrings as strings } from './strings.ts';

/** What the frame's own page says. */
export type EmbedState = 'opening' | 'expired' | 'ended' | 'blocked' | 'failed';

/** Props for EmbedStatus. */
export interface EmbedStatusProps {
  readonly state: EmbedState;
  /** The partner's registered frame origins: the only ones asked for a fresh launch. */
  readonly origins: readonly string[];
  /** Tries again, for a fault on our side; without it, Try again reloads the page. */
  readonly onRetry?: () => void;
}

/** How long a press waits for the app around the frame to answer before saying what to do instead. */
const ANSWER_WAIT_MS = 4000;

/** The frame's own page: opening, run out, ended, refused its cookie, or failed. */
export function EmbedStatus({ state, origins, onRetry }: EmbedStatusProps) {
  const framed = isFramed(window) && origins.length > 0;
  // Asked the partner for a fresh launch: busy a few seconds, then, if this page is still here, what to do instead.
  const [asked, setAsked] = useState<'no' | 'waiting' | 'unanswered'>('no');
  useEffect(() => {
    if (asked !== 'waiting') return undefined;
    const timer = window.setTimeout(() => setAsked('unanswered'), ANSWER_WAIT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [asked]);
  const relaunch = (target: 'frame' | 'tab') => {
    setAsked('waiting');
    tellPartner(window, origins, {
      type: 'timefix:relaunch',
      target,
      reason: state === 'blocked' ? 'cookies' : state === 'ended' ? 'ended' : 'expired',
    });
  };
  const action = (target: 'frame' | 'tab') =>
    framed ? (
      <Button
        variant="primary"
        icon={target === 'tab' ? 'external-link' : 'refresh-cw'}
        isPending={asked === 'waiting'}
        onPress={() => relaunch(target)}
      >
        {target === 'tab' ? strings.openInNewTab : strings.openAgain}
      </Button>
    ) : undefined;
  // One short line at most: what to do when the button can't help (no app around it, or no answer from it).
  const line = !framed ? strings.goBackText : asked === 'unanswered' ? strings.noAnswerText : undefined;
  const body = (() => {
    if (state === 'opening') return <EmptyState title={strings.opening} isLoading layout="block" />;
    if (state === 'failed') {
      return (
        <EmptyState
          title={strings.failedTitle}
          tone="error"
          layout="block"
          {...(onRetry === undefined ? {} : { onRetry })}
        >
          {strings.failedText}
        </EmptyState>
      );
    }
    const blocked = state === 'blocked';
    return (
      <EmptyState
        title={blocked ? strings.blockedTitle : state === 'ended' ? strings.endedTitle : strings.expiredTitle}
        icon={blocked ? 'external-link' : 'log-out'}
        layout="block"
        {...(framed ? { actions: action(blocked ? 'tab' : 'frame') } : {})}
      >
        {line}
      </EmptyState>
    );
  })();
  return (
    <EmbeddedLayout>
      <WorkspacePage
        page={{
          topBar: <TopBar title={strings.title} icon="id-card" />,
          body: <PageColumn align="center">{body}</PageColumn>,
        }}
      />
    </EmbeddedLayout>
  );
}
