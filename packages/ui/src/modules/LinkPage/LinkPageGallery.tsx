// A link page's gallery block and its viewer (spec 0061, AC-6109), one chunk: loaded only on a page that has one.
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import type { LinkPageBlock } from './LinkPage.tsx';
import styles from './LinkPageGallery.module.css';
import { strings } from './strings.ts';

/** Props for LinkPageGallery. */
export interface LinkPageGalleryProps {
  readonly block: Extract<LinkPageBlock, { kind: 'gallery' }>;
  /** Drawn as a grid tile: the swipe row fills the tile. */
  readonly isTile: boolean;
}

/** How far a finger moves across the picture before it counts as a swipe to the next one, in CSS pixels. */
const SWIPE = 48;

/**
 * Two to twelve pictures (AC-6109): a swipe row that snaps a picture at a time, with Previous and Next on a screen
 * with a pointer, or a grid of squares, as the owner picked. Each picture is a button that opens it large in the
 * viewer, where the arrow keys, Previous and Next or a swipe move through them, Escape closes it, and focus goes
 * back to the picture that opened it.
 */
export function LinkPageGallery({ block, isTile }: LinkPageGalleryProps) {
  const [open, setOpen] = useState<number | undefined>(undefined);
  // Pictures that failed to load leave the gallery, so neither the row nor the viewer shows a broken one.
  const [failed, setFailed] = useState<readonly string[]>([]);
  const trackRef = useRef<HTMLUListElement>(null);
  const trackId = useId();
  const pictures = block.images.flatMap((image) => {
    const src = safeImageSrc(image.src);
    return src === undefined || failed.includes(src) ? [] : [{ ...image, src }];
  });
  if (pictures.length === 0) return null;
  const display = isTile ? 'row' : block.display;
  // One picture's width along the row: the scroll a Previous or Next press moves, so the snap lands on the next one.
  const step = (direction: 1 | -1) => {
    const track = trackRef.current;
    const first = track?.firstElementChild;
    if (track === null || !(first instanceof HTMLElement)) return;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
    track.scrollBy({ left: direction * (first.offsetWidth + gap) });
  };
  return (
    <div className={styles.root} data-display={display} data-fill={isTile || undefined}>
      <ul ref={trackRef} id={trackId} className={styles.track} aria-label={strings.gallery}>
        {pictures.map((picture, index) => (
          <li key={picture.src} className={styles.item}>
            <button
              type="button"
              className={styles.shot}
              onClick={() => {
                setOpen(index);
              }}
            >
              <img
                className={styles.picture}
                src={picture.src}
                width={picture.width}
                height={picture.height}
                alt={strings.openPicture(picture.alt)}
                loading="lazy"
                decoding="async"
                onError={() => {
                  setFailed((was) => [...was, picture.src]);
                }}
              />
            </button>
          </li>
        ))}
      </ul>
      {display === 'row' && !isTile && pictures.length > 1 && (
        <div className={styles.steps}>
          <Button
            variant="secondary"
            isRound
            icon="chevron-left"
            label={strings.previous}
            controls={trackId}
            onPress={() => {
              step(-1);
            }}
          />
          <Button
            variant="secondary"
            isRound
            icon="chevron-right"
            label={strings.next}
            controls={trackId}
            onPress={() => {
              step(1);
            }}
          />
        </div>
      )}
      <Viewer
        pictures={pictures}
        at={open}
        onMove={setOpen}
        onClose={(at) => {
          setOpen(undefined);
          // Back to the picture the viewer was showing, not only the one that opened it: the row scrolls to it.
          focusLater(() => trackRef.current?.querySelectorAll('button').item(at));
        }}
      />
    </div>
  );
}

/**
 * The viewer (AC-6109): the library's Modal, holding one picture large, its place in the gallery beside its name,
 * Previous and Next in the footer. The arrow keys move while it is open, a swipe across the picture does too, and
 * Escape or Close puts focus back on the picture that opened it (the Modal returns focus to what had it).
 */
function Viewer({
  pictures,
  at,
  onMove,
  onClose,
}: {
  readonly pictures: readonly {
    readonly src: string;
    readonly alt: string;
    readonly width: number;
    readonly height: number;
  }[];
  readonly at: number | undefined;
  readonly onMove: (index: number) => void;
  readonly onClose: (at: number) => void;
}) {
  const startX = useRef<number | undefined>(undefined);
  // The picture last shown, kept while the viewer closes so its exit draws what it showed.
  const [shown, setShown] = useState(at ?? 0);
  if (at !== undefined && at !== shown) setShown(at);
  const count = pictures.length;
  const move = (direction: 1 | -1) => {
    onMove((shown + direction + count) % count);
  };
  const isOpen = at !== undefined;
  useEffect(() => {
    if (!isOpen || count < 2) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') onMove((shown + 1) % count);
      else if (event.key === 'ArrowLeft') onMove((shown - 1 + count) % count);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, shown, count, onMove]);
  const picture = pictures[shown] ?? pictures[0];
  if (picture === undefined) return null;
  return (
    <Modal
      title={picture.alt}
      variant="window"
      status={strings.pictureOf(shown + 1, count)}
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose(shown);
      }}
      {...(count < 2
        ? {}
        : {
            actions: (
              <>
                <Button
                  icon="chevron-left"
                  onPress={() => {
                    move(-1);
                  }}
                >
                  {strings.previous}
                </Button>
                <Button
                  icon="chevron-right"
                  onPress={() => {
                    move(1);
                  }}
                >
                  {strings.next}
                </Button>
              </>
            ),
          })}
    >
      <div
        className={styles.large}
        onPointerDown={(event: PointerEvent) => {
          startX.current = event.clientX;
        }}
        onPointerUp={(event: PointerEvent) => {
          const from = startX.current;
          startX.current = undefined;
          if (from === undefined || count < 2) return;
          const moved = event.clientX - from;
          if (Math.abs(moved) >= SWIPE) move(moved < 0 ? 1 : -1);
        }}
      >
        <img
          className={styles.largePicture}
          src={picture.src}
          width={picture.width}
          height={picture.height}
          alt={picture.alt}
          decoding="async"
          draggable={false}
        />
      </div>
    </Modal>
  );
}
