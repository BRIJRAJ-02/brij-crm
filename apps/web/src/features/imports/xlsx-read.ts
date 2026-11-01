// Reading a workbook for the import page (lane wip/crm-dataio): the name and
// size are checked here, then the bytes go to a fresh worker
// (`xlsx.worker.ts`, its own chunk, loaded only when an .xlsx is chosen),
// which answers the sheet as the CSV reader's table. One worker per read,
// ended when it answers, so nothing stays running.
import { isXlsxName, XLSX_LIMITS, type XlsxResult } from '@crm/data/imports';

/** Reads `file`'s sheet `sheet` (else the first with data) off the page's thread. */
export async function readWorkbook(
  file: { readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer> },
  sheet?: number,
): Promise<XlsxResult> {
  if (!isXlsxName(file.name)) return { ok: false, reason: 'type', sheets: [], sheet: 0 };
  if (file.size > XLSX_LIMITS.bytes) {
    return { ok: false, reason: 'bytes', bytes: file.size, limit: XLSX_LIMITS.bytes, sheets: [], sheet: 0 };
  }
  const bytes = await file.arrayBuffer();
  const worker = new Worker(new URL('./xlsx.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<XlsxResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<XlsxResult>) => {
        resolve(event.data);
      };
      worker.onerror = () => {
        reject(new Error('The workbook reader stopped.'));
      };
      worker.postMessage({ bytes, ...(sheet === undefined ? {} : { sheet }) }, [bytes]);
    });
  } finally {
    worker.terminate();
  }
}
