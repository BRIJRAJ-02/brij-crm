LinkList, LinkGrid and LinkCard draw a link page's links: full width pill buttons, two tiles to a row with pictures, and one featured card.

**Use it for**: the links on a link page and its editor preview. **Don't use it for** managing booking pages or forms inside the app; those are lists of things to manage, with switches and menus.

**The consumer provides**: `items` (id, title, optional subtitle, href, an icon or network mark, an optional image or a hue for the picture area, clicks), a `label` for the list, `isPreview` so links don't navigate, and `showClicks` for the editor's click count badge. LinkCard takes one `item`.

**States**: rest, hover (2px lift with a soft shadow, only on devices that hover), pressed (0.97), focus ring, a picture or the icon large on its hue, and click counts in editor mode ("1.3K"). They read the page's look from `--tf-lp-*` variables and fall back to the calm look on their own.

**Interaction**: each link is one tab stop; Enter opens it, in a new tab for web addresses (named "opens in a new tab"). The featured card's arrow steps 2px out on hover (learn more hover). Press eases over 150ms.

**Replaces**: LinkList, LinkGrid, LinkCard, SpanCard and LinkCardSkeleton.
