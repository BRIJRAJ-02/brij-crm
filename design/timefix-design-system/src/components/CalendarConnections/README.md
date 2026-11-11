CalendarConnections lists the calendars Timefix reads to avoid double booking, and connects new ones.

**Use it for**: Settings › Calendars and the calendar step of onboarding. **Don't use it for** choosing which calendar new meetings are written to (a Select beside this list).

**The consumer provides**: `accounts` (provider, email, how many calendars, `connected` or `reconnect`, whether it checks for conflicts), `onCheckConflicts`, `onReconnect` and `onConnect`, which return promises, and the `providers` to offer.

**States**: each row is a neutral letter tile (no brand marks), the account and a grey line with the provider and calendar count, a status tag (green Connected, orange Needs reconnect), then either the "Check for conflicts" switch or an ink Reconnect. A button busy connecting shows a spinner and keeps its width.

**Interaction**: the switch takes effect at once, so nothing needs saving. Reconnect and the Add buttons go pending, then the add button's tick draws in (success check: fade, turn from 80 degrees, fades in, draw) and its label resolves to "Connected" before returning. A newly connected account drops in at the top (0fr to 1fr with a 12px rise, 250ms) with a brief blue wash; a status that changes pops in once. Keyboard: Tab through rows, Space toggles a switch, Enter presses.

**Replaces**: CalendarList.
