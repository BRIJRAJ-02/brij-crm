FormPicture shows forms before anyone answers them: as cards on the forms list, and live inside a device frame in the builder.

**Status words** (the one set every page uses): Not published (gray), Live (green), Paused (gray).

**Use it for**: `FormCard` on the forms list (a picture of the form, its name, a rolling response count and its status), `FormStatusTag` wherever a form's status shows, `HostedFormPreview` beside the builder. **Don't use it for** the hosted page itself: use HostedForm.

**The consumer provides**: `FormCard` takes `name`, `status` (`draft`, `live`, `closed`), `responses`, `updated` ("Edited 2h ago"), `questions` (the picture draws the first choice or rating question), and `href` or `onPress`, plus an optional `badge` beside the count ("2 new") and `menu` (the card's ⋯ MenuTrigger, which sits above the card's stretched press). `HostedFormPreview` takes every HostedForm prop plus `device` or `defaultDevice` (`desktop`, `phone`), `onDeviceChange` and `address` for the browser bar. `HostedFormPreview` takes `barAction`, placed before the device switch (the form's Look button), and `showBar={false}` to leave the bar out where the page has its own device switch (the full page preview: pass `device`); a form with a look paints the whole screen in it.

**States**: Draft (dashed circle), Live (green check), Closed (crossed circle); hovered card (edge and shadow), pressed; desktop and phone frames.

**Interaction**: the picture is the real guest controls at half size, inert and hidden from assistive tech, so it always matches HostedForm. The card's name is its one link, stretched over the card; Enter opens it and a press eases the card to .99. A new response rolls the count's digits (NumberRoll). The device switch is a SegmentedControl whose pill slides (16); the frame eases to the new device's size (01 card resize) and the form fades in from (34). The form inside is live: it can be answered, checked and sent, laid out at the device's width and scaled to the column.

**Replaces**: FormPicture, HostedFormPreview, FormLayoutThumbnail and the forms list's LinkCard picture.
