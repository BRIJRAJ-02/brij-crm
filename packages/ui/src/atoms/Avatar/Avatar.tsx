import { useLayoutEffect, useRef, useState } from 'react';
import type { Hue } from '../../hue.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import type { ReactNode } from 'react';
import { initialsOf, stableHue } from '../../lib/stable-hue.ts';
import { strings } from './strings.ts';
import styles from './Avatar.module.css';

/**
 * Avatar sizes: `xs` 16px (cells, chips), `sm` 20px, `md` 24px, `lg` 32px, `title` 48px (a record heading its
 * page or panel), `xl` 72px (a booking page's host, the picture on Settings › Profile).
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'title' | 'xl' | 'hero';

/** Props for Avatar. */
export interface AvatarProps {
  /** Whose avatar: read as its name, and the source of the initials. */
  readonly name: string;
  /** Seeds the hue when none is given, so the same person always gets the same colour. */
  readonly id?: string;
  /** A picture on our origin, `data:image` or `blob:`. Anything else, or a picture that fails, shows the initials. */
  readonly src?: string;
  /** The tile's hue, or `ink` for the workspace's own mark. Defaults to a stable hash of `id` (or `name`). */
  readonly hue?: Hue | 'ink';
  readonly size?: AvatarSize;
  /** `circle` for people (the default), `square` for companies and other records. */
  readonly shape?: 'circle' | 'square';
  /** Hides it from screen readers when the name is written right beside it. */
  readonly isDecorative?: boolean;
  /**
   * A mark in place of the initials, for something that isn't a person or a record (a form, the system): an Icon the
   * caller sizes (`xs` up to `sm` tiles, `sm` at `md`), so its face keeps the row's size and shape beside people's.
   * A picture still wins when `src` is given. A node, not an icon name, so Avatar never pulls the icon registry into
   * a page that draws only people.
   */
  readonly mark?: ReactNode;
}

/**
 * The sizes whose picture fades in over the initials once it has loaded (29 Oct 2026): a page's one big picture (a
 * link page's, a booking page's host, a record heading its page) otherwise sits as an empty tile and then pops. The
 * small ones in rows and chips show the picture at once, as before: a fade repeated down a table is noise.
 */
const FADES_IN: ReadonlySet<AvatarSize> = new Set<AvatarSize>(['title', 'xl', 'hero']);

/** The two small sizes, 16px and 20px, show one initial: a pair doesn't fit at a readable size. */
const ONE_INITIAL: ReadonlySet<AvatarSize> = new Set<AvatarSize>(['xs', 'sm']);

/** A person's or company's picture, or their initials on a hue tile: people are circles, companies squares. */
export function Avatar({ name, id, src, hue, size = 'sm', shape = 'circle', isDecorative = false, mark }: AvatarProps) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  // The picture that has loaded, and whether it was already in the browser's cache: one there shows at once.
  const [loaded, setLoaded] = useState<{ readonly src: string; readonly isCached: boolean } | undefined>(undefined);
  const picture = useRef<HTMLImageElement>(null);
  const image = safeImageSrc(src);
  const showImage = image !== undefined && failed !== image;
  const fades = showImage && FADES_IN.has(size);
  // While a fading picture loads, its initials hold the tile; once it has, they go, so a picture with clear parts
  // (a company's logo) never shows letters through it.
  const isWaiting = fades && loaded?.src !== image;
  // A picture the browser already holds (a preloaded or a cached one) is complete before the first paint: it shows
  // straight away, with no initials and no fade.
  useLayoutEffect(() => {
    const element = picture.current;
    if (fades && element !== null && element.complete && element.naturalWidth > 0) {
      setLoaded({ src: image, isCached: true });
    }
  }, [fades, image]);
  // One initial is the first word's: initialsOf on that word alone, so a letter built of several code points stays whole.
  const initials = mark ?? initialsOf(ONE_INITIAL.has(size) ? (name.trim().split(/\s+/u)[0] ?? '') : name);
  return (
    <span
      className={styles.root}
      data-size={size}
      data-shape={shape}
      data-hue={hue ?? stableHue(id ?? name)}
      {...(isDecorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      {showImage ? (
        <>
          {isWaiting ? initials : null}
          <img
            className={styles.image}
            src={image}
            alt={strings.pictureAlt}
            ref={picture}
            {...(fades ? { 'data-fade': isWaiting ? 'waiting' : loaded?.isCached === true ? 'shown' : 'in' } : {})}
            onLoad={() => {
              setLoaded((now) => (now?.src === image ? now : { src: image, isCached: false }));
            }}
            onError={() => {
              setFailed(image);
            }}
          />
        </>
      ) : (
        initials
      )}
    </span>
  );
}

/** One person in an AvatarStack. */
export interface AvatarStackPerson {
  readonly id: string;
  readonly name: string;
  readonly src?: string;
  readonly hue?: Hue;
}

/** Props for AvatarStack. */
export interface AvatarStackProps {
  readonly people: readonly AvatarStackPerson[];
  /** How many show before "+N". */
  readonly max?: number;
  readonly size?: AvatarSize;
  /** How many people the stack stands for when `people` holds only the first few (a public team page sends 4). Defaults to `people.length`. */
  readonly total?: number;
  /** The stack's accessible name ("Team of 6") when the names aren't for reading out. Defaults to everyone's names. */
  readonly label?: string;
}

/** A few overlapping avatars and "+N" for the rest: who is viewing, who is assigned. */
export function AvatarStack({ people, max = 3, size = 'sm', total = people.length, label }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const rest = Math.max(0, total - shown.length);
  return (
    <span
      className={styles.stack}
      data-size={size}
      role="group"
      aria-label={label ?? strings.people(people.map((person) => person.name))}
    >
      {shown.map((person) => (
        <Avatar
          key={person.id}
          id={person.id}
          name={person.name}
          size={size}
          isDecorative
          {...(person.src === undefined ? {} : { src: person.src })}
          {...(person.hue === undefined ? {} : { hue: person.hue })}
        />
      ))}
      {rest > 0 && (
        <span className={styles.more} aria-hidden="true">
          {strings.more(rest)}
        </span>
      )}
    </span>
  );
}
