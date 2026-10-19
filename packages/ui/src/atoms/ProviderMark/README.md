# ProviderMark

A brand's own mark at icon size: Google's G, the Google Calendar, Outlook and Apple Calendar marks, and the Timefix mark.

## Why it exists

New (20 October 2026). Continue with Google, Add to calendar and synced calendar events name a brand, and that brand's terms ask for its own mark beside its name, unchanged. The Icon atom draws Lucide glyphs in the current colour and stroke, so it can't carry them: a brand mark is fixed artwork in its own colours. Reusing Icon would mean redrawing the marks as glyphs, which the brands forbid, and no variant of Icon could hold a multi colour image. So this is a new atom, and the one exception to the Lucide only icon rule.

**Owner approved brand exception, 20 October 2026.** The owner approved these marks as the only non Lucide images in the library:

| `provider`        | Mark                              | Source                                                          |
| ----------------- | --------------------------------- | --------------------------------------------------------------- |
| `google`          | Google's multi colour "G"         | Google's sign in branding guidelines (the standard G, 24 by 24) |
| `google-calendar` | The Google Calendar mark (2020)   | Google's published product icon                                 |
| `outlook`         | The Microsoft Outlook mark (2025) | Microsoft's published product icon                              |
| `apple-calendar`  | The Apple Calendar app icon       | Apple's published app icon                                      |
| `timefix`         | The Timefix mark, light and dark  | The product's own `timefix-mark.svg`                            |

The files live in `src/assets/`, each the brand's published SVG unaltered: only the XML prolog, editor comments and editor metadata were dropped, never a shape or a colour. The Timefix mark is the one made here: `timefix-mark-light.svg` is the product's mark as is (dark ink on light), and `timefix-mark-dark.svg` swaps its two fills for dark surfaces, the way the wordmark has a light and a dark file. Adding another brand needs the owner's approval and a line in this table.

## Use

```tsx
<Button provider="google" size="lg">Continue with Google</Button>
<Button provider="google-calendar">Add to Google Calendar</Button>
<ProviderMark provider="timefix" isLabelled />
```

- Beside a label that names the brand (most uses, through Button's `provider`), the mark is decoration: `alt=""`.
- Standing alone (a booking tagged by where it came from), pass `isLabelled`, and it reads as an image named for the brand ("Google Calendar").
- `size`: `md` (`size-icon`, the default) in a 30px button or a row; `sm` (`size-icon-sm`) in a 26px button.
- The same image shows in light and dark: the brands keep their colours on both, and the button or row around the mark follows our tokens. Only Timefix swaps its file by theme, by the rule the tokens follow (a saved choice on the root, else the OS).

## States

One per brand. Decorative or labelled. Timefix light and dark.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
