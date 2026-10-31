// A link page's media block (spec 0061, AC-6106, AC-6127), its own chunk: loaded only on a page that has one.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import type { LinkPageBlock, LinkPageMediaProvider } from './LinkPage.tsx';
import styles from './LinkPageMedia.module.css';
import { strings } from './strings.ts';

/** Each provider's one player origin (AC-6107): a frame on any other address is never drawn. */
const PLAYER_ORIGINS: Readonly<Record<LinkPageMediaProvider, string>> = {
  youtube: 'https://www.youtube-nocookie.com',
  vimeo: 'https://player.vimeo.com',
  spotify: 'https://open.spotify.com',
  soundcloud: 'https://w.soundcloud.com',
  applemusic: 'https://embed.music.apple.com',
};

/** The player's address, only when it is on its provider's own player origin over https; else undefined. */
export function playerSrc(provider: LinkPageMediaProvider, frame: string): string | undefined {
  try {
    const url = new URL(frame);
    return url.protocol === 'https:' && url.origin === PLAYER_ORIGINS[provider] ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Props for LinkPageMedia. */
export interface LinkPageMediaProps {
  readonly block: Extract<LinkPageBlock, { kind: 'media' }>;
  /** Play was pressed (a press counter's beacon). */
  readonly onPress?: () => void;
  /** Drawn as a grid tile: the stage fills the tile. */
  readonly isTile: boolean;
}

/**
 * A video or a song behind its facade (AC-6106): the poster from our own origin, the title, "Plays from YouTube",
 * and one Play button. Nothing is requested from the provider until Play is pressed (AC-6127); then the player
 * replaces the poster in the very same box, so nothing jumps, and focus moves into it. The frame's address is the
 * one the server built from the parsed provider and id, checked again here against that provider's player origin.
 */
export function LinkPageMedia({ block, onPress, isTile }: LinkPageMediaProps) {
  const [isPlaying, setPlaying] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const src = playerSrc(block.provider, block.frame);
  const poster = block.poster === undefined ? undefined : safeImageSrc(block.poster.src);
  const shape = block.provider === 'youtube' || block.provider === 'vimeo' ? 'video' : 'audio';
  useEffect(() => {
    if (isPlaying) frameRef.current?.focus();
  }, [isPlaying]);
  return (
    <figure className={styles.root} data-shape={shape} data-provider={block.provider} data-fill={isTile || undefined}>
      <div className={styles.stage}>
        {isPlaying && src !== undefined ? (
          <iframe
            ref={frameRef}
            className={styles.frame}
            src={src}
            title={block.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
            allowFullScreen
            // YouTube refuses a frame that sends no referrer; the origin alone, never the page's path.
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
          />
        ) : (
          <button
            type="button"
            className={styles.poster}
            disabled={src === undefined}
            onClick={() => {
              setPlaying(true);
              onPress?.();
            }}
          >
            {poster !== undefined && block.poster !== undefined && (
              <img
                className={styles.posterImage}
                src={poster}
                width={block.poster.width}
                height={block.poster.height}
                alt={strings.thumbAlt}
                loading="lazy"
                decoding="async"
              />
            )}
            <span className={styles.play} aria-hidden="true">
              <Icon name="play" />
            </span>
            <VisuallyHidden>{strings.play(block.title)}</VisuallyHidden>
          </button>
        )}
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.title}>{block.title}</span>
        <span className={styles.line}>{strings.playsFrom(strings.providers[block.provider])}</span>
      </figcaption>
    </figure>
  );
}
