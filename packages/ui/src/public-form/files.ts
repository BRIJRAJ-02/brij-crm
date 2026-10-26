// What a hosted form's file question needs from the page (#32): sending a file, taking it back, and telling the form
// a file is still going. The library sends nothing itself (it has no network calls); the page's client does.

/** A file the server kept for a visitor: the id their answer carries, and what it says about the file. */
export interface HostedUploadedFile {
  readonly fileId: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** What sending a file answered, as the page's client words it. */
export type HostedUploadOutcome =
  | { readonly kind: 'done'; readonly file: HostedUploadedFile }
  /** The server refused this file, with a sentence saying what to do. */
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'limited' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'offline' };

/** Sends one file, reporting progress from 0 to 100. Never throws. */
export type HostedUpload = (file: File, onProgress: (percent: number) => void) => Promise<HostedUploadOutcome>;

/** Takes back a file the visitor sent and no longer wants. Never throws. */
export type HostedRemoveUpload = (fileId: string) => Promise<void>;

/** What the form hands a file question: the page's two calls, and where it says a file is going. */
export interface HostedFileHandlers {
  readonly upload: HostedUpload;
  readonly remove: HostedRemoveUpload;
  /** Marks the question busy while a file goes, so the form won't send until it is in. */
  readonly setBusy: (key: string, busy: boolean) => void;
}

/** Whether a held answer is an uploaded file. */
export function isUploadedFile(value: unknown): value is HostedUploadedFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly fileId?: unknown }).fileId === 'string' &&
    typeof (value as { readonly name?: unknown }).name === 'string'
  );
}
