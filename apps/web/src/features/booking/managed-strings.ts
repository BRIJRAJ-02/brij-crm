// Words for managed booking pages (spec 0037, AC-1333 to AC-1336): the template editor, the choice in New, the
// badge a member sees on a page their workspace set, and the two opposite endings' questions. The two endings are
// the words that matter most: taking someone off deletes their page, deleting the template keeps every page, and
// each question has to say which one it is without the reader having to work it out.
import type { ManagedPart } from '@crm/data';

/** Every word this feature shows. */
export const managedStrings = {
  /** New › Who books. */
  bookManaged: 'A page each',
  managedInfo:
    'One page you set up, with a page of it for each person you pick. You choose which parts they can change.',
  addManaged: 'Add a managed page',

  /** Captures › Links. */
  group: 'Managed pages',
  groupLine: 'One page you set up, with a copy for each person on it',
  badge: 'Managed page',
  memberBadge: (count: number) => (count === 1 ? '1 person' : `${String(count)} people`),
  openTemplate: (title: string) => `Open ${title}`,
  more: (title: string) => `More for ${title}`,

  /** The editor. */
  editorTitle: 'Managed page',
  details: 'Details',
  title: 'Title',
  titlePlaceholder: 'Intro call',
  description: 'Description',
  descriptionPlaceholder: 'What this meeting is for',
  titleRequired: 'Give the page a title.',

  /** The locks. */
  locksTitle: 'What your workspace sets',
  // True of all eight, including Hours, which is a rule rather than a value copied from here.
  locksLine: 'Switched on, the workspace decides this and nobody can change it on their own page.',
  partName: {
    address: 'Web address',
    details: 'Title and description',
    durations: 'Lengths',
    location: 'Location',
    questions: 'Questions',
    on_booking: 'On booking',
    limits: 'Limits',
    hours: 'Working hours',
  } satisfies Record<ManagedPart, string>,
  partLine: {
    address: 'Each page keeps its own address, built from this one. Nobody can rename theirs.',
    details: 'The title and description everyone’s page shows.',
    durations: 'The meeting lengths everyone offers.',
    location: 'Where the meeting happens.',
    questions: 'What a visitor is asked.',
    on_booking: 'Whether a booking adds the visitor to the CRM, and where their answers go.',
    limits: 'Buffers, notice, how far ahead, the daily limit and how often a slot starts.',
    hours: 'Everyone’s page books on their own working hours, and can’t be pointed at another schedule.',
  } satisfies Record<ManagedPart, string>,

  /** The people. */
  peopleTitle: 'Who has this page',
  peopleLine:
    'Each person gets their own page, on their own hours, at their own address. Adding or taking someone off saves straight away.',
  /** Why the picker and the x wait: a page made now would be built from the settings as last saved. */
  saveFirst: 'Save your changes first.',
  addPerson: 'Add someone',
  addPlaceholder: 'Pick a teammate',
  nobodyToAdd: 'Everyone here already has this page',
  full: 'This page is set up for 200 people already',
  noPeople: 'Nobody has this page yet',
  pageAddress: (slug: string) => `/${slug}`,
  pageBeingMade: 'Page being made',

  /** Taking someone off: their page goes. */
  removePerson: (name: string) => `Take ${name} off this page`,
  removeTitle: (name: string) => `Take ${name} off this managed page?`,
  removeText: (name: string, title: string) =>
    `${name}’s ${title} page and its link are deleted. Bookings already made stay in Bookings, and ${name} is emailed.`,
  // The outcome is in the button on both endings, so neither can be read as the other out of context.
  removeAction: (name: string) => `Delete ${name}’s page`,
  removeKeep: 'Cancel',
  removed: (name: string) => `${name} is off this page, and their page is deleted.`,
  removeFailed: (name: string) => `${name} is still on this page.`,
  added: (name: string) => `${name} has their own page now, and has been emailed.`,
  addFailed: (name: string) => `${name} wasn’t added.`,

  /** Deleting the template: every page stays. The opposite of the above, and the words have to carry that. */
  endingTitle: 'Stop managing these pages',
  endingLine: 'Nobody loses a page. Each one becomes its owner’s own, to change as they like.',
  deleteTemplate: 'Stop managing these pages',
  deleteTitle: (title: string) => `Stop managing the ${title} pages?`,
  // "No page is deleted", never "nothing is deleted": the template itself does go. One line at every count.
  deleteText: (count: number) =>
    count === 0
      ? 'Nobody has a page from it, so no page is affected.'
      : count === 1
        ? 'The one page made from it keeps working and becomes its owner’s own, to change as they like. You stop setting it from here.'
        : `All ${String(count)} pages made from it keep working and become their owners’ own, to change as they like. You stop setting them from here.`,
  deleteAction: 'Stop managing, keep the pages',
  deleteKeep: 'Cancel',
  deleted: (title: string) => `${title} is no longer managed. Everyone’s own page is untouched.`,
  deleteFailed: (title: string) => `${title} is still managed.`,

  /** Saving the template. */
  save: 'Save',
  saving: 'Saving…',
  savedOne: 'Saved.',
  savedMany: (count: number) =>
    count === 1
      ? 'Saved, and the one page made from this was updated too.'
      : `Saved, and all ${String(count)} pages made from this were updated too.`,
  saveFailed: 'Nothing was saved.',

  /** What a member sees on a page their workspace set. */
  fromTemplate: 'Set by your workspace',

  /** Loading and failure. */
  failed: 'That managed page couldn’t be loaded.',
  notFound: 'That managed page doesn’t exist any more.',
  refused: 'Something went wrong.',
} as const;
