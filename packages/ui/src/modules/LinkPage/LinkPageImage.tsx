// A link page's picture block (spec 0061, AC-6108), its own chunk: loaded only on a page that has one.
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { safeHref } from '../../lib/safe-href.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import type { LinkPageBlock } from './LinkPage.tsx';
import styles from './LinkPageImage.module.css';
import { strings } from './strings.ts';

/** Props for LinkPageImage. */
export interface LinkPageImageProps {
  readonly block: Extract<LinkPageBlock, { kind: 'image' }>;
  /** Its link was pressed (a press counter's beacon). */
  readonly onPress?: () => void;
  /** Drawn as a grid tile: the picture fills the tile, cropped to it. */
  readonly isTile: boolean;
}

/**
 * One picture (AC-6108): from our own origin, its width and height set so its box is held before it loads, lazily,
 * with its alt text, the caption under it, and, when the owner gave one, the picture as a link to a web page in a
 * new tab. A picture whose address isn't ours draws as its alt text in the same box, never as a broken image.
 */
export function LinkPageImage({ block, onPress, isTile }: LinkPageImageProps) {
  const src = safeImageSrc(block.image.src);
  const href = block.href === undefined ? undefined : safeHref(block.href);
  const web = href !== undefined && /^https?:/i.test(href) ? href : undefined;
  const picture =
    src === undefined ? (
      <span className={styles.missing}>{block.alt}</span>
    ) : (
      <img
        className={styles.picture}
        src={src}
        width={block.image.width}
        height={block.image.height}
        alt={block.alt}
        loading="lazy"
        decoding="async"
      />
    );
  return (
    <figure className={styles.root} data-fill={isTile || undefined}>
      {web === undefined ? (
        <span className={styles.frame}>{picture}</span>
      ) : (
        <a
          className={styles.frame}
          data-link=""
          href={web}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={onPress}
        >
          {picture}
          <VisuallyHidden>{strings.newTab}</VisuallyHidden>
        </a>
      )}
      {block.caption !== undefined && block.caption !== '' && (
        <figcaption className={styles.caption}>{block.caption}</figcaption>
      )}
    </figure>
  );
}
