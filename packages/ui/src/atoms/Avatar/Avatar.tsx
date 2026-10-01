import { useState } from 'react';
import type { Hue } from '../../hue.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import { initialsOf, stableHue } from '../../lib/stable-hue.ts';
import { strings } from './strings.ts';
import styles from './Avatar.module.css';

/** Avatar sizes: `xs` 16px (cells, chips), `sm` 20px, `md` 24px, `lg` 32px (record headers). */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

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
}

/** A person's or company's picture, or their initials on a hue tile: people are circles, companies squares. */
export function Avatar({ name, id, src, hue, size = 'sm', shape = 'circle', isDecorative = false }: AvatarProps) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const image = safeImageSrc(src);
  const showImage = image !== undefined && failed !== image;
  return (
    <span
      className={styles.root}
      data-size={size}
      data-shape={shape}
      data-hue={hue ?? stableHue(id ?? name)}
      {...(isDecorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      {showImage ? (
        <img
          className={styles.image}
          src={image}
          alt={strings.pictureAlt}
          onError={() => {
            setFailed(image);
          }}
        />
      ) : (
        initialsOf(name)
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
}

/** A few overlapping avatars and "+N" for the rest: who is viewing, who is assigned. */
export function AvatarStack({ people, max = 3, size = 'sm' }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={styles.stack} role="group" aria-label={strings.people(people.map((person) => person.name))}>
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
