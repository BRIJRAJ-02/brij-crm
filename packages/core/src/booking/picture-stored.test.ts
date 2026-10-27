// A picture the person uploaded (27 Oct 2026), pure: `user.image` names it as `stored:` and a path bound to their own
// id, so one person's picture field can never be made to serve another person's file, a path that climbs, or a URL;
// and `personPicture` answers either kind, the upload before Google's, with a version that moves with the picture.
import { describe, expect, it } from 'vitest';
import {
  personPicture,
  pictureVersion,
  servedPicture,
  storedPictureImage,
  storedPictureOf,
  storedPicturePath,
} from './picture.ts';

const ADA = '01a17d71-1ebc-7ae4-986b-7879179e331a';
const GRACE = '01a17d71-1ebc-7ae4-986b-7879179e3399';
const FILE = '4915d312-c68c-4adf-9a55-a86ddf6ccf5c';
const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c';

describe('an uploaded picture', () => {
  it('is kept under the person’s own id, with nothing in the path anyone typed', () => {
    expect(storedPicturePath(ADA, FILE, 'jpg')).toBe(`pictures/${ADA}/${FILE}.jpg`);
    // Ids come in lowercase whatever case they were minted in, so the binding below compares like with like.
    expect(storedPicturePath(ADA.toUpperCase(), FILE.toUpperCase(), 'png')).toBe(`pictures/${ADA}/${FILE}.png`);
    expect(storedPictureImage(`pictures/${ADA}/${FILE}.jpg`)).toBe(`stored:pictures/${ADA}/${FILE}.jpg`);
  });

  it('is read back only for its owner', () => {
    const image = storedPictureImage(storedPicturePath(ADA, FILE, 'webp'));
    expect(storedPictureOf(ADA, image)).toBe(`pictures/${ADA}/${FILE}.webp`);
    // Grace's field naming Ada's file serves nothing: the path must carry the reader's own id.
    expect(storedPictureOf(GRACE, image)).toBeUndefined();
  });

  it('refuses anything that isn’t exactly its shape', () => {
    const refused = [
      undefined,
      '',
      GOOGLE,
      `pictures/${ADA}/${FILE}.jpg`, // no prefix
      `stored:pictures/${ADA}/../${GRACE}/${FILE}.jpg`,
      `stored:pictures/${ADA}/${FILE}.svg`,
      `stored:pictures/${ADA}/${FILE}.gif`,
      `stored:pictures/${ADA}/${FILE}.jpg?x=1`,
      `stored:forms/${ADA}/${FILE}.jpg`,
      `stored:/pictures/${ADA}/${FILE}.jpg`,
      `stored:pictures/${ADA}/not-a-uuid.jpg`,
      `stored:https://evil.example/pictures/${ADA}/${FILE}.jpg`,
    ];
    for (const image of refused) expect(storedPictureOf(ADA, image)).toBeUndefined();
  });
});

describe('a person’s picture to serve', () => {
  it('is their upload, read from the store, when they have one', () => {
    const image = storedPictureImage(storedPicturePath(ADA, FILE, 'jpg'));
    expect(personPicture(ADA, image)).toEqual({
      kind: 'stored',
      path: `pictures/${ADA}/${FILE}.jpg`,
      version: pictureVersion(ADA, image),
    });
  });

  it('is Google’s by the same rules as before, otherwise', () => {
    const google = personPicture(ADA, GOOGLE);
    expect(google?.kind).toBe('google');
    expect(google?.version).toBe(servedPicture(ADA, GOOGLE)?.version);
  });

  it('is nothing for a picture that is neither', () => {
    expect(personPicture(ADA, undefined)).toBeUndefined();
    expect(personPicture(ADA, 'https://evil.example/me.jpg')).toBeUndefined();
    expect(personPicture(GRACE, storedPictureImage(storedPicturePath(ADA, FILE, 'jpg')))).toBeUndefined();
  });

  it('moves to a new version with a new upload, so nothing cached under the old one shows', () => {
    const first = personPicture(ADA, storedPictureImage(storedPicturePath(ADA, FILE, 'jpg')));
    const second = personPicture(ADA, storedPictureImage(storedPicturePath(ADA, GRACE, 'jpg')));
    expect(first?.version).not.toBe(second?.version);
  });

  it('keeps `servedPicture` Google’s alone, which the sign in code relies on', () => {
    expect(servedPicture(ADA, storedPictureImage(storedPicturePath(ADA, FILE, 'jpg')))).toBeUndefined();
  });
});
