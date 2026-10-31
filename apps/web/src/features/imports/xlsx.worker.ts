// The Excel reader's worker (lane wip/crm-dataio): a workbook is unzipped and
// its sheet scanned here, off the page's thread, so a big file never freezes
// the import page. It gets the file's bytes (transferred) and the sheet asked
// for, and answers the reader's result; it keeps nothing between messages.
import { readXlsx, type XlsxResult } from '@crm/data/imports';

/** What the page sends: the workbook's bytes, and the sheet to read (else the first with data). */
interface ReadMessage {
  readonly bytes: ArrayBuffer;
  readonly sheet?: number;
}

/** The worker's own scope, typed by hand: the app's TypeScript library is the page's (DOM), not the worker's. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReadMessage>) => void) | null;
  postMessage: (message: XlsxResult) => void;
};

scope.onmessage = (event) => {
  const { bytes, sheet } = event.data;
  try {
    scope.postMessage(readXlsx(new Uint8Array(bytes), sheet));
  } catch {
    scope.postMessage({ ok: false, reason: 'broken', sheets: [], sheet: 0 });
  }
};
