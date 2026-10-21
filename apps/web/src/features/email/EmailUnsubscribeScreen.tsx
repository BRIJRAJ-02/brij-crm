// Brief
// Purpose: the page an optional email's one click unsubscribe opens when a
// mail app opens it in a browser, with no sign in.
// Main task: say yes, and that email's topic is off. Nothing is sent before
// then, since link scanners open addresses too. Leaves out: the member's
// other choices (the email's Email preferences link opens those), and
// signing in.
import type { EmailUnsubscribeStore } from '@crm/data';
import { useEmailUnsubscribe } from '@crm/data/react';
import { AuthLayout, Button, Callout, EmptyState } from '@crm/ui';
import { PRODUCT_LOGO } from '../../brand.ts';
import { strings } from './strings.ts';

/** Asks before an email's one click turns its topic off, then says what is off. */
export function EmailUnsubscribeScreen({ store }: { readonly store: EmailUnsubscribeStore }) {
  const state = useEmailUnsubscribe(store);
  if (state.status === 'error' && state.error.code === 'NOT_FOUND') {
    return (
      <AuthLayout productName={strings.product} logo={PRODUCT_LOGO} title={strings.unsubscribeTitle}>
        <EmptyState title={strings.goneTitle}>{strings.goneText}</EmptyState>
      </AuthLayout>
    );
  }
  if (state.status === 'done') {
    return (
      <AuthLayout
        productName={strings.product}
        logo={PRODUCT_LOGO}
        title={strings.unsubscribedTitle}
        footer={strings.otherChoices}
      >
        <Callout tone="success" isAnnounced>
          {strings.topics[state.answer.topic].stopped(state.answer.workspaceName)}
        </Callout>
      </AuthLayout>
    );
  }
  const saving = state.status === 'saving';
  return (
    <AuthLayout
      productName={strings.product}
      logo={PRODUCT_LOGO}
      title={strings.unsubscribeTitle}
      description={strings.unsubscribeAsk}
      footer={strings.otherChoices}
    >
      {state.status === 'error' ? (
        <Callout tone="danger" title={strings.unsubscribeFailed}>
          {state.error.message}
        </Callout>
      ) : null}
      <Button variant="primary" size="lg" isFullWidth="center" isPending={saving} onPress={() => void store.confirm()}>
        {saving ? strings.unsubscribing : strings.unsubscribe}
      </Button>
    </AuthLayout>
  );
}
