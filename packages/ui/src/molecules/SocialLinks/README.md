# SocialLinks

A person's own social links as a row of brand marks: a host's LinkedIn, X, website and the rest, where a visitor meets them.

## Why it exists

New (booking socials, 25 October 2026). The owner asked for social links on booking pages, which the booking rail, the `/<handle>` profile and (spec 0051) the link page all draw the same way. Reuse first: each link is a `ButtonLink` (ghost, `lg`, icon only), so hover, focus, the 34px hit area and the forced colours look are Button's own, and the mark is `ProviderMark` (Lucide’s `link` Icon for a website: a globe beside the rail’s time zone, also a globe, read as one more zone), already in every page that draws a Button. What none of them could be is the row itself: a named list of links, laid out so the first mark lines up with the text above, with tooltips that load off the first load. LinkChip shows one link with its words, for a record's url value; a row of marks with no words is a different thing, so it is not a variant of LinkChip.

## Use

```tsx
<SocialLinks
  label="Ada Lovelace’s social links"
  links={[
    { network: 'linkedin', href: 'https://linkedin.com/in/ada', label: 'ada' },
    { network: 'website', href: 'https://ada.dev', label: 'ada.dev' },
  ]}
/>
```

- `links` come from the server ready to draw (`PublicSocialLink`): the network, the canonical link and what it reads as. The public pages carry no link parsing.
- `label` names the list for screen readers; each link is named "LinkedIn, ada" (the network, then its label), and its tooltip says "LinkedIn · ada".
- Each opens in a new tab with `rel="me nofollow noopener noreferrer"`: `me` says the profile is the person's own, `nofollow` that we don't vouch for it. A link `safeHref` refuses draws disabled.
- Nothing draws when there are no links, so a slot never leaves a gap.

## States

- **Rest**: the marks in their brand colours, no box.
- **Hover**: Button ghost's `surface-hover` behind the mark, only on devices that hover.
- **Focus**: from the keyboard, Button's ring; the tooltip opens at once.
- **Empty**: draws nothing.
- **Loading**: none of its own. It arrives with the page's facts, in the same paint; the frame's loading shape reserves nothing for it, since most hosts have none.
- **Disabled**: a link `safeHref` refuses (never one the server sent).

## Keyboard

`Tab` reaches each link in order; `Enter` opens it in a new tab. The tooltip opens on focus and closes on `Escape`.

## Size

The tooltips load on their own (`SocialLinksTips.tsx`, `lazy`), so a booking page's first load gains only the row and its few lines of CSS.
