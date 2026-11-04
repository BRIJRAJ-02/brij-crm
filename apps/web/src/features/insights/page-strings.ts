// One page's numbers (PageInsights): a form's Analytics today, a booking page's and the link page's next. Plain and
// short; every count a whole number.

export const pageStrings = {
  summary: 'This period',
  stops: 'Where people stop',
  stopsTable: 'How far people got',
  reached: 'Reached',
  share: 'Of those who started',
  lost: 'Stopped here',
  nobodyStopped: 'Everyone who started finished.',
  worstStop: (name: string, stopped: string, reached: string) =>
    `Most people stop at “${name}”: ${stopped} of the ${reached} who got there.`,
  ofStarted: (reached: string, started: string) => `${reached} of ${started} who started`,
  ofViews: (views: string, total: string) => `${views} of ${total} views`,
  overTime: 'Views over time',
  overTimeChart: (period: string) => `Views per day over ${period}`,
  day: 'Day',
  views: 'Views',
  finished: 'Finished',
  sources: 'Where they come from',
  source: 'Source',
  noSources: 'Nothing yet',
} as const;
