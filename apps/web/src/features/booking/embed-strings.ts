/** The Embed card's words (spec 0062, L3). Every word a visitor could see is the site owner's, never ours. */
export const embedStrings = {
  title: 'Put it on your site',
  tip: 'Paste the snippet once. It keeps working when you change the page here.',
  mode: 'How it opens',
  modes: {
    floating: 'A corner button',
    popup: 'Your own button',
    inline: 'In the page',
  },
  modeHints: {
    floating: 'We draw a button in the bottom right corner of every page the snippet is on.',
    popup: 'Put the snippet on a button of your own, and pressing it opens the page.',
    inline: 'The page sits in your own layout and grows to fit what it shows.',
  },
  side: 'Slide in from the side',
  sideHint: 'A column against the right edge, and a sheet from the bottom on a phone.',
  words: 'Button words',
  wordsPlaceholder: 'Book a time',
  colour: 'Button colour',
  colourDefault: 'Timefix',
  icon: 'Button mark',
  icons: { none: 'No mark', calendar: 'Calendar', chat: 'Chat', mail: 'Mail' },
  snippet: 'Snippet',
  copy: 'Copy the snippet',
  liveFirst: 'Publish the page to get its snippet.',
  paste: 'Paste it once, anywhere in your page’s HTML.',
} as const;
