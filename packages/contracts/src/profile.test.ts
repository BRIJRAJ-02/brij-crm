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
