// Add to Wallet (the owner, 26 October 2026): the owner carries their own link page in their wallet and shows its
// code, instead of spelling an address out. This file is what the rest of the API sees — one maker per wallet, or
// nothing where this environment has no credentials for it — so a handler never touches a key or a certificate.
//
// The pass holds only what the page already shows: their name, the line under it, and their address. A scan opens
// that address tagged `utm_medium=<wallet>` (`walletPageUrl`), so a visit from the pass is tellable from one from
// a shared link.
import type { WalletKind } from '@crm/contracts/brand';
import { applePkpass, type AppleWalletConfig } from './apple.ts';
import { passBackground, passBackground2x } from './background.ts';
import { googleWalletLink, type GoogleWalletConfig } from './google.ts';
import { passIcons } from './icon.ts';

/** The one page a pass stands for, as a handler knows it: read from the profile the handle belongs to. */
export interface WalletPerson {
  readonly handle: string;
  readonly name: string;
  readonly bio?: string;
  /**
   * Whether somebody other than the owner is saving it (26 October 2026). The pass is the same either way; what
   * changes is the code's tag, so a visit from a pass a visitor saved reads apart from one the owner carries.
   */
  readonly shared?: boolean;
}

/** Makes one save link for one person. Never throws for a missing credential: there is no maker without one. */
export type WalletLinkMaker = (person: WalletPerson) => string;

/** What the makers are built from: the origin pages are served on, and whichever wallets are configured. */
export interface WalletSettings {
  /** The origin a page's address is on, which is also the origin a save link may be pressed from. */
  readonly origin: string;
  readonly google?: GoogleWalletConfig | undefined;
  readonly apple?: AppleWalletConfig | undefined;
}

/** Where a browser asks for the caller's own `.pkpass`. A plain link, so it works with no script. */
export const APPLE_PASS_PATH = '/api/me/wallet/pass.pkpass';

/**
 * The maker for each wallet, or undefined where this environment has no credentials for it. Built once by
 * `createApp` and handed to handlers through the request context, so nothing downstream reads the environment.
 *
 * Google's answer is the save link itself, since Google takes the whole pass in one. Apple's is the address of
 * this API's own route, because a `.pkpass` is a file a browser downloads, not a link somewhere else.
 */
export function createWalletLinks(settings: WalletSettings): (wallet: WalletKind) => WalletLinkMaker | undefined {
  const origin = new URL(settings.origin).origin;
  return (wallet) => {
    if (wallet === 'apple_wallet') {
      // The route needs to know whose pass it is making, and checks that the handle is really the caller's.
      return settings.apple === undefined
        ? undefined
        : (person) => `${APPLE_PASS_PATH}?handle=${encodeURIComponent(person.handle)}`;
    }
    const config = settings.google;
    if (config === undefined) return undefined;
    return (person) =>
      googleWalletLink(config, {
        handle: person.handle,
        name: person.name,
        ...(person.bio === undefined || person.bio === '' ? {} : { bio: person.bio }),
        pageUrl: `${origin}/${encodeURIComponent(person.handle)}`,
        origin,
      });
  };
}

/**
 * Makes one person's `.pkpass`, or undefined where Apple has no certificate here. Synchronous since the ground
 * stopped being fetched (26 October 2026): everything a pass needs is already in this process.
 */
export type ApplePassMaker = (person: WalletPerson) => Uint8Array;

/** The `.pkpass` maker, or undefined: the one thing the route needs, built from the same settings. */
export function createApplePass(settings: WalletSettings): ApplePassMaker | undefined {
  const config = settings.apple;
  if (config === undefined) return undefined;
  const origin = new URL(settings.origin).origin;
  // The ground is the same for every pass, so it is drawn once when the maker is built rather than per request.
  const background = passBackground();
  const background2x = passBackground2x();
  return (person) => {
    const icons = passIcons();
    // `walletPageUrl` sets the source, medium and campaign and leaves everything else alone, so the one tag that
    // says who saved this pass is set here and survives.
    const page = `${origin}/${encodeURIComponent(person.handle)}${person.shared === true ? '?utm_content=shared' : ''}`;
    return applePkpass(config, {
      handle: person.handle,
      name: person.name,
      ...(person.bio === undefined || person.bio === '' ? {} : { bio: person.bio }),
      pageUrl: page,
      icon: icons.icon,
      icon2x: icons.icon2x,
      background,
      background2x,
    });
  };
}
