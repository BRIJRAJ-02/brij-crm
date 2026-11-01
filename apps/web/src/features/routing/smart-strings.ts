// The words of Routing › Smart (spec 0037, L8): the mode, the fairness allowance and the fit links. Short labels and
// one live sentence that states the bound in plain words (AC-1364); no help paragraphs.

export const smartStrings = {
  view: 'Smart',

  // Mode
  mode: 'Ranking',
  modeHint: 'How the free reps are ordered once the rules have chosen who may host.',
  modes: { off: 'Off', fit: 'Fit', learn: 'Learn' } as const,
  modeAbout: {
    off: 'Everyone takes their turn, as the rotation says.',
    fit: 'Reps whose skills match the lead come first.',
    learn: 'Skills, and once there is enough data, who closes leads like this.',
  } as const,

  // The fairness allowance
  allowance: 'Fairness allowance',
  allowanceLabel: 'Allowance',
  percent: '%',
  allowanceHint: 'How far the ranking may move a meeting away from the person with the fewest.',
  bound: (meetings: number, windowDays: number) =>
    `Smart ranking can give someone up to ${String(meetings)} more ${meetings === 1 ? 'meeting' : 'meetings'} than the least busy person in the last ${String(windowDays)} days.`,
  boundOff: 'Ranking is off, so everyone keeps their turn.',

  // Fit
  fit: 'Fit',
  fitHint: 'Join an answer to a skill, and reps who hold it come first for those leads.',
  fitTable: 'Fit links',
  field: 'Field',
  option: 'Answer',
  skill: 'Skill',
  actions: 'Actions',
  addLink: 'Add link',
  pickField: 'Pick a field',
  pickOption: 'Pick an answer',
  pickSkill: 'Pick a skill',
  removeLink: 'Remove link',
  removeLinkOf: (option: string, skill: string) => `Remove ${option} to ${skill}`,
  noFit: 'No fit links yet',
  noFitText: 'Add one to put the reps who match a lead first.',
  noFields: 'No select or status fields on People, Companies or Deals yet',
  noSkills: 'Add a skill on the Skills tab first',
  limit: (max: number) => `A workspace can have at most ${String(max)} fit links.`,

  // States
  failed: 'Couldn’t save. Try again.',
  loadFailed: 'Smart couldn’t load',
  loadFailedText: 'Check your connection and try again.',

  // The remove confirm (owner rule, 21 October 2026)
  removeTitle: 'Remove this fit link?',
  removeText: (option: string, skill: string) =>
    `Leads answering ${option} will no longer go to reps with ${skill} first.`,
  remove: 'Remove',
  cancel: 'Cancel',
};
