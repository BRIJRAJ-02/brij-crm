import { isDataError } from '@crm/data';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { inboxSearch, notificationKind } from '../features/inbox/search.ts';
import { InboxScreen } from '../features/inbox/InboxScreen.tsx';
import { strings } from '../features/inbox/strings.ts';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings as workspace } from '../features/workspace/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// The inbox (spec 0038, AC-1169 to AC-1174): `?status=done` (the Done tab),
// `?kind=` (`mentions`, `replies` or `assignments`), `?unread=1` and `?task=`
// (an assignment's task dialog). The loader starts the list the address
// names beside the objects (the record chips' pages), the members (who did
// it, and the names in an excerpt) and the person's member id, all through
// the data layer; the inbox's store loads in its own chunk, and the screen
// holds the list, so it stays live.
export const Route = createFileRoute('/w/$slug/inbox')({
  validateSearch: inboxSearch,
  loaderDeps: ({ search }) => ({ status: search.status, kind: search.kind, unread: search.unread }),
  loader: async ({ context, params, deps }) => {
    try {
      const kind = notificationKind(deps.kind);
      const [objects, members, access, list] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.members.list(params.slug),
        context.data.access.mine(params.slug).catch(() => undefined),
        context.data.inbox.list(params.slug, {
          status: deps.status ?? 'inbox',
          ...(kind === undefined ? {} : { kind }),
          ...(deps.unread === 1 ? { unreadOnly: true } : {}),
        }),
      ]);
      return { page: { objects, members, meId: access?.memberId, list } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => <WorkspacePage page={pendingPage()} />,
  errorComponent: InboxError,
  component: InboxRoute,
});

function InboxRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  if (page === undefined) {
    return <WorkspacePage page={missingPage(workspace.pageMissingTitle, workspace.pageMissingText)} />;
  }
  return <InboxScreen slug={slug} search={search} {...page} />;
}

function InboxError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <WorkspacePage page={failedPage(strings.inbox, () => void router.invalidate(), error, strings.failedTitle)} />;
}
