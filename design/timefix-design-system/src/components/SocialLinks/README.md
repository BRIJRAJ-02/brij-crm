SocialLinks is a person's social links as a row of official marks in the page's text colour; SocialLinksEditor is where they keep that list.

**Use it for**: link pages and the booking page's rail (SocialLinks), and the profile and link page editors (SocialLinksEditor). **Don't use it for** a record's URL value; that is a RecordChip.

**The consumer provides**: `links` (id, network, url) and a `label` for SocialLinks; `links` and `onChange` for the editor. `detectNetwork`, `socialUrl` and `socialLabel` are the plain functions behind it.

**States**: the row draws nothing when empty. Marks are monochrome (Instagram, X, LinkedIn, YouTube, TikTok, Threads, GitHub, Facebook from their official files; website and email in Lucide). The editor shows an empty line, a taken network as an error, and "Removed · Undo" after a removal.

**Interaction**: hovering a mark lifts it 4px and nudges its neighbours with a 0.45 falloff, then the row springs back (avatar group hover). Each mark opens in a new tab with `rel="me nofollow"`. In the editor, pasting a link detects the network and its mark swaps in (icon swap); one link per network; grips reorder by drag or keyboard (lib/drag.ts: the row lifts under the pointer, the others slide aside, Space, arrows, Space); × removes, Undo brings it back.

**Replaces**: SocialLinks, SocialLinksEditor and the social marks of ProviderMark.
