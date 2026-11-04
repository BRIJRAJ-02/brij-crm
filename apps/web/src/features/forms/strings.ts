// Every word the forms screens show (spec 0023, 0023-experience.md), in one place.
import type { FormStatus, SubmissionState } from '@crm/data';
import { strings as questionStrings } from '../questions/strings.ts';

const count = (n: number, one: string, many: string) => `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`;

export const strings = {
  forms: 'Forms',
  formsDescription:
    'A form collects submissions from a link, your site or your own form, and can add each one to your CRM.',
  /** The create button's name; it reads `newButton`, the same word as Links', so switching tabs moves nothing. */
  newForm: 'New form',
  newButton: 'New',
  noForms: 'No forms yet',
  noFormsText: 'Share a form by link or on your site.',
  failedTitle: 'Forms didn’t load',
  failedText: 'Something went wrong. Try again.',
  formFailedTitle: 'This form didn’t load',
  missingTitle: 'Form not found',
  missingText: 'This form doesn’t exist, or it was deleted.',
  backToForms: 'Back to forms',

  // The list (Captures › Forms draws the same rows as Links)
  copying: 'Copying',
  moreFor: (name: string) => `More for ${name}`,
  /** Open's tooltip on a form's card. */
  openInNewTab: 'Open in a new tab',
  manageOnly: 'Only members who manage forms can change it',
  createFailed: 'Couldn’t make the form.',

  // The template gallery (spec 0063, AC-6323): New form opens it, and each tile makes a draft at once.
  galleryTitle: 'Start a form',
  /** Said in the title bar, and announced politely, while a template is being turned into a draft. */
  galleryMakingOne: (name: string) => `Making your ${name}…`,
  /** What the blank template is called in that line, when the tiles never loaded and only Blank is reachable. */
  galleryBlankName: 'blank form',
  galleryFailedTitle: 'The templates didn’t load',
  /** Read by screen readers while the tiles are on their way; the tile and lines only show after the loading delay. */
  galleryLoading: 'Loading templates',
  /** The way forward when there are no tiles to press: a failed read, or no templates at all. */
  galleryBlank: 'Make a blank form',
  galleryEmpty: 'No templates',
  galleryEmptyText: 'Make a form from scratch instead.',
  turnOnFailed: (name: string) => `Couldn’t resume ${name}. It’s still paused.`,
  turnOffFailed: (name: string) => `Couldn’t pause ${name}. It’s still live.`,
  duplicateFailed: (name: string) => `Couldn’t duplicate ${name}.`,
  submissionCount: (n: number) => count(n, 'submission', 'submissions'),
  noSubmissionsYet: 'No submissions yet',
  /** A draft card's one action: back into its builder to finish it and publish. */
  editDraft: 'Edit',
  /** Its accessible name: which draft it opens, the visible word first. */
  editFormOf: (name: string) => `Edit ${name}`,
  openForm: (name: string) => `Open ${name} in a new tab`,
  searchForms: 'Search forms',
  addressPending: '/f/…',
  thisMonth: (n: number) => `${count(n, 'submission', 'submissions')} this month`,
  spam: (n: number) => `${new Intl.NumberFormat().format(n)} spam`,
  accepting: 'Live',
  notAccepting: 'Paused',
  notPublishedYet: 'Not published',
  /** Why Copy link is off on a form never published. */
  acceptingOf: (name: string) => `${name} is live`,
  formActions: (name: string) => `Actions for ${name}`,
  open: 'Open',
  duplicate: 'Duplicate',
  duplicated: (name: string) => `Made “${name}”.`,
  delete: 'Delete',
  deleteForm: 'Delete form',
  /** A destructive confirm names the thing in its question (the owner's rule, 21 October 2026). */
  deleteTitle: (name: string) => `Delete “${name}”?`,
  /** One line under the question (spec 0058, AC-18): what goes, and what stays. */
  deleteText: (submissions: number) =>
    submissions === 0
      ? 'The form and its link are gone for good.'
      : `Its ${count(submissions, 'submission is', 'submissions are')} gone for good; records stay.`,
  /** The confirm's commit: the verb last, never OK. */
  deleteFormAction: 'Delete form',
  deleted: (name: string) => `Deleted “${name}”.`,
  cancel: 'Cancel',

  // The editor
  untitledForm: 'Untitled form',
  previewOpen: 'Preview',
  previewNotLive: 'Preview, not live. Answers are checked here, and nothing is sent.',
  publish: 'Publish',
  /** The ⋯ menu's way back to the live form, and its confirm (it loses work, so it asks first). */
  discardChanges: 'Discard changes',
  discardTitle: 'Discard your changes?',
  discardText: 'The form goes back to what is live now. Your edits since the last publish are lost.',
  discarded: 'Changes discarded.',
  publishing: 'Publishing',
  moreActions: 'More actions',
  pause: 'Pause',
  resume: 'Resume',
  statusLive: 'Live',
  statusChanged: 'Live · edited',
  statusDraft: 'Draft',
  statusPaused: 'Paused',
  tabs: 'Form sections',
  tabForm: 'Form',
  tabSettings: 'Settings',
  tabInstall: 'Install',
  tabSubmissions: 'Submissions',
  tabAnalytics: 'Analytics',
  published: 'Published.',
  madeUnique: (field: string, objectName: string) => `${field} is now unique on ${objectName}: one record per email.`,
  viewField: 'View field',
  /** The first publish's one line on the match (spec 0058, AC-13), said before Publish makes it so. */
  willMakeUnique: (field: string, objectName: string) =>
    `${field} becomes unique on ${objectName}: one record per email.`,
  changedBy: (name: string) => `${name} changed this form.`,
  someoneChanged: 'Someone else changed this form.',
  loadTheirs: 'Load their version',
  saveFailed: 'Your last change didn’t save. Check your connection; it saves again as you go on.',
  saveRefused: (why: string) => `Your last change didn’t save. ${why}`,
  redirectIncomplete: 'Give a full address, like https://example.com.',
  buttonTextMissing: 'Give the button some text.',
  /** Publish refused while a Settings field is incomplete: which card, then what it needs. */
  publishGap: (what: string) => `After sending needs a web address. ${what}`,
  publishGapButton: (what: string) => `Text needs the button’s words. ${what}`,
  // Prefill (spec 0063, AC-6309)
  prefillTitle: 'Prefill link',
  prefillTip:
    'Add ?key=value to the link to fill a question before the visitor opens it, or to set a hidden one. Repeat a key for several picks.',
  prefillExample: 'Example',
  copyPrefill: 'Copy prefill link',
  prefillKeys: 'Question keys',
  prefillQuestion: 'Question',
  prefillKey: 'Key',
  // Layout (spec 0063)
  layoutTitle: 'Layout',
  layoutClassic: 'Classic',
  layoutSteps: 'Steps',
  layoutOneAtATime: 'One at a time',
  colour: 'Colour',
  light: 'Light',
  dark: 'Dark',
  corners: 'Corners',
  rounded: 'Rounded',
  square: 'Square',
  /** The look's third axis (spec 0063, AC-6327): the workspace's brand kit, or the product's own colours. */
  theme: 'Colours',
  themeBrand: 'Brand colours',
  themePlain: 'Plain colours',
  /** Said under Brand colours while the workspace has neither a colour nor a logo saved. */
  themeBrandEmpty: 'Add your logo and colour in Settings › Brand.',
  /** The workspace logo over the form reads as nothing: the headline beside it already names the form. */
  brandLogoAlt: '',

  // Questions: the shared editor's words (`features/questions/strings.ts`), and the form's own
  ...questionStrings,
  emailStays: 'The form matches records by this email.',
  /** Publish couldn't make the email the match: two records on the object already share one (27 October 2026). */
  matchHasDuplicates: (objectName: string) => `Duplicate emails on ${objectName}. Fix them, then publish.`,

  // First publish (spec 0058, AC-13): one step, then the Ready panel (AC-6)
  publishTitle: 'Publish your form',
  liveTitle: 'Your form is live',
  name: 'Name',
  /** An example of a name, never the name an unnamed form gets: Publish refuses a blank one. */
  namePlaceholder: 'Contact us',
  address: 'Link',
  addressTaken: 'That link is taken',
  addressInvalid: 'The link needs 2 to 40 lowercase letters, numbers or hyphens.',
  done: 'Done',
  noCrm: 'Don’t add to the CRM',
  /** The Save to list's way to make an object out of the form, one field per question, made as Publish starts. */
  buildObjectItem: (name: string) => `New object “${name}”`,
  buildObjectText: (fields: number) => `${count(fields, 'field', 'fields')} from its questions`,
  /** Each mapping row's Select, named by its question for screen readers. */
  savedAsOf: (question: string) => `${question}, saved as`,
  /** A field Publish will make for the question. */
  newField: 'New',
  /** A question kept off the CRM, with the submission only. */
  submissionOnly: 'Submission only',
  embedTiles: 'Put it on your site',
  ownFormThanks: 'Thanks, we got it.',

  // Settings tab
  nameRequired: 'Give the form a name.',
  addressChanged: 'Link changed. Old links still open the form.',
  headline: 'Headline',
  headlineDefault: 'Fill this in and we will come back to you',
  subheadingOptional: 'Subheading',
  addressChangeWarning: 'Links with the old address keep working.',
  buttonText: 'Button text',
  wordsTitle: 'Text',
  afterTitle: 'After sending',
  afterChoice: 'What they see next',
  showMessage: 'Message',
  sendToAddress: 'Web page',
  thankYou: 'Thank you message',
  thankYouDefault: 'Thank you. We will come back to you at the address you gave.',
  redirectUrl: 'Web address',
  redirectHint: 'Starts with https://',
  // Book a meeting after sending (AC-1055 to AC-1059)
  bookMeeting: 'Booking',
  bookingPage: 'Booking page',
  pickBookingPage: 'Pick a booking page',
  pageItem: (title: string, minutes: number) => `${title} · ${String(minutes)} min`,
  pageNotUsable: 'Paused, or not yours to use: pick another',
  pagePausedTitle: (title: string) => `${title} is paused`,
  pagePaused: (when: { readonly hostLeft: boolean; readonly canResume: boolean; readonly canPick: boolean }) =>
    [
      when.hostLeft
        ? 'Its last host left the workspace, so visitors see your message instead of booking a meeting.'
        : 'Visitors see your message instead of booking a meeting.',
      when.canResume ? (when.hostLeft ? 'Give it a host, then resume it' : 'Resume it') : 'Ask its owner to resume it',
    ].join(' ') + (when.canPick ? ', or pick another page.' : '.'),
  pageGoneTitle: 'Its booking page was deleted',
  pageGone: (canPick: boolean) =>
    `Visitors see your message instead of booking a meeting.${canPick ? ' Pick another page.' : ''}`,
  afterPagePausedTitle: (title: string) => `Visitors can’t book: ${title} is paused`,
  afterPageGoneTitle: 'Visitors can’t book: the booking page was deleted',
  afterPageText: 'They see the form’s message instead of booking a meeting.',
  afterPageFix: 'Change where it sends',
  openPage: 'Open page',
  noBookingPages: 'No live booking pages',
  keepsMessage: 'Visitors see your message until then.',
  keepsWebPage: 'Visitors go to your web page until then.',
  bookingPagesFailed: 'Your booking pages didn’t load',
  createBookingPage: 'Create a booking page',
  countdown: 'Countdown',
  countdownAtOnce: 'At once',
  countdownAfter: (seconds: number) => `After ${String(seconds)} seconds`,
  crmTitle: 'CRM',
  addToCrmSwitch: 'Add each submission to the CRM',
  addToCrmOn: (object: string, match: string | undefined) =>
    match === undefined ? `Adds a ${object}.` : `Adds or updates a ${object}, matched by ${match}.`,
  whichObject: 'Save to',
  mappingLabel: 'Where each answer is saved',
  /** The table's own name for screen readers: its section's heading already says what the section is for. */
  mappingTable: 'Questions and their fields',
  mappingQuestion: 'Question',
  mappingSavedAs: 'Saved as',
  retargetFailed: 'That didn’t change where submissions go.',
  retargetTitle: (to: string) => `Save answers to ${to}?`,
  retargetOffTitle: 'Stop saving answers to the CRM?',
  /**
   * What the change does to the questions saved now, named (forms fix a2, 5 November 2026): they are remembered, so
   * switching back saves them where they were.
   */
  retargetText: (questions: string, from: string) =>
    `${questions} stop saving to ${from}. Switching back restores them.`,
  retargetDone: (to: string) => `Answers now save to ${to}.`,
  retargetOffDone: 'Answers now stay in Submissions.',
  /** Email them a copy (forms fix b1): the visitor's own copy of what they sent. */
  copyRow: 'Email them a copy',
  copyHelp: 'Each person gets a copy of their answers at the email they gave. Replies come to the form’s owner.',
  copyNeedsEmail: 'Add an email question first, so there is somewhere to send it.',
  copySubject: 'Subject',
  copySubjectDefault: 'We got your message',
  copyLine: 'Message',
  copyLineDefault: 'Thanks, we got it. We will come back to you soon.',
  /** Closes (forms fix b2): when the form stops taking answers by itself, and what it says then. */
  closesRow: 'Closes',
  closesHelp: 'Stop taking answers on a day, or after enough have come in. Pause stops it now. Goes live with Publish.',
  closesNever: 'Never',
  closesOnDate: 'On a date',
  closesAfterCount: 'After a number of answers',
  closesDay: 'Last day',
  closesCount: 'Number of answers',
  closedMessageRow: 'Message when closed',
  closedMessageDefault: 'This form isn’t taking answers right now.',
  /** Also create a deal (forms fix a3): a switch under Save answers to, People only. */
  alsoDeal: 'Also create a deal',
  alsoDealTip: 'Each submission also adds a deal, linked to the person and their company. Goes live with Publish.',
  thisObject: 'this object',
  savingWaits: (objectName: string) =>
    `Changes here go live when you publish. Until then, submissions are still saved to ${objectName}.`,
  savingWaitsKeptOnly:
    'Changes here go live when you publish. Until then, submissions are still kept with the form only.',
  retargetAction: (to: string) => `Save to ${to}`,
  retargetOffAction: 'Stop saving',
  filedOn: (object: string, attribute: string) => `${object} › ${attribute}`,
  keptOnly: 'Kept with the submission only',
  owner: 'Owner',
  ownerHint: 'For new records only.',
  /** The owner the form names, who has left the workspace (late trap #88). */
  ownerFormer: 'Former member',
  ownerLeftHint: 'They’ve left the workspace, so new records get no owner. Pick another.',
  nobody: 'Nobody',
  // A round robin group as the owner (spec 0029 milestone 3): in code a rotation, on screen a round robin group.
  ownerGroups: 'Round robin',
  /** A group's line in the list: who in it takes new records now. */
  groupTakers: (on: number) => (on === 0 ? 'Nobody switched on' : on === 1 ? '1 teammate' : `${String(on)} teammates`),
  groupHint: (name: string) => `Each new record goes to the next teammate in ${name}.`,
  groupNobodyOn: (name: string) => `Nobody in ${name} is switched on, so new records get no owner.`,
  /** The group the form names, while the list loads or when the reader can't list it. */
  groupUnknown: 'Round robin group',
  /** A group the form names that the reader can't list: it still hands out new records. */
  groupHidden: 'New records go to a round robin group you can’t see.',
  groupsFailed: 'Your round robin groups didn’t load.',
  // Who hears of each new submission (AC-568, AC-1047): the lead's owner always, and the people listed here.
  noticesTitle: 'Submission emails',
  noticesLabel: 'Email each new submission to',
  noticesNobody: 'Nobody else',
  noticesHint: (ownerIsTold: boolean) =>
    ownerIsTold
      ? 'The new record’s owner is emailed too. People who can’t see submissions aren’t emailed, and each email leaves out answers that person can’t see.'
      : 'People who can’t see submissions aren’t emailed, and each email leaves out answers that person can’t see.',
  /** A teammate not chosen once 20 are. */
  noticesFull: 'Up to 20 people',
  noticesSearch: 'Search teammates',
  /** The people the form lists whom the reader can't list (the server already drops those who left). */
  noticesOthers: (count: number) => (count === 1 ? '1 other person' : `${String(count)} other people`),
  noticesOthersHint: 'People you can’t see in this workspace',
  spamTitle: 'Spam',
  spamSummary: 'On. Doubtful sends wait for review.',
  detailsTitle: 'Details',
  spamReview: 'Review',
  settingsFailed: 'That didn’t save.',

  // Install tab
  readOnlyTitle: 'You can view this form',
  readOnlyText: 'Only people who manage forms can change it.',
  shareTitle: 'Share',
  shareTip: 'Opens the form on its own page.',
  link: 'Link',
  copy: 'Copy',
  copyLink: 'Copy link',
  openLink: 'Open',
  copyEmbed: 'Copy snippet',
  copyFormHtml: 'Copy form HTML',
  copySecret: 'Copy signing secret',
  websiteTitle: 'Put it on your site',
  websiteTip: 'Paste it where the form should show. One script tag serves every form.',
  embedMode: 'How it shows',
  embedInline: 'In the page',
  embedPopup: 'Popup',
  embedFloating: 'Corner button',
  /** Each embed tile's tooltip (spec 0058, AC-11): what the visitor sees. */
  embedInlineHint: 'Sits in your page and grows with the form.',
  embedPopupHint: 'Your own button opens it in a dialog.',
  embedFloatingHint: 'A button in the corner of every page opens it.',
  /** Under the corner button's snippet: the one thing a site may want to change. */
  embedFloatingWords: 'Change its words in data-timefix-text.',
  /** The words on the popup's and the corner's button, until the site changes them. */
  embedButtonText: 'Contact us',
  /** Spec 0063 s5 / 0062 L3 (the owner, 2 November 2026): a form that books afterwards needs no second snippet. */
  embedBooks: 'After it’s sent, this form opens your booking page. One snippet covers both steps.',
  embedCouldBook: 'A form can open a booking page once it’s sent, so one snippet asks and books.',
  embedCouldBookLink: 'Set what happens after it’s sent',
  embedSnippet: 'Embed snippet',
  advancedTitle: 'For developers',
  ownFormTitle: 'Your own HTML',
  ownFormSnippet: 'Form HTML',
  taggingText:
    'Each field’s name is its question’s key, so a rename never breaks your page. Each post adds the page, referrer and UTM tags.',
  /** The consent line, with its code names drawn by `code` so they read and copy exactly. */
  taggingConsent: <T>(code: (text: string) => T): readonly (string | T)[] => [
    'No cookie is set until your site allows it: add ',
    code('data-timefix-consent="granted"'),
    ' to the script tag, or call ',
    code('Timefix.consent(true)'),
    ' from your cookie banner. Then a first party ',
    code('tfx_vid'),
    ' cookie links one visitor’s submissions.',
  ],
  ownFormChooseOne: 'Choose one',
  ownFormTrapNote: 'Leave this hidden field in place: it keeps bots out.',
  ownFormTrapLabel: 'Leave this empty',
  ownFormNoFiles: (label: string) => `${label}: file questions work on the hosted form only.`,
  ownFormHostedOnly: (label: string) => `${label}: this question works on the hosted form only.`,
  copied: 'Copied.',
  sitesTitle: 'Allowed sites',
  sitesTip: 'Your own HTML only posts from these addresses. Embeds and the hosted page work on any site.',
  sitesEmpty: 'None yet, so your own HTML can’t post.',
  siteNew: 'Site address',
  siteNewPlaceholder: 'https://acme.com',
  siteAdd: 'Add site',
  siteRemove: (origin: string) => `Remove ${origin}`,
  siteRemoveTitle: (origin: string) => `Remove ${origin}?`,
  siteRemoveText: 'Your own HTML there stops posting at once. Embeds keep working.',
  siteRemoveAction: 'Remove site',
  siteNotHttps: 'Use the site’s https address, such as https://acme.com.',
  siteTaken: 'That site is in the list already.',
  sitesFull: 'A form lists at most 20 sites.',
  sitesSaved: 'Sites saved.',
  unsignedRefused: 'Unsigned posts are refused now.',
  unsignedAllowed: 'Unsigned posts are taken again.',
  refuseUnsigned: 'Refuse unsigned posts',
  signedTitle: 'Signed posts',
  refuseUnsignedHint: 'For forms only your server posts to. The hosted page and embeds keep working.',
  /** How to sign, with its code names drawn by `code`. */
  signHowText: <T>(code: (text: string) => T): readonly (string | T)[] => [
    'On your server, take the exact body you send, make its HMAC with SHA 256 and the signing secret, and send it in the ',
    code('x-crm-signature'),
    ' header as ',
    code('sha256='),
    ' and the hex digest.',
  ],
  secret: 'Signing secret',
  secretReason: 'Keep it on your server. Anyone with it can post as you.',
  secretReveal: 'Reveal',
  secretHide: 'Hide',
  secretRotate: 'Rotate secret',
  secretRotateTitle: 'Rotate the signing secret?',
  secretRotateText: 'The old secret stops working at once.',
  secretRotateAction: 'Rotate secret',
  secretRotated: 'New signing secret made. Update your server.',
  pausedTitle: 'This form is paused',
  pausedText: 'The link shows a closed notice until you turn it back on.',
  notLiveYet: 'Publish the form first.',

  // Submissions tab
  allStates: 'All submissions',
  filterStates: 'State',
  filterLabel: 'Filter submissions',
  noSubmissions: 'No submissions yet',
  noneIn: {
    received: 'Nothing waiting.',
    processing: 'Nothing in progress.',
    processed: 'Nothing added yet.',
    spam: 'No spam. Anything that looks like it lands here.',
    held: 'Nothing held.',
    needs_review: 'Nothing needs a look.',
    failed: 'Nothing failed.',
  },
  when: 'When',
  person: 'Person',
  email: 'Email',
  state: 'State',
  answers: 'Answers',
  states: {
    received: 'Processing',
    processing: 'Processing',
    processed: 'Added',
    spam: 'Spam',
    held: 'Held',
    needs_review: 'Needs review',
    failed: 'Failed',
  } satisfies Record<SubmissionState, string>,
  /** A processed submission that has no record: one Add to CRM can file, or one a form that files nothing kept. */
  stateNotInCrm: 'Not in CRM',
  stateKept: 'Received',
  submission: 'Submission',
  cameFrom: 'Where it came from',
  cameFromPage: 'Page',
  cameFromHome: 'Home page',
  cameFromTitle: 'Page title',
  cameFromLanding: 'First page of the visit',
  cameFromReferrer: 'Referrer',
  cameFromHow: 'Sent from',
  cameFromMode: {
    page: 'The form’s own page',
    inline: 'An embed in the page',
    popup: 'An embed’s popup',
    floating: 'An embed’s corner button',
    own: 'The site’s own HTML',
  } as const,
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  utmTerm: 'UTM term',
  utmContent: 'UTM content',
  records: 'Records',
  recordAction: { created: 'Created', updated: 'Updated', matched: 'Matched', linked: 'Linked' },
  release: 'Not spam',
  markSpam: 'Mark as spam',
  notSpam: 'Not spam',
  moreSubmissionActions: 'More submission actions',
  exportCsv: 'Export as CSV',
  exportButton: 'Export CSV',
  exportFilter: 'What this filter shows, every answer as a column',
  exportShown: 'What the table shows for this search, every answer as a column',
  exportPicked: (n: number) => `The ${count(n, 'picked submission', 'picked submissions')}, every answer as a column`,
  exportStarted: 'Preparing your CSV…',
  exportReady: (file: string) => `${file} is ready.`,
  download: 'Download',
  addToCrm: 'Add to CRM',
  addQueued: (queued: number, skipped: number) =>
    skipped === 0
      ? `Adding ${count(queued, 'submission', 'submissions')} to the CRM.`
      : `Adding ${count(queued, 'submission', 'submissions')} to the CRM. ${String(skipped)} skipped.`,
  nothingToAdd: 'Nothing to add: these are already in the CRM or held.',
  /** Asks before many submissions go to the CRM at once: "Add 12 submissions to the CRM?". */
  addManyTitle: (n: number, max: number) => `Add ${count(Math.min(n, max), 'submission', 'submissions')} to the CRM?`,
  addManyText: (n: number, max: number) =>
    n > max
      ? `Adds ${String(max)} now, the way the form files. Run it again for the rest.`
      : 'Each is added the way the form saves now.',
  addDone: (done: number, refused: number) =>
    refused === 0
      ? `${count(done, 'submission', 'submissions')} added to the CRM.`
      : `${count(done, 'submission', 'submissions')} added, ${String(refused)} failed.`,
  jobFailed: (label: string) => `${label} didn’t finish. See why in Settings › Background jobs.`,
  syncOld: 'Sync earlier submissions',
  syncOldText: 'Save earlier submissions the way the form saves now',
  syncStarted: 'Syncing earlier submissions. You can keep working.',
  syncDone: (done: number, refused: number) =>
    refused === 0
      ? `${count(done, 'submission', 'submissions')} synced.`
      : `${count(done, 'submission', 'submissions')} synced; ${String(refused)} couldn’t be.`,
  // Sync earlier submissions (spec 0058, AC-14): one line, the scope, the counts, one button
  syncTitle: 'Sync earlier submissions?',
  syncTextPublished: 'Save earlier submissions the new way too.',
  syncTextMenu: 'Save earlier submissions the way the form saves now.',
  syncTextConnected: 'Add earlier submissions to the CRM too.',
  syncNothing: 'Nothing to sync',
  syncNothingText: 'Every earlier submission already follows the form.',
  syncFailuresText: 'Any that can’t be synced stay as they are.',
  syncScope: 'Which submissions',
  syncUnfiled: 'Only unsaved',
  syncAll: 'All',
  /** The count preview's name for screen readers. */
  syncPreview: 'What syncing would do',
  /**
   * The one count line (spec 0058, AC-14): what the sync would do, each part only when it isn't none, so a count
   * never sits beside the button's own number as a puzzle ("Unchanged 2" by "Sync 2 submissions").
   */
  syncSummary: (counts: {
    readonly creates: number;
    readonly updates: number;
    readonly unchanged: number;
    readonly failures: number;
  }) => {
    const parts = [
      counts.creates > 0 ? count(counts.creates, 'new record', 'new records') : undefined,
      counts.updates > 0 ? count(counts.updates, 'record updated', 'records updated') : undefined,
      counts.unchanged > 0 ? count(counts.unchanged, 'already matches', 'already match') : undefined,
      counts.failures > 0 ? `${new Intl.NumberFormat().format(counts.failures)} can’t be synced` : undefined,
    ].filter((part) => part !== undefined);
    const line = new Intl.ListFormat('en', { type: 'conjunction' }).format(parts);
    return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
  },
  /** Every submission in scope already matches: said once, with no Sync beside it ("All 2 already match."). */
  syncAllMatch: (n: number) =>
    n === 1 ? 'It already matches.' : `All ${new Intl.NumberFormat().format(n)} already match.`,
  syncCapped: (checked: number) => `Counts cover the newest ${new Intl.NumberFormat().format(checked)}.`,
  /** The one button, with the count it starts on: "Sync 42 submissions". */
  syncStart: (total: number) => `Sync ${count(total, 'submission', 'submissions')}`,
  /** The button before the count is known (loading, or the preview failed). */
  syncStartPlain: 'Sync',
  syncStarting: 'Starting',
  notNow: 'Not now',
  tryAgain: 'Try again',
  settledSome: (done: number, of: number) => `Changed ${String(done)} of ${String(of)}; the rest are still picked.`,
  markingSpam: 'Marking as spam…',
  markingNotSpam: 'Marking as not spam…',
  markedSpamMany: (n: number) => `${count(n, 'submission', 'submissions')} marked as spam.`,
  releasedMany: (n: number) => `${count(n, 'submission', 'submissions')} marked as not spam. They are being processed.`,
  review: 'Review',
  needReview: (n: number) => `${count(n, 'submission needs', 'submissions need')} your review.`,
  searchSubmissions: 'Search submissions',
  noMatch: (query: string) => `No submissions match “${query}”`,
  noSubmissionsText: 'Share the link and the first one shows here.',
  retry: 'Retry',
  deleteSubmission: 'Delete',
  /** Names the submission by who sent it: "Delete the submission from Grace Hopper?". */
  deleteSubmissionTitle: (who: string | undefined) =>
    who === undefined ? 'Delete this submission?' : `Delete the submission from ${who}?`,
  deleteSubmissionText: 'Its answers are gone for good; the people and records it made stay.',
  deleteSubmissionAction: 'Delete submission',
  /** Bulk Delete (asks first: a submission can't come back): "Delete 3 submissions?". */
  deleteManyTitle: (n: number) => `Delete ${count(n, 'submission', 'submissions')}?`,
  deleteManyText: 'Their answers are gone for good; the people and records they made stay.',
  deleteManyAction: (n: number) => `Delete ${count(n, 'submission', 'submissions')}`,
  deletingMany: 'Deleting…',
  deletedMany: (n: number) => `${count(n, 'submission', 'submissions')} deleted.`,
  deletedSome: (done: number, of: number) => `Deleted ${String(done)} of ${String(of)}; the rest are still picked.`,
  /** Marks the answers not saved on the record, when some were. */
  notSavedMark: 'Not saved',
  /** Above the answers of a submission our spam check caught, when it carries a file: kept for a release. */
  spamFilesTitle: 'Our spam check caught this',
  spamFiles: (day: string) => `Open files only if you trust the sender. Removed on ${day} unless marked Not spam.`,
  /** The Submissions tab's own failure (forms fix a6): the form stays, the tab says it and offers Try again. */
  submissionsFailedTitle: 'Submissions didn’t load',
  /** A submission that went to a record already there (forms fix a4): a tag in the list. */
  returning: 'Returning',
  /** A returning person's answers filing left as they were, with Use new (forms fix a4). */
  keptTitle: (count: number, name: string) =>
    count === 1 ? `${name} already had a different answer here` : `${name} already had different answers here`,
  useNew: 'Use new',
  useNewLabel: (question: string) => `Use the new answer for ${question}`,
  usedNew: 'Saved on the record.',
  /** Over the answers filing left off the record, each with why (late trap #50). */
  notSavedTitle: (count: number) =>
    count === 1 ? 'One answer wasn’t saved on the record' : `${String(count)} answers weren’t saved on the record`,
  /** Several questions' labels as one line ("Job title and Budget"), in English as the rest of the copy is. */
  questionList: (labels: readonly string[]) =>
    new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels),
  /** The way forward under them: put the field back or file the question elsewhere, then file again. */
  notSavedNext: 'Restore the field or pick another, then sync earlier submissions.',
  /** After Answers, once for the section: what went to the CRM. */
  answersKeptOnly: 'Not added to the CRM',
  answersNotInCrm: 'Not in the CRM',
  answersAllSaved: 'All saved on the record',
  answersNoneSaved: 'None saved on the record',
  answersSomeSaved: (saved: number, total: number) => `${String(saved)} of ${String(total)} saved on the record`,
  /** Under Records while the job adds it. */
  answersFiling: 'Adding it to the CRM now.',
  released: 'Released. It is being processed.',
  markedSpam: 'Marked as spam.',
  retried: 'Processing it again.',
  submissionDeleted: 'Submission deleted.',
  loadMore: 'Show more',
  failure: 'What went wrong',
  // Endings, the score and the Flow view (spec 0063 slice 5, AC-6315, AC-6316, AC-6325).
  endingsTitle: 'Endings',
  endingsLine: 'Where a jump or a rule can send a visitor instead of the thank you.',
  endingsFull: (most: number) => `A form holds the thank you and ${String(most)} endings.`,
  addEnding: 'Add an ending',
  endingName: (place: number, heading: string | undefined) =>
    heading === undefined || heading.trim() === '' ? `Ending ${String(place)}` : heading,
  endingHeading: 'Heading',
  endingHeadingPlaceholder: 'Thanks, we are not a fit',
  endingLine: 'Line under it',
  endingLinePlaceholder: 'Optional',
  endingButton: 'Button',
  endingButtonNone: 'No button',
  endingButtonUrl: 'Link',
  endingButtonBooking: 'Booking page',
  endingButtonLabel: 'Button text',
  endingButtonLabelPlaceholder: 'Read the guide',
  endingAddress: 'Web address',
  removeEnding: 'Remove',
  endingRemoved: 'Ending removed.',
  recallHint: 'Write {{key}} to show an earlier answer, or {{score}} for the score.',
  scoreTitle: 'Score',
  scoreLine: 'Points on the answers add up to a score you can jump on, show, and save.',
  scoreFiledOn: 'Save the score to',
  scoreFiledNowhere: 'Keep it off the CRM',
  scoreNoNumbers: 'This object has no number field to save a score to.',
  flowOpen: 'Flow',
  flowTitle: 'Flow',
  flowStep: (place: number, title: string | undefined) =>
    title === undefined || title.trim() === '' ? `Step ${String(place)}` : `Step ${String(place)} · ${title}`,
  /** A jump as a line: "If Budget is Under $1k". */
  flowJump: (condition: string) => `If ${condition}`,
  /** Where it goes, after its If: "Jump to Step 3", "Jump to Ending: Not a fit". */
  flowJumpTo: (where: string) => `Jump to ${where}`,
  /** A step that only shows for some answers. */
  flowShownIf: 'Shown only if',
  /** Where a step goes after its jumps: everyone the jumps above didn't send elsewhere. */
  flowNext: 'Otherwise',
  /** Where a step with no jumps goes. */
  flowThen: 'Then',
  /** The next step, as a place to go. */
  flowGoTo: (name: string) => `Go to ${name}`,
  flowEndings: 'Endings',
  flowClassic: 'Steps and logic jumps work with the Steps layout.',
  flowEmptyTitle: 'No questions yet',
  flowEmpty: 'Add a question to see the flow.',
  /** The form's own end, after the last step. */
  flowThanks: 'Thank you page',
  flowEdit: 'Edit',
  flowAddStep: 'Add a step',
  flowClose: 'Close',
  // Analytics (spec 0063, AC-6321, AC-6322). Short on purpose (spec 0058, AC-3).
  analytics: 'Analytics',
  analyticsPeriod: 'Period',
  analyticsDays: (days: number) => `${String(days)} days`,
  analyticsViews: 'Views',
  analyticsStarts: 'Starts',
  analyticsCompletion: 'Completion',
  analyticsMedian: 'Median time',
  /** The change against the period before, beside its arrow: "+8 vs 30 days before", so nothing has to be subtracted. */
  analyticsChange: (change: string, days: number) => `${change} vs ${String(days)}\u00a0days before`,
  analyticsNoChange: (days: number) => `Same as the ${String(days)}\u00a0days before`,
  /** The median is the one figure where less is better, so its change says so in words rather than by an arrow. */
  analyticsFaster: (by: string) => `${by} faster`,
  analyticsSlower: (by: string) => `${by} slower`,
  analyticsNoMedian: 'No finishes yet',
  analyticsDay: 'Day',
  analyticsChart: (days: number) => `Views per day over the last ${String(days)} days`,
  analyticsDropOff: 'Where people stop',
  analyticsDropOffChart: 'People who stopped on each question',
  analyticsQuestion: 'Question',
  /** A question's place in the form, as the drop off chart's axis label: "Q4". */
  analyticsQuestionAt: (at: number) => `Q${String(at)}`,
  analyticsSummary: 'Headline figures',
  analyticsLeft: 'Stopped here',
  analyticsSources: 'Where they come from',
  analyticsSource: 'Source',
  analyticsCompletions: 'Finished',
  analyticsDirect: 'Direct',
  analyticsEmpty: 'No visits yet',
  analyticsEmptyText: 'Share the form’s link to see how it performs.',
  analyticsNoneInRange: 'No visits in this period',
  analyticsNoneInRangeText: 'Try a longer period.',
  analyticsNoSources: 'Nothing yet',
  analyticsFailed: 'Analytics didn’t load',
  /** A question card's chip (AC-6322): "82% answered", or nothing at all when nobody reached it. */
  analyticsChip: (answered: string) => `${answered} answered`,
  /** What the chip's percentage is of, as its tooltip: the denominator, which the card has no room to say. */
  analyticsReached: (answered: string, reached: string) => `${answered} of the ${reached} who reached this question`,

  status: {
    draft: 'Not published',
    live: 'Live',
    paused: 'Paused',
    archived: 'Archived',
  } satisfies Record<FormStatus, string>,
  // After they send (T20, 5 November 2026): the end of the Form tab's list, as Typeform's endings and Tally's thank you
  // page sit at the end of a form. Endings, routing and the score live here, never in Settings.
  afterSend: 'After they send',
  anotherEnding: 'Another ending',
  sendElsewhere: 'Send to a booking page or link',
  afterMenu: 'More ways to end',
  thankYouPage: 'Thank you page',
  /** What everyone no rule sends elsewhere gets, as the default row's choice. */
  afterEveryone: 'Everyone else',
  /** A rule's destination, over its choice of a booking page or a link. */
  sendTo: 'Send to',
  afterKindThanks: 'Thank you page',
  afterKindBooking: 'Booking page',
  afterKindLink: 'Link',
  bookingRow: (title: string | undefined) => (title === undefined ? 'Booking page' : `Booking page · ${title}`),
  linkRow: (url: string) => (url.trim() === '' || url === 'https://' ? 'Link' : `Link · ${url}`),
  messageRow: 'Message',
  /** A rule's condition on its row: "When Budget is Under $1k". */
  whenLine: (line: string) => `When ${line}`,
  dependingOnAnswers: 'Depending on answers',
  addCondition: 'Depending on answers…',
  /** An ending nothing sends anyone to yet. */
  endingUnreached: 'Nothing leads here yet',
  /** An ending only a step's jump reaches. */
  endingByJump: 'Reached by a jump',
  removeOutcome: 'Remove',
  outcomeRemoved: 'Removed.',
  insertAnswer: 'Insert an answer',
  insertScore: 'Score',
  linkAddress: 'Address',
  scoreRow: 'Score',
  scoreSaveTo: 'Save the score to',
  scoreSaveHelp: 'Points from the answers add up to a score. Save it on the record to sort and filter by it.',
  routeIncomplete: 'A link needs a full address that starts with https://.',
  // The preview's words, edited in place (T21: the Text card went).
  editHeadline: 'Edit the headline',
  editButton: 'Edit the button',
  // Settings as rows (T21: label left, a compact control right, no cards).
  saveAnswersTo: 'Save answers to',
  onlySubmissions: 'Only in Submissions',
  emailEach: 'Email each submission to',
  acceptingRow: 'Accepting submissions',
  acceptingHelp: 'Turn off to close the form. Visitors see that it is closed.',
  spamRow: 'Spam',
  linkHelp: 'Links with the old address keep working.',
  ownerHelpTip: 'Who owns the records this form makes. Records already made keep their owner.',
  savingHelpTip: 'Each submission adds or updates a record here, matched by email. A change goes live with Publish.',
  savingChangedToast: (where: string) => `Answers will save to ${where} once you publish.`,
  savingOffToast: 'Answers will stay in Submissions once you publish.',
  // Analytics (T22)
  analyticsFinishedOf: (finished: string, started: string) => `${finished} of ${started} who started finished`,
  analyticsAllFinished: 'Everyone who started finished.',
  analyticsSourceLine: (views: string, finished: string, count: number) =>
    `${views} ${count === 1 ? 'view' : 'views'} · ${finished} finished`,
} as const;
