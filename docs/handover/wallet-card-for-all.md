# Wallet card: from partners to every Timefix workspace

Written 13 November 2026. The owner asked for the custom Apple Wallet card to work for partners first, and "later" for all of Timefix. This note is what is built, and what the later part needs.

## What is built (branch `feat/partner-wallet-card`, migration 0207)

A partner can have its own Apple Wallet card: one colour and one logo, set in the operator console (Settings › Super admin › Partners › Edit › Apple Wallet card).

- **Who gets it.** Every person whose link page is in a workspace with a live connection to that partner. With several connected partners, the oldest live connection that has a card wins. Disconnecting goes back to the Timefix card.
- **What changes on the pass.** The ground (a ramp drawn from the colour: near black at the top, the colour at the foot), the text colour (white, or the app's ink on a pale colour), the logo (in place of the Timefix wordmark) and the organisation name (the partner's). A partner may set only one of the two; the other stays Timefix's.
- **What does not change.** The pass's small icon (still the Timefix mark), the fields, the QR code and its tags, the signing certificate, and Google Wallet.
- **Passes already saved** keep their old look until the person adds the pass again. We do not push pass updates.

Where the code is:

| Part | File |
| --- | --- |
| The colour rule, shared by server and console | `packages/contracts/src/wallet-card.ts` |
| The ground, the look, the logo check | `packages/core/src/profile/pass-brand.ts` |
| Which brand a pass wears | `readPassBrand` in `packages/core/src/access/door.ts` |
| Storage | `auth.partners.wallet_*` (migration 0207), `packages/db/src/identity/partners.ts` |
| The pass maker and routes | `apps/api/src/public/apple-pass.ts`, `apps/api/src/public/wallet.ts` |
| The console form | `apps/web/src/features/partners/PartnersScreen.tsx`, `wallet-card.ts` |

## What "for all of Timefix" needs

The drawing, the logo pipeline and the pass maker already take any brand. Only three things are partner specific: where the card is stored, who may set it, and how a pass finds it.

1. **Storage.** Add the same five columns to the workspace's brand kit (`workspace_brands`, spec 0060, migration 0155): `wallet_colour`, `wallet_logo`, `wallet_logo_2x`, `wallet_logo_3x`, `wallet_logo_version`, with the same two checks. It is a tenant table, so it needs no new policy.
2. **Settings.** A "Wallet card" section in Settings › Brand, with the same two controls and the same preview as the partner form. Move the two controls out of `PartnersScreen.tsx` into one shared part first, so both screens use the same one. Permission: whoever may edit the brand kit.
3. **Lookup.** In `readPassBrand`, read the workspace's own card first, then the partner's, then fall back to Timefix. The read already runs inside the workspace's transaction.

Decisions the owner still has to make before that is built:

- **Who may switch it on.** A card with no Timefix mark is a white label feature. On 31 October 2026 the owner decided "Powered by Timefix" stays on public pages. Either gate this by plan or early access, or keep a small Timefix mark on a workspace's card (the icon already stays).
- **The colour default.** A workspace already has a brand accent (spec 0060). The card could start from that accent instead of asking for a second colour.
- **Google Wallet.** Its pass is a separate object with its own colour and logo fields. Not covered here.

## Not yet done on the partner version

- The form was checked by typecheck, lint and tests, and the logo and preview code was run in a real browser with a real logo, but the form itself has not been looked at in the running app.
- Nothing is pushed or deployed. Migration 0207 has only run on a local test database.
