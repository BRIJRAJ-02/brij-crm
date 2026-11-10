# 0065 verify

Each check is run in the real app (both productions after landing) or by the named test.

## H0
- Since 0195 (9 Nov 2026): a new workspace shows Menu, Menu QR, Table seating and Appointments on in Settings › Apps with no activation, and Events "On its way". Switching Menu off makes a menu procedure answer `APP_NOT_INSTALLED` and `/m/<key>` the not found page, and it stays off after a deploy. Switching Appointments off refuses a new booking. A workspace that had apps installed without early access before 0195 finds them switched off.
- A member (not admin) cannot switch an app; an admin switches Menu off, which hides Menus; switching it on again restores the same menus.
- The first view of a business screen sets the business up and seeds the Floor staff role.
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
- News double opt in (0066 AC-6672): reserve with the box ticked; no consent row exists and a `reservation_news` email arrives. Opening its link shows a question and writes nothing; Yes writes one granted consent; Yes again answers `already`; after a withdrawal the same link answers `NOT_FOUND`; a link older than 7 days is refused. The reserve answer is the same with or without an earlier yes.
- Durable limits (0066 AC-6673): a sixth reserve from one address in a minute is refused, also across two function instances; junk input never counts toward the place's 50; a sixth reservation for one email at a place in an hour is refused; `auth.rate_limit` holds no address or email in the clear.

## H4
- Two tablets on Service: seat a party on one, the other shows it within a second.
- Finished frees the rest of the hold: a new online time appears for that table.
- Walk in for 2 shows free tables with how long each is free; seating takes one tap.
- No show asks first; a status move can be undone for 10 seconds.

## H5
- SN on Warm with its brand kit: screenshots at 390 and 1280, light and dark where the preset allows, reviewed against SN's current menu site before turning on.

## H7 (properties, 0198 to 0201)
- A workspace with one business reads exactly as before; adding a second shows the switcher, and each business keeps its own menus, draft and Publish.
- A dish can't be placed in another business's menu (the server refuses). Copy to another business copies a menu without photos and a service offline, in no category.
- A second business's address is a wish until its first Publish; a sixth new handle in 24 hours is refused; an address another page took meanwhile makes Publish answer `SLUG_TAKEN` on the field.
- At a business's own address with two places taking reservations, Reserve asks for the place first; with one, it goes straight there; `/r/<key>` and printed QR codes still open their place.
- A member limited to one place: sees that business with its other places left out, gets `FORBIDDEN` on its profile, menus, Sold out and Publish, and `NOT_FOUND`, the same as a missing id, on another place's reservation in every hospitality procedure (the slice 4 test). History says "limited Bea to 1 business and 2 places". The switcher follows mid session after the change.
- Removing a business someone is limited to answers `IN_USE` with the Members hint.
- Cover (10 Nov 2026): upload a cover to a second business's page; before Publish guests see the gallery's first photo, after Publish the cover leads the page, the share image and JSON-LD. Remove it and the gallery's first photo leads again. A picture no page uses is gone a day later.
- Unlinkable: two businesses of one workspace answer different `business:` and `menu-ws:` tags in their public JSON, and an edit to one purges only its own tag (and, until 24 Nov 2026, the old workspace tag).
- An 11th new business address in 24 hours by one person, across two workspaces, is refused on the field with "You’ve taken 10 new addresses today."
