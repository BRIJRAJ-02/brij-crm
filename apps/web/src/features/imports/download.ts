// Saving a CSV the page wrote (spec 0040): the rows with errors, the refused
// rows. The text never leaves the browser.

/** Hands the browser a CSV to save as `fileName`. */
export function saveCsv(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // The click starts the save at once; the address is let go after it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
