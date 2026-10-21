# ProviderMark

A brand's own mark at icon size: Google's G, the Google Calendar, Outlook and Apple Calendar marks, the Timefix mark, and the social networks' marks on profile links.

## Why it exists

New (20 October 2026). Continue with Google, Add to calendar and synced calendar events name a brand, and that brand's terms ask for its own mark beside its name, unchanged. The Icon atom draws Lucide glyphs in the current colour and stroke, so it can't carry them: a brand mark is fixed artwork in its own colours. Reusing Icon would mean redrawing the marks as glyphs, which the brands forbid, and no variant of Icon could hold a multi colour image. So this is a new atom, and the one exception to the Lucide only icon rule.

**Owner approved brand exception, 20 October 2026.** The owner approved these marks as the only non Lucide images in the library:

| `provider`                                                                                      | Mark                                                                                                                              | Source                                                          |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `google`                                                                                        | Google's multi colour "G"                                                                                                         | Google's sign in branding guidelines (the standard G, 24 by 24) |
| `google-calendar`                                                                               | The Google Calendar mark (2020)                                                                                                   | Google's published product icon                                 |
| `outlook`                                                                                       | The Microsoft Outlook mark (2025)                                                                                                 | Microsoft's published product icon                              |
| `apple-calendar`                                                                                | The Apple Calendar app icon                                                                                                       | Apple's published app icon                                      |
| `timefix`                                                                                       | The Timefix mark, light and dark                                                                                                  | The product's own `timefix-mark.svg`                            |
| `linkedin`, `x`, `instagram`, `github`, `facebook`, `youtube`, `angellist`, `tiktok`, `threads` | Each network's logo glyph in its brand colour; the black ones (X, GitHub, AngelList as Wellfound, TikTok, Threads) light and dark | Simple Icons 13.21.0 (CC0), each brand's published glyph        |

**Social marks, owner approved 20 October 2026** (social network marks beside Lucide). A url value on a network (a LinkedIn or X profile) shows the network's mark before the handle, through the field set's url display; the marks are `social-<network>.svg` in `src/assets/`, the Simple Icons path with the brand's colour as its fill. A black brand gets a second file filled white for dark surfaces, the way the Timefix mark does, since a black glyph would vanish on a dark row.

The files live in `src/assets/`, each the brand's published SVG unaltered: only the XML prolog, editor comments and editor metadata were dropped, never a shape or a colour. The Timefix mark is the one made here: `timefix-mark-light.svg` is the product's mark as is (dark ink on light), and `timefix-mark-dark.svg` swaps its two fills for dark surfaces, the way the wordmark has a light and a dark file. Adding another brand needs the owner's approval and a line in this table.

## Use

```tsx
<Button provider="google" size="lg">Continue with Google</Button>
<Button provider="google-calendar">Add to Google Calendar</Button>
<ProviderMark provider="timefix" isLabelled />
```

- Beside a label that names the brand (most uses, through Button's `provider`), the mark is decoration: `alt=""`.
- Standing alone (a booking tagged by where it came from), pass `isLabelled`, and it reads as an image named for the brand ("Google Calendar").
- `size`: `md` (`size-icon`, the default) in a 30px button or a row; `sm` (`size-icon-sm`) in a 26px button; `lg` (`size-chip`, 20px) where a workspace's square avatar sits, for the Timefix mark at the top of the app's sidebar (F29: the product's logo heads the sidebar, as in timefix). Why a size: the sidebar's mark slot is the avatar's 20px, and a 16px mark beside a 20px row read as shrunken.
- The same image shows in light and dark: the brands keep their colours on both, and the button or row around the mark follows our tokens. Only the black marks (Timefix, X, GitHub, AngelList, TikTok, Threads) swap their file by theme, by the rule the tokens follow (a saved choice on the root, else the OS).

## States

One per brand. Decorative or labelled. The black marks light and dark.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
