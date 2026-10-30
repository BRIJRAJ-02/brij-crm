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
- `FormatScope`: changes the time zone, date format (`auto`, `dmy`, `mdy`, `ymd`) or week start (`auto`, `monday`, `sunday`, `saturday`) for everything inside it. The web app wraps each workspace in one with the member's preferences (Settings › Account › Preferences), so dates, calendars and "today" follow them. `useFormatSettings()` reads the result; `formatDate`, `formatDay` and `firstDayOfWeek` are the same helpers the library uses, for screens that write a date themselves.
- `useKeyboardPlatform()`: `mac` or `other`, read once by the provider. Kbd and the grid's Mod keys use it, and a screen's own shortcuts (the workspace frame's undo) read it too, so every shortcut agrees on Cmd or Ctrl.

## Toasts

- A 36px confirmation at the bottom right: an icon, one sentence and Dismiss.
- Confirmations leave after 5 seconds and errors after 8, paused while hovered or focused. Toasts with an action (Undo, Retry, Use mine) stay until dismissed. Only the toasts take part in their view transition: the page is never captured and the transition's overlay passes every click through, so nothing freezes while a toast moves. At most three show at once; the rest wait their turn.
- Success is past tense and specific: "Record added successfully", "12 people imported". Errors say what failed and what to do next.
- `info` (an info icon in the data blue, `dot-blue`) is news about what someone else did ("Bea changed the filters on this view.", spec 0020) or a quiet notice that isn't a failure ("That link's filter couldn't be read, so the saved view is shown."). Why a tone: a view's live change and a skipped link were neither a confirmation of the reader's own action nor an error, and a green tick or a red alert misread both. It times out as a confirmation does.
- `isBusy: true` puts a spinner in the icon's place for work under way ("Exporting People…"); it stays until the screen dismisses it, usually as it raises the toast saying how the work ended (Download, or Try again). Why: an export said "ready later" and its file arrived in a second, unrelated toast; one place that shows the work and then its result is easier to follow.
- Toasts never carry the only copy of important information.
- React Aria's toast is still `UNSTABLE_` in 1.21, so only `toasts.tsx` imports it.
- Enter and exit animations arrive with the overlay layer in milestone 2.
- `FormatSettings` holds the workspace's `currency` and `country` when a `FormatScope` gives them; `useRegionDefaults()` answers both, else the language's region's (en-IN is IN and INR), else the US's, so a new amount, phone number or Currency attribute never starts in USD by itself. The server keeps no workspace currency or country yet, so today it is always the language's. `useTodayReader()` reads today in the time zone when called, without a re-render per tick (a grid paste's "tomorrow"). `SiteIconsContext` says where a host's icon comes from; the web app supplies it once the api serves workspace icons.

## States

- `useDelayedLoading(isLoading)` says when to show a skeleton: only after 200 ms of loading, then for at least 300 ms, so quick loads never flash one.
- `LoadingNow` wraps a page that only appears once that delay has passed (the router's pending page): its skeletons show at once, still for at least 300 ms, rather than waiting out the delay again behind a blank area.

## Keyboard

- Toasts sit after the page in the tab order: `Tab` reaches the toast, then its buttons. `Enter` on Dismiss closes it, and focus returns to where it was.
- F6 landmark navigation is checked again with the overlay layer in milestone 2.
- React Aria gives each toast `role="alertdialog"`; the region carries `data-toast-region`, so a screen's shortcut that stands aside for an open dialog can still answer while focus is on a toast.

## Differences from the artifact

The artifact's Toast card is a static toast with `tone` and `onClose`. Here toasts are raised through a queue, with the timing policy built in, and the region draws them.
