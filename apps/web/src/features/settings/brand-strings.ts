/** Settings › Workspace › Brand's copy (spec 0060, AC-1 to AC-3). */
export const strings = {
  /** The workspace's template (spec 0068, AC-6804). */
  template: 'Template',
  /** A template picked and not published yet (spec 0068). */
  templatePublishNote: 'Publishing changes every public page: booking pages, forms and link pages.',
  templateChange: (from: string, to: string) => `Template ${from} → ${to}`,
  templateClassic: 'Classic',
  templateStudio: 'Studio',
  templateNight: 'Night',
  templateSplit: 'Split',
  title: 'Brand',
  /** The settings navigation's entry. */
  navLabel: 'Brand',
  /** Said once to a member who may read the kit but not change it. */
  readOnly: 'Only owners and admins change the brand.',
  logo: 'Logo',
  logoDrop: 'Add your logo',
  logoReplace: 'Replace logo',
  logoAlt: 'Your logo',
  /** The types the logo takes, as people name them, in the picker's hint. */
  logoTypes: 'PNG, JPG or WebP',
  /** A member's view of a kit with no logo. */
  noLogo: 'No logo',
  logoRemove: 'Remove logo',
  logoRemoving: 'Remove the logo?',
  logoRemoveText: 'Booking pages and forms show no logo, and the sidebar and tab go back to Timefix’s mark.',
  logoUnreadable: 'That picture couldn’t be read. Try a PNG, JPEG or WebP.',
  colour: 'Colour',
  /** The default the kit's colour falls back to: the product's own accent. */
  colourDefault: 'Timefix',
  colourMore: 'Dark colour',
  colourDarkDefault: 'Automatic',
  cancel: 'Cancel',
  failed: 'The brand kit couldn’t be read.',
  retry: 'Try again',
  /** The preview's switch, and its two pages. */
  preview: 'Preview',
  previewBooking: 'Booking page',
  previewForm: 'Form',
  /** The sample booking page the preview draws. */
  sampleHost: 'Your team',
  sampleMeeting: 'Intro call',
  sampleLength: '30 min',
  sampleChooseTime: 'Choose a time',
  /** The sample form the preview draws. */
  sampleHeadline: 'Tell us about your project',
  sampleName: 'Your name',
  sampleEmail: 'Email',
  sampleSend: 'Send',
} as const;
