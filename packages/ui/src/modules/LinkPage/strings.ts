/** LinkPage's built in copy. */
export const strings = {
  /** The typeface sample in a look's thumbnail (LinkPageThumbnail): two letters, so a mono look reads as mono. */
  thumbnailSample: 'Aa',
  /** Read after a link's own words: it opens in a new tab. */
  newTab: '(opens in a new tab)',
  /** The blocks as one list, for screen readers, when no heading names them. */
  blocks: 'Links',
  loading: 'Loading…',
  /** What a set of questions is called when its owner gave it no title of its own (spec 0052, AC-5209). */
  questions: 'Questions',
  /** The one primary action under the person: their contact card, downloaded as a vCard. */
  saveContact: 'Save contact',
  /** Under Save contact: the page as a pass a visitor keeps in Apple Wallet (26 October 2026). */
  addToWallet: 'Add to Apple Wallet',
  /** The address pill under the bio: its visible label is the address itself, so its name says what pressing it does. */
  copyAddress: (address: string) => `${address}, copy link`,
  /** The toast the address pill raises once it has copied. */
  addressCopied: 'Link copied',
  /**
   * Read on a folded section's row after its words (AC-5416): the number beside the chevron is shown, and this
   * says what it counts, so the row reads as "Work, 3 links inside, collapsed" rather than as a bare number.
   */
  inside: (count: number) => (count === 1 ? '1 link inside' : `${String(count)} links inside`),
  /** A site icon names nothing a reader needs: the title beside it already says where the link goes. */
  siteIconAlt: '',
  /** A link's thumbnail (spec 0061, AC-6101) is decoration too: the title beside or under it names the link. */
  thumbAlt: '',
  /** The banner's landmark name (AC-6112). */
  banner: 'Announcement',
  /** The banner's close button (AC-6112): it goes for this visit. */
  closeBanner: 'Close banner',
  /** The socials row block, for screen readers (AC-6104). */
  socials: 'Social links',
  /** The media facade's button (AC-6106), named for what it plays. */
  play: (title: string) => `Play ${title}`,
  /** Under a media block's title, before anything loads from the provider (AC-6106). */
  playsFrom: (provider: string) => `Plays from ${provider}`,
  /** A media block that can't play here: its player's address was refused, or its code couldn't load. */
  cantPlay: 'Can’t play here',
  /** Each provider's own name, for "Plays from YouTube": `MEDIA_PROVIDER_NAMES` in the contracts, repeated here. */
  providers: {
    youtube: 'YouTube',
    vimeo: 'Vimeo',
    spotify: 'Spotify',
    soundcloud: 'SoundCloud',
    applemusic: 'Apple Music',
  },
  /** A picture that is a link, named by its alt text and where it opens. */
  linkedPicture: (alt: string) => `${alt} (opens in a new tab)`,
  /** A gallery's pictures, for screen readers (AC-6109). */
  gallery: 'Pictures',
  /** A gallery picture's button: it opens the picture large. */
  openPicture: (alt: string) => `${alt}, open large`,
  /** The gallery row's buttons on wide screens, and the viewer's. */
  previous: 'Previous picture',
  next: 'Next picture',
  /** The viewer's place in the gallery, beside its title: "2 of 5". */
  pictureOf: (at: number, of: number) => `${String(at)} of ${String(of)}`,
  /** A next times block (AC-6110). */
  moreTimes: 'More times',
  noTimes: 'No open times in the next two weeks',
  timesLoading: 'Loading open times…',
  /** Under a next times block's title: the length its chips are for. */
  minutes: (minutes: number) => `${String(minutes)} min`,
  /** The times' list, for screen readers. */
  times: (title: string) => `Next open times for ${title}`,
  /** The notice sheet (AC-6113): its two answers. The question itself is `profileNoticeSentence`, from the caller. */
  noticeContinue: 'Continue',
  noticeBack: 'Go back',
  /** What each notice says, as `profileNoticeSentence` in the contracts writes it, repeated here. */
  notices: {
    sensitive: 'This link may show sensitive content.',
    '18': 'You need to be 18 or older to open this.',
    '21': 'You need to be 21 or older to open this.',
  },
  /** Read after a link that asks first: pressing it opens a notice, not the link. */
  asksFirst: '(asks before it opens)',
} as const;
