Tags show select, multi-select and status values; they are where most colour in the product lives.

**Use it for**: status (with `status`, which picks its shape and hue), options (`hue`), neutral facts (`outline`: a price, a plan), invite and booking states (`size="pill"`). `StatusDot` is the dot-plus-word form for dense text. `Count` is the round number on tabs, nav items and columns. **Don't** use a tag as an action button; a removable filter is a FilterChip. The one pressable form is a jump link: with `onPress` a tag becomes a button that opens where its value is set (a question card's "Shown if …" chip opens that question's More options at Logic and points); it shows a hairline on hover, the focus ring on keys, and long words end in an ellipsis.

**The consumer provides**: the label, `status` or `hue` (gray, red, orange, yellow, lime, green, sky, blue, purple), an optional Lucide `icon`, `size` (`sm` 22 in tables and selects, `md` 26, `pill` 30), and for a jump link `onPress` with an optional `aria-label`.

**Status shapes**: dashed circle draft, half circle in progress, pie in review, filled check done, crossed circle failed or cancelled, clock waiting or expired. The shape carries the meaning without colour; text and icon take the hue (4.5:1 or better on the soft ground in both themes).

**Interaction**: a status that changes in place pops in (scale 0.92 → 1, 200ms); counts roll with `NumberRoll`.

**Replaces**: Tag, Badge, StatusDot, the status chips inside BookingList, MeetingCard and FormPicture.
