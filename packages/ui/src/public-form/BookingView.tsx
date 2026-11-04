import { createElement, useEffect, useState } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import type { FormBooking as EagerFormBooking, FormBookingProps } from './FormBooking.tsx';
import { FormConfirmation } from './FormParts.tsx';

/**
 * Sent, and on to book (FormBooking), in a chunk of its own: nobody sees it before they send, and the hosted page's
 * first load has no room to spare (apps/web/.size-limit.js). It starts loading once the form is drawn and is kept
 * once here, so by the time anyone presses Send it draws at once, and its heading can take focus in the same render;
 * BookingFallback stands in until it arrives, or for good if it can't.
 */
const loadBooking = () => import('./FormBooking.tsx');

/**
 * Sent, while the countdown's chunk is still arriving or when it can't be fetched (a flaky network, or a deploy
 * between load and Send): the answers are saved, so the thank you shows with Book a time as its one way on, never a
 * blank page. What was sent reads back above it, as on the countdown.
 */
function BookingFallback({ state, mode, heading, url, text, summary }: FormBookingProps) {
  return (
    <FormConfirmation mode={mode} heading={heading} title={state.words.thanksTitle} text={text} summary={summary}>
      <Button
        variant="primary"
        size="public"
        onPress={() => {
          state.goTo(url);
        }}
      >
        {state.words.bookATime}
      </Button>
    </FormConfirmation>
  );
}

/**
 * FormBooking once its chunk has arrived, for every layout; undefined until then (it starts loading as the form
 * draws), when BookingFallback stands in.
 */
export function useLoadedBooking() {
  const [LoadedBooking, setLoadedBooking] = useState<typeof EagerFormBooking>();
  useEffect(() => {
    // A chunk that can't be fetched leaves BookingFallback in its place.
    void loadBooking().then(
      (module) => {
        setLoadedBooking(() => module.FormBooking);
      },
      () => undefined,
    );
  }, []);
  return LoadedBooking;
}

/** Sent, and on to book: FormBooking once `loaded` (useLoadedBooking) has it, BookingFallback until then. */
export function BookingView({
  loaded,
  ...props
}: FormBookingProps & { readonly loaded: typeof EagerFormBooking | undefined }) {
  return loaded === undefined ? <BookingFallback {...props} /> : createElement(loaded, props);
}
