// The words of Routing › Smart (spec 0037, L8): the mode, the fairness allowance and the fit links. Short labels and
// one live sentence that states the bound in plain words (AC-1364); no help paragraphs.

export const smartStrings = {
  view: 'Smart',

  // Mode
  mode: 'Ranking',
  // One line per mode, so the segment never has to be guessed at: they do different things.
  modeHint: {
    off: 'Available reps take strict turns, as the rotation says.',
    fit: 'Available reps whose skills match the lead come first.',
    learn:
      'As Fit, and once there is enough data, the reps who have closed leads like this come first. Worked out from this workspace’s own meetings; nothing is sent anywhere.',
  } as const,
  modes: { off: 'Off', fit: 'Fit', learn: 'Learn' } as const,

  // The fairness allowance
  allowance: 'Fairness allowance',
  allowanceLabel: 'Allowance',
  percent: '%',
  allowanceHint: 'How far the ranking may move a meeting away from the person with the fewest. 0 to 50%.',
  /**
   * The bound in plain words (AC-1364), as a share rather than a count: the pool's mean load, which turns the share
   * into meetings, is the server's and isn't read here, and a made up mean would state a number the product can't
   * keep. Noted for /architect: sending the live bound with the settings would let this say "up to 3 meetings".
   */
  bound: (percent: number, windowDays: number) =>
    `Smart routing can let someone run up to ${String(percent)}% ahead of the least busy person over the last ${String(windowDays)} days, and never more.`,
  boundStrict: 'Everyone takes a strict turn: the ranking moves nothing.',
  boundOff: 'Ranking is off, so everyone keeps their turn.',
  clamped: (percent: number) => `Allowance set to ${String(percent)}%, the highest allowed.`,

  // Fit
  fit: 'Fit',
  fitHint: 'Join an answer to a skill, and reps who hold it come first for those leads.',
  fitUnused: 'Used while Ranking is Fit or Learn.',
  taken: 'This link already exists.',
  fitTable: 'Fit links',
  field: 'Field',
  option: 'Answer',
  skill: 'Skill',
  actions: 'Actions',
  addLink: 'Add link',
  pickField: 'Pick a field',
  pickOption: 'Pick an answer',
  pickSkill: 'Pick a skill',
  removeLinkOf: (option: string, skill: string) => `Remove ${option} to ${skill}`,
  removed: 'Fit link removed',
  noFit: 'No fit links yet',
  noFitText: 'Add one to put the reps who match a lead first.',
  noFieldsTitle: 'Nothing to link to yet',
  noFields: 'A fit link joins an answer of a select or status field on People, Companies or Deals to a skill.',
  noSkillsTitle: 'No skills yet',
  noSkills: 'A fit link sends a lead to the reps who hold a skill.',
  goToSkills: 'Go to Skills',
  loadFailedSkills: 'Skills couldn’t load',
  limit: (max: number) => `A workspace can have at most ${String(max)} fit links.`,

  // States
  failed: 'Couldn’t save. Try again.',
  loadFailed: 'Smart couldn’t load',
  loadFailedText: 'Check your connection and try again.',

  // The remove confirm (owner rule, 21 October 2026)
  removeTitle: 'Remove this fit link?',
  removeText: (field: string, option: string, skill: string) =>
    `Leads whose ${field} is ${option} will no longer go to reps with ${skill} first.`,
  remove: 'Remove',
  cancel: 'Cancel',
};

/** The words L9 adds: the holdout, the segment fields, Learn from and each team page's objective. */
export const learnStrings = {
  // The holdout (AC-1389)
  holdout: 'Holdout',
  holdoutLabel: 'Holdout',
  holdoutHint: 'A share of ranked meetings takes a strict turn, so Insights can tell whether the ranking is helping.',
  holdoutOff: 'Nothing is held back, so Insights has nothing to compare against.',
  holdoutOn: (percent: number) =>
    `${String(percent)}% of ranked meetings take a strict turn, and Insights compares them with the rest.`,
  holdoutClamped: (percent: number) => `Holdout set to ${String(percent)}%, the highest allowed.`,

  // Segment fields (AC-1370)
  segments: 'Segments',
  segmentsHint:
    'Learn separately for each kind of lead. Pick up to two fields of Companies or Deals with at most six options.',
  segmentsNone: 'All leads are counted together.',
  segmentField: (place: number) => `Field ${String(place)}`,
  segmentPick: 'No field',
  segmentsRestart: 'Changing these starts segment learning over. The all-leads numbers carry on.',
  noSegmentFields: 'Nothing to segment by yet',
  noSegmentFieldsText:
    'A segment field is a select or status field of Companies or Deals with at most six live options.',

  // Learn from (AC-1386)
  learnSince: 'Learn from',
  learnSinceHint: 'Ignore outcomes from before a date, to start over after you change how you sell.',
  learnSinceLabel: 'Date',
  learnSinceSet: (day: string) => `Outcomes before ${day} are not counted.`,
  learnSinceUnset: 'Every outcome in the learning window is counted. Clear the date to count everything again.',
  learnSinceCleared: 'Learn from cleared',
  learnSinceStarted: (day: string) => `Learning starts over from ${day} at tonight’s run`,
  // The confirm (owner rule, 21 October 2026; AC-1445)
  learnSinceTitle: 'Start learning over from this date?',
  learnSinceText: (day: string) =>
    `Smart ranking starts over from ${day}. Outcomes of meetings booked before it stop counting at tonight’s run, and a segment may go back to fairness and fit alone until it has enough data again. Clear the date to count them again.`,
  learnSinceConfirm: 'Start over',

  // Each team page's objective (AC-1354)
  objectives: 'What each page learns toward',
  objectivesHint: 'A team page’s ranking learns toward one outcome. Deals created unless you change it.',
  objectiveTable: 'Team pages and their objectives',
  page: 'Team page',
  objective: 'Learning toward',
  objectiveNames: { deal: 'Deals created', won: 'Deals won', held: 'Meetings held' } as const,
  wonNeedsStage: 'Set Won means on Overview to learn toward Deals won.',
  noPages: 'No team pages yet',
  noPagesText: 'A team page’s ranking is what learns; make one in Captures › Links.',
  objectiveOf: (page: string) => `What ${page} learns toward`,

  cancel: 'Cancel',
  failed: 'Couldn’t save. Try again.',
};
