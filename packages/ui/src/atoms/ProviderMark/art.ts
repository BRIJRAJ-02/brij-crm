// Every brand mark's artwork, inlined by the build as data URIs (about 13 kB). UiProvider gives it to ProviderMark
// through ProviderArtContext, so it loads with the app, the booking pages and Storybook, and stays out of the hosted
// form's first load, which never draws a mark (it mounts UiProviderBase).
import appleCalendar from '../../assets/apple-calendar.svg';
import googleCalendar from '../../assets/google-calendar.svg';
import googleG from '../../assets/google-g.svg';
import outlook from '../../assets/outlook.svg';
import angellistDark from '../../assets/social-angellist-dark.svg';
import angellistLight from '../../assets/social-angellist-light.svg';
import facebook from '../../assets/social-facebook.svg';
import githubDark from '../../assets/social-github-dark.svg';
import githubLight from '../../assets/social-github-light.svg';
import instagram from '../../assets/social-instagram.svg';
import linkedin from '../../assets/social-linkedin.svg';
import threadsDark from '../../assets/social-threads-dark.svg';
import threadsLight from '../../assets/social-threads-light.svg';
import tiktokDark from '../../assets/social-tiktok-dark.svg';
import tiktokLight from '../../assets/social-tiktok-light.svg';
import xDark from '../../assets/social-x-dark.svg';
import xLight from '../../assets/social-x-light.svg';
import youtube from '../../assets/social-youtube.svg';
import timefixDark from '../../assets/timefix-mark-dark.svg';
import timefixLight from '../../assets/timefix-mark-light.svg';
import type { ProviderArt } from './art-context.ts';

/** One image per brand; a black mark (Timefix, X, GitHub, AngelList, TikTok, Threads) has a light and a dark one, shown by theme like the wordmark. */
export const providerArt: ProviderArt = {
  google: googleG,
  'google-calendar': googleCalendar,
  outlook,
  'apple-calendar': appleCalendar,
  timefix: { light: timefixLight, dark: timefixDark },
  linkedin,
  x: { light: xLight, dark: xDark },
  instagram,
  github: { light: githubLight, dark: githubDark },
  facebook,
  youtube,
  angellist: { light: angellistLight, dark: angellistDark },
  tiktok: { light: tiktokLight, dark: tiktokDark },
  threads: { light: threadsLight, dark: threadsDark },
};
