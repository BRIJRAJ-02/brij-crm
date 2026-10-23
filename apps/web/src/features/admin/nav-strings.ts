// Settings › Super admin's navigation and route words (spec 0047): apart from the pages' own copy, so the settings
// frame and the routes, which load up front, carry only these.

/** The Super admin group and its pages' names, as the settings navigation shows them, and the routes' error words. */
export const navStrings = {
  group: 'Super admin',
  overview: 'Overview',
  users: 'Users',
  pages: 'Booking pages',
  website: 'Website',
  /** A page that failed to draw (its route's error screen). */
  failedTitle: 'Couldn’t load the numbers',
  failedText: 'Something went wrong drawing this page. Try again.',
} as const;
