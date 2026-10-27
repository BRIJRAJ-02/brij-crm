// The Apple Wallet pass one person's link page becomes (the owner's design, 27 October 2026). It lives under
// `src/public/` because the pass itself is drawn by `@crm/core/public`, the public booking door, which only the
// public routes may reach; this file is the one place the API turns a person into pass bytes.
import type { Hue, ProfileContactCard } from '@crm/contracts';
import { walletPageUrl } from '@crm/contracts/brand';
import { brandImages, passImages, writePass } from '@crm/core/public';
import type { ApplePassMaker, WalletSettings } from '../wallet/wallet.ts';

/**
 * Makes one person's `.pkpass`, or undefined where Apple has no certificate here. Synchronous: everything a pass
 * needs is already in this process.
 */
/**
 * The `.pkpass` maker, or undefined. The pass itself is drawn by `@crm/core`'s profile pass (the owner's design,
 * 27 October 2026: the gradient in their hue, white type, the wordmark small, the role beside the page), and this
 * only hands it the person, their colour and Apple's keys.
 */
export function createApplePass(settings: WalletSettings): ApplePassMaker | undefined {
  const config = settings.apple;
  if (config === undefined) return undefined;
  const origin = new URL(settings.origin).origin;
  const identity = {
    passTypeIdentifier: config.passTypeId,
    teamIdentifier: config.teamId,
    organizationName: 'Timefix',
  };
  const keys = {
    certificatePem: config.certificatePem,
    intermediatePem: config.wwdrPem,
    keyPem: config.privateKeyPem,
  };
  return (person) => {
    const name = person.name.trim() === '' ? person.handle : person.name;
    // Their card when they have one, else the least a card can be: the name the page shows.
    const card: ProfileContactCard = person.card ?? { fullName: name };
    // `walletPageUrl` sets the source, medium and campaign; the one tag that says who saved this pass is set here.
    const page = `${origin}/${encodeURIComponent(person.handle)}${person.shared === true ? '?utm_content=shared' : ''}`;
    const hue: Hue = person.hue ?? 'blue';
    return writePass(
      {
        card,
        handle: person.handle,
        pageUrl: walletPageUrl(page, 'apple_wallet'),
        theme: { hue },
        serialNumber: person.handle,
        identity,
        images: { ...brandImages(true), ...passImages(hue) },
      },
      keys,
      new Date(),
    );
  };
}
