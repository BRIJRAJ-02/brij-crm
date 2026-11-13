# PublishBar

The head of a public page's editor (spec 0068, AC-6811, AC-6812): how many changes guests don't see yet, then Changes (the list, each a plain sentence such as "Length 30 min → 45 min"), Versions, Preview, Discard draft and Publish. Booking pages first; link, business, event and menu pages take the same bar.

## Why a new part

SaveBar is the floating bar for unsaved edits on one screen: it leaves once they are saved. A published page has a second state that outlives the screen: a saved draft guests don't see, its changes, and its versions. Putting that into SaveBar would make one bar mean two things (unsaved here, unpublished for guests), so it is its own strip, built from the library's Icon, Button, Menu and Modal. It is dashboard chrome, so it keeps today's design system exactly: a status change is a plain icon and words that crossfade (`duration-fast`), never the public pages' NumberPop or SuccessCheck.

## States

- `live`: nothing to publish. A quiet "Live: guests see this page" with a check, and Versions.
- `live` with `isPaused`: "Paused: guests can't book this page" with a pause, and the live version is marked Published, not Live, in Versions. Nothing in the bar claims the page is live.
- `draft`: a dot and "3 changes not published"; Changes, Versions, Preview (when `previewHref` is given), Discard draft and Publish. Paused or not, the count stays.
- `publishing`: Publish keeps its place with its spinner; Discard draft waits.
- `published`: a check and "Published", and Publish says Published, disabled; the caller puts the bar back to `live` after a moment.
- `error`: one line saying why (`problem.message`) and the way to the setting to fix (`problem.fix`); Publish keeps its name. Below 480px of its own width (a phone) the reason comes first, above the status and the buttons (a container query).

`PublishBarSkeleton` stands in while the editor loads: the same strip and height with its status as a skeleton line, so the editor under it lands where the loading state put it.

Three options let every editor of a published thing head with this bar (spec 0074, batch 3): `changeCount` says a count where the editor knows only how many changes wait (a menu's draft), with Changes offered only for the sentences in `changes`; `onDiscard` left out draws no Discard draft (a thing never published has nothing to go back to); `pausedText` is what a paused page says when it isn't a booking page ("Hidden: guests see that the menu isn't available"). In the same additive style: `liveText` (a form's "Live: visitors can send this form", the business page's publish date), `draftText` (a thing never published says "Not published yet" in place of the count, with no Changes to open), `discardWords` (the confirm in the editor's own words, a menu's "Sold out stays as it is."), `publishKbd` (the editor's ⌘↵ shown on Publish), `versionsFailed` (the Versions menu says they didn't load). `onDiscard` may return a promise: the confirm stays open and busy until it settles, and a rejection's message is said inside it. When Publish or Discard draft leaves with focus on it (a publish lands, a discard is confirmed), focus goes to the bar's status line, never the page. Changes are keyed by place and words, since two can read the same.

Publish asks nothing (publishing is reversible through Versions). Discard draft asks first: "Discard the draft?", with Keep the draft and Discard draft. Versions reads when its menu opens (`onVersions`); the live one is marked and can't be picked; picking another calls `onRestore`, which brings it back as the draft. Changes is a disclosure (`aria-expanded` on its button), the status is a polite live region and the refusal an alert. The status crossfades when what it says changes (a fade, which reduced motion keeps).

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.

## Timefix prototype (spec 0072)

Takes its look from FloatingBar's `white` tone (spec 0072), the prototype's PublishBar: the raised surface with a hairline, `space-4` around the actions and `space-16` before the words, the status in `text-body-strong` with a `space-6` dot in `dot-orange` while changes wait, the changes list in `text-body-sm`.

**Use it for** a public page's draft against what guests see, at the head of its editor. **Don't use it for** unsaved settings: that is SaveBar.

**States**: live, paused, draft (the dot and the count, Changes, Discard, Publish), publishing (Publish pending), published, refused (the reason and its fix).

**Differences from the prototype**: it stays an inline strip at the head of the editor (spec 0068) rather than a floating pill, so it doesn't render FloatingBar: its corners are `radius-xl` (it grows a list of the changes), and its shadow stays `shadow-xs`. The changes list, versions and restore, Preview as a link, the refusal's fix and the skeleton are the library's.

**Repeats from its replacer**: the dot and the status type, which FloatingBar itself doesn't draw (its bars bring their own words); nothing to share.
