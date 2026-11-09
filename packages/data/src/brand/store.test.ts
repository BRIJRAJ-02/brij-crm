import { describe, expect, it } from 'vitest';
import { brandColours, openBrand, type ImageSend } from './store.ts';

/** A fake API answered by hand: each procedure resolves or rejects as a test sets it. */
function setup(over: { save?: () => Promise<never>; send?: ImageSend; member?: string } = {}) {
  const sent: string[] = [];
  const store = openBrand({
    brand: {
      get: () => Promise.resolve({ accent: '#1f5fd6', template: 'classic' as const, canEdit: true }),
      save: (input) =>
        over.save?.() ??
        Promise.resolve({
          ...(input.accent === null ? {} : { accent: input.accent }),
          ...(input.accentDark === null ? {} : { accentDark: input.accentDark }),
          template: 'classic' as const,
          ...(input.template === undefined || input.template === 'classic' ? {} : { templateDraft: input.template }),
          canEdit: true,
        }),
      publishTemplate: () => Promise.resolve({ accent: '#1f5fd6', template: 'studio' as const, canEdit: true }),
      discardTemplate: () => Promise.resolve({ accent: '#1f5fd6', template: 'classic' as const, canEdit: true }),
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
    ...(over.member === undefined ? {} : { member: over.member }),
  });
  return { store, sent };
}

describe('the workspace template (spec 0068)', () => {
  it('waits as a draft until Publish, and Discard lets it go', async () => {
    const { store } = setup();
    await store.readKit('acme');
    const held = () => {
      const state = store.kit('acme').getSnapshot();
      return state.status === 'ready' ? state.value : undefined;
    };
    expect(await store.saveTemplate('acme', 'studio')).toBeUndefined();
    expect(held()).toMatchObject({ template: 'classic', templateDraft: 'studio' });
    expect(await store.publishTemplate('acme')).toBeUndefined();
    expect(held()).toMatchObject({ template: 'studio' });
    expect(held()).not.toHaveProperty('templateDraft');
  });
});

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

  it('says Same photo when the page already has exactly the photo sent (spec 0068)', async () => {
    const { store } = setup({ send: () => Promise.resolve({ version: 'abcdefabcdef', same: true }) });
    const look = store.look('acme');
    look.retain();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await store.uploadPhoto('acme', 'cover', new Blob(['x'], { type: 'image/jpeg' }))).toBe('same');
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
    expect(store.photoSrc('acme', 'cover', '0123456789ab')).toBe(
      '/api/me/link-page/cover?workspace=acme&v=0123456789ab',
    );
    expect(store.photoSrc('acme', 'avatar', '../x')).toBeUndefined();
    // Someone else's page (spec 0070): read through the same door as the upload, naming whose page it is.
    const theirs = setup({ member: '018f0000-0000-7000-8000-000000000001' }).store;
    expect(theirs.photoSrc('acme', 'avatar', '0123456789ab')).toBe(
      '/api/me/link-page/avatar?workspace=acme&member=018f0000-0000-7000-8000-000000000001&v=0123456789ab',
    );
    expect(store.logoSrc('acme', 'nope')).toBeUndefined();
  });

  it('keeps the latest of two quick picks, whichever answer comes back first', async () => {
    const answers: ((value: { canEdit: boolean; template: 'classic'; accent?: string }) => void)[] = [];
    const store = openBrand({
      brand: {
        get: () => Promise.resolve({ accent: '#1f5fd6', template: 'classic' as const, canEdit: true }),
        save: () => new Promise((resolve) => answers.push(resolve)),
        publishTemplate: () => Promise.reject(new Error('unused')),
        discardTemplate: () => Promise.reject(new Error('unused')),
      },
      profile: { look: () => Promise.resolve({}), saveAccent: () => Promise.reject(new Error('unused')) },
      call: (run) => run({}),
      mintId: () => '018f0000-0000-7000-8000-000000000000',
      send: () => Promise.resolve({}),
      now: () => 0,
    });
    await store.readKit('acme');
    const first = store.saveKit('acme', '#ff5b59');
    const second = store.saveKit('acme', '#fb8f3c');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Sent one after another: only the first is out until it answers.
    expect(answers).toHaveLength(1);
    answers[0]?.({ canEdit: true, template: 'classic', accent: '#ff5b59' });
    await first;
    const between = store.kit('acme').getSnapshot();
    expect(between.status === 'ready' && between.value.accent).toBe('#fb8f3c');
    await new Promise((resolve) => setTimeout(resolve, 0));
    answers[1]?.({ canEdit: true, template: 'classic', accent: '#fb8f3c' });
    await second;
    const after = store.kit('acme').getSnapshot();
    expect(after.status === 'ready' && after.value.accent).toBe('#fb8f3c');
  });
});
