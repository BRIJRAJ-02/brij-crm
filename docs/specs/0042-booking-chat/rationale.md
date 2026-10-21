# 0042 rationale

## Context

The owner asked on 21 October 2026 for timefix's booking chat on the public booking link. The page `/b/<publicKey>` is frozen; this ask lifts the freeze for the chat only. Timefix's assistant is a rule based state machine (chrono-node and luxon, no LLM, 2,080 lines), most of which serves things this CRM doesn't have or shouldn't do on a public page: the host booking for contacts on their own page, the visitor's calendar, lead hand offs, party sizes.

## Options considered

1. **Port the rule based agent, server side** (chosen). Every turn replays the visitor's messages against live slots, as timefix does. One booking path, no state to store, nothing leaves our servers.
2. **An LLM with tools.** More forgiving with phrasing, but it sends visitor text to a vendor (a data processing agreement, consent copy, a cost per turn), its output is untrusted input, and timefix itself removed its AI tier in August 2026. Not for v1.
3. **Parse in the browser.** Saves a request per turn, but the slots and the booking are server side anyway, and a second copy of the parser in the public bundle costs first load.

For dates: chrono-node would be a new dependency for a handful of phrases. The repo already uses luxon in core's slot engine, so the parser is written for exactly the phrases in AC-1505 and AC-1506 and tested against a table; chrono's long tail ("a fortnight on Thursday") isn't worth a dependency on a public endpoint.

## Rationale

- **One booking path.** The chat calls `bookPublicSlot` with the same input the form sends, so the slot check, the lock, the race guard, the person match, the emails and the guest page token are the form's. The only addition is an optional transcript to store.
- **Replay, not sessions.** Re-deriving state from the visitor's own lines each turn means a slot taken mid conversation simply stops matching, a retried request is harmless, and there is nothing to expire or clean up. The assistant's earlier lines are never read back as facts.
- **A read back before writing.** Timefix books as soon as a time, name and email are present. Here the chat always asks once ("… Shall I book it?"), because a booking emails two people and a one message booking is the easiest thing for a bot to send.
- **No recognition.** Timefix greets signed in visitors by name and fills their calendar in. On a public page that is the route by which "we know you" leaks; the chat recognises nobody, and a typed email that matches a contact changes nothing in the reply.
- **Transcript only on a booking.** It is qualification data for the host, so it sits with the booking it qualified, under the booking's visibility and retention. An abandoned chat has no purpose to keep it for.
- **A third segment, not a floating widget.** The view switch already chooses how times are picked; Chat is one more way. It keeps the rail, the length and the zone in one place and leaves the rest of the frozen page alone.

## Evidence

- Timefix: `src/lib/booking-agent.ts` (replay, intents, quick replies, the identity gate), `src/app/api/chat/route.ts` (limits per address and page, cross site refusal, transcript as qualification data), `src/components/booking/assistant.tsx` (the thread and chips).
- This repo: `packages/core/src/booking/public.ts` (`readPublicSlots`, `bookPublicSlot`), `apps/api/src/public/booking.ts` and `limits.ts`.

## References

- Spec 0025 booking pages; spec 0028 the visitor's calendar; spec 0023 public limits.
