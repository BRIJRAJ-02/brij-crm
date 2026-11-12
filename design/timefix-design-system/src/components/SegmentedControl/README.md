A segmented control picks one of two to five ways to see or set the same thing, such as Table, Board or Calendar, with a raised pill that slides to the chosen segment.

**Use it for**: view switchers, a booking page's 12h / 24h clock, Day / Week / Month, short either-or settings that take effect at once. **Don't use it for**: sections of a page (use `Tabs`), more than five options (use a select), or an on/off setting (use a `Switch`).

**The consumer provides**: `items` (`id`, `label` and/or a Lucide `icon`; icon-only items need `ariaLabel`, which also becomes their tooltip), an `aria-label`, `selectedKey` with `onSelectionChange` (or `defaultSelectedKey`), `size` (`md` 36, `sm` 28), `variant` (`default` white pill on a grey track, `ink` filled pill for public pages), `isFullWidth`, `isDisabled`. Inside a `SegmentedFillContext` of `narrow` (a toolbar), the control takes the full row and its segments share the width when the container is under 34rem.

**States**: rest (grey text), hover (ink text), selected (white raised pill with a hairline, or ink pill with white text), focus-visible, disabled per segment or whole.

**Interaction**: one tab stop; arrow keys move between segments, Space or Enter picks. Exactly one is always chosen. The pill is measured onto the chosen segment and tweens its position and width over 250ms on the smooth-out curve (transitions.dev 16, tabs sliding); it snaps on first paint and on resize, and moves instantly under reduced motion.

**Replaces**: SegmentedControl, the ad hoc view switchers in Toolbar.
