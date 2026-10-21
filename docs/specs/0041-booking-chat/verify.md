# 0041 verify

How each acceptance criterion is proved.

| AC | Proof |
|---|---|
| AC-1501, AC-1502, AC-1503 | Flow `booking-chat.flow.ts`: Chat segment, greeting with times, typing and tapping |
| AC-1504 | `build.test.ts` first load graph and `pnpm size` in CI |
| AC-1505 to AC-1512 | `packages/core/src/booking/chat/parse.test.ts` and `agent.test.ts`: a table of sentences against fixed slots and a fixed clock, in two zones |
| AC-1513, AC-1514 | `agent.test.ts`: details in any order, the read back, only a yes books |
| AC-1515, AC-1516 | `apps/api/src/public/chat.test.ts` against Postgres: a booking by chat, the same turn again answers the same booking, a taken time answers fresh offers |
| AC-1517 | `agent.test.ts`: assistant lines are ignored; a slot gone between turns stops matching |
| AC-1518, AC-1519 | `chat.test.ts`: the reply to an email of an existing person equals the reply to a new one; replies carry no other booking |
| AC-1520 | `chat.test.ts`: the 31st turn in a minute is 429 with `Retry-After`; oversized bodies are refused |
| AC-1521, AC-1522 | `chat.test.ts`: `answers.chat` on the booking, nothing stored without one; the guest page answer has no transcript; the CRM booking read carries it |
| AC-1523, AC-1524 | Library stories (keyboard, roles) and screenshots at 1280 and 390, light and dark |
