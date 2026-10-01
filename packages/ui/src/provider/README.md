# UiProvider and toasts

`UiProvider` wraps the app once and gives every component the language, the time zone, the router, the shared clock and the toasts. This folder also holds `createToasts()` and the toast region, `createClock()` and `useDelayedLoading()`.

## Why it exists

Components never read the browser's language, time zone or clock themselves, so a profile setting (#23) can replace the browser's without touching a component, and stories can freeze time. Nothing here lives at module level: the toast queue and the clock are made by factories and passed in.

## Use

```tsx
const toasts = createToasts(); // once, in main.tsx; also handed to the data layer
<UiProvider
  locale={navigator.languages[0] ?? 'en-US'}
  timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
  navigate={(href) => router.history.push(href)}
  useHref={(href) => router.history.createHref(href)}
  toasts={toasts}
>
  <App />
</UiProvider>;
```

- `locale` and `timeZone`: every date, number and amount formats in these (`useFormatSettings()` inside the library).
- `navigate` and `useHref`: React Aria's router, so library links route through TanStack Router.
- `toasts`: the queue from `createToasts()`. Raise one with `toasts.toast({ tone, message, action? })`.
- `clock` (optional): the shared clock behind relative times (`useNow()`), ticking every 30 seconds and paused while the tab is hidden. Stories pass `createFixedClock()`.
- `loadingTiming` (optional): when skeletons appear. Storybook turns the delay off.

## Toasts

- A 36px confirmation at the bottom right: an icon, one sentence and Dismiss.
- Confirmations leave after 5 seconds, paused while hovered or focused. Errors, and toasts with an action (Undo), stay until dismissed. At most three show at once; the rest wait their turn.
- Success is past tense and specific: "Record added successfully", "12 people imported". Errors say what failed and what to do next.
- Toasts never carry the only copy of important information.
- React Aria's toast is still `UNSTABLE_` in 1.21, so only `toasts.tsx` imports it.
- Enter and exit animations arrive with the overlay layer in milestone 2.

## States

- `useDelayedLoading(isLoading)` says when to show a skeleton: only after 200 ms of loading, then for at least 300 ms, so quick loads never flash one.

## Keyboard

- Toasts sit after the page in the tab order: `Tab` reaches the toast, then its buttons. `Enter` on Dismiss closes it, and focus returns to where it was.
- F6 landmark navigation is checked again with the overlay layer in milestone 2.

## Differences from the artifact

The artifact's Toast card is a static toast with `tone` and `onClose`. Here toasts are raised through a queue, with the timing policy built in, and the region draws them.
