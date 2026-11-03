# 0065 verify

Each check is run in the real app (both productions after landing) or by the named test.

## H0
- A workspace without early access: Settings > Apps shows no Hospitality apps; calling a menu procedure answers `APP_NOT_INSTALLED`.
- Operator turns on early access: the audit log has the operator and the switch.
- A member (not admin) cannot install; an admin installs Menu; removing it hides Menus and makes `/m/<key>` the not found page; reinstalling restores the same menus.
- Hours crossing midnight (18:00 to 02:00) read open at 01:30 and closed at 02:30 in the place's zone, including on a DST change night (unit tests).
- Floor staff role sees Service and the guests of reservations, and no other records (access door test).
- Guard tests: every new table forces RLS with a policy; cross workspace reads return nothing; new lookup roles are listed in `guards.test.ts`.

## H1
- Edit a price, guests still see the old one; Publish; guests see the new one within the cache purge.
- Mark an item Sold out: the guest page shows it dimmed without Publish.
- One item placed in Dinner and Drinks: change its name once, both show it.
- A serving time Brunch Sat to Sun 10 to 15: on a Saturday at 11 in the place's zone it shows first; at 16 it moves behind the switcher.
- Slow 4G emulation on a mid range phone profile: first menu text under 2 seconds; photos lazy.
- axe passes on the guest page in Warm, Clean and Night; the item sheet traps focus and closes on Escape; 200% text keeps one column.
- Prices: JPY shows no decimals, BHD three, GBP two.

## H2
- Scan a table code: the menu opens with "Table 4"; the scan count rises by one.
- Replace the code: the old print opens the menu without a table; switch off: the old print shows "no longer in use".
- Print page: table tents and stickers print on A4 in Chrome and Safari with no clipped codes; every printed code scans with an iPhone and an Android camera.

## H3
- Two browsers race for the last four top at 20:00: exactly one reservation; the other sees the next free times.
- A party of 3 with only a 2 top and a 4 top free gets the 4 top; a party of 6 with joinable 2 + 4 gets both.
- A party of 10 with an online max of 8 can only send a request; confirming assigns tables.
- Reminder emails arrive 24 h and 3 h before; Cancel inside the cutoff says to call with the phone.
- The guest becomes a Person (or matches an existing one by email, then phone); the Visits panel lists it.
- Public answers carry no other guest's data (inspect the responses).

## H4
- Two tablets on Service: seat a party on one, the other shows it within a second.
- Finished frees the rest of the hold: a new online time appears for that table.
- Walk in for 2 shows free tables with how long each is free; seating takes one tap.
- No show asks first; a status move can be undone for 10 seconds.

## H5
- SN on Warm with its brand kit: screenshots at 390 and 1280, light and dark where the preset allows, reviewed against SN's current menu site before turning on.
