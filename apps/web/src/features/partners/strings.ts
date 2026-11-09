// The words of partner connect (spec 0070, slice 2): the connect page, Settings › Connected apps and the operator
// console's Partners page.

/** A module's name and what it lets a connected app do, as the connect page and Connected apps say them. */
export const MODULES = {
  link_pages: {
    label: 'Link pages',
    power: 'Open Link pages for them, and manage each person’s link page and QR code',
  },
} as const;

/** What every connection lets an app do, before its modules (AC-7012). */
export const BASE_POWER = 'Add and remove people in this workspace';

export const connectStrings = {
  product: 'Timefix',
  title: (partner: string) => `Connect ${partner} to Timefix`,
  description: 'Pick the workspace to share and what it may use. You can change or end this any time.',
  loadingTitle: 'Connect an app',
  refusedTitle: 'This link can’t connect an app',
  refusedText: 'Go back to the app you came from and try again.',
  failedText: 'Something went wrong reading this request. Try again.',
  retry: 'Try again',
  canDo: (partner: string) => `${partner} will be able to`,
  workspace: 'Workspace',
  noWorkspaces: 'You don’t own a workspace yet, so name one here.',
  others: (count: number) =>
    count === 1
      ? 'You’re in 1 other workspace. Only its owners can connect it.'
      : `You’re in ${String(count)} other workspaces. Only their owners can connect them.`,
  connectedAlready: 'Already connected. Connecting again replaces its access.',
  newWorkspace: 'A new workspace',
  newWorkspaceName: 'Workspace name',
  newWorkspacePlaceholder: 'Acme',
  newWorkspaceMissing: 'Name the workspace.',
  modules: 'Modules',
  modulesMissing: 'Tick at least one module.',
  approve: 'Connect',
  approving: 'Connecting…',
  deny: 'Cancel',
  leaving: 'Going back…',
} as const;

export const connectedStrings = {
  test: 'Test',
  emptyTitle: 'No apps connected',
  emptyText: 'An app you connect from its own Integrate Timefix button shows here.',
  failedTitle: 'Couldn’t load connected apps',
  columns: {
    app: 'App',
    modules: 'Modules',
    connected: 'Connected',
    lastCall: 'Last call',
    approvedBy: 'Approved by',
    actions: 'Actions',
  },
  never: 'Not yet',
  formerMember: 'A former member',
  modulesLabel: 'Modules',
  change: (app: string) => `Change what ${app} can use`,
  changeShort: 'Change',
  disconnect: (app: string) => `Disconnect ${app}`,
  disconnectShort: 'Disconnect',
  modulesTitle: (app: string) => `What ${app} can use`,
  modulesText: 'It can always add and remove people in this workspace.',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  saved: (app: string) => `${app} updated`,
  confirmTitle: (app: string) => `Disconnect ${app}?`,
  confirmText: (app: string) =>
    `${app} stops working with this workspace at once. You can connect it again from ${app}.`,
  confirm: 'Disconnect',
  disconnecting: 'Disconnecting…',
  disconnected: (app: string) => `${app} disconnected`,
  modulesMissing: 'Keep at least one module, or disconnect the app.',
} as const;

export const partnersStrings = {
  register: 'Register partner',
  emptyTitle: 'No partners yet',
  emptyText: 'A partner is an outside product that connects workspaces to Timefix. Register one to get its keys.',
  failedTitle: 'Couldn’t load partners',
  columns: {
    name: 'Partner',
    clientId: 'Client id',
    secret: 'Secret',
    created: 'Registered',
    actions: 'Actions',
  },
  secretHint: (hint: string) => `…${hint}`,
  edit: (name: string) => `Edit ${name}`,
  editShort: 'Edit',
  replace: (name: string) => `Replace the secret of ${name}`,
  replaceShort: 'Replace secret',
  form: {
    registerTitle: 'Register a partner',
    editTitle: (name: string) => `Edit ${name}`,
    name: 'Name',
    nameMissing: 'Give the partner a name.',
    logo: 'Logo',
    logoTypes: 'PNG, JPG or WebP',
    logoUnreadable: 'Couldn’t read that image. Try a PNG, JPG or WebP.',
    frameOrigins: 'Sites allowed to embed Timefix',
    frameOriginsHint: 'One origin a line, like https://hub.example.com.',
    redirectUris: 'Addresses that receive a connection',
    redirectUrisHint: 'One full address a line. A connect must name one of these exactly.',
    redirectMissing: 'Add the address that receives a connection.',
    isTest: 'Sandbox partner',
    isTestHint: 'For trying the API before going live. Its connections are marked as tests and never billed.',
    cancel: 'Cancel',
    register: 'Register',
    registering: 'Registering…',
    save: 'Save',
    saving: 'Saving…',
  },
  secret: {
    madeTitle: (name: string) => `${name} is registered`,
    replacedTitle: (name: string) => `New secret for ${name}`,
    clientId: 'Client id',
    secret: 'Client secret',
    copyClientId: 'Copy client id',
    copySecret: 'Copy secret',
    text: 'Copy the secret now: Timefix shows it only this once and keeps only a hash.',
    done: 'Done',
  },
  replaceConfirm: {
    title: (name: string) => `Replace the secret of ${name}?`,
    text: 'The secret it uses now stops working at once. Its server needs the new one before it can connect anyone.',
    confirm: 'Replace secret',
    replacing: 'Replacing…',
    cancel: 'Cancel',
  },
  saved: (name: string) => `${name} saved`,
  // The sandbox (spec 0070, AC-7035).
  test: 'Test',
  wipe: (name: string) => `Wipe the test connections of ${name}`,
  wipeShort: 'Wipe tests',
  wipeConfirm: {
    title: (name: string) => `Wipe the test connections of ${name}?`,
    text: 'Every workspace it is connected to as a test is disconnected, and its open screens close. People it added stay in their workspaces.',
    confirm: 'Wipe tests',
    wiping: 'Wiping…',
    failed: 'Couldn’t wipe the test connections. Try again.',
    cancel: 'Cancel',
  },
  wiped: (count: number) =>
    count === 0
      ? 'No test connections to wipe'
      : count === 1
        ? 'Wiped 1 test connection'
        : `Wiped ${count} test connections`,
} as const;
