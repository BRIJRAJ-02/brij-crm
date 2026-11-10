// Brief
// Purpose: the page a business's email's Unsubscribe link opens (10 November 2026), at /r/<key>/manage#unsubscribe=,
//   and the signed up page's "Changed your mind?": a guest takes back their yes to news and offers, with no sign in.
// Main task: one press of Unsubscribe, then say it's done, with Subscribe again (by the email's Yes, never at once).
//   Nothing is sent before the press, since link scanners open links; the mail app's own one click needs no page.
// Leaves out: the reservation, other businesses, and whether this address was on a list at all.
import { BookingFrame, BookingMessage, Button, Callout } from '@crm/ui/public-booking';
import { isDataError, type PublicTablePage, type TableClient } from '@crm/data/tables';
import { useEffect, useState } from 'react';
import { frameHead } from './ReservePage.tsx';
import { strings } from './strings.ts';

type State =
  | { readonly status: 'asking' }
  | { readonly status: 'saving' }
  | { readonly status: 'done'; readonly resubscribing: boolean; readonly failed?: string }
  | { readonly status: 'resent' }
  | { readonly status: 'gone' }
  | { readonly status: 'failed'; readonly message: string };

/** A refusal's words: offline, or the API's own sentence. */
const messageOf = (error: unknown): string => (isDataError(error) ? error.message : strings.offline);

/** Asks before an unsubscribe link's token is sent, then says it's done and offers Subscribe again. */
export function NewsUnsubscribe({
  client,
  page,
  placeKey,
  token,
}: {
  readonly client: TableClient;
  /**
   * The place's page, for its name and frame; undefined when it didn't load (a place since moved to a new key, or
   * gone): the way out works with the token alone, so it never depends on the page.
   */
  readonly page: PublicTablePage | undefined;
  /** The place key the address named, for the way back to reserving. */
  readonly placeKey: string;
  /** The link's token, or undefined when the address carried none worth sending. */
  readonly token: string | undefined;
}) {
  const [state, setState] = useState<State>(token === undefined ? { status: 'gone' } : { status: 'asking' });
  const business = page?.business.name;
  const reserve = { label: strings.reserveTable, href: `/r/${encodeURIComponent(page?.key ?? placeKey)}` };
  useEffect(() => {
    document.title = business === undefined ? strings.unsubscribe : strings.unsubscribeTabTitle(business);
    // The token is held in state from here: off the address bar, so the history keeps no copy of it.
    globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`);
  }, [business]);

  if (state.status === 'gone' || token === undefined) {
    return (
      <BookingMessage title={strings.unsubscribeGone} page="booking_manage" action={reserve}>
        {strings.unsubscribeGoneBody}
      </BookingMessage>
    );
  }
  if (state.status === 'resent') {
    return (
      <BookingMessage title={strings.subscribeCheckEmail} page="booking_manage" action={reserve}>
        {strings.subscribeCheckEmailBody}
      </BookingMessage>
    );
  }
  if (state.status === 'done') {
    const again = () => {
      if (state.resubscribing) return;
      setState({ status: 'done', resubscribing: true });
      client.resubscribeNews(token).then(
        () => {
          setState({ status: 'resent' });
        },
        (error: unknown) => {
          if (isDataError(error) && error.code === 'NOT_FOUND') setState({ status: 'gone' });
          else setState({ status: 'done', resubscribing: false, failed: messageOf(error) });
        },
      );
    };
    // A message, as the signed up page is: its heading takes focus as it arrives, and Subscribe again sits apart
    // from where Unsubscribe was, so a second tap never lands on it.
    return (
      <BookingMessage
        title={strings.unsubscribed}
        page="booking_manage"
        action={reserve}
        press={{
          label: strings.subscribeAgain,
          onPress: again,
          isPending: state.resubscribing,
          pendingLabel: strings.subscribing,
        }}
      >
        {state.failed ?? (business === undefined ? strings.unsubscribedPlain : strings.unsubscribedBody(business))}
      </BookingMessage>
    );
  }
  const saving = state.status === 'saving';
  const unsubscribe = () => {
    if (saving) return;
    setState({ status: 'saving' });
    client.unsubscribeNews(token).then(
      () => {
        setState({ status: 'done', resubscribing: false });
      },
      (error: unknown) => {
        if (isDataError(error) && error.code === 'NOT_FOUND') setState({ status: 'gone' });
        else setState({ status: 'failed', message: messageOf(error) });
      },
    );
  };
  return (
    <BookingFrame
      {...(page === undefined ? {} : frameHead(page))}
      heading={business === undefined ? strings.unsubscribeAskPlain : strings.unsubscribeAsk(business)}
      description={strings.unsubscribeAskBody}
    >
      {state.status === 'failed' && (
        <Callout tone="danger" isAnnounced>
          {state.message}
        </Callout>
      )}
      <Button variant="primary" isFullWidth="center" isPending={saving} onPress={unsubscribe}>
        {saving ? strings.unsubscribing : strings.unsubscribe}
      </Button>
    </BookingFrame>
  );
}
