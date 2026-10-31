// The tab's icon inside a workspace (spec 0060): the workspace's logo when it has one, from its member route
// (`/api/brand/logo?workspace=&v=`, our own origin, its type checked again on the way out), as Slack and Linear wear
// a workspace's icon. Leaving the workspace, or a logo removed, puts the product's icons back exactly as they were.
import { useEffect } from 'react';

/** What the page's icon links held before a workspace's logo replaced them. */
interface Kept {
  readonly link: HTMLLinkElement;
  readonly href: string;
  readonly type: string | null;
  readonly sizes: string | null;
}

/** Points every icon link at `src`, and answers how to put them back. */
export function wearFavicon(document: Pick<Document, 'querySelectorAll'>, src: string): () => void {
  const kept: Kept[] = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((link) => ({
    link,
    href: link.getAttribute('href') ?? '',
    type: link.getAttribute('type'),
    sizes: link.getAttribute('sizes'),
  }));
  for (const { link } of kept) {
    link.removeAttribute('type');
    link.setAttribute('sizes', 'any');
    link.setAttribute('href', src);
  }
  return () => {
    for (const { link, href, type, sizes } of kept) {
      link.setAttribute('href', href);
      if (type === null) link.removeAttribute('type');
      else link.setAttribute('type', type);
      if (sizes === null) link.removeAttribute('sizes');
      else link.setAttribute('sizes', sizes);
    }
  };
}

/** The workspace's logo as the tab's icon while `src` is set; the product's icons otherwise. */
export function useWorkspaceFavicon(src: string | undefined): void {
  useEffect(() => (src === undefined ? undefined : wearFavicon(document, src)), [src]);
}
