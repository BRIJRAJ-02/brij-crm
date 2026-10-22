// Brief
// Purpose: the page an email's preferences link opens, with no sign in: which
// optional emails this member gets from this workspace.
// Main task: turn a topic on or off; it saves at once. Leaves out: the emails
// that always come (sign in, account, bookings), other members, and signing in.
import type { DataError, EmailPreferencesStore, EmailTopic } from '@crm/data';
import { useEmailPreferences } from '@crm/data/react';
import { AuthLayout, Callout, Skeleton, Switch } from '@crm/ui';
import { PRODUCT_LOGO } from '../../brand.ts';
import { AuthError } from '../auth/AuthStates.tsx';
import { strings } from './strings.ts';

/** The link's topic first (the email it came from), then the rest in their own order. */
function ordered<T extends { readonly topic: EmailTopic }>(items: readonly T[], first: EmailTopic): readonly T[] {
  return [...items.filter((each) => each.topic === first), ...items.filter((each) => each.topic !== first)];
}

/** The member's choices, one switch a topic, each saved the moment it changes. */
export function EmailPreferencesScreen({ store }: { readonly store: EmailPreferencesStore }) {
  const state = useEmailPreferences(store);
  if (state.status === 'loading') return <EmailPreferencesPending />;
  if (state.status === 'error') return <EmailPreferencesError error={state.error} />;
  const { view, saving, refused } = state;
  return (
    <AuthLayout
      productName={strings.product}
      logo={PRODUCT_LOGO}
      title={strings.title}
      description={strings.description(view.workspaceName)}
      footer={strings.always}
    >
      {refused === undefined ? null : (
        <Callout tone="danger" title={strings.refused}>
          {refused.message}
        </Callout>
      )}
      {ordered(view.preferences, view.topic).map((preference) => (
        <Switch
          key={preference.topic}
          label={strings.topics[preference.topic].label}
          description={strings.topics[preference.topic].description}
          isSelected={preference.subscribed}
          isReadOnly={saving.has(preference.topic)}
          onChange={(subscribed) => void store.set(preference.topic, subscribed)}
        />
      ))}
    </AuthLayout>
  );
}

/** The page's frame while its choices load. */
export function EmailPreferencesPending() {
  return (
    <AuthLayout productName={strings.product} logo={PRODUCT_LOGO} title={strings.title} isBusy>
      <Skeleton lines={3} />
    </AuthLayout>
  );
}

/**
 * A link that opens nothing says so as the page's title, why under it, as the
 * invitation page's dead link does; any other failure is the pages before the
 * app's own (AuthError: one announced sentence and Try again).
 */
export function EmailPreferencesError({ error }: { readonly error: DataError | undefined }) {
  if (error?.code !== 'NOT_FOUND') return <AuthError title={strings.title} />;
  return (
    <AuthLayout
      productName={strings.product}
      logo={PRODUCT_LOGO}
      title={strings.goneTitle}
      description={strings.goneText}
    >
      {null}
    </AuthLayout>
  );
}
