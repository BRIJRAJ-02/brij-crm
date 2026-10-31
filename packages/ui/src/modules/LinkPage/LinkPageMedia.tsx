// A link page's media block (spec 0061, AC-6106, AC-6127), its own chunk: loaded only on a page that has one.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
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
  const play = () => {
    setPlaying(true);
    onPress?.();
  };
  const posterImage =
    poster === undefined || block.poster === undefined ? null : (
      <img
        className={styles.posterImage}
        src={poster}
        width={block.poster.width}
        height={block.poster.height}
        alt={strings.thumbAlt}
        loading="lazy"
        decoding="async"
      />
    );
  return (
    <figure className={styles.root} data-shape={shape} data-provider={block.provider} data-fill={isTile || undefined}>
      <div className={styles.stage}>
        {src === undefined ? (
          // A player address the check refused: the poster alone and a line saying so, never a dead Play.
          posterImage
        ) : isPlaying ? (
          <>
            {/* The poster stays under the player until the player paints over it, so Play never flashes white. */}
            {posterImage}
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
          </>
        ) : (
          // The whole poster plays on a click, as a visitor expects; the one control, for the keyboard and screen
          // readers, is the library's round Play button in its middle (its press is the poster's click).
          // A mouse's larger target only: `presentation`, since the Play button inside is the control.
          <div
            className={styles.poster}
            role="presentation"
            onClick={(event) => {
              // The button's own press plays it; this is the rest of the poster.
              if (event.target instanceof Element && event.target.closest('button') !== null) return;
              play();
            }}
          >
            {posterImage}
            <span className={styles.play}>
              <Button
                variant="primary"
                size="touch"
                isRound
                icon="play"
                label={strings.play(block.title)}
                onPress={play}
              />
            </span>
          </div>
        )}
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.title}>{block.title}</span>
        <span className={styles.line}>
          {src === undefined ? strings.cantPlay : strings.playsFrom(strings.providers[block.provider])}
        </span>
      </figcaption>
    </figure>
  );
}
