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
