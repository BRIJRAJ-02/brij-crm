/** Share specific times (the bookings area, 5 November 2026). */
export const shareTimesStrings = {
  title: 'Share specific times',
  help: 'Pick 2 to 5 open times. The link offers only those, and only while they are still free.',
  notLive: 'Publish the page to share its times.',
  noTimes: 'No open times in these days.',
  failed: 'The open times couldn’t load.',
  nextWeek: 'Show the next week',
  actions: 'Share the times',
  copyLink: 'Copy link',
  copyText: 'Copy text',
  pickMore: 'Pick at least 2 times.',
  tooMany: 'A link offers at most 5 times. Untick one to pick another.',
  textLead: (title: string, minutes: number) => `Would one of these work for ${title} (${String(minutes)} min)?`,
  textZone: (zone: string) => `Times in ${zone}.`,
  textPick: (link: string) => `Pick one here: ${link}`,
} as const;
