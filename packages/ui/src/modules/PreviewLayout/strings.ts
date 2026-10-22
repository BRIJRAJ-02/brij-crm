/** PreviewLayout's built in copy. */
export const strings = {
  preview: 'Preview',
  showPreview: 'Show preview',
  width: 'Preview width',
  phone: 'Phone',
  tablet: 'Tablet',
  desktop: 'Desktop',
  previewOf: (title: string) => `Preview of ${title}`,
  /** EditorStatus's word on a phone's bar, in place of its full words. */
  shortStatus: { live: 'Live', changed: 'Changed', draft: 'Draft', paused: 'Paused' },
} as const;
