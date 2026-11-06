import { isDataError } from '@crm/data';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { EmbedFrame } from '../features/embed/EmbedFrame.tsx';
import { EmbedStatus, type EmbedState } from '../features/embed/EmbedStatus.tsx';
import { embedLinkPageHref } from '../features/embed/screens.ts';

// A launch's one time address in a partner's frame (spec 0070, AC-7030, AC-7031): `/embed/<clientId>/start#code=…`.
// The code rides in the fragment, which no server or Referer sees, and leaves the address before anything else
// happens. Redeemed once, it sets the frame's own session cookie; the frame then checks the browser kept it, and opens
// the screen the launch named. Run out, already used, refused its cookie or ended (`?ended`), the frame says so and
// asks the partner for a fresh launch, never anything of ours.
export const Route = createFileRoute('/embed/$clientId/start')({
  // `?ended` is a session that ended under a screen; `?theme` keeps the partner's look on this page too.
  validateSearch: (search: Record<string, unknown>): { readonly ended?: true; readonly theme?: 'light' | 'dark' } => {
    const theme = search['theme'];
    return {
      ...(search['ended'] === true || search['ended'] === 'true' ? { ended: true as const } : {}),
      ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
    };
  },
  loaderDeps: ({ search }) => ({ ended: search.ended === true }),
  loader: async ({ context, params, deps }): Promise<{ readonly state: EmbedState; readonly origins: string[] }> => {
    const origins = [...(await context.data.embed.frameOrigins(params.clientId))];
    if (deps.ended) return { state: 'ended', origins };
    const code = new URLSearchParams(window.location.hash.slice(1)).get('code');
    // Out of the address at once: not in history, not in a copied link.
    if (window.location.hash !== '') {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    }
    if (code === null || code === '') return { state: 'expired', origins };
    let view;
    try {
      view = await context.data.embed.start(code);
    } catch (error) {
      return { state: isDataError(error) && error.code !== 'INTERNAL' ? 'expired' : 'failed', origins };
    }
    // A launch for another partner's frame opens nothing here.
    if (view.partner.clientId !== params.clientId) return { state: 'expired', origins };
    // The browser may refuse a frame's cookie even partitioned (Safari, privacy settings): then the session isn't
    // there on the next call, and the frame offers a tab of its own.
    try {
      await context.data.embed.session();
    } catch (error) {
      return { state: isDataError(error) && error.code === 'UNAUTHENTICATED' ? 'blocked' : 'failed', origins };
    }
    throw redirect({
      href: embedLinkPageHref(params.clientId, view.screen ?? 'link_pages.mine', view.theme),
      replace: true,
    });
  },
  pendingComponent: () => <EmbedStatus state="opening" origins={[]} />,
  errorComponent: EmbedStartError,
  component: EmbedStartRoute,
});

function EmbedStartRoute() {
  const { state, origins } = Route.useLoaderData();
  const { theme } = Route.useSearch();
  const router = useRouter();
  // A fresh launch put in this same frame differs from this page's address only by its fragment, which the browser
  // treats as a move within the page: read the new code then.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith('#code=')) void router.invalidate();
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, [router]);
  return (
    <EmbedFrame origins={origins} theme={theme}>
      <EmbedStatus state={state} origins={origins} />
    </EmbedFrame>
  );
}

function EmbedStartError(_props: ErrorComponentProps) {
  const router = useRouter();
  return <EmbedStatus state="failed" origins={[]} onRetry={() => void router.invalidate()} />;
}
