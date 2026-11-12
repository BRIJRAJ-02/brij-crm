Icon draws every Lucide glyph in the product at one stroke and four sizes; ProviderMark draws a brand's own mark where Lucide has none.

**Use it for**: `Icon` for every interface glyph: 16 in rows, menus and buttons, 14 inside 28px controls and chips, 12 in card footers and meta lines, 20 in empty states and tiles. `ProviderMark` for Continue with Google, calendar and video-call providers (Google Calendar, Meet, Outlook, Microsoft, Apple, Zoom), Slack and WhatsApp notifications, the Timefix mark and social profile links. **Don't** redraw or recolour a brand, put a brand mark in place of a Lucide glyph, or use `ai` tone for anything but AI.

**The consumer provides**: `icon` (a Lucide component), `size`, `tone`, and `label` only when the icon is the sole content; otherwise it is hidden from screen readers. `ProviderMark` takes `provider`, `size` (14 to 24), `isLabelled` when no text beside it names the brand, and `tone="mono"` for a row of social marks that must read as one set.

**States**: static. Black marks (X, GitHub, TikTok, Threads, AngelList) swap to their white files in dark theme; Timefix renders `LogoMark`, which flips with the theme.

**Interaction**: none of its own; it sits inside Buttons, rows and links.

**Replaces**: Icon (the Lucide registry and tiles) and ProviderMark. Artwork for Google, Google Calendar, Outlook, Apple Calendar and the social networks is main's files byte for byte. Google Meet, Microsoft, Zoom, Slack and WhatsApp have no official files in the repo yet, so they show a neutral letter tile; drop each brand's official SVG into `marks/` to replace it. Brand marks are never redrawn.
