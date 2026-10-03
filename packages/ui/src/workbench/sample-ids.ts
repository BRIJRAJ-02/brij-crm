// Fixed uuids for the sample objects, records, members and options, so every
// sample value parses as a real one would (ids are uuids, spec 0003). Each
// kind takes its own block, so an id says what it names: the last group is
// `00000000`, the kind's hex digit, then the item's number. Stories and tests only.

/** What a sample id names. Each kind has its own block of ids. */
export type SampleIdKind = 'member' | 'automation' | 'record' | 'object' | 'status' | 'option';

const BLOCK: { readonly [K in SampleIdKind]: string } = {
  member: 'a',
  automation: 'b',
  record: 'c',
  object: 'd',
  status: 'e',
  option: 'f',
};

/** The fixed uuid (v7 shaped) of sample item `n` (1 to 999) of `kind`, such as `0199a3c0-0000-7000-8000-00000000a001` for the first member. */
export function sampleId(kind: SampleIdKind, n: number): string {
  return `0199a3c0-0000-7000-8000-00000000${BLOCK[kind]}${String(n).padStart(3, '0')}`;
}

/** The sample ids by name, so a story or test reads which option, member or record it means. */
export const SAMPLE_IDS = {
  /** The Companies object, which the sample companies belong to. */
  companies: sampleId('object', 1),
  /** The pipeline stages (status options). */
  stage: {
    lead: sampleId('status', 1),
    qualified: sampleId('status', 2),
    proposal: sampleId('status', 3),
    won: sampleId('status', 4),
    legacy: sampleId('status', 5),
  },
  /** The segment tags (select options). */
  tag: {
    saas: sampleId('option', 1),
    fintech: sampleId('option', 2),
    b2b: sampleId('option', 3),
    emea: sampleId('option', 4),
    old: sampleId('option', 5),
  },
  /** The workspace members. */
  member: {
    ada: sampleId('member', 1),
    grace: sampleId('member', 2),
    alan: sampleId('member', 3),
    katherine: sampleId('member', 4),
  },
  /** The sample companies (records of the Companies object). */
  company: {
    northwind: sampleId('record', 1),
    globex: sampleId('record', 2),
    initech: sampleId('record', 3),
    umbrella: sampleId('record', 4),
  },
  /** The automations that act on records. */
  automation: {
    leadRouting: sampleId('automation', 1),
  },
} as const;
