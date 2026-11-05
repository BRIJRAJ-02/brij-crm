/** The Embed card's words (spec 0062, L3). Every word a visitor could see is the site owner's, never ours. */
export const embedStrings = {
  title: 'Put it on your site',
  tip: 'Paste the snippet once. It keeps working when you change the page here.',
  mode: 'How it opens',
  /** The three ways, named and described as a form's Share tab names them (the same card, 5 November 2026). */
  modes: {
    inline: 'In the page',
    popup: 'Popup',
    floating: 'Corner button',
  },
  modeHints: {
    inline: 'Sits in your page.',
    popup: 'A button in your page opens it.',
    floating: 'A button in the corner opens it.',
  },
  side: 'Slide in from the side',
  sideHint: 'A column on the right, a sheet on a phone.',
  words: 'Button words',
  wordsPlaceholder: 'Book a time',
  colour: 'Button colour',
  colourDefault: 'Timefix',
  icon: 'Button mark',
  icons: { none: 'None', calendar: 'Calendar', chat: 'Chat', mail: 'Mail' },
  preview: 'How the booking page sits on your site',
  snippet: 'Embed snippet',
  copy: 'Copy snippet',
  liveFirst: 'Publish the page to get its snippet.',
} as const;
