Presence shows who else is working on the same thing right now: their pointers, their typing caret and a stack of their avatars.

**Use it for**: `RemoteCursor` on shared canvases (the form and booking-page builders, a board); `RemoteCaret` inside a shared note or rich text; `PresenceGroup` in a record's or page's header to say who is here. **Don't** show a cursor for someone on another page, or use these for people who are merely members.

**The consumer provides**: RemoteCursor `name`, `x` and `y` in px inside a positioned container, `hue` (defaults to the person's avatar hue) and `isIdle`. RemoteCaret `name` and `hue`. PresenceGroup `people` (name, `status` active or idle, optional `activity` and photo), `max` (4) and `size`.

**States**: cursor moving, cursor idle (the name pill folds away, the arrow dims). Avatar dots: green active, yellow idle. Overflow shows "+n".

**Interaction**: cursor positions glide between updates over 150ms with the smooth-out ease, so updates every 100 to 150ms read as continuous motion. PresenceGroup follows transitions.dev 11 avatar group hover: the hovered avatar lifts 4px and grows to 1.05, neighbours lift 0.45 as much per step, in with smooth-out and back with the strong bounce. Each avatar is focusable (Tab) and names the person and what they are doing in a Tooltip. Pointers and carets are hidden from screen readers; the group's label says who is here.

**Replaces**: RemoteCursor (now RemoteCaret) and the ad hoc presence stacks.
