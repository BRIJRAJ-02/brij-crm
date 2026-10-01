# 0003 · Rich text and email

## Summary

One editor component, `RichTextEditor` on Tiptap 3, serves notes, comments and email, with a different set of tools for each. Its content is saved as Tiptap's JSON document, never as HTML, so nothing a person pastes can run. Live co editing (Yjs) is a session the shared notes feature (#27) creates in the data layer and passes in. Emails received from outside render in a sandboxed frame, with scripts off and images off until asked.

## Versions (checked 2026-10-01)

`@tiptap/react` 3.31.4, plus `@tiptap/starter-kit`, `@tiptap/extension-mention` and `@tiptap/extension-collaboration` at the same version, and `yjs`. All are pinned in the catalog. The `tiptap` skill (`ueberdosis/tiptap`) is installed, but its collaboration pages assume Tiptap's cloud. We self host with Hocuspocus (spec 0001), so follow its editor guidance and not its cloud setup.

## The editor

```ts
interface RichTextEditorProps {
  mode: 'note' | 'comment' | 'email';
  label: string;
  value?: RichTextDoc | null;  defaultValue?: RichTextDoc | null;
  onChange?(doc: RichTextDoc): void;            // debounced 300 ms; the data layer saves
  placeholder?: string;
  onSearchMentions?(query: string): Promise<ActorDisplay[]>;   // members to mention
  variables?: readonly VariableOption[];         // email only: attribute paths to insert
  collaboration?: CollabSession;                 // created by @crm/data in #27; opaque to screens
  isReadOnly?: boolean;  readOnlyReason?: string;
  error?: string;
}
```

| Mode | Tools | Extras |
|---|---|---|
| `note` | headings, bold, italic, strike, highlight, link, bullet and numbered lists, task list, quote, code block | mentions, collaboration cursors (`RemoteCursor`), comment anchors (a `commentAnchor` mark holding a thread id, for #29) |
| `comment` | bold, italic, strike, link, lists | mentions; Enter sends, Shift+Enter makes a new line |
| `email` | bold, italic, link, lists | `Variable` nodes for attribute paths, with a missing state |

- **The value**: `RichTextDoc`, a Zod schema in `@crm/contracts/values` for Tiptap's JSON.
  - Its allowed node and mark names are a constant list in contracts, since contracts can't import Tiptap. A test in `packages/ui` checks the list equals the editor schema's names.
  - Link marks must pass the same protocol rule as `safeHref()`.
  - A document is capped at 200 KB.
  - HTML for outgoing email is made from it on the server (#45), and that's why the schema itself enforces the link rule.
- **Styles**: Tiptap's injected stylesheet is turned off (`injectCSS: false`), because our CSP is `style-src 'self'`. All editor styles live in the module's CSS, on tokens.
- **Toolbar**: the format toolbar is the artifact's `FormatToolbar`, a floating bubble on selection in notes and a fixed row in email. Toggle buttons are `Button` in its pressed variant. Keyboard shortcuts are the usual ones (⌘B, ⌘I, ⌘K for a link), listed in `ShortcutHelp`.
- **Mentions**: typing `@` opens our `Menu` (async, virtualised), which calls `onSearchMentions`. A chosen member becomes a `mention` node with the member id, drawn as the `Mention` chip.
- **Pasting**: content outside the mode's schema is dropped on paste. Links go through `safeHref()` (`http`, `https`, `mailto`, `tel`, and paths on our origin), and images are dropped, since files go through #32. Nothing renders through Tiptap's `renderHTML` into the page as a string, because HTML style attributes would break `style-src 'self'`.
- **Collaboration**: `CollabSession` is `{ doc: Y.Doc, awareness: Awareness, user: { name, hue } }`. It is created by `@crm/data` in #27, together with the Hocuspocus provider that moves updates over the socket. Screens pass it through without importing `yjs` (lint allows Yjs only in `packages/ui` and `packages/data`).
  - When it's passed, history moves to Yjs (undo stays per person), and `RemoteCursor` draws others' carets and selections in their hue.
  - In #4 it is storied with two editors sharing one local `Y.Doc` and no server.

## Email bodies

`EmailBody` shows one received message:

```ts
interface EmailBodyProps {
  src: string;           // a URL on an isolated origin that serves the sanitised body (#43)
  hasRemoteImages: boolean;
  imagesShown: boolean;  onShowImages?(): void;
  height?: number;       // the frame's height; the body scrolls inside it
}
```

Raw HTML is never a public prop. Stories use a separate `EmailBodyPreview` export from a stories only file, which takes `srcDoc`. Production code can't import it (lint).

- **The frame**: an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" loading="lazy">`, with no `allow-scripts` and no `allow-same-origin`. Scripts never run, the frame can't touch the app, and links open in a new tab.
- **Images**: while `imagesShown` is false, a `Callout` above the frame offers "Show images". The image policy itself is #43's to serve: an image proxy, so senders never see the reader's address, and a body variant with images allowed.
- **Height**: a sandbox without scripts can't report its height, so the frame takes `height` (default 480px), with a "Show full message" toggle to a taller frame.
- **Why `src` and not `srcDoc` in the app**: a `srcDoc` frame inherits the app's CSP, `style-src 'self'`, which would strip every email's inline styles. So #43 must serve bodies from an isolated origin with its own policy: inline styles allowed, scripts and frames forbidden, images only through the proxy, and `frame-ancestors` set to our app only. Our CSP then adds that origin to `frame-src`. Today `frame-src` falls back to `default-src 'self'`, which blocks any outside frame.
  - Both CSP changes are #43's.
  - In #4 the component is built and storied with `EmailBodyPreview`, since Storybook isn't under the app's CSP.

## Comment threads

`CommentThread` shows one thread: the anchor's quoted passage, replies with author and relative time, a `CommentComposer` (the editor in comment mode), and Resolve or Reopen. Threads, notifications and live updates are #29's.
