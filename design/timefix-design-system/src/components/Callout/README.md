A callout is a message that stays on the page until its cause is fixed or the user dismisses it.

**Use it for**: `info` for how something works here, `success` for a state that is now true ("Google Calendar connected"), `warning` for a limit coming up, `danger` for something broken that needs the user ("Outlook stopped syncing"), `neutral` for a tip. **Don't** use it for something that just happened (use a toast), for field errors (they sit under the field), or stack more than two in one place.

**The consumer provides**: `tone`, an optional `title`, one or two sentences as children, an optional `action` (`{ label, onPress }`, drawn as a link with an arrow), and `onDismiss` to show × for callouts that can go away.

**States**: five tones, each with its own icon (bulb, info, check, triangle, alert) on a soft tinted ground; with or without title; with action; dismissing.

**Interaction**: danger and warning are `role="alert"` and are announced; the others are `status`. The action and × are in the tab order. The action's arrow nudges 4px on hover. Dismiss collapses the callout with transitions.dev accordion motion (the row's height eases to zero while the content fades and blurs, 250ms), so the content below slides up instead of jumping, then `onDismiss` runs.

**Replaces**: Callout, CalloutBar.
