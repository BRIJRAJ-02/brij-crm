/** PreviewLayout's built in copy. */
export const strings = {
  preview: 'Preview',
  /** The narrow layout's button that opens the preview sheet: apart from an editor's own Preview, which opens a tab. */
  showPreview: 'Show preview',
  /** The phone's screen, when a long preview scrolls in it. */
  phone: 'Phone preview',
  previewOf: (title: string) => `Preview of ${title}`,
  /** EditorStatus's word on a phone's bar, in place of its full words. */
  shortStatus: { live: 'Live', changed: 'Edited', draft: 'Draft', paused: 'Paused' },
} as const;
