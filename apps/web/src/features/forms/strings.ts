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
  noFormsText: 'A form collects submissions from a link or your site, and can add each one to your CRM.',
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
  turnOnFailed: (name: string) => `Couldn’t resume ${name}. It’s still paused.`,
  turnOffFailed: (name: string) => `Couldn’t pause ${name}. It’s still live.`,
  duplicateFailed: (name: string) => `Couldn’t duplicate ${name}.`,
  submissionCount: (n: number) => count(n, 'submission', 'submissions'),
  noSubmissionsYet: 'No submissions yet',
  publishToShare: 'Publish it to start taking submissions',
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
  deleteText: (submissions: number) =>
    submissions === 0
      ? 'The form and its link are gone for good; nothing was sent to it yet.'
      : `The form, its link and its ${count(submissions, 'submission', 'submissions')} are gone for good; the people and records they made stay.`,
  /** The confirm's commit: the verb last, never OK. */
  deleteFormAction: 'Delete form',
  deleted: (name: string) => `Deleted “${name}”.`,
  cancel: 'Cancel',

  // The editor
  untitledForm: 'Untitled form',
  previewOpen: 'Preview',
  previewNotLive: 'Preview, not live. Answers are checked here, and nothing is sent.',
  publish: 'Publish',
  publishChanges: 'Publish changes',
  publishing: 'Publishing',
  moreActions: 'More actions',
  pause: 'Pause',
  resume: 'Resume',
  statusLive: (version: number) => `Live · v${String(version)}`,
  statusChanged: 'Live · edited',
  statusDraft: 'Draft',
  statusPaused: 'Paused',
  tabs: 'Form sections',
  tabForm: 'Form',
  tabSettings: 'Settings',
  tabInstall: 'Install',
  tabSubmissions: 'Submissions',
  published: (version: number) => `Published version ${String(version)}.`,
  madeUnique: (field: string, objectName: string) => `${field} is now unique on ${objectName}: one record per email.`,
  viewField: 'View field',
  willMakeUnique: (field: string, objectName: string) =>
    `Publishing makes ${field} unique on ${objectName}: one record per email. Submissions, imports and other forms then update that record instead of adding another.`,
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
  colour: 'Colour',
  light: 'Light form',
  dark: 'Dark form',
  corners: 'Corners',
  rounded: 'Rounded corners',
  square: 'Square corners',

  // Questions: the shared editor's words (`features/questions/strings.ts`), and the form's own
  ...questionStrings,
  emailStays: 'The email question stays while the form files onto People: it is how a submission becomes a person.',
  /** Publish couldn't make the email the match: two records on the object already share one (27 October 2026). */
  matchHasDuplicates: (objectName: string) =>
    `Some ${objectName} share an email already, so email can’t tell them apart yet. Give each its own, then publish.`,

  // First publish
  setUpTitle: 'Set up your form',
  answersTitle: 'Where the answers go',
  liveTitle: 'Your form is live',
  stepOf: (step: number, of: number) => `Step ${String(step)} of ${String(of)}`,
  name: 'Name',
  address: 'Link',
  addressHint: 'Lowercase letters, numbers and hyphens',
  addressTaken: 'That address is taken',
  addressInvalid: 'The address needs 2 to 40 lowercase letters, numbers or hyphens.',
  next: 'Next',
  back: 'Back',
  close: 'Close',
  fileOnto: 'Where submissions go',
  fileOntoHint: 'Each submission adds or updates one of these, matched by email.',
  noCrm: 'Don’t add to the CRM',
  keptOnlyHint: 'Submissions stay in the form’s Submissions tab. You can add them to the CRM later, from Settings.',
  buildObject: 'Build one out of this form',
  buildObjectButton: (name: string, attributes: number) =>
    `Make an object named “${name}” with ${count(attributes, 'attribute', 'attributes')}`,
  building: 'Making the object…',
  liveText: 'Share the link, or put it on your site.',
  ownFormLater: 'To use your own design, take the form HTML from Install.',
  ownFormThanks: 'Thank you. That is with us.',

  // Settings tab
  nameHint: 'Only your team sees it.',
  nameRequired: 'Give the form a name.',
  addressChanged: 'Address changed. Old links still open the form.',
  draftNameText: 'Only your team sees it. The address comes with the first publish.',
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
  mappingQuestion: 'Question',
  mappingSavedAs: 'Saved as',
  retargetFailed: 'That didn’t change where submissions go.',
  retargetTitle: 'Change which object submissions are saved to?',
  retargetOffTitle: 'Stop saving submissions to the CRM?',
  retargetText: (filed: number, from: string, to: string) =>
    `${count(filed, 'question is', 'questions are')} saved to ${from} fields. On ${to}, only questions whose label matches a field stay saved; the rest are kept with the submission only.`,
  retargetOffText: (filed: number, from: string) =>
    `${count(filed, 'question is', 'questions are')} saved to ${from} fields. Submissions will make no record, and every answer is kept with the submission only.`,
  thisObject: 'this object',
  savingWaits: (objectName: string) =>
    `Changes here go live when you publish. Until then, submissions are still saved to ${objectName}.`,
  savingWaitsKeptOnly:
    'Changes here go live when you publish. Until then, submissions are still kept with the form only.',
  retargetAction: 'Change object',
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
  noticesTitle: 'Notifications',
  noticesLabel: 'Email each new submission to',
  noticesNobody: 'Nobody else',
  noticesHint: (filing: boolean) =>
    filing
      ? 'The new record’s owner is always emailed too. Each person sees only the answers they have access to.'
      : 'Each person sees only the answers they have access to.',
  /** Someone the form lists who has left, or whom the reader can't list. */
  noticesFormer: 'Former member',
  spamTitle: 'Spam',
  spamSummary: 'On. Doubtful sends wait for review.',
  detailsTitle: 'Details',
  spamReview: 'Review',
  settingsFailed: 'That didn’t save.',

  // Install tab
  readOnlyTitle: 'You can view this form',
  readOnlyText: 'Only people who manage forms can change it.',
  shareTitle: 'Share',
  shareTip:
    'Use the link in an email, a chat or a post: it opens the form on a page of its own. To keep people on your site, put the form there with the snippet below.',
  link: 'Link',
  copy: 'Copy',
  copyLink: 'Copy link',
  openLink: 'Open',
  copyEmbed: 'Copy snippet',
  copyFormHtml: 'Copy form HTML',
  copySecret: 'Copy signing secret',
  websiteTitle: 'Put it on your site',
  websiteTip:
    'Paste the snippet where the form should show. One script tag serves every form and booking page on your site, so add it once.',
  embedMode: 'How it shows',
  embedInline: 'In the page',
  embedPopup: 'Popup',
  embedFloating: 'Corner button',
  embedInlineHint: 'Fills its space and grows with the form.',
  embedPopupHint: 'Your own button opens it in a dialog.',
  embedFloatingHint: 'A corner button on every page opens it. Change its words in data-timefix-text.',
  /** The words on the popup's and the corner's button, until the site changes them. */
  embedButtonText: 'Contact us',
  embedSnippet: 'Embed snippet',
  embedText: 'Put the form on a page of your own site.',
  advancedTitle: 'For developers',
  ownFormTitle: 'Your own HTML',
  ownFormSnippet: 'Form HTML',
  taggingText:
    'The form names your workspace, this form and its version. Each field’s name is its question’s key, so renaming a question never breaks your page. With each post the script sends the page, its title, the visit’s first page and referrer, and the UTM tags, shown on the submission as Came from.',
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
  copied: 'Copied.',
  sitesTitle: 'Allowed sites',
  sitesTip: 'Your own HTML only posts from these addresses. Embeds and the hosted page work on any site.',
  sitesEmpty: 'None yet, so your own HTML can’t post.',
  siteNew: 'Site address',
  siteNewPlaceholder: 'https://acme.com',
  siteAdd: 'Add site',
  siteRemove: (origin: string) => `Remove ${origin}`,
  siteRemoveTitle: (origin: string) => `Remove ${origin}?`,
  siteRemoveText:
    'Your own HTML on that site stops posting to the form at once. Embeds and the hosted page keep working.',
  siteRemoveAction: 'Remove site',
  siteNotHttps: 'Use the site’s https address, such as https://acme.com.',
  siteTaken: 'That site is in the list already.',
  sitesFull: 'A form lists at most 20 sites.',
  sitesSaved: 'Sites saved.',
  unsignedRefused: 'Unsigned posts are refused now.',
  unsignedAllowed: 'Unsigned posts are taken again.',
  refuseUnsigned: 'Refuse unsigned posts',
  signedTitle: 'Signed posts',
  refuseUnsignedHint:
    'Turn on Refuse unsigned posts when only your server posts to the form. Each post must then carry a signature made with the secret, so your own HTML in a browser is refused. The hosted page and embeds keep working.',
  /** How to sign, with its code names drawn by `code`. */
  signHowText: <T>(code: (text: string) => T): readonly (string | T)[] => [
    'On your server, take the exact body you send, make its HMAC with SHA 256 and the signing secret, and send it in the ',
    code('x-crm-signature'),
    ' header as ',
    code('sha256='),
    ' and the hex digest.',
  ],
  secret: 'Signing secret',
  secretReason: 'Keep it on your server only. Anyone who has it can post as your site.',
  secretReveal: 'Reveal',
  secretHide: 'Hide',
  secretRotate: 'Rotate secret',
  secretRotateTitle: 'Rotate the signing secret?',
  secretRotateText:
    'A new secret takes over at once and posts signed with the old one are refused. This can’t be undone, so update your server right after.',
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
    processed: 'Nothing filed yet.',
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
  exportStarted: 'Preparing your CSV. A Download button shows here when it is ready.',
  exportReady: (file: string) => `${file} is ready.`,
  download: 'Download',
  addToCrm: 'Add to CRM',
  addQueued: (queued: number, skipped: number) =>
    skipped === 0
      ? `Adding ${count(queued, 'submission', 'submissions')} to the CRM.`
      : `Adding ${count(queued, 'submission', 'submissions')} to the CRM. ${String(skipped)} skipped: already in it or held.`,
  nothingToAdd: 'Nothing to add: these are already in the CRM or held.',
  /** Asks before many submissions go to the CRM at once: "Add 12 submissions to the CRM?". */
  addManyTitle: (n: number, max: number) => `Add ${count(Math.min(n, max), 'submission', 'submissions')} to the CRM?`,
  addManyText: (n: number, max: number) =>
    n > max
      ? `Each is filed the way the form files now, making new records or updating the ones it matches. The first ${String(max)} go now; add the rest after.`
      : 'Each is filed the way the form files now, making new records or updating the ones it matches.',
  addDone: (done: number, refused: number) =>
    refused === 0
      ? `${count(done, 'submission', 'submissions')} added to the CRM.`
      : `${count(done, 'submission', 'submissions')} added to the CRM; ${String(refused)} couldn’t be.`,
  jobFailed: (label: string) => `${label} didn’t finish. Background jobs in Settings says why.`,
  syncOld: 'Sync earlier submissions',
  syncOldText: 'File earlier submissions the way the form files now',
  syncStarted: 'Syncing earlier submissions. You can keep working.',
  syncDone: (done: number, refused: number) =>
    refused === 0
      ? `${count(done, 'submission', 'submissions')} synced.`
      : `${count(done, 'submission', 'submissions')} synced; ${String(refused)} couldn’t be.`,
  syncTitle: 'Sync earlier submissions?',
  syncTextPublished: 'The form now files its answers differently. Earlier submissions can be filed the same way.',
  syncTextMenu: 'File earlier submissions the way the form files its answers now.',
  syncTextConnected: 'The form now adds each submission to the CRM. Earlier submissions can be added the same way.',
  syncInScope: (total: number) => `${count(total, 'earlier submission', 'earlier submissions')} in scope.`,
  syncNothing: 'Every earlier submission here already follows the form.',
  syncFailuresText: 'Some can’t be filed, such as when the CRM needs a field the form doesn’t ask.',
  syncScope: 'Which submissions',
  syncUnfiled: 'Only unfiled',
  syncUnfiledText: 'The ones not in the CRM yet',
  syncAll: 'All',
  syncAllText: 'Every submission except spam and ones waiting for review',
  syncCreates: 'New records',
  syncUpdates: 'Records updated',
  syncUnchanged: 'Nothing to change',
  syncFailures: 'Can’t be synced',
  syncCapped: (checked: number) =>
    `These counts cover the newest ${new Intl.NumberFormat().format(checked)} submissions.`,
  syncStart: 'Sync',
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
  /** Marks the answers not saved on the record, when some were. */
  notSavedMark: 'Not saved',
  /** Above the answers of a submission our spam check caught, when it carries a file: kept for a release. */
  spamFilesTitle: 'Our spam check caught this',
  spamFiles: (day: string) =>
    `Open its files only if you trust the sender. They’re removed on ${day}. Choose Not spam to keep them.`,
  /** Over the answers filing left off the record, each with why (late trap #50). */
  notSavedTitle: (count: number) =>
    count === 1 ? 'One answer wasn’t saved on the record' : `${String(count)} answers weren’t saved on the record`,
  /** Several questions' labels as one line ("Job title and Budget"), in English as the rest of the copy is. */
  questionList: (labels: readonly string[]) =>
    new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels),
  /** The way forward under them: put the field back or file the question elsewhere, then file again. */
  notSavedNext:
    'To save them, restore the field or save the question to another one, then sync earlier submissions. Or copy the answer onto the record.',
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
  status: {
    draft: 'Not published',
    live: 'Live',
    paused: 'Paused',
    archived: 'Archived',
  } satisfies Record<FormStatus, string>,
} as const;
