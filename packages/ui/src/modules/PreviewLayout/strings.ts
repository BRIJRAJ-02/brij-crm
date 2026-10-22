/** PreviewLayout's built in copy. */
export const strings = {
  preview: 'Preview',
  /** The phone's screen, when a long preview scrolls in it. */
  phone: 'Phone preview',
  previewOf: (title: string) => `Preview of ${title}`,
  /** EditorStatus's word on a phone's bar, in place of its full words. */
  shortStatus: { live: 'Live', changed: 'Edited', draft: 'Draft', paused: 'Paused' },
} as const;
