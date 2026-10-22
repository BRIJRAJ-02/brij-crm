// The rail's host (spec 0037, AC-1339): personal pages by name and their
// picture when they have one, team pages stack initials under the workspace's name.
import { describe, expect, it } from 'vitest';
import { railHost, railTitle } from './host.ts';

describe('railHost', () => {
  it('gives a personal page exactly its host, as before team pages', () => {
    expect(railHost({ hostName: 'Ada Lovelace' })).toStrictEqual({ name: 'Ada Lovelace' });
  });

  it('gives a personal page its host’s picture when the page names one', () => {
    const image = '/api/public/booking/abcdefghijklmnop/picture';
    expect(railHost({ hostName: 'Ada Lovelace', hostImage: image })).toStrictEqual({ name: 'Ada Lovelace', image });
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

  it('titles a team page with the workspace, and leaves a personal page’s title alone', () => {
    expect(railTitle({ title: 'Coffee chat', hostName: 'Ada Lovelace' })).toBe('Coffee chat');
    expect(railTitle({ title: 'Intro call', hostName: 'Acme', team: { avatars: [], more: 0 } })).toBe(
      'Intro call with Acme',
    );
  });
});
