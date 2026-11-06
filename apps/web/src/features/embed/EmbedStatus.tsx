// Brief
// Purpose: the embedded frame's own page while a screen opens, or when it can't (spec 0070, AC-7031).
// Main task: say in one line what happened and offer the one way on: open again, or open in a new tab.
// Leaves out: any link into Timefix itself; the way on is always a fresh launch from the partner's own app.
import { Button, EmptyState, PageColumn, TopBar } from '@crm/ui';
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
  /** Tries again, for a fault on our side. */
  readonly onRetry?: () => void;
}

const TITLES: Readonly<Record<EmbedState, string>> = {
  opening: strings.opening,
  expired: strings.expiredTitle,
  ended: strings.endedTitle,
  blocked: strings.blockedTitle,
  failed: strings.failedTitle,
};

/** The frame's own page: opening, run out, ended, refused its cookie, or failed. */
export function EmbedStatus({ state, origins, onRetry }: EmbedStatusProps) {
  const framed = isFramed(window);
  const relaunch = (target: 'frame' | 'tab') => {
    tellPartner(window, origins, {
      type: 'timefix:relaunch',
      target,
      reason: state === 'blocked' ? 'cookies' : state === 'ended' ? 'ended' : 'expired',
    });
  };
  const body = (() => {
    if (state === 'opening') return <EmptyState title={strings.opening} isLoading layout="block" />;
    if (state === 'failed') {
      return (
        <EmptyState
          title={strings.failedTitle}
          icon="circle-alert"
          layout="block"
          {...(onRetry === undefined ? {} : { onRetry })}
        >
          {strings.failedText}
        </EmptyState>
      );
    }
    if (state === 'blocked') {
      return (
        <EmptyState
          title={strings.blockedTitle}
          icon="external-link"
          layout="block"
          actions={
            framed ? (
              <Button variant="primary" icon="external-link" onPress={() => relaunch('tab')}>
                {strings.openInNewTab}
              </Button>
            ) : undefined
          }
        >
          {strings.blockedText}
        </EmptyState>
      );
    }
    return (
      <EmptyState
        title={TITLES[state]}
        icon="log-out"
        layout="block"
        actions={
          framed ? (
            <Button variant="primary" icon="refresh-cw" onPress={() => relaunch('frame')}>
              {strings.openAgain}
            </Button>
          ) : undefined
        }
      >
        {framed ? (state === 'ended' ? strings.endedText : strings.expiredText) : strings.goBackText}
      </EmptyState>
    );
  })();
  return (
    <EmbeddedLayout>
      <WorkspacePage
        page={{
          topBar: <TopBar title={TITLES[state]} icon="id-card" />,
          body: <PageColumn align="center">{body}</PageColumn>,
        }}
      />
    </EmbeddedLayout>
  );
}
