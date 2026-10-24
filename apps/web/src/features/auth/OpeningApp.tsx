// Brief
// Purpose: the place the app holds while it finds out who is signed in, for a
// browser whose last visit had a session.
// Main task: stand where the workspace frame will stand (the sidebar, the top
// bar, the page), so the app arrives into the same shape, and say what is
// happening, with a way on, when the answer takes unusually long.
// Leaves out: anything of the person's own. Nothing here is read or shown
// because the hint says someone is signed in; it is all placeholder.
import { AppShell, Button, EmptyState, NavItem, NavSection, ProviderMark, Sidebar, Skeleton, TopBar } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';
import { strings as workspaceStrings } from '../workspace/strings.ts';

/** How long the session answer may take before the page stops being silent about it. */
const SLOW_MS = 5000;

/** Whether `ms` have passed since this mounted: a wait long enough to be worth a word. */
function useWaitedLong(ms: number): boolean {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setWaited(true);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [ms]);
  return waited;
}

/**
 * The app's own loading state before the session is known: the frame's
 * sidebar, top bar and page, all loading, so the workspace lands in the same
 * places and little moves. Someone who turns out to be signed out is sent on
 * to sign in from here; someone signed in never sees a sign in screen at all.
 * A session answer still out after `SLOW_MS` stops the silence: the page says
 * so and offers Try again, so a hung call is never a spinner with no way on.
 */
export function OpeningApp() {
  const router = useRouter();
  const isSlow = useWaitedLong(SLOW_MS);
  const [isRetrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    void router.invalidate().finally(() => {
      setRetrying(false);
    });
  };
  return (
    <AppShell
      // The heading follows what the page says, so the tab's title (which reads the h1) says it too.
      topBar={<TopBar title={isSlow ? strings.stillOpeningTitle : strings.openingTitle} isLoading={!isSlow} />}
      sidebar={
        <Sidebar
          workspace={strings.product}
          mark={<ProviderMark provider="timefix" size="lg" />}
          // Nobody's workspace is known here, and none may be guessed at: the head stays a skeleton.
          isWorkspaceLoading
          // The frame's foot (Settings, Help) belongs to a workspace, so its place is held rather than drawn.
          footer={
            <>
              <Skeleton width="short" />
              <Skeleton width="short" />
            </>
          }
        >
          {/* Home is where the app is going (`/` sends you to your workspace), so it stands, current, where the
              workspace's own Home will be. */}
          <NavItem icon="house" href="/" isCurrent>
            {workspaceStrings.home}
          </NavItem>
          <NavSection title={workspaceStrings.records} isLoading />
        </Sidebar>
      }
    >
      {isSlow ? (
        <EmptyState
          title={strings.stillOpeningTitle}
          icon="clock"
          actions={
            <Button variant="primary" icon="refresh-cw" isPending={isRetrying} onPress={retry}>
              {strings.retry}
            </Button>
          }
        >
          {strings.stillOpeningText}
        </EmptyState>
      ) : (
        <EmptyState title={strings.openingTitle} isLoading />
      )}
    </AppShell>
  );
}
