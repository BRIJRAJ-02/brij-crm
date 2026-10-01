# Icon

The one way the app draws an icon. It comes from the design system artifact's Icon card: Lucide is the only icon library, drawn in outline at `icon-stroke` in `currentColor`, sized by the `size-icon` tokens.

## Use

```tsx
<Icon name="building" />                     // 16px, inherits colour, hidden from screen readers
<Icon name="sparkles" size="sm" tone="ai" /> // the AI sparkle, inside a button
<Icon name="users" tile="green" />           // the People object, on its tile
<Icon name="circle-question-mark" label="Help" /> // the only content of a control
```

- `name`: the icon as lucide.dev names it. Only names in `icons.ts` type check.
- `size`: `md` (16, the default) for nav, menus and attribute rows; `sm` (14) in buttons, chips, table headers and card rows; `xs` (12) in card footers and variables.
- `tone`: `inherit` (the default), `muted` (`text-secondary`, for attribute and column header icons) or `ai` (the sparkle only).
- `label`: only when the icon is the whole content of a control. It then reads as an image with that name; without it, the icon is hidden from screen readers.
- `tile`: a hue (`gray`, `red`, `orange`, `yellow`, `lime`, `green`, `sky`, `blue`, `purple`) to set the icon on its tile. A tile always holds an `sm` icon in the hue's text colour, so `size` and `tone` can't be combined with it.

Each attribute type has one icon, used everywhere that type appears: `globe` domains, `tag` selects, `calendar` dates, `circle-dollar-sign` currency, `users` teams, `building` companies, `user` people, `star` ratings, `map-pin` locations, `phone` phone numbers, `at-sign` emails, `hash` ids.

## Adding an icon

Add one import and one line to `icons.ts`, under its lucide.dev name. It is the only file allowed to import `lucide-react` (ESLint enforces it), so every icon the app ships is listed there, and nothing else ships.

## Why it differs from the artifact's API

- The artifact takes a pixel `size` and a `tileSize`. Code takes token names, because no component may hold a raw number.
- `tone` replaces the artifact's `ws-icon-muted` and `ws-icon-ai` classes, because callers never pass a class name.
- Nothing else passes through to the `svg`: one look, set here.
- The artifact accepts any of the 1,857 Lucide names as a string. Here the registry lists the icons in use, so the bundle carries only those. A feature that lets people pick their own icon will load it through Lucide's dynamic loader, inside this atom only.
