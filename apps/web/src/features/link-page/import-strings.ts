// Bringing a link in bio page across (spec 0055, AC-5524 to AC-5528): the modal's copy.

/** How many, written out for a sentence rather than a figure on its own. */
const count = (made: number, one: string, many: string) => (made === 1 ? one : many.replace('{n}', String(made)));

export const importStrings = {
  title: 'Bring a page across',
  address: 'Your page’s address',
  example: 'linktr.ee/yourname',
  /** The seven services in one hint line (spec 0058, AC-16). */
  services: 'Linktree, Beacons, Bio.link, Lnk.Bio, Linktw.in, Liinks or Solo.to.',
  cancel: 'Cancel',
  bring: 'Bring links across',
  done: 'Done',
  doneTitle: 'What came across',
  madeLine: (made: number) => count(made, 'One link came across', '{n} links came across'),
  /** Under the count: the rows landed archived, so the page is unchanged until they are turned on. */
  hiddenNote: 'They wait in Archived until you restore them.',
  alreadyDone: 'You’ve brought this page across already, so nothing was added again.',
  nothingTitle: 'No links on that page',
  nothingText: 'Nothing found. Is the page public?',
  skippedLine: (skipped: number) => count(skipped, 'One row didn’t come across:', '{n} rows didn’t come across:'),
  unnamed: 'A row with no title',
  /** Why a row stayed behind, in the person's words rather than the parser's. */
  reasons: {
    'no-address': 'it goes nowhere we could follow',
    'not-web': 'it isn’t a web address',
    'the-page-itself': 'it points back at that page',
    repeated: 'it’s the same link twice',
    'past-limit': 'your page is full',
    'no-title': 'it had no words to use as a title',
    'not-in-workspace': 'it’s a page of another workspace',
  },
} as const;
