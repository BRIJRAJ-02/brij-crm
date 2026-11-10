// A link page's unpublished changes (spec 0068, AC-6810, AC-6811), as pure functions: a snapshot as the definers keep
// it (`crm_link_page_rows`, migration 0172) read into a plain shape, and each change between the published one and
// the draft in a plain sentence. No I/O, so the services in `link-publish.ts` and the tests share one reading.

/** One block as a snapshot keeps it. */
export interface LinkSnapshotItem {
  readonly id: string;
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** A link page as a snapshot keeps it: the drafted columns by name, and the live blocks in order. */
export interface LinkSnapshot {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly items: readonly LinkSnapshotItem[];
}

/**
 * The drafted columns, in the order the Changes list names them. The name, the title and whether it shows under the
 * name are profile data, live on save (owner, 10 Nov 2026; migration 0205), so none of them is here.
 */
const FIELDS = [
  'bio',
  'theme',
  'accent',
  'accent_dark',
  'cover_path',
  'ground_path',
  'avatar_path',
  'site_url',
  'foot_line',
] as const;

/** A stored snapshot read into its plain shape; anything that isn't one reads as an empty page. */
export function linkSnapshotOf(stored: unknown): LinkSnapshot {
  const record: Readonly<Record<string, unknown>> =
    typeof stored === 'object' && stored !== null ? (stored as Readonly<Record<string, unknown>>) : {};
  const items = Array.isArray(record.items) ? (record.items as readonly unknown[]) : [];
  return {
    fields: Object.fromEntries(FIELDS.map((key) => [key, record[key] ?? null])),
    items: items.flatMap((one) => {
      if (typeof one !== 'object' || one === null) return [];
      const item = one as Readonly<Record<string, unknown>>;
      if (typeof item.id !== 'string' || typeof item.kind !== 'string') return [];
      const data =
        typeof item.data === 'object' && item.data !== null ? (item.data as Readonly<Record<string, unknown>>) : {};
      return [{ id: item.id, kind: item.kind, data }];
    }),
  };
}

/** Whether two values are the same, compared as their JSON with keys in order. */
function same(one: unknown, other: unknown): boolean {
  return stable(one ?? null) === stable(other ?? null);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The words a block goes by in a sentence: its title, label or text, else its kind. */
function blockName(item: LinkSnapshotItem): string {
  const words = [item.data.title, item.data.label, item.data.text, item.data.fullName].find(
    (one): one is string => typeof one === 'string' && one.trim() !== '',
  );
  if (words === undefined) return KIND_NAMES[item.kind] ?? 'A block';
  const trimmed = words.trim();
  return `“${trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed}”`;
}

/** A block of no words, by its kind. */
const KIND_NAMES: Readonly<Record<string, string>> = {
  page: 'A booking page',
  times: 'Next times',
  socials: 'Social links',
  media: 'A video',
  image: 'A picture',
  gallery: 'A gallery',
  contact: 'A contact card',
  faq: 'Questions',
  form: 'A form',
  heading: 'A heading',
  text: 'Some text',
  testimonial: 'A testimonial',
  link: 'A link',
  banner: 'A banner',
};

/** The template and face words, as the editor names them. */
const LOOK_WORDS: Readonly<Record<string, string>> = {
  classic: 'Classic',
  studio: 'Studio',
  night: 'Night',
  split: 'Split',
  circle: 'Circle',
  rounded: 'Rounded',
};

/** A look's key, or undefined. */
function lookKey(theme: unknown, key: string): unknown {
  return typeof theme === 'object' && theme !== null ? (theme as Readonly<Record<string, unknown>>)[key] : undefined;
}

/** The look's changes: the template and the face by name, anything else as one line. */
function lookSentences(before: unknown, after: unknown): readonly string[] {
  if (same(before, after)) return [];
  // A page never published had no look: only a template picked for it is news.
  if (before === null || before === undefined) {
    const template = lookKey(after, 'template');
    return typeof template === 'string' ? [`Template ${LOOK_WORDS[template] ?? template}`] : [];
  }
  const word = (value: unknown) => (typeof value === 'string' ? (LOOK_WORDS[value] ?? value) : 'Workspace’s');
  const lines: string[] = [];
  if (!same(lookKey(before, 'template'), lookKey(after, 'template'))) {
    lines.push(`Template ${word(lookKey(before, 'template'))} → ${word(lookKey(after, 'template'))}`);
  }
  if (!same(lookKey(before, 'avatar'), lookKey(after, 'avatar'))) {
    lines.push(`Photo shape ${word(lookKey(before, 'avatar'))} → ${word(lookKey(after, 'avatar'))}`);
  }
  const rest = (theme: unknown) =>
    typeof theme === 'object' && theme !== null
      ? Object.fromEntries(
          Object.entries(theme as Readonly<Record<string, unknown>>).filter(
            ([key]) => key !== 'template' && key !== 'avatar' && key !== 'moved',
          ),
        )
      : {};
  if (lines.length === 0 && !same(rest(before), rest(after))) lines.push('Look changed');
  return lines;
}

/** A photo's change: added, removed or changed. */
function photoSentence(name: string, before: unknown, after: unknown): string | undefined {
  if (same(before, after)) return undefined;
  if (before === null || before === undefined) return `${name} added`;
  if (after === null || after === undefined) return `${name} removed`;
  return `${name} changed`;
}

/**
 * Each change the draft makes against what guests see (AC-6811), as plain sentences: the profile first ("Bio
 * changed", "Template Classic → Studio", "Cover photo added"), then the blocks ("Added “Shop”", "Removed “Blog”",
 * "Changed “Intro call”", "Order changed"). A page never published has every block as added.
 */
export function diffLinkPage(published: LinkSnapshot, draft: LinkSnapshot): readonly string[] {
  const before = published.fields;
  const after = draft.fields;
  const lines: string[] = [];
  if (!same(before.bio ?? '', after.bio ?? ''))
    lines.push(typeof after.bio !== 'string' || after.bio.trim() === '' ? 'Bio removed' : 'Bio changed');
  lines.push(...lookSentences(before.theme, after.theme));
  if (!same(before.accent, after.accent) || !same(before.accent_dark, after.accent_dark)) {
    lines.push(after.accent === null && after.accent_dark === null ? 'Colour follows the workspace' : 'Colour changed');
  }
  const avatar = photoSentence('Profile photo', before.avatar_path, after.avatar_path);
  if (avatar !== undefined) lines.push(avatar);
  const cover = photoSentence('Cover photo', before.cover_path, after.cover_path);
  if (cover !== undefined) lines.push(cover);
  const ground = photoSentence('Background photo', before.ground_path, after.ground_path);
  if (ground !== undefined) lines.push(ground);
  if (!same(before.site_url, after.site_url)) lines.push('Website changed');
  if (!same(before.foot_line, after.foot_line)) lines.push('Foot line changed');
  const old = new Map(published.items.map((item) => [item.id, item]));
  const now = new Map(draft.items.map((item) => [item.id, item]));
  for (const item of draft.items) {
    const was = old.get(item.id);
    if (was === undefined) lines.push(`Added ${blockName(item)}`);
    else if (!same(was.data, item.data)) lines.push(`Changed ${blockName(item)}`);
  }
  for (const item of published.items) if (!now.has(item.id)) lines.push(`Removed ${blockName(item)}`);
  // The blocks both hold, in each one's order: a move is one line however many moved.
  const kept = (items: readonly LinkSnapshotItem[], other: ReadonlyMap<string, LinkSnapshotItem>) =>
    items.filter((item) => other.has(item.id)).map((item) => item.id);
  if (!same(kept(published.items, now), kept(draft.items, old))) lines.push('Order changed');
  return lines;
}

/** The photo paths a snapshot names, for the store. */
export function photoPathsOf(snapshot: LinkSnapshot): readonly string[] {
  return [snapshot.fields.cover_path, snapshot.fields.ground_path, snapshot.fields.avatar_path].filter(
    (path): path is string => typeof path === 'string',
  );
}
