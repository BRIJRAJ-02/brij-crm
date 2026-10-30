import { describe, expect, it } from 'vitest';
import { brandColours, openBrand, type ImageSend } from './store.ts';

/** A fake API answered by hand: each procedure resolves or rejects as a test sets it. */
function setup(over: { save?: () => Promise<never>; send?: ImageSend } = {}) {
  const sent: string[] = [];
  const store = openBrand({
    brand: {
      get: () => Promise.resolve({ accent: '#1f5fd6', canEdit: true }),
      save: (input) =>
        over.save?.() ??
        Promise.resolve({
          ...(input.accent === null ? {} : { accent: input.accent }),
          ...(input.accentDark === null ? {} : { accentDark: input.accentDark }),
          canEdit: true,
        }),
    },
    profile: {
      look: () => Promise.resolve({ cover: '0123456789ab' }),
      saveAccent: (input) => Promise.resolve({ accent: input.accent, accentDark: input.accentDark }),
    },
    call: (run) => run({}),
    mintId: () => '018f0000-0000-7000-8000-000000000000',
    send:
      over.send ??
      ((path, _workspace, body) => {
        sent.push(`${body === undefined ? 'DELETE' : 'POST'} ${path}`);
        return Promise.resolve(body === undefined ? { removed: true } : { version: 'abcdefabcdef' });
      }),
    now: () => 0,
  });
  return { store, sent };
}

describe('the brand store', () => {
  it('draws no variables for no accent, and the guard’s for a hex', () => {
    expect(brandColours(undefined)).toBeUndefined();
    expect(brandColours('red')).toBeUndefined();
    const drawn = brandColours('#ffd400');
    expect(drawn?.variables.map(([name]) => name)).toContain('--brand-accent');
    // Yellow on a white page can't hold 3:1, so the guard moved it and says so.
    expect(drawn?.adjusted).toBe(true);
  });

  it('shows a kit change at once and keeps what the server answered', async () => {
    const { store } = setup();
    await store.readKit('acme');
    const saving = store.saveKit('acme', '#e8590c');
    const shown = store.kit('acme').getSnapshot();
    expect(shown.status === 'ready' && shown.value.accent).toBe('#e8590c');
    expect(await saving).toBeUndefined();
    const landed = store.kit('acme').getSnapshot();
    expect(landed.status === 'ready' && landed.isSaving).toBe(false);
  });

  it('puts the kit back and hands the refusal back when the save is refused', async () => {
    const { store } = setup({ save: () => Promise.reject(Object.assign(new Error('no'), { status: 403 })) });
    await store.readKit('acme');
    const refusal = await store.saveKit('acme', '#e8590c');
    expect(refusal?.code).toBeDefined();
    const back = store.kit('acme').getSnapshot();
    expect(back.status === 'ready' && back.value.accent).toBe('#1f5fd6');
  });

  it('reads a page’s look with the workspace accent it follows, and names a new photo once it lands', async () => {
    const { store, sent } = setup();
    const look = store.look('acme');
    look.retain();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const read = look.getSnapshot();
    expect(read.status === 'ready' && read.value.workspaceAccent).toBe('#1f5fd6');
    expect(await store.uploadPhoto('acme', 'ground', new Blob(['x'], { type: 'image/jpeg' }))).toBeUndefined();
    const after = look.getSnapshot();
    expect(after.status === 'ready' && after.value.ground).toBe('abcdefabcdef');
    expect(await store.removePhoto('acme', 'cover')).toBeUndefined();
    const gone = look.getSnapshot();
    expect(gone.status === 'ready' && gone.value.cover).toBeUndefined();
    expect(sent).toEqual(['POST /api/me/link-page/ground', 'DELETE /api/me/link-page/cover']);
  });

  it('builds image paths only from checked parts', () => {
    const { store } = setup();
    expect(store.photoSrc('ada', 'cover', '0123456789ab')).toBe('/api/public/profiles/ada/cover?v=0123456789ab');
    expect(store.photoSrc('../x', 'cover', '0123456789ab')).toBeUndefined();
    expect(store.logoSrc('acme', 'nope')).toBeUndefined();
  });
});
