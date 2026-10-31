// Where a check leaves a domain (spec 0064, AC-6402 to AC-6404, AC-6408).
import { describe, expect, it } from 'vitest';
import {
  CHECK_EVERY_SECONDS,
  decideCheck,
  DOMAIN_PROBLEMS,
  LIVE_CHECK_EVERY_SECONDS,
  recordsFor,
  VERCEL_DEFAULT_CNAME,
  WAIT_FOR_TXT_MS,
  type CheckedDomain,
  type VercelHostView,
} from './status.ts';

const NOW = new Date('2026-10-31T12:00:00Z');
const TOKEN = 'a'.repeat(32);

const domain = (changes: Partial<CheckedDomain> = {}): CheckedDomain => ({
  host: 'book.janedoe.com',
  kind: 'subdomain',
  status: 'waiting',
  verifyToken: TOKEN,
  records: [],
  waitingSince: new Date(NOW.getTime() - 60_000),
  ...changes,
});

const vercel = (changes: Partial<VercelHostView> = {}): VercelHostView => ({
  attached: true,
  verified: true,
  misconfigured: false,
  verification: [],
  cname: 'abc123.vercel-dns-017.com',
  ...changes,
});

describe('recordsFor', () => {
  it('leads with the ownership TXT, then what Vercel recommends', () => {
    expect(recordsFor(domain(), vercel())).toEqual([
      { type: 'TXT', name: '_timefix.book.janedoe.com', value: `timefix-verify=${TOKEN}`, purpose: 'ownership' },
      { type: 'CNAME', name: 'book.janedoe.com', value: 'abc123.vercel-dns-017.com', purpose: 'routing' },
    ]);
  });

  it('shows the A records Vercel recommends for an apex, and none it has not given', () => {
    const apex = domain({ host: 'janedoe.com', kind: 'apex' });
    expect(recordsFor(apex, vercel({ aValues: ['76.76.21.21'] })).map((record) => record.type)).toEqual(['TXT', 'A']);
    expect(recordsFor(apex).map((record) => record.type)).toEqual(['TXT']);
  });

  it('falls back to Vercel’s documented CNAME for a subdomain before Vercel answers', () => {
    expect(recordsFor(domain())[1]).toMatchObject({ type: 'CNAME', value: VERCEL_DEFAULT_CNAME });
  });

  it('adds Vercel’s own _vercel TXT while it asks for one', () => {
    const asked = vercel({
      verified: false,
      verification: [{ name: '_vercel.janedoe.com', value: 'vc-domain-verify=x' }],
    });
    expect(recordsFor(domain(), asked).at(-1)).toEqual({
      type: 'TXT',
      name: '_vercel.janedoe.com',
      value: 'vc-domain-verify=x',
      purpose: 'vercel',
    });
  });
});

describe('decideCheck', () => {
  it('waits, checked every 15 minutes, while the TXT record is missing', () => {
    expect(decideCheck(domain(), { txt: 'missing' }, NOW)).toMatchObject({
      status: 'waiting',
      verifiedNow: false,
      nextInSeconds: CHECK_EVERY_SECONDS,
    });
  });

  it('fails after 7 days with no TXT record, and stops checking', () => {
    const old = domain({ waitingSince: new Date(NOW.getTime() - WAIT_FOR_TXT_MS) });
    const decision = decideCheck(old, { txt: 'missing' }, NOW);
    expect(decision).toMatchObject({ status: 'failed', problem: DOMAIN_PROBLEMS.noTxt });
    expect(decision.nextInSeconds).toBeUndefined();
  });

  it('is proved when the TXT record is found, and checking until Vercel answers', () => {
    expect(decideCheck(domain(), { txt: 'found', vercel: 'unknown' }, NOW)).toMatchObject({
      status: 'checking',
      verifiedNow: true,
      nextInSeconds: CHECK_EVERY_SECONDS,
    });
  });

  it('goes live once Vercel reports it verified and configured, then checks daily', () => {
    expect(decideCheck(domain(), { txt: 'found', vercel: vercel() }, NOW)).toMatchObject({
      status: 'live',
      verifiedNow: true,
      liveNow: true,
      nextInSeconds: LIVE_CHECK_EVERY_SECONDS,
    });
    const live = domain({ status: 'live', verifiedAt: NOW, liveAt: NOW });
    // A TXT record taken down later changes nothing once proved.
    expect(decideCheck(live, { txt: 'missing', vercel: vercel() }, NOW)).toMatchObject({
      status: 'live',
      liveNow: false,
    });
  });

  it('stays checking, naming Vercel’s record, while Vercel wants its own TXT', () => {
    const asked = vercel({ verified: false, verification: [{ name: '_vercel.janedoe.com', value: 'v' }] });
    expect(
      decideCheck(domain({ verifiedAt: NOW, status: 'checking' }), { txt: 'found', vercel: asked }, NOW),
    ).toMatchObject({
      status: 'checking',
      problem: DOMAIN_PROBLEMS.vercel,
    });
  });

  it('needs attention, saying what is wrong, when a live domain’s DNS moves away', () => {
    const live = { status: 'live' as const, verifiedAt: NOW, liveAt: NOW };
    expect(decideCheck(domain(live), { txt: 'found', vercel: vercel({ misconfigured: true }) }, NOW)).toMatchObject({
      status: 'attention',
      problem: DOMAIN_PROBLEMS.cname,
      nextInSeconds: CHECK_EVERY_SECONDS,
    });
    const apex = domain({ ...live, host: 'janedoe.com', kind: 'apex' });
    expect(decideCheck(apex, { txt: 'found', vercel: vercel({ misconfigured: true }) }, NOW)).toMatchObject({
      problem: DOMAIN_PROBLEMS.aRecord,
    });
  });

  it('keeps a live domain as it is when Vercel could not be read', () => {
    const live = domain({ status: 'live', verifiedAt: NOW, liveAt: NOW });
    expect(decideCheck(live, { txt: 'unknown', vercel: 'unknown' }, NOW)).toMatchObject({ status: 'live' });
  });

  it('leaves a failed or removed domain alone', () => {
    expect(decideCheck(domain({ status: 'failed' }), { txt: 'found' }, NOW).status).toBe('failed');
    expect(decideCheck(domain({ status: 'removed' }), { txt: 'found' }, NOW).nextInSeconds).toBeUndefined();
  });
});
