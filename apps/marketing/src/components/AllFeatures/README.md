# AllFeatures

Every feature of Timefix, one click away: a quiet "All features" button in the footer that opens a sheet listing each area and what it holds.

## Why it exists

The owner wanted every feature on the page (22 October 2026), then the page down to one screen with no scrolling and minimal copy (23 October 2026), then the sheet itself "better" (23 October 2026). A sheet keeps all three: nothing on screen until asked for, everything there when it is. It is the library's `Modal` (`variant="window"`, opened from a `ModalTrigger` by a ghost `Button`), so focus, Escape, the click outside, the enter and exit motion and the return of focus are the app's. What is the site's own is the sheet inside the body: the areas down the left as quiet full width Buttons, each a jump to its section, and the sections on the right, each a checked list of features. Nothing in the library lays out a reference of this shape (a settings page's rail beside long content), and it is text, not a control, so it lives here.

## Use

```tsx
<AllFeatures groups={FEATURE_GROUPS} />
```

The areas and features live in `src/features.ts`: only what is live on app.timefix.ai. The title bar's context counts them.

## States

- **Closed:** the ghost Button, with the library's hover and focus.
- **Open:** the Modal's own states. The rail and the sections scroll together in the Modal’s body (nothing is sticky, so nothing overlaps); a row scrolls its section to the top and moves focus onto it. Under 480px of sheet (a phone) the rail sits above the sections in one column. The foot holds Close (Esc) and Claim your page.
