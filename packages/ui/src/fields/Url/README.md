# Url

A web link, or several.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the url type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a LinkChip to the URL, showing its domain without `www.` and its path, with no protocol, query or trailing slash ("northwind.com/pricing"; a long one is cut from the end, so the domain stays, and the cell's tooltip shows it whole); it opens in a new tab; several values are a row of chips with "+N". A link to a profile on a known network (LinkedIn, X or Twitter, Instagram, GitHub, Facebook, YouTube, AngelList or Wellfound, TikTok, Threads) shows the network's mark (ProviderMark, through LinkChip's `mark`) and the handle instead: "@adalovelace" where the network writes handles with `@`, "ada-lovelace" where it doesn't. A link on the network that isn't a profile (a post) shows the mark and the domain and path. The network comes from the link's host, so a custom url attribute holding a GitHub link shows GitHub's mark too. On a card (a board card, a line of the timeline) the chip is flat, the link's text alone: a blue chip there read heavier than the words around it (the owner, 21 October 2026).
- **Editor**: a Field checked on blur. Text without a protocol gets `https://`; only `http` and `https` links are taken, up to 2,048 characters; the scheme and host are lowercased and the path keeps its case. On a form the placeholder is an example ("example.com") and a hint says https:// can be left out; a cell, a panel row or a filter keeps "Set <Attribute>…" (the label is hidden there) and the refusal names the example. Phones get the web address keyboard (`inputMode="url"`).
- **Social profiles**: an attribute whose API name is a network's (`linkedin`, `twitter` or `x`, `instagram`, `github`, `facebook`, `youtube`, `angellist` or `wellfound`, `tiktok`, `threads`; People's and Companies' standard ones are) also takes a handle, with or without `@`, and keeps the profile's one canonical link: the network's own host with no `www.`, the profile's path, no trailing slash or tracking (`https://www.linkedin.com/in/ada/?utm_source=share` and `ada` both become `https://linkedin.com/in/ada`; `twitter.com` becomes `x.com`). On LinkedIn and AngelList a bare handle is a person's profile, except on the Companies object (the attribute's `objectKey`, which `toFieldAttribute` takes from the screen), where it is the company's page (`company/acme`); `in/ada` or `company/acme` can always be typed. A link to another network (an X link in LinkedIn) is refused with "That is a link to X. Enter a handle on LinkedIn, or a link to the profile.", and the network's bare host is no one's profile. A link to anywhere else (a link page) is kept as a link. The copy names the field as its label does ("Twitter"). On a form the placeholder is the network's example handle (a company's on Companies) and the hint says a handle or a link is welcome; a handle the network wouldn't take is refused with "Enter a handle on Twitter, such as @adalovelace, or a link to the profile." The network rules live in `@crm/contracts/values` (`src/values/social.ts`, tested there), which the engine's write path also runs, so a value written through the API, a bulk edit, an import or a form is stored as the same canonical link and refused with the same words. This folder's `social.ts` is a thin layer that words the refusals in the field's copy; the display, the editor and the text conversion share it. A filter's "contains" on a url takes a handle typed with `@`: "@ada" also finds `https://x.com/ada`.
- **Text out / in** (copy, paste, CSV, the import preview): the URL / the same check, so a column of handles pasted into LinkedIn becomes profile links.
- **Polish (30 October 2026)**: A link that isn't a social profile leads with its site's icon when the app serves icons (`SiteIconsContext`), its first letter as the fallback. On the record panel each chip has Copy. A pasted list splits on commas, lines and spaces.
- **Filter operators**: is, contains, is empty, is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value (a domain, or a network's mark and handle), several values, read only, and in the editor: typing, invalid (the Field's error says how to fix it, and nothing is committed), required.

## Keyboard

The editor is a Field: Enter commits in a cell, blur commits elsewhere, Esc cancels. In a grid cell one value is typed in the cell itself; several edit in a popover under the cell, the list with an add field ("Set <Attribute>…", then "Add another…").

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly. The social profile row was added to the table in spec 0003 on 22 October 2026 and goes to the artifact with the next publish.
