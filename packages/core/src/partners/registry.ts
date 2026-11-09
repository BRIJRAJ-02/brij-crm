// The partner registry (spec 0070, AC-7010), the operator console's side: list, register, change and replace the
// secret. Who may call these is the api's operator gate (OPERATOR_EMAILS, two factor, a recent sign in), never this
// module, and the api keeps each write in the console's log. A secret is answered once, by the call that made it;
// only its SHA-256 is stored, and replacing it stops the old one with that write.
import type {
  PartnerList,
  PartnerView,
  PartnerWithSecret,
  RegisterPartnerInput,
  UpdatePartnerInput,
} from '@crm/contracts';
import type { PartnerAudit, PartnerChange, PartnerIdentity, PartnerRow } from '@crm/db';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { frameOriginProblem, partnerLogoPath, readPartnerLogo, redirectUriProblem } from './addresses.ts';
import { newClientId, newPartnerSecret, partnerSecretHash, partnerSecretHint } from './tokens.ts';

/** What the registry needs: the identity store's partner rows. */
export interface PartnerRegistryDeps {
  readonly partners: Pick<
    PartnerIdentity,
    'listPartners' | 'partnerById' | 'addPartner' | 'updatePartner' | 'replacePartnerSecret'
  >;
}

const UNKNOWN = 'There is no partner with that id.';

/** A row as the console shows it: never the hash. */
export function toPartnerView(row: PartnerRow): PartnerView {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    ...(row.logoVersion === undefined ? {} : { logoUrl: partnerLogoPath(row.clientId, row.logoVersion) }),
    frameOrigins: [...row.frameOrigins],
    redirectUris: [...row.redirectUris],
    secretHint: row.secretHint,
    createdAt: row.createdAt.toISOString(),
    ...(row.secretReplacedAt === undefined ? {} : { secretReplacedAt: row.secretReplacedAt.toISOString() }),
    isTest: row.isTest,
  };
}

/** The addresses as given, once each, after refusing any that isn't one (on its field). */
function checkedAddresses(
  values: readonly string[],
  problem: (value: string) => string | undefined,
  field: 'frameOrigins' | 'redirectUris',
): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
  for (const value of unique) {
    const found = problem(value);
    if (found !== undefined) throw refuseOn('CONFIG_INVALID', found, field);
  }
  return unique;
}

/** A logo upload's bytes, or a refusal on `logo`. */
function checkedLogo(upload: NonNullable<RegisterPartnerInput['logo']>) {
  const read = readPartnerLogo(upload);
  if ('problem' in read) throw refuseOn('CONFIG_INVALID', read.problem, 'logo');
  return read;
}

/** Every partner, newest first. */
export async function listPartners(deps: PartnerRegistryDeps): Promise<PartnerList> {
  const rows = await deps.partners.listPartners();
  return { partners: rows.map(toPartnerView) };
}

/** Registers a partner and answers its client id and its whole secret, once (AC-7010). */
export async function registerPartner(
  deps: PartnerRegistryDeps,
  input: RegisterPartnerInput,
  audit: PartnerAudit,
): Promise<PartnerWithSecret> {
  const name = input.name.trim();
  const frameOrigins = checkedAddresses(input.frameOrigins, frameOriginProblem, 'frameOrigins');
  const redirectUris = checkedAddresses(input.redirectUris, redirectUriProblem, 'redirectUris');
  if (redirectUris.length === 0) {
    throw refuseOn('CONFIG_INVALID', 'Add the address that receives a connection.', 'redirectUris');
  }
  const logo = input.logo === undefined ? undefined : checkedLogo(input.logo);
  const secret = newPartnerSecret();
  const row = await deps.partners.addPartner(
    {
      clientId: newClientId(),
      name,
      ...(logo === undefined ? {} : { logo }),
      frameOrigins,
      redirectUris,
      secretHash: partnerSecretHash(secret),
      secretHint: partnerSecretHint(secret),
      createdBy: audit.userId,
      ...(input.isTest === true ? { isTest: true } : {}),
    },
    audit,
  );
  return { partner: toPartnerView(row), secret };
}

/** Changes a partner's name, logo or addresses; a connect already under way is checked against the new ones. */
export async function updatePartner(
  deps: PartnerRegistryDeps,
  input: UpdatePartnerInput,
  audit: PartnerAudit,
): Promise<PartnerView> {
  const change: PartnerChange = {
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(input.frameOrigins === undefined
      ? {}
      : { frameOrigins: checkedAddresses(input.frameOrigins, frameOriginProblem, 'frameOrigins') }),
    ...(input.redirectUris === undefined
      ? {}
      : { redirectUris: checkedAddresses(input.redirectUris, redirectUriProblem, 'redirectUris') }),
    ...(input.logo === undefined ? {} : { logo: input.logo === null ? null : checkedLogo(input.logo) }),
    ...(input.isTest === undefined ? {} : { isTest: input.isTest }),
  };
  if (change.redirectUris?.length === 0) {
    throw refuseOn('CONFIG_INVALID', 'Keep at least one address that receives a connection.', 'redirectUris');
  }
  const row = await deps.partners.updatePartner(input.partnerId, change, audit);
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN);
  return toPartnerView(row);
}

/** Replaces a partner's secret: the old one stops with this write, and the new one is answered once. */
export async function replacePartnerSecret(
  deps: PartnerRegistryDeps,
  input: { readonly partnerId: string },
  audit: PartnerAudit,
): Promise<PartnerWithSecret> {
  const existing = await deps.partners.partnerById(input.partnerId);
  if (existing === undefined) throw refuse('NOT_FOUND', UNKNOWN);
  const secret = newPartnerSecret();
  const row = await deps.partners.replacePartnerSecret(
    input.partnerId,
    partnerSecretHash(secret),
    partnerSecretHint(secret),
    audit,
  );
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN);
  return { partner: toPartnerView(row), secret };
}
