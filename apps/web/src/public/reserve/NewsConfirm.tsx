// Brief
// Purpose: the page the news and offers email's link opens (double opt-in, 9 November 2026), at
//   /r/<key>/manage#news=<token>: the guest ticked news and offers on a reservation, and it counts only once they say
//   yes here.
// Main task: one press of Yes, and say it's saved. Nothing is sent before the press, since link scanners open links.
// Leaves out: the reservation itself (the reservation's own email opens that), and any choice beyond yes, but for
//   the signed up page's quiet "Changed your mind? Unsubscribe" (10 November 2026).
import { BookingFrame, BookingMessage, Button, Callout } from '@crm/ui/public-booking';
import { isDataError, type PublicTablePage, type TableClient } from '@crm/data/tables';
import { useEffect, useState } from 'react';
import { frameHead } from './ReservePage.tsx';
import { strings } from './strings.ts';

type State =
  | { readonly status: 'asking' }
  | { readonly status: 'saving' }
  | { readonly status: 'done'; readonly already: boolean; readonly unsubscribeToken?: string }
  | { readonly status: 'gone' }
  | { readonly status: 'failed'; readonly message: string };

/** Asks before a news link's token is sent, then says what was saved. */
export function NewsConfirm({
  client,
  page,
  token,
}: {
  readonly client: TableClient;
  readonly page: PublicTablePage;
  /** The link's token, or undefined when the address carried none worth sending. */
  readonly token: string | undefined;
}) {
  const [state, setState] = useState<State>(token === undefined ? { status: 'gone' } : { status: 'asking' });
  const business = page.business.name;
  const reserve = { label: strings.reserveTable, href: `/r/${encodeURIComponent(page.key)}` };
  useEffect(() => {
    document.title = strings.newsTabTitle(business);
    // The token is held in state from here: off the address bar, so the history keeps no copy of it.
    globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`);
  }, [business]);

  if (state.status === 'done') {
    return (
      <BookingMessage
        title={state.already ? strings.newsAlready : strings.newsDone}
        page="booking_manage"
        action={reserve}
        // A quiet way back out (10 November 2026): the unsubscribe page, which asks before it does anything.
        {...(state.unsubscribeToken === undefined
          ? {}
          : {
              link: {
                label: strings.newsChangedMind,
                href: `/r/${encodeURIComponent(page.key)}/manage#${new URLSearchParams({ unsubscribe: state.unsubscribeToken }).toString()}`,
                icon: null,
              },
            })}
      >
        {strings.newsDoneBody(business)}
      </BookingMessage>
    );
  }
  // `token === undefined` already starts as `gone`; it is checked again so `confirm` below holds a string.
  if (state.status === 'gone' || token === undefined) {
    return (
      <BookingMessage title={strings.newsGone} page="booking_manage" action={reserve}>
        {strings.newsGoneBody}
      </BookingMessage>
    );
  }
  const saving = state.status === 'saving';
  const confirm = () => {
    if (saving) return;
    setState({ status: 'saving' });
    client.confirmNews(page.key, token).then(
      (answer) => {
        setState({
          status: 'done',
          already: answer.status === 'already',
          ...(answer.unsubscribeToken === undefined ? {} : { unsubscribeToken: answer.unsubscribeToken }),
        });
      },
      (error: unknown) => {
        if (isDataError(error) && error.code === 'NOT_FOUND') setState({ status: 'gone' });
        else setState({ status: 'failed', message: isDataError(error) ? error.message : strings.offline });
      },
    );
  };
  return (
    <BookingFrame {...frameHead(page)} heading={strings.newsAsk(business)} description={strings.newsAskBody(business)}>
      {state.status === 'failed' && (
        <Callout tone="danger" isAnnounced>
          {state.message}
        </Callout>
      )}
      <Button variant="primary" isFullWidth="center" isPending={saving} onPress={confirm}>
        {saving ? strings.newsSaving : strings.newsYes}
      </Button>
    </BookingFrame>
  );
}
