// The booking page's fill ticket (spec 0023, B-04): the server's note of when the page loaded, which a booking and a
// chat turn that books carry. Without a valid one the server refuses a booking as too fast, so a visitor is never
// left holding none: a ticket the page couldn't fetch, or one near its day's end, is fetched again before it is
// sent, and a fresh one is held back until the server's minimum fill time has passed. A booking spends its ticket
// (`take`), and the next is fetched behind it, so retries never meet a ticket's use limit; a chat turn only shows it
// (`peek`), since the server counts it only on the turn that books.

/** How long after it was fetched a ticket may go out: the server's two second minimum fill time, and a margin. */
export const TICKET_SETTLE_MS = 2_100;

/** How old a ticket may be before it is fetched again: the server keeps one for a day. */
export const TICKET_REFRESH_MS = 23 * 60 * 60 * 1000;

/** The page's ticket, kept ready. */
export interface TicketKeeper {
  /** The ticket for a booking, then a fresh one fetched for the next. Undefined only when none can be had. */
  readonly take: () => Promise<string | undefined>;
  /** The ticket for a chat turn, kept for the next. */
  readonly peek: () => Promise<string | undefined>;
}

/** What keeping a ticket needs: the clock and a wait, with browser defaults; tests pass their own. */
export interface TicketDeps {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Keeps the page's ticket from `fetchTicket` (the booking client's `ticket`), asking for the first at once. */
export function keepTicket(fetchTicket: () => Promise<string | undefined>, deps: TicketDeps = {}): TicketKeeper {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const fetchNow = () => ({ ticket: fetchTicket().catch(() => undefined), at: now() });
  let held = fetchNow();
  /** The held ticket, fetched again when there was none or it is near its day's end, and old enough to send. */
  const ready = async (): Promise<string | undefined> => {
    let ticket = await held.ticket;
    if (ticket === undefined || now() - held.at > TICKET_REFRESH_MS) {
      held = fetchNow();
      ticket = await held.ticket;
    }
    const wait = held.at + TICKET_SETTLE_MS - now();
    if (wait > 0) await sleep(wait);
    return ticket;
  };
  return {
    take: async () => {
      const ticket = await ready();
      held = fetchNow();
      return ticket;
    },
    peek: ready,
  };
}
