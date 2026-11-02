// The words of Routing › Insights (spec 0037, AC-1376, AC-1386, AC-1389): the learning's state in plain words, the
// holdout comparison, and each rep's numbers. Short labels, no help paragraphs, and never a number the data can't
// back up.

export const insightsStrings = {
  view: 'Insights',

  // The learning's state
  learning: 'Learning',
  neverRan: 'Nothing learned yet',
  neverRanText:
    'Ranked meetings are counted every night. Until a segment has enough finished meetings, available reps are ordered by fairness and fit alone.',
  trainedAt: 'Last counted',
  /** AC-1376's sentence, in plain words: how far a cell is from warm, and when it could be. */
  startsAfter: (needed: number, so_far: number, waiting: number, readyFrom?: string) =>
    `Learning starts after ${String(needed)} finished meetings: ${String(so_far)} so far, ${String(waiting)} more waiting for their outcome${readyFrom === undefined ? '' : `, ready from ${readyFrom}`}.`,
  learningOn: (trials: number) => `Learning from ${String(trials)} finished meetings.`,
  learnSince: 'Learning from',
  learnSinceValue: (day: string) => `Outcomes before ${day} are not counted.`,
  segmentsBy: 'Segments',
  noSegments: 'All leads counted together.',
  segmentsRestarted:
    'The segment fields changed, so segment learning starts over. The all-leads numbers carry on as they were.',
  markingRate: 'No show marks',
  teamMarking: (share: string) => `The team marks ${share} of its finished meetings a no show.`,

  // The comparison (AC-1389)
  comparison: 'Smart routing against fairness alone',
  changed: 'Ranking moved it',
  leftAlone: 'Ranking left it',
  // Plain words, to sit beside the other two arms: "holdout" is the statistician's word for it, and the Smart tab
  // keeps it where it is the name of a setting.
  holdout: 'Without ranking',
  arm: (trials: number) => `${String(trials)} ${trials === 1 ? 'meeting' : 'meetings'}`,
  /** The page's ranked meetings in the window, said so it can't be read as the cells' own counts. */
  ranked: (count: number) => `${String(count)} ranked in the window`,
  /**
   * The headline of AC-1389, which must say which way it went: `isCertain` only says the two intervals are apart,
   * so a page where the ranking is certainly **hurting** would otherwise read as confidently as one where it helps.
   */
  verdict: (smart: string, plain: string, verdict: 'ahead' | 'behind' | 'unsure') =>
    verdict === 'ahead'
      ? `Smart routing is ahead: ${smart} against ${plain} without it.`
      : verdict === 'behind'
        ? `Smart routing is behind: ${smart} against ${plain} without it.`
        : `Smart routing is at ${smart}, against ${plain} without it — not enough meetings to be sure yet.`,
  noComparison: 'No ranked meetings have finished yet.',
  /** Nothing is held back, so there is no control arm: a 0% column would read as a result rather than no measurement. */
  noHoldout: 'No meetings are held back, so there is nothing to compare against. Set a holdout on Smart.',

  // The objectives (AC-1354)
  objective: 'Learning toward',
  objectives: { deal: 'Deals created', won: 'Deals won', held: 'Meetings held' } as const,

  // The cells
  segment: 'Segment',
  cellsTable: 'Reps in this segment',
  rep: 'Rep',
  trials: 'Meetings',
  /** Named so the blend is expected: a rep with 3 meetings and 3 wins reads near the team's rate, not 100%. */
  rate: 'Est. rate',
  /** The rate column says what it is a rate of: "Est. deals won rate", not a bare "Rate". */
  rateOf: (objective: string) => `Est. ${objective.toLowerCase()} rate`,
  /**
   * The gap to the team's rate in percentage points, not the ranker's own 0 to 1 weight: "100% lift" would read as
   * "closes twice as often", which is not what the weight means.
   */
  lift: 'vs team',
  points: (gap: number) => `${gap > 0 ? '+' : gap < 0 ? '−' : ''}${String(Math.abs(Math.round(gap * 100)))} pts`,
  /** Said once under the table, because Meetings and Est. rate don't divide into each other. */
  smoothed:
    'Rates are smoothed toward the team’s while a rep has few meetings, so a rep with 3 meetings never reads 100%.',
  share: 'Share',
  /** Their share of the cell's meetings against an equal one: "38% · fair 33%", never "38% of 33%". */
  shareOf: (share: string, fair: string) => `${share} · fair ${fair}`,
  cold: 'Not enough data',
  coldHint: 'Available reps here are ordered by fairness and fit alone.',
  warm: 'Learning',
  noCells: 'No segments counted yet',
  noCellsText: 'A segment appears here once a ranked meeting has been booked in it.',
  noPages: 'No team pages yet',
  noPagesText: 'Insights counts the meetings a team page’s ranking decided.',

  // The window
  // Named for what it actually cuts: the cells below are whatever the last nightly run wrote, and don't follow it.
  window: 'Comparison window',
  cellsNote: 'Rep numbers are the latest nightly count and don’t follow this window.',
  weeks: (count: number) => `Last ${String(count)} weeks`,
  wholeWindow: 'Whole learning window',

  // States
  loadFailed: 'Insights couldn’t load',
  loadFailedText: 'Check your connection and try again.',
};
