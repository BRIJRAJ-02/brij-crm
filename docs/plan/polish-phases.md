# Polish phases (from 20 October 2026)

The owner's call on 20 October 2026: slow down, one thing at a time, in phases, to the bar the records work set. Each phase is clean, optimised, tested, functional, reviewed for UX, UI and interaction, with the relevant skills applied, before the next one starts.

## How every phase runs

1. Read the phase's spec and its acceptance criteria. Write a three line brief per screen.
2. Load the skills for the area (below) and follow them.
3. Build, with unit and integration tests beside the code.
4. Drive it in a real browser, light and dark, at 1280 and 390 wide, including the empty, loading, error and no access states and full keyboard use.
5. Run the reviewers on the diff: design-system-guardian and ux-interaction-reviewer for screens, state-performance-reviewer for data and queries, security-access-reviewer for anything on the server. Run `dxe` on the screens.
6. Fix what they find, then `pnpm check` and every suite green.
7. Land it, show the owner, and take their feedback into the same phase before moving on.

Skills by area: crm-design-system, crm-frontend-state, react-aria, semantic-html-first, interface-affordances, interaction-design, emil-design-eng, subtractive-design and prototype-to-production for screens; crm-api-backend, crm-data-model-access, security-and-hardening, zod and vitest for the server.

## Phases

| # | Phase | What it covers | Owner feedback it carries |
|---|---|---|---|
| 0 | Ship what is done | Everything landed so far goes live through CI on main | "push things which is done to live" |
| 1 | Bookings | The tabs (the underline stuck on Calendar on Availability), the week calendar, the list, quick actions on the grid (book, block), brand marks on bookings and synced events | F1 to F9 |
| 2 | Availability | Full width, the timefix layout, the date field and time zone from the design system, copy times, days off | F10 to F12 |
| 3 | Public booking page | The timefix version: the same structure, steps, interaction and UX, our look; no workspace name in the footer; success and manage pages | F13 to F17 |
| 4 | Booking page editor | The timefix editor: section menu with live summaries, one Save, field rhythm, the public link as a read only copy row | F18, F19 |
| 5 | Captures lists | Links and Forms: quiet row actions in our language, search and New in the tab strip, consistent wording | F20 to F23 |
| 6 | Forms | The builder, the hosted form and embed with the library's own inputs, phone and country pickers, the meeting hand off, forms milestone 2 | F24 to F27 |
| 7 | Settings | Spec 0026: the grouped settings area, the theme switch out of the sidebar, Calendar under Account, brand marks | F28 to F30 |
| 8 | Sign in, sign up, onboarding | The timefix flows in our look, the Google mark, focus on the first field, the theme colour for phones | F31 to F34 |
| 9 | Calendar sync | Milestones 2 and 3, and solo Google events shown as Busy blocks (decided) | F35 |
| 10 | Booking milestone 2 | Guest move, add guests and cancel, emails with .ics, reminders, questions, host actions | F36 |
| 11 | Records | The testing pass's findings: the cut off cell error, phone and country fields, the board count and New deal, and the rest | F37 to F39 |
| 12 | The testing batch | Screenshot baselines, Playwright flows, a full verification pass, the design system artifact publish | F40 |

Work that was in flight when the lanes stopped is kept on its lane branches (a `wip:` commit on top where it was unfinished). Each phase starts from what its lane left, reviews it, and keeps only what passes.

## The owner's feedback, as given

### Bookings
- F1. "booked but nothing comes up": Bookings showed nothing after a real booking. Fixed by the Bookings list.
- F2. "fix. need to add calendar", "and all": the whole timefix bookings page, the week calendar, actions, new meeting, team views, filing. Done: the week calendar, quick actions, New meeting, and filing the guest as a person and company. Open: timefix's team calendar (one column per member, needs its own spec and permissions) and linking a booking to a deal or a custom object by hand.
- F3. "bookings tab should be like capture": underline tabs under the TopBar. Done; on a phone the tab's tools wrap under the tabs (20 Oct).
- F4. "this is same why two? check": a booking and its own Google event showed twice. Fixed.
- F5. "show active day": tint today's column. Done.
- F6. "fix this and padding": one strip, then content. Done.
- F7. "tab is still not changed in here": the underline stays on Calendar on the Availability tab. Done (checked 20 Oct, the tabs rework fixed it).
- F8. "quick action to block, book, etc from here": drag or click empty time, then Book someone in, Block time (this date or every week) or Hold for a private meeting type. Owner chose all three, like timefix (20 Oct). Built and reviewed; saving closes the card with an Undo toast (owner: industry standard). Done (20 Oct); the spec turns Accepted once it ships.
- F9. "calendar logo", "also a timefix next to timefix booking": the Timefix mark on bookings, the Google Calendar mark on synced events. Done.

### Availability
- F10. "full width". Done (20 Oct): full width, the week beside a side column of time zone and days off (Cal.com's layout), and your pages listed with the hours each books on (timefix's rows).
- F11. The days off date field is the browser's own, not the design system's. Done: the library's DatePicker, in a Form, Enter adds, a missing or past date said on the field.
- F12. The time zone should be the searchable list, and the start and end fields need room. Done: each zone with its GMT offset (also in the closed field), current names, search by place or offset; times in 12 hour form with room.

### Public booking page
- F13. Timefix layout and interaction, our design language.
- F14. "this could roll back to the same as timefix version", "same interaction and UX". Open.
- F15. Remove the workspace name ("stealth's workspace") from the footer. Open.
- F16. The time zone trigger, the oversized slots, the Book button and alignment. Fixed in the timefix rework.
- F17. "add timefix across", "Add timefix logos as well". Done on the public pages.

### Booking page editor
- F18. "fix UI": fields with no rhythm, the public link looking disabled, a stray "Edit my hours" line. Open.
- F19. The New booking page panel should be a popup. Done.

### Captures lists
- F20. "links and form are same but looks different design", and a new one didn't show until a refresh. Fixed.
- F21. "shift the search on the tab div on the right side", "reduce the border radius". Done.
- F22. "this looks like from timefix make it as per our design language": the framed icon group. Quiet ghost actions now.
- F23. Empty states centred, and the booking links empty state fixed. Done.

### Forms
- F24. "use the same": the form preview drew its own inputs. Now the library's.
- F25. "add search box in phone number and country", "make it better instead of direct input field", "use our custom design language of input", "add it to design system": PhoneField and CountryPicker. Done.
- F26. "borders look in too dark": text fields now use the softer field border at 3:1, the accessible minimum, as chosen.
- F27. "Also make sure all input fields across needs to be as per the design system". Open across the app.

### Settings and the shell
- F28. "get rid of this from the bottom. build a proper settings": the theme switch out of the sidebar, Settings with grouped navigation (spec 0026). Open.
- F29. "form booking and all should be sidebar as timefix. and call this timefix. and take the logo": done.
- F30. "fix all the cursor across the dashboard": done.

### Sign in and onboarding
- F31. "Sign in Sign ups. Flows. Each.": design each flow the timefix way.
- F32. "add. google": the official Google mark on Continue with Google, the one brand exception to Lucide.
- F33. Focus the first field on welcome, and set the theme colour for phones. Open.
- F34. "make a check on each one of it": every flow driven and checked.

### Calendar sync
- F35. Google events with nobody else invited show as Busy blocks (owner, 20 Oct: "yes blocked"). Open.

### Booking milestone 2
- F36. Guest and host actions, emails and reminders. Open.

### Records
- F37. A cell's error bubble cut off in the last column. Open.
- F38. Phone and country attributes use the design system's pickers everywhere. Open.
- F39. The board count and New deal, the date popover position, the restore toast's Open, and the rest of the testing pass. Open.

### Everywhere
- F40. "make phases and do one thing at a time and make it clean good. better. optimised. tested. functional. fixed. UXed UIed Interaction Design engineer. Apply skills": this plan.
- Modals centred across every variant, no page overflow from hidden inputs, cursors by one rule: done.
