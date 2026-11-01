// Sample data's content: a small, believable sales world of 8 companies, 15 people and 10 deals across the Sales
// stages, with a few notes and tasks. Plain data and one pure planner, so it tests in Node. Addresses use
// `example.com` subdomains (reserved, RFC 2606), so nothing here ever names a real company or reaches a real inbox.

/** One sample company. */
export interface SampleCompany {
  readonly key: string;
  readonly name: string;
  readonly domain: string;
  readonly description: string;
}

/** One sample person, at one of the companies. */
export interface SamplePerson {
  readonly key: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly jobTitle: string;
  readonly company: string;
}

/** One sample deal, on a company, with its people. */
export interface SampleDeal {
  readonly key: string;
  readonly name: string;
  readonly company: string;
  readonly people: readonly string[];
  /** A Sales stage's label. */
  readonly stage: SalesStage;
  /** In US dollars, as a decimal string. */
  readonly value: string;
  /** Days from today it is expected to close (negative: closed already). */
  readonly closesInDays: number;
  readonly nextStep: string;
}

/** A note on a sample record. */
export interface SampleNote {
  readonly on: string;
  readonly title: string;
  readonly text: string;
}

/** A task linked to a sample record. */
export interface SampleTask {
  readonly on: string;
  readonly title: string;
  /** Days from today it is due. */
  readonly dueInDays: number;
}

/** The Sales template's stages, in order, with their colour and outcome. */
export const SALES_STAGES = [
  { label: 'Lead', hue: 'gray', outcome: 'open' },
  { label: 'Qualified', hue: 'sky', outcome: 'open' },
  { label: 'Proposal', hue: 'blue', outcome: 'open' },
  { label: 'Negotiation', hue: 'purple', outcome: 'open' },
  { label: 'Won', hue: 'green', outcome: 'won' },
  { label: 'Lost', hue: 'red', outcome: 'lost' },
] as const;

/** A Sales stage's label. */
export type SalesStage = (typeof SALES_STAGES)[number]['label'];

/** The board view the Sales template adds to Deals. */
export const PIPELINE_VIEW_NAME = 'Pipeline';

/** The sample companies. */
export const SAMPLE_COMPANIES: readonly SampleCompany[] = [
  {
    key: 'northwind',
    name: 'Northwind Labs',
    domain: 'northwind.example.com',
    description: 'Lab software for biotech teams.',
  },
  {
    key: 'bluepeak',
    name: 'Bluepeak Health',
    domain: 'bluepeak.example.com',
    description: 'Clinic scheduling across 40 sites.',
  },
  {
    key: 'harbor',
    name: 'Harbor Freight Co',
    domain: 'harbor.example.com',
    description: 'Regional logistics and warehousing.',
  },
  { key: 'lumen', name: 'Lumen Studio', domain: 'lumen.example.com', description: 'Brand and product design agency.' },
  {
    key: 'quarry',
    name: 'Quarry Analytics',
    domain: 'quarry.example.com',
    description: 'Data platform for retail chains.',
  },
  {
    key: 'tidewater',
    name: 'Tidewater Bank',
    domain: 'tidewater.example.com',
    description: 'Community bank with 12 branches.',
  },
  {
    key: 'evergreen',
    name: 'Evergreen Schools',
    domain: 'evergreen.example.com',
    description: 'Private school group, K to 12.',
  },
  {
    key: 'copper',
    name: 'Copperline Energy',
    domain: 'copper.example.com',
    description: 'Solar installs for businesses.',
  },
];

/** The sample people, two or so at each company. */
export const SAMPLE_PEOPLE: readonly SamplePerson[] = [
  { key: 'maya', firstName: 'Maya', lastName: 'Chen', jobTitle: 'Head of Operations', company: 'northwind' },
  { key: 'leo', firstName: 'Leo', lastName: 'Okafor', jobTitle: 'CTO', company: 'northwind' },
  { key: 'sara', firstName: 'Sara', lastName: 'Lindqvist', jobTitle: 'VP Patient Experience', company: 'bluepeak' },
  { key: 'omar', firstName: 'Omar', lastName: 'Haddad', jobTitle: 'IT Director', company: 'bluepeak' },
  { key: 'grace', firstName: 'Grace', lastName: 'Mensah', jobTitle: 'COO', company: 'harbor' },
  { key: 'tom', firstName: 'Tom', lastName: 'Becker', jobTitle: 'Fleet Manager', company: 'harbor' },
  { key: 'ines', firstName: 'Inês', lastName: 'Duarte', jobTitle: 'Founder', company: 'lumen' },
  { key: 'raj', firstName: 'Raj', lastName: 'Patel', jobTitle: 'Head of Data', company: 'quarry' },
  { key: 'hannah', firstName: 'Hannah', lastName: 'Weiss', jobTitle: 'Procurement Lead', company: 'quarry' },
  { key: 'daniel', firstName: 'Daniel', lastName: 'Kim', jobTitle: 'Chief Risk Officer', company: 'tidewater' },
  { key: 'amara', firstName: 'Amara', lastName: 'Nwosu', jobTitle: 'Digital Lead', company: 'tidewater' },
  { key: 'lucia', firstName: 'Lucía', lastName: 'Romero', jobTitle: 'Principal', company: 'evergreen' },
  { key: 'ben', firstName: 'Ben', lastName: 'Carter', jobTitle: 'Finance Director', company: 'evergreen' },
  { key: 'yuki', firstName: 'Yuki', lastName: 'Tanaka', jobTitle: 'CEO', company: 'copper' },
  { key: 'nadia', firstName: 'Nadia', lastName: 'Petrova', jobTitle: 'Project Manager', company: 'copper' },
];

/** The sample deals, across every Sales stage. */
export const SAMPLE_DEALS: readonly SampleDeal[] = [
  {
    key: 'd1',
    name: 'Northwind annual plan',
    company: 'northwind',
    people: ['maya', 'leo'],
    stage: 'Negotiation',
    value: '48000',
    closesInDays: 12,
    nextStep: 'Send the revised order form',
  },
  {
    key: 'd2',
    name: 'Bluepeak pilot',
    company: 'bluepeak',
    people: ['sara'],
    stage: 'Proposal',
    value: '18000',
    closesInDays: 21,
    nextStep: 'Walk Omar through security',
  },
  {
    key: 'd3',
    name: 'Harbor fleet rollout',
    company: 'harbor',
    people: ['grace', 'tom'],
    stage: 'Qualified',
    value: '64000',
    closesInDays: 45,
    nextStep: 'Book a site visit',
  },
  {
    key: 'd4',
    name: 'Lumen starter',
    company: 'lumen',
    people: ['ines'],
    stage: 'Won',
    value: '6000',
    closesInDays: -8,
    nextStep: 'Kick off onboarding',
  },
  {
    key: 'd5',
    name: 'Quarry data add-on',
    company: 'quarry',
    people: ['raj', 'hannah'],
    stage: 'Lead',
    value: '22000',
    closesInDays: 60,
    nextStep: 'Intro call with Raj',
  },
  {
    key: 'd6',
    name: 'Tidewater branches',
    company: 'tidewater',
    people: ['daniel'],
    stage: 'Proposal',
    value: '36000',
    closesInDays: 30,
    nextStep: 'Answer the risk questionnaire',
  },
  {
    key: 'd7',
    name: 'Evergreen campus licence',
    company: 'evergreen',
    people: ['lucia', 'ben'],
    stage: 'Lost',
    value: '15000',
    closesInDays: -20,
    nextStep: 'Check back next term',
  },
  {
    key: 'd8',
    name: 'Copperline expansion',
    company: 'copper',
    people: ['yuki'],
    stage: 'Qualified',
    value: '27000',
    closesInDays: 40,
    nextStep: 'Price the second region',
  },
  {
    key: 'd9',
    name: 'Northwind support tier',
    company: 'northwind',
    people: ['leo'],
    stage: 'Lead',
    value: '9000',
    closesInDays: 75,
    nextStep: 'Share the support plans',
  },
  {
    key: 'd10',
    name: 'Tidewater mobile app',
    company: 'tidewater',
    people: ['amara'],
    stage: 'Won',
    value: '52000',
    closesInDays: -3,
    nextStep: 'Plan the launch',
  },
];

/** The sample notes, on deals, a person and a company. */
export const SAMPLE_NOTES: readonly SampleNote[] = [
  {
    on: 'd1',
    title: 'Pricing call',
    text: 'Maya is happy with the scope. Legal wants a 30 day notice clause before signing.',
  },
  {
    on: 'd3',
    title: 'Discovery notes',
    text: '120 vans across 4 depots. Tom owns the rollout; Grace signs off on budget.',
  },
  {
    on: 'sara',
    title: 'First meeting',
    text: 'Sara wants fewer no-shows. Pilot at two clinics, then decide by quarter end.',
  },
  {
    on: 'quarry',
    title: 'Account background',
    text: 'Uses a spreadsheet today. Raj is the champion; Hannah runs the buying process.',
  },
];

/** The sample tasks, due over the coming week. */
export const SAMPLE_TASKS: readonly SampleTask[] = [
  { on: 'd1', title: 'Send the revised order form', dueInDays: 1 },
  { on: 'd2', title: 'Book a security review with Omar', dueInDays: 3 },
  { on: 'd6', title: 'Answer the risk questionnaire', dueInDays: 5 },
  { on: 'd5', title: 'Intro call with Raj', dueInDays: 0 },
];

/** A person's sample address: first name at their company's domain, lower case, letters only. */
export function sampleEmail(person: SamplePerson, companies: readonly SampleCompany[]): string {
  const company = companies.find((each) => each.key === person.company);
  const local = person.firstName
    .normalize('NFD')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
  return `${local}@${company?.domain ?? 'example.com'}`;
}

/** The day `days` from `today` (`YYYY-MM-DD`, UTC). */
export function dayFrom(today: Date, days: number): string {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
  return day.toISOString().slice(0, 10);
}

/** What the Sales template does to Deals' stages, given their live labels in order. */
export type StagePlan =
  | { readonly kind: 'create'; readonly add: readonly SalesStage[] }
  | {
      readonly kind: 'upgrade';
      readonly rename: { readonly from: string; readonly to: SalesStage };
      readonly add: readonly SalesStage[];
    }
  | { readonly kind: 'keep' };

/** The stages a new workspace's Deals starts with (`templates/standard-v1.ts`). */
export const SEEDED_DEAL_STAGES = ['Lead', 'In progress', 'Won', 'Lost'] as const;

/**
 * The Sales template's plan for Deals' stages: with none live, all six; still the four a workspace starts with, its
 * "In progress" renamed Qualified and Proposal and Negotiation added after it (deals on it keep their stage); any
 * other set is the workspace's own and stays as it is.
 */
export function planStages(live: readonly string[]): StagePlan {
  if (live.length === 0) return { kind: 'create', add: SALES_STAGES.map((stage) => stage.label) };
  const same =
    live.length === SEEDED_DEAL_STAGES.length &&
    live.every((label, index) => label.trim().toLowerCase() === SEEDED_DEAL_STAGES[index]?.toLowerCase());
  if (!same) return { kind: 'keep' };
  return { kind: 'upgrade', rename: { from: 'In progress', to: 'Qualified' }, add: ['Proposal', 'Negotiation'] };
}
