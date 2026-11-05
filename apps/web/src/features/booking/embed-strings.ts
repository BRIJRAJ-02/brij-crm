/**
 * The Embed card's words (spec 0062, L3). Every word a visitor could see is the site owner's, never ours. The three
 * ways' names and lines are the form's (`EMBED_TILES`), so the two cards say them the same.
 */
export const embedStrings = {
  title: 'Put it on your site',
  tip: 'Paste the snippet once. It keeps working when you change the page here.',
  mode: 'How it opens',
  side: 'Slide in from the side',
  sideHint: 'A column on the right, a sheet on a phone.',
  words: 'Button words',
  wordsPlaceholder: 'Book a time',
  colour: 'Button colour',
  colourDefault: 'Timefix',
  icon: 'Button icon',
  icons: { none: 'None', calendar: 'Calendar', chat: 'Chat', mail: 'Mail' },
  preview: 'How the booking page sits on your site',
  snippet: 'Embed snippet',
  copy: 'Copy snippet',
  liveFirst: 'Publish the page to get its snippet.',
} as const;
