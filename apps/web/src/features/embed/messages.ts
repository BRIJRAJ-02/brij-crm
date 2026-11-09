// What the embedded frame tells the partner's page around it (spec 0070, AC-7031, AC-7032), with `postMessage`. Every
// message goes to each of the partner's registered frame origins by name, never to `*`: the browser delivers it only
// to the one the parent page is on, so nothing reaches a page that isn't the partner's. The partner's guide
// (docs/partners/guide.md) documents each message; they are a promise, like the partner API.

/** The frame's height in CSS pixels, each time it changes: the partner sizes the frame to it. */
export interface HeightMessage {
  readonly type: 'timefix:height';
  readonly height: number;
}

/**
 * The frame needs a fresh launch: its address ran out or its session ended (`target: 'frame'`, put the new address in
 * the same frame), or the browser refused the frame's cookie (`target: 'tab'`, open the new address in a new tab).
 */
export interface RelaunchMessage {
  readonly type: 'timefix:relaunch';
  readonly target: 'frame' | 'tab';
  readonly reason: 'expired' | 'ended' | 'cookies';
}

/** Every message the frame sends. */
export type EmbedMessage = HeightMessage | RelaunchMessage;

/** Whether this page sits in another page's frame. */
export function isFramed(view: Window): boolean {
  return view.parent !== view;
}

/** Sends `message` to the parent page, at each registered origin by name; none registered, nothing is sent. */
export function tellPartner(view: Window, origins: readonly string[], message: EmbedMessage): void {
  if (!isFramed(view)) return;
  for (const origin of origins) {
    // An origin that isn't the parent's is dropped by the browser; a malformed one throws, and is skipped.
    try {
      view.parent.postMessage(message, origin);
    } catch {
      // Not an origin: nothing goes there.
    }
  }
}
