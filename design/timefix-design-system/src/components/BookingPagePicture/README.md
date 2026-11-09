BookingPagePicture draws a booking page in miniature, and BookingPageCard puts it on the Pages list with the page's name, length, place, an On or Hidden switch, Copy link and a menu of the rest.

**Use it for**: the booking pages list, and anywhere a page needs to read as itself small (the embed preview's inline box). **Don't use it for** the real public page (that is BookingFlow) or for forms, which have their own picture.

**The consumer provides**: `host`, `title`, `duration` ("30 or 60 min"), `openDays` (seven booleans, Monday first, from the page's weekly hours) and `hue` for the picture; the card adds `location`, `url`, `isOn` with `onOnChange`, and `onAction` for Edit, Open page, Embed on a site, Duplicate and Delete. Nothing inside fetches.

**States**: open days in the page's soft colour, the first one picked in its solid colour; no open days leaves every day quiet. Hidden greys the picture and turns Copy link off. Long titles and places cut with an ellipsis.

**Interaction**: Tab reaches the switch, Copy link and the menu. Copy link morphs to "Copied" keeping the shared letters (transitions.dev text morph) while the copy icon swaps to a check (icon swap), then returns after 1.6 seconds; a polite status says "Link copied". On and Hidden crossfade (text swap). The menu opens from its button (menu dropdown). The picture itself never moves or takes focus.

**Replaces**: BookingPagePicture and the booking pages' LinkCard picture.
