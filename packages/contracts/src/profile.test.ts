// The profile's picture choice (owner ask A124): the one schema the screen and the API share takes only a true or
// false for it, and a profile reads with or without it (absent for a member with no sign in of their own).
import { describe, expect, it } from 'vitest';
import { MyProfile, UpdateMyProfileInput } from './profile.ts';

const MUTATION = '0199a2c4-0000-7000-8000-000000000001';

describe('UpdateMyProfileInput', () => {
  it('takes the picture choice alone, true or false', () => {
    for (const pictureHidden of [true, false]) {
      expect(UpdateMyProfileInput.parse({ workspace: 'acme', pictureHidden, mutationId: MUTATION })).toEqual({
        workspace: 'acme',
        pictureHidden,
        mutationId: MUTATION,
      });
    }
    expect(UpdateMyProfileInput.parse({ workspace: 'acme', mutationId: MUTATION })).not.toHaveProperty('pictureHidden');
  });

  it('refuses anything but a true or false', () => {
    for (const pictureHidden of ['yes', 1, null, 'true']) {
      expect(
        UpdateMyProfileInput.safeParse({ workspace: 'acme', pictureHidden, mutationId: MUTATION }).success,
        String(pictureHidden),
      ).toBe(false);
    }
  });
});

describe('MyProfile', () => {
  const profile = {
    memberId: MUTATION,
    name: 'Ada',
    email: 'ada@example.com',
    workspaceTimeZone: 'UTC',
    bio: '',
  };

  it('reads with the choice, and without it for a member who has none to make', () => {
    expect(MyProfile.parse({ ...profile, pictureHidden: true }).pictureHidden).toBe(true);
    expect(MyProfile.parse(profile)).not.toHaveProperty('pictureHidden');
  });
});

describe('SocialLinks (booking socials)', () => {
  const parse = (socials: unknown) =>
    UpdateMyProfileInput.safeParse({ workspace: 'acme', socials, mutationId: MUTATION });

  it('takes handles and links, in order, as their canonical links', () => {
    const parsed = parse([
      { network: 'github', href: '@ada' },
      { network: 'website', href: 'ada.dev' },
    ]);
    expect(parsed.success && parsed.data.socials).toEqual([
      { network: 'github', href: 'https://github.com/ada' },
      { network: 'website', href: 'https://ada.dev' },
    ]);
    expect(parse([]).success).toBe(true);
  });

  it('refuses a network twice, an eleventh, an unknown network and a bad link, in plain words on the row', () => {
    const twice = parse([
      { network: 'x', href: 'ada' },
      { network: 'x', href: 'bea' },
    ]);
    expect(twice.success ? [] : twice.error.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['socials.1.network', 'Add X only once.'],
    ]);
    const wrong = parse([{ network: 'linkedin', href: 'https://instagram.com/ada' }]);
    expect(wrong.success ? [] : wrong.error.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['socials.0.href', 'That’s a link to Instagram, not LinkedIn.'],
    ]);
    expect(parse([{ network: 'myspace', href: 'ada' }]).success).toBe(false);
    expect(
      parse(Array.from({ length: 11 }, (_x, index) => ({ network: 'x', href: `a${String(index)}` }))).success,
    ).toBe(false);
  });
});
