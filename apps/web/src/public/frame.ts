// Inside an embed's frame (spec 0023, 0023-embeds.md): what the embed script
// (`embed/v1.js`) told the frame in its address, and the two messages the
// frame sends back, its content's height and a request to close. Shared by
// the hosted form and the booking page, and invisible: nothing here draws.
//
// Messages go only to the page that framed us, never to `*`: its origin is
// the browser's own `ancestorOrigins` where it has them (Chromium, WebKit),
// else the `host` the script named (Firefox). A page that names another
// site's origin gets nothing, since the browser delivers a message only when
// the parent's origin is the one named. The frame reads no message at all.
import { handleAddressOf } from '@crm/contracts/handles';

/** How a frame was embedded: inline (its height follows its content) or in the script's dialog. */
export type EmbedMode = 'inline' | 'popup';

/** A frame the embed script made: how, its id on the host page, and the host's origin to post to. */
export interface Embed {
  readonly mode: EmbedMode;
  readonly frameId: string;
  readonly hostOrigin: string;
}

/** What the frame knows of where it sits. */
export interface FramePlace {
  readonly search: string;
  readonly isFramed: boolean;
  readonly ancestorOrigins?: readonly string[] | undefined;
}

/** An origin, or undefined when `text` isn't an http or https address. */
function originOf(text: string | null | undefined): string | undefined {
  if (text === null || text === undefined || text === '' || !URL.canParse(text)) return undefined;
  const url = new URL(text);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
}

/**
 * The embed this frame is, or undefined when it isn't one we can answer: not
 * framed, no `embed=1`, or no host origin to post to.
 */
export function embedOf(place: FramePlace): Embed | undefined {
  if (!place.isFramed) return undefined;
  const params = new URLSearchParams(place.search);
  if (params.get('embed') !== '1') return undefined;
  const mode: EmbedMode = params.get('mode') === 'popup' ? 'popup' : 'inline';
  const frameId = params.get('fid') ?? '';
  if (!/^\d{1,6}$/.test(frameId)) return undefined;
  const parent = place.ancestorOrigins?.[0];
  // The browser's word wins where it has one.
  const hostOrigin = parent !== undefined ? originOf(parent) : originOf(params.get('host'));
  return hostOrigin === undefined ? undefined : { mode, frameId, hostOrigin };
}

/** A message the frame sends its host, in the one shape the embed script takes. */
export type FrameMessage =
  | { readonly timefix: 1; readonly type: 'height'; readonly fid: string; readonly height: number }
  | { readonly timefix: 1; readonly type: 'close'; readonly fid: string };

/** Where the frame's messages go. */
export type PostToHost = (message: FrameMessage, targetOrigin: string) => void;

/**
 * Posts the frame's content height to its host whenever `measure` changes it
 * (`watch` calls back on each resize), rounding up so the frame never clips
 * a pixel. Answers the function that stops it.
 */
export function reportHeight(
  embed: Embed,
  post: PostToHost,
  measure: () => number,
  watch: (changed: () => void) => () => void,
): () => void {
  let last = -1;
  const send = () => {
    const height = Math.ceil(measure());
    if (!Number.isFinite(height) || height === last) return;
    last = height;
    post({ timefix: 1, type: 'height', fid: embed.frameId, height }, embed.hostOrigin);
  };
  const stop = watch(send);
  send();
  return stop;
}

/** In the script's dialog, Escape inside the frame closes it, unless an open list or popover took the key. */
export function closeOnEscape(embed: Embed, post: PostToHost, target: Pick<Window, 'addEventListener'>): void {
  if (embed.mode !== 'popup') return;
  target.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const open = event.target instanceof Element && event.target.closest('[role="listbox"], [role="dialog"]') !== null;
    if (!open) post({ timefix: 1, type: 'close', fid: embed.frameId }, embed.hostOrigin);
  });
}

/**
 * Whether a form's next address is one of our booking pages: `/b/<key>`, or a handle address `/<handle>/<slug>`
 * (22 Oct 2026), a path on this origin either way.
 */
export function isOwnBookingPath(url: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) return false;
  if (url.startsWith('/b/')) return true;
  const pathname = new URL(url, 'https://frame.invalid').pathname;
  return handleAddressOf(pathname)?.kind === 'page';
}

/** One of our own addresses (`/b/…`, `/<handle>/<slug>`) opened in the same frame, keeping what makes it an embed. */
export function framedUrl(path: string, embed: Embed): string {
  const url = new URL(path, 'https://frame.invalid');
  url.searchParams.set('embed', '1');
  url.searchParams.set('mode', embed.mode);
  url.searchParams.set('fid', embed.frameId);
  url.searchParams.set('host', embed.hostOrigin);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * A full page layout's own height, without the page's minimum: a booking
 * page's `main` stands at least a viewport tall, so inside a frame it would
 * only ever grow. Its content is its first child's children; their span, plus
 * the page's own padding, is what the frame should be.
 */
export function naturalHeight(page: Element, view: Pick<Window, 'getComputedStyle'>): number {
  const content = page.firstElementChild;
  if (content === null) return page.getBoundingClientRect().height;
  const parts = [...content.children].map((child) => child.getBoundingClientRect());
  if (parts.length === 0) return page.getBoundingClientRect().height;
  const top = Math.min(...parts.map((part) => part.top));
  const bottom = Math.max(...parts.map((part) => part.bottom));
  const style = view.getComputedStyle(page);
  return bottom - top + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
}

/** Calls `changed` once a frame whenever anything under `root` changes size or shape; answers the stop. */
export function watchTree(root: Element, changed: () => void): () => void {
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    globalThis.requestAnimationFrame(() => {
      queued = false;
      changed();
    });
  };
  const sizes = new ResizeObserver(queue);
  const observeAll = () => {
    sizes.disconnect();
    sizes.observe(root);
    for (const each of root.querySelectorAll('main, main > *, main > * > *')) sizes.observe(each);
  };
  const shapes = new MutationObserver(() => {
    observeAll();
    queue();
  });
  observeAll();
  shapes.observe(root, { subtree: true, childList: true });
  return () => {
    sizes.disconnect();
    shapes.disconnect();
  };
}
