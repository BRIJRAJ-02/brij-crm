// The link page switcher's copy (spec 0064, AC-6413 to AC-6416): several pages, a new one, the primary one, delete.
import { LINK_PAGES_MAX } from '@crm/contracts/link-page';

export const pagesStrings = {
  /** The switcher's own name, its group's accessible name. */
  switcher: 'Your link pages',
  /** Under it, once there is more than one: which one the screen shows and edits. */
  switcherText: 'Pick a page to share or edit it. Each has its own address, look and numbers.',
  /** A page with no private name of its own goes by its address. */
  unnamed: (handle: string) => `/${handle}`,
  primary: 'Main page',
  /** The tile that opens New link page. */
  newPage: 'New link page',
  full: 'At the limit',
  fullReason: `You have ${String(LINK_PAGES_MAX)} link pages, the most you can have here.`,
  /** The menu for the page on screen. */
  options: 'Page options',
  rename: 'Rename',
  makePrimary: 'Make main page',
  remove: 'Delete page',
  /** New link page's Modal: only a handle and a name (AC-6414). */
  newTitle: 'New link page',
  newText: 'It gets its own address, look, blocks and numbers.',
  handleLabel: 'Address',
  handleMissing: 'Pick an address.',
  nameLabel: 'Name',
  nameHint: 'Only you see it, to tell your pages apart.',
  namePlaceholder: 'Side project',
  create: 'Create page',
  creating: 'Creating…',
  cancel: 'Cancel',
  createFailed: 'That page couldn’t be made. Try again.',
  /** The Ready panel after a new page (spec 0058, AC-5). */
  readyTitle: 'Your link page is ready',
  readyMessage: 'Anyone with the link can open it.',
  readyEdit: 'Add to your page',
  /** Rename's Modal. */
  renameTitle: 'Rename page',
  save: 'Save',
  /** Delete's confirm (one line, two buttons: AC-6416). */
  deleteTitle: 'Delete this link page?',
  deleteText: (address: string) =>
    `Its blocks and numbers go for good. ${address} stays yours and opens your main page.`,
  deleteAction: 'Delete page',
  deleted: 'Link page deleted.',
  madePrimary: 'This is your main page now.',
  failed: 'That didn’t work. Try again.',
  /** Home's card under the main page: the rest are on the link page screen (AC-6415). */
  morePages: (count: number) => `${String(count)} more ${count === 1 ? 'page' : 'pages'}`,
};
