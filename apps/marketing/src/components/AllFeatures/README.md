# AllFeatures

Every feature of Timefix, one click away: a quiet "All features" button in the footer that opens a panel listing each area and what it holds.

## Why it exists

The owner wanted every feature on the page (22 October 2026), then the page down to one screen with no scrolling and minimal copy (23 October 2026). A panel keeps both: nothing on screen until asked for, everything there when it is. The library's `Modal` and `Popover` need React Aria running in the browser, and this site ships no script, so this is a native popover (`popover`, `popoverTarget`) drawn as the app's Modal is: the raised surface, a hairline, the large shadow, the overlay inset, the scrim.

## Use

```tsx
<AllFeatures groups={FEATURE_GROUPS} />
```

The areas and features live in `src/features.ts`: only what is live on app.timefix.ai.

## States

- **Closed:** the trigger, a footer row with the sidebar's hover surface and the library's focus ring.
- **Open:** the panel grows from `scale-enter` over `duration-modal` (reduced motion fades only), the header stays put while the list scrolls, and Escape, a click outside or the close button shuts it. The browser returns focus to the trigger.
