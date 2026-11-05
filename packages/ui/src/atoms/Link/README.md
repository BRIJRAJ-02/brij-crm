# Link

An inline text link.

## Why it exists

New. Text in notes, descriptions, settings and empty states links somewhere; one atom routes app paths through the router and checks every href with `safeHref()` (AC-14). For a link as a value (an email, a domain, a URL) use LinkChip.

## Use

```tsx
<Link href="/settings/members">Invite your team</Link>
<Link href="https://docs.example.com">Read the guide</Link>
```

- App paths (`/people/1`) go through the router (React Aria's `RouterProvider`, from UiProvider).
- `http` and `https` links out open in a new tab with `noopener noreferrer`; `mailto:` and `tel:` open as usual.
- Any other href (`javascript:`, `data:`, `//host`) renders the text with no link.
- `opensInNewTab` opens an app path in a new tab too, with "(opens in a new tab)" read after its words. Why a variant: a dialog half filled in that needs something set up elsewhere first (a new booking page's round robin group) lost what was typed when the link moved the page; in a new tab the dialog waits. Links out already open in a new tab without it.
- `tone="quiet"` draws it in the surrounding text's colour with a faint underline that darkens on hover and focus. Why a variant: a form card's submissions count is a fact on its meta line as much as a way to the submissions (5 November 2026); in link blue it outshouted the card's name. It is still underlined, so it never relies on colour.
- `label` names it for screen readers when its words are ambiguous out of context: every card's "12 submissions" reads as "12 submissions to Contact us".
- `onPress` does something in the page instead of navigating (a form's error summary focuses a question): the same look, focus ring and Enter key, and `href` is not rendered.

## States

It is underlined at rest (soft), so it never relies on colour; hover and focus darken the underline, and focus adds the 1px `accent-line` ring just outside the text (the halo alone is under 3:1).

## Keyboard

Tab reaches it; Enter follows it.

## Differences from the artifact

Not in the artifact.
