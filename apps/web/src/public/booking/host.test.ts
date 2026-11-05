// The rail's host (spec 0037, AC-1339): personal pages by name and their
// picture when they have one, team pages stack initials under the workspace's name.
import { describe, expect, it } from 'vitest';
import { hasNoHosts, hostInWords, railHost } from './host.ts';

describe('railHost', () => {
  it('gives a personal page exactly its host, as before team pages', () => {
    expect(railHost({ hostName: 'Ada Lovelace' })).toStrictEqual({ name: 'Ada Lovelace' });
  });

  it('gives a personal page its host’s picture when the page names one', () => {
    const image = '/api/public/booking/abcdefghijklmnop/picture';
    expect(railHost({ hostName: 'Ada Lovelace', hostImage: image })).toStrictEqual({ name: 'Ada Lovelace', image });
  });

  it('gives a personal page its host’s social links, in order, and none when the page has none', () => {
    const socials = [
      { network: 'linkedin', href: 'https://linkedin.com/in/ada', label: 'ada' },
      { network: 'website', href: 'https://ada.dev', label: 'ada.dev' },
    ] as const;
    expect(railHost({ hostName: 'Ada Lovelace', socials: [...socials] }).socials).toStrictEqual(socials);
    expect(railHost({ hostName: 'Ada Lovelace', socials: [] })).toStrictEqual({ name: 'Ada Lovelace' });
  });

  it('never puts social links on a team page’s host, whatever the page says', () => {
    const socials = [{ network: 'x' as const, href: 'https://x.com/ada', label: '@ada' }];
    expect(railHost({ hostName: 'Acme', socials, team: { avatars: [], more: 0 } }).socials).toBeUndefined();
  });

  it('never puts a picture on a team page’s host: its faces stay as the server gave them', () => {
    const host = railHost({ hostName: 'Acme', hostImage: '/x.png', team: { avatars: [{ initials: 'SL' }], more: 0 } });
    expect(host.image).toBeUndefined();
    expect(host.team?.people[0]?.src).toBeUndefined();
  });

  it('stacks a team page under the workspace, counting the rest and naming the team', () => {
    const host = railHost({
      hostName: 'Acme',
      team: {
        avatars: [{ initials: 'SL' }, { initials: 'KP' }, { initials: 'M' }, { initials: 'JB', image: '/a.png' }],
        more: 2,
      },
    });
    expect(host.name).toBe('Acme');
    expect(host.team?.total).toBe(6);
    expect(host.team?.label).toBe('Team of 6');
    expect(host.team?.people.map((person) => person.name)).toStrictEqual(['S L', 'K P', 'M', 'J B']);
    expect(host.team?.people[3]?.src).toBe('/a.png');
  });

  it('says a person’s name in a sentence, and "the team" for a team page, never the workspace’s name', () => {
    expect(hostInWords({ hostName: 'Ada Lovelace' })).toBe('Ada Lovelace');
    expect(hostInWords({ hostName: 'Brij’s workspace', team: { avatars: [{ initials: 'BR' }], more: 0 } })).toBe(
      'the team',
    );
  });

  it('knows a team page with nobody on it, and that a personal page always has its host', () => {
    expect(hasNoHosts({ team: { avatars: [], more: 0 } })).toBe(true);
    expect(hasNoHosts({ team: { avatars: [{ initials: 'BR' }], more: 0 } })).toBe(false);
    expect(hasNoHosts({})).toBe(false);
  });
});
