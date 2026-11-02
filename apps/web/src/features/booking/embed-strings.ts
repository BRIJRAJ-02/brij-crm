/** The Embed card's words (spec 0062, L3). Every word a visitor could see is the site owner's, never ours. */
export const embedStrings = {
  title: 'Put it on your site',
  tip: 'Paste the snippet once. It keeps working when you change the page here.',
  mode: 'How it opens',
  modes: {
    inline: { name: 'In the page', description: 'Sits in your page and grows to fit.' },
    popup: { name: 'From your button', description: 'Your own button opens it.' },
    floating: { name: 'A corner button', description: 'We draw a button, bottom right.' },
  },
  panel: 'Where it opens',
  panels: { centre: 'Middle', side: 'Side panel' },
  panelHint: 'The side panel slides in from the right, and rises from the bottom on a phone.',
  words: 'Button words',
  wordsPlaceholder: 'Book a time',
  colour: 'Button colour',
  colourDefault: 'Timefix',
  icon: 'Button mark',
  icons: { none: 'No mark', calendar: 'Calendar', chat: 'Chat', mail: 'Mail' },
  snippet: 'Snippet',
  copy: 'Copy the snippet',
  liveFirst: 'Publish the page to get its snippet.',
} as const;
