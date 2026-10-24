import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import {
  EmailPreferencesError,
  EmailPreferencesPending,
  EmailPreferencesScreen,
} from '../features/email/EmailPreferencesScreen.tsx';
import { EmailUnsubscribeScreen } from '../features/email/EmailUnsubscribeScreen.tsx';

// The page an email's preferences link opens (the emails lane): no session,
// only the link's signed token, carried in the fragment so no request, log
// or Referer holds it: `#t=` (the footer's Email preferences link, every
// topic) or `#u=` (the one click unsubscribe a mail app opened in a browser,
// which asks before it turns its one topic off). The data layer sends the
// token to the API's public endpoints in a header. A token that opens
// nothing says so.
export const Route = createFileRoute('/email-preferences')({
  loader: async ({ context, location }) => {
    const fragment = new URLSearchParams(location.hash);
    const unsubscribe = fragment.get('u');
    if (unsubscribe !== null)
      return { kind: 'unsubscribe' as const, store: context.data.emailUnsubscribe(unsubscribe) };
    const store = context.data.emailPreferences(fragment.get('t') ?? '');
    await store.load();
    return { kind: 'page' as const, store };
  },
  pendingComponent: () => (
    <LoadingNow>
      <EmailPreferencesPending />
    </LoadingNow>
  ),
  errorComponent: ({ error }) => <EmailPreferencesError error={isDataError(error) ? error : undefined} />,
  component: EmailPreferencesRoute,
});

function EmailPreferencesRoute() {
  const loaded = Route.useLoaderData();
  return loaded.kind === 'unsubscribe' ? (
    <EmailUnsubscribeScreen store={loaded.store} />
  ) : (
    <EmailPreferencesScreen store={loaded.store} />
  );
}
