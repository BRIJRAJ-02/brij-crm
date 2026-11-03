// A link page's Changes list (spec 0068, AC-6811): each difference between what guests see and the draft, in words.
import { describe, expect, it } from 'vitest';
import { diffLinkPage, linkSnapshotOf, photoPathsOf } from './link-drafts.ts';

const page = (fields: Record<string, unknown>, items: readonly Record<string, unknown>[] = []) =>
  linkSnapshotOf({ bio: '', theme: { template: 'classic', avatar: 'circle' }, ...fields, items });

const link = (id: string, title: string) => ({ id, kind: 'link', position: 0, data: { title, url: 'https://a.co' } });

describe('a link page’s changes', () => {
  it('says nothing for a draft the same as the page', () => {
    const one = page({ bio: 'Hi' }, [link('a', 'Shop')]);
    expect(diffLinkPage(one, one)).toEqual([]);
  });

  it('names the profile’s changes, then each block added, changed and removed, and a move once', () => {
    const published = page({ bio: 'Hi', cover_path: 'x/1.jpg' }, [
      link('a', 'Shop'),
      link('b', 'Blog'),
      link('c', 'Old'),
    ]);
    const draft = page(
      {
        bio: 'Hello',
        theme: { template: 'studio', avatar: 'rounded' },
        accent: '#112233',
        show_job_title: true,
      },
      [link('b', 'Blog'), link('a', 'Shop, renamed'), link('d', 'New')],
    );
    expect(diffLinkPage(published, draft)).toEqual([
      'Bio changed',
      'Template Classic → Studio',
      'Face Circle → Rounded',
      'Colour changed',
      'Cover photo removed',
      'Job title shown',
      'Changed “Shop, renamed”',
      'Added “New”',
      'Removed “Old”',
      'Order changed',
    ]);
  });

  it('reads a page never published as empty, so each block reads as added', () => {
    expect(diffLinkPage(linkSnapshotOf(null), page({}, [link('a', 'Shop')]))).toEqual([
      'Template Classic',
      'Added “Shop”',
    ]);
  });

  it('names the photos a snapshot keeps in the store', () => {
    expect(photoPathsOf(page({ cover_path: 'x/1.jpg', ground_path: null }))).toEqual(['x/1.jpg']);
  });
});
