ShareSheet is the one share dialog: every Share button opens it, and so does a thing's first publish.

**Use it for**: sharing any public page: a form, a booking page, the link page and team pages, a menu, the business page. **Don't use it for** inviting people into the workspace (InviteDialog) or for share links to Insights (named, revocable links have their own dialog).

**The consumer provides**: `isOpen`, `onOpenChange`, `title` ("Share Discovery call", or "Talk to sales is live" after a first publish), `description`, `url` without https://, `name`, `onSite` (shows "Put it on your site" where it embeds), `invite` (words before the link in Email and WhatsApp), `extra` (that thing's own ways, as Buttons: Offer specific times, One-time link, Add to link page) and `footer` (one quiet line, like "Answers go to People · Change").

**States**: the link with Copy (a toast says whether it copied, and the link when it didn't), Email, WhatsApp and More (the system share sheet, else Copy), the QR code with PNG and SVG, Put it on your site, the extra ways under a line, the footer.

**Interaction**: a library Dialog; Esc, × and Done close it. Downloads go through `downloadQr`.

**Replaces**: the forms' Live dialog, the link page's share dialog, the booking pages' Share menu and the menu's and business page's Copy link buttons.
