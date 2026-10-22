/** WorkspacePreview's built in words: the app's own labels, and the sample workspace sign in shows. */
export const strings = {
  /** The sidebar's rows, as the app names them. */
  nav: { home: 'Home', inbox: 'Inbox', tasks: 'Tasks', calendar: 'Calendar', booking: 'Bookings', forms: 'Forms' },
  records: 'Records',
  objects: { people: 'People', companies: 'Companies', deals: 'Deals' },
  /** The sample workspace and person, before anyone has typed (sign in, verify, join). */
  sampleWorkspace: 'Halcyon Labs',
  samplePerson: 'Maya Chen',
  /** The sample People table: a name and the company beside it. */
  samplePeople: [
    ['Ada Lovelace', 'Analytical Engines'],
    ['Grace Hopper', 'Compiler Works'],
    ['Alan Turing', 'Bletchley Park'],
    ['Katherine Johnson', 'Langley Research'],
    ['Margaret Hamilton', 'Apollo Software'],
    ['Tim Berners-Lee', 'World Wide Web'],
    ['Radia Perlman', 'Spanning Tree'],
    ['Barbara Liskov', 'Substitution Labs'],
    ['Linus Torvalds', 'Kernel Group'],
    ['Hedy Lamarr', 'Frequency Hopping'],
    ['Dennis Ritchie', 'Bell Labs'],
    ['Frances Allen', 'Optimising Compilers'],
    ['John Backus', 'Formula Translation'],
    ['Edsger Dijkstra', 'Shortest Paths'],
    ['Donald Knuth', 'Literate Programs'],
    ['Joan Clarke', 'Hut 8'],
    ['Claude Shannon', 'Information Theory'],
    ['Sophie Wilson', 'Acorn Computers'],
  ] as const,
} as const;
