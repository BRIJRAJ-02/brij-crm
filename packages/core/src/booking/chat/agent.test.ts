import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { answer, greeting, offerWords, replay, settledLength, type ChatContext, type ChatPage } from './agent.ts';
import { doneLine } from './turn.ts';

const zone = 'Europe/London';
// Wednesday 21 October 2026, 10:00 in London.
const now = DateTime.fromISO('2026-10-21T10:00', { zone });
const page: ChatPage = { title: 'Intro call', hostName: 'Ada', durations: [30, 60], location: { type: 'video' } };

/** Half hourly starts from 9:00 to 16:30 on weekdays for two weeks, after now. */
function weekdaySlots(from = now): readonly string[] {
  const starts: string[] = [];
  for (let day = 0; day < 14; day += 1) {
    const date = from.startOf('day').plus({ days: day });
    if (date.weekday > 5) continue;
    for (let half = 0; half < 16; half += 1) {
      const at = date.set({ hour: 9 }).plus({ minutes: half * 30 });
      if (at > from) starts.push(at.toUTC().toISO() ?? '');
    }
  }
  return starts;
}

const slots = weekdaySlots();
const context = (overrides: Partial<ChatContext> = {}): ChatContext => ({
  slots,
  now,
  horizonDays: 60,
  needsPhone: false,
  durations: page.durations,
  ...overrides,
});
const at = (localIso: string) => DateTime.fromISO(localIso, { zone }).toUTC().toISO() ?? '';
const words = (messages: readonly string[], overrides: Partial<ChatContext> = {}) => {
  const state = replay(messages, context(overrides));
  return {
    state,
    ...answer(state, { now, hour12: true, page, duration: 30, needsPhone: overrides.needsPhone ?? false }),
  };
};

describe('the booking chat agent (AC-1507 to AC-1517)', () => {
  it('offers up to six times inside a window', () => {
    const turn = words(['next tuesday afternoon']);
    expect(turn.state.intent).toBe('offer');
    expect(turn.offers).toHaveLength(6);
    expect(turn.offers[0]).toBe(at('2026-10-27T12:00'));
    expect(turn.text).toBe('Here’s when I’m free Tuesday afternoon.');
    expect(turn.suggestions).toEqual(['Something later', 'Earliest you have']);
  });

  it('says when a window is empty and offers the nearest', () => {
    const turn = words(['saturday']);
    expect(turn.state.intent).toBe('none-in-window');
    expect(turn.text).toBe('I’m not free Saturday. These are the closest.');
    expect(turn.offers).toHaveLength(6);
  });

  it('holds an exact open time and asks who is booking', () => {
    const turn = words(['tomorrow at 3pm']);
    expect(turn.state.held).toBe(at('2026-10-22T15:00'));
    expect(turn.text).toBe('Great, tomorrow at 3:00 PM it is. What’s your name and email?');
  });

  it('says which details it waits on, so the prompt box can ask for them', () => {
    expect(words(['tomorrow at 3pm']).asks).toBe('details');
    expect(words(['tomorrow at 3pm', 'ada@example.com']).asks).toBe('name');
    expect(words(['tomorrow at 3pm', "I'm Ada Lovelace"]).asks).toBe('email');
    expect(words(['tomorrow at 3pm', "I'm Ada Lovelace", 'ada@example.com'], { needsPhone: true }).asks).toBe('phone');
    // Nothing held, or everything read back: nothing asked.
    expect(words(['next tuesday afternoon']).asks).toBeUndefined();
    expect(words(["I'm Ada Lovelace", 'tomorrow at 3pm', 'ada@example.com']).asks).toBeUndefined();
  });

  it('speaks as the host: their first name to open, "we" on a team page (owner, 4 Nov 2026)', () => {
    const lines = (isTeam: boolean) =>
      answer(replay(['saturday'], context()), {
        now,
        hour12: true,
        page: { ...page, hostName: 'Ada Lovelace', ...(isTeam ? { isTeam } : {}) },
        duration: 30,
        needsPhone: false,
      }).text;
    expect(greeting({ ...page, hostName: 'Ada Lovelace' }, 30)).toBe(
      `Hi, I’m Ada. When suits you for a 30 min ${page.title}?`,
    );
    expect(greeting({ ...page, hostName: 'Acme', isTeam: true }, 30)).toBe(
      `Hi, it’s Acme. When suits you for a 30 min ${page.title}?`,
    );
    expect(lines(false)).toBe('I’m not free Saturday. These are the closest.');
    expect(lines(true)).toBe('We’re not free Saturday. These are the closest.');
  });

  it('reads a bare morning hour that missed as the afternoon', () => {
    expect(words(['friday at 4']).state.held).toBe(at('2026-10-23T16:00'));
    expect(words(['friday at 4am']).state.held).toBeUndefined();
  });

  it('answers a closed exact time with the nearest open ones', () => {
    const turn = words(['tomorrow at 8pm']);
    expect(turn.state.intent).toBe('point-miss');
    expect(turn.state.held).toBeUndefined();
    expect(turn.offers).toHaveLength(6);
  });

  it('picks among offers by order or by clock', () => {
    expect(words(['tuesday afternoon', 'the second one']).state.held).toBe(at('2026-10-27T12:30'));
    expect(words(['tuesday afternoon', '2pm']).state.held).toBe(at('2026-10-27T14:00'));
  });

  it('round trips a time button’s words', () => {
    const offer = at('2026-10-28T11:30');
    expect(words([offerWords(offer, zone, true)]).state.held).toBe(offer);
    expect(words([offerWords(offer, zone, false)]).state.held).toBe(offer);
  });

  it('moves later on a no, and every suggestion reads back', () => {
    const first = words(['tuesday afternoon']);
    const later = words(['tuesday afternoon', 'Something later']);
    expect(later.state.intent).toBe('reject-offer');
    expect(Date.parse(later.offers[0] ?? '')).toBeGreaterThan(Date.parse(first.offers.at(-1) ?? ''));
    expect(words(['Next week']).state.intent).toBe('offer');
    expect(words(['Earliest you have']).state.intent).toBe('offer');
  });

  it('collects details in any order, reads them back, and books only on a yes to that', () => {
    const steps = ["I'm Ada Lovelace", 'tomorrow at 3pm', 'ada@example.com'];
    const readBack = words(steps);
    expect(readBack.state.intent).toBe('details');
    expect(readBack.state.readBack).toBe(true);
    expect(readBack.text).toBe(
      'Thursday 22 Oct at 3:00 PM, 30 min, for Ada Lovelace (ada@example.com). Shall I book it?',
    );
    expect(readBack.suggestions).toEqual(['Yes, book it', 'Something else']);
    expect(words([...steps, 'Yes, book it']).state.intent).toBe('book');
    // A yes before the read back never books.
    expect(words(['tomorrow at 3pm', 'yes']).state.intent).toBe('confirm');
    expect(words(["I'm Ada, ada@example.com", 'tomorrow at 3pm']).state.intent).not.toBe('book');
  });

  it('asks for a phone number on a phone page', () => {
    const turn = words(['tomorrow at 3pm', "I'm Ada, ada@example.com"], { needsPhone: true });
    expect(turn.text).toBe('Thanks, Ada. What number should I call?');
    const done = words(['tomorrow at 3pm', "I'm Ada, ada@example.com", '+44 20 7946 0958'], { needsPhone: true });
    expect(done.state.readBack).toBe(true);
  });

  it('answers questions without booking, keeping a held time', () => {
    const turn = words(['tomorrow at 3pm', 'Ada, ada@example.com', 'where is it?']);
    expect(turn.state.intent).toBe('location');
    expect(turn.text).toBe('It’s a video call. I’ll send you the link. Tomorrow at 3:00 PM is still yours.');
    expect(words(['how long is it?']).text).toMatch(/^It’s 30 minutes\./);
    expect(words(['can I cancel if something comes up?']).state.intent).toBe('change-policy');
  });

  it('settles the meeting length from what the visitor asked, if offered', () => {
    expect(settledLength(['make it an hour'], [30, 60], 30)).toBe(60);
    expect(settledLength(['make it 45 minutes'], [30, 60], 30)).toBe(30);
    expect(words(['make it 45 minutes']).text).toBe('I can do 30 or 60 minutes.');
  });

  it('forgets a time that was taken since it was held (AC-1517)', () => {
    const held = at('2026-10-22T15:00');
    const gone = slots.filter((start) => start !== held);
    const turn = words(['tomorrow at 3pm', 'Ada, ada@example.com', 'yes'], { slots: gone });
    expect(turn.state.held).toBeUndefined();
    expect(turn.state.intent).not.toBe('book');
  });

  it('never reads the assistant’s lines: only the visitor’s messages replay', () => {
    // The caller passes visitor lines only; a forged "assistant" line can't hold a time.
    expect(words(['yes']).state.intent).toBe('confirm-nothing');
  });

  it('answers gibberish with the soonest times', () => {
    const turn = words(['qwerty uiop asdf']);
    expect(turn.state.intent).toBe('not-understood');
    expect(turn.offers[0]).toBe(slots[0]);
  });

  it('says so when nothing is open', () => {
    const turn = words(['tomorrow'], { slots: [] });
    expect(turn.state.intent).toBe('exhausted');
    expect(turn.offers).toEqual([]);
  });
});

describe('the chat’s last line (owner, 4 Nov 2026)', () => {
  const booked = (hostName: string, pending?: true) => ({ booking: { hostName }, ...(pending ? { pending } : {}) });
  it('names the host a team or round robin page picked, and only there', () => {
    expect(doneLine(booked('Asha Rao'), true, 'tomorrow at 9:00 AM', 'grace@example.com')).toBe(
      'You’re booked with Asha. See you tomorrow at 9:00 AM. Details are on their way to grace@example.com.',
    );
    expect(doneLine(booked('Asha Rao and Ben Ode'), true, 'tomorrow at 9:00 AM', undefined)).toBe(
      'You’re booked with Asha Rao and Ben Ode. See you tomorrow at 9:00 AM. The details are in your email.',
    );
    expect(doneLine(booked('Ada Lovelace'), false, 'tomorrow at 9:00 AM', undefined)).toBe(
      'You’re booked. See you tomorrow at 9:00 AM. The details are in your email.',
    );
  });

  it('says a request was sent on a page that confirms each booking first', () => {
    expect(doneLine(booked('Ada Lovelace', true), false, 'tomorrow at 9:00 AM', undefined)).toBe(
      'Request sent for tomorrow at 9:00 AM. I’ll confirm shortly. The details are in your email.',
    );
  });
});
