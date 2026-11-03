// The business page's gallery (spec 0066, AC-6641): up to 20 photos. On a wide screen a large first photo and four
// tiles beside it; on a phone a swipe row that snaps a photo at a time, with its place ("2 / 8") in the corner. "See all
// photos" (and any photo) opens the viewer: the library's Modal holding one photo large, with Previous and Next, the
// arrow keys and a swipe, and focus back on the photo that opened it.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import styles from './BusinessGallery.module.css';
import { strings } from './strings.ts';

/** One photo of the gallery: our own origin's address, its size, and what it shows. */
export interface BusinessPhotoItem {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string | undefined;
}

/** Props for BusinessGallery. */
export interface BusinessGalleryProps {
  readonly photos: readonly BusinessPhotoItem[];
  /** The business's name: a photo with no description of its own is "<name>, photo 2 of 8". */
  readonly name: string;
  /** While the page loads: the mosaic's shape, empty. */
  readonly isLoading?: boolean;
}

/** How far a finger moves across the photo before it counts as a swipe to the next one, in CSS pixels. */
const SWIPE = 48;

/** The mosaic's tiles beside the large first photo, on a wide screen. */
const TILES = 4;

/**
 * The gallery (AC-6641). Photos that fail to load leave it, so it never shows a broken one; with none left it draws
 * nothing, and the page's header carries on without it.
 */
export function BusinessGallery({ photos, name, isLoading = false }: BusinessGalleryProps) {
  const [open, setOpen] = useState<number | undefined>(undefined);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [shownAt, setShownAt] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const shots = photos.flatMap((photo) => {
    const src = safeImageSrc(photo.src);
    return src === undefined || failed.includes(src) ? [] : [{ ...photo, src }];
  });
  // Which photo the phone's row shows, for its "2 / 8": the one nearest the row's start.
  useEffect(() => {
    const track = trackRef.current;
    if (track === null) return undefined;
    const onScroll = () => {
      const width = track.clientWidth;
      if (width > 0) setShownAt(Math.round(track.scrollLeft / width));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
    };
  }, [shots.length]);
  if (isLoading) {
    return (
      <section className={styles.root} data-loading aria-label={strings.photos} aria-busy>
        <div className={styles.mosaic} data-count={TILES + 1}>
          {Array.from({ length: TILES + 1 }, (_, index) => (
            <span key={index} className={styles.placeholder} data-first={index === 0 || undefined} />
          ))}
        </div>
      </section>
    );
  }
  if (shots.length === 0) return null;
  const count = shots.length;
  const label = (index: number) => shots[index]?.alt ?? `${name}, ${strings.photoOf(index + 1, count)}`;
  const forget = (src: string) => {
    setFailed((was) => [...was, src]);
  };
  return (
    <section ref={rootRef} className={styles.root} aria-label={strings.photos}>
      {/* A wide screen: the large first photo and up to four tiles. */}
      <div className={styles.mosaic} data-count={Math.min(count, TILES + 1)}>
        {shots.slice(0, TILES + 1).map((shot, index) => (
          <button
            key={shot.src}
            type="button"
            className={styles.tile}
            data-shot="mosaic"
            data-first={index === 0 || undefined}
            aria-label={strings.openPhoto(index + 1, count)}
            onClick={() => {
              setOpen(index);
            }}
          >
            <img
              className={styles.picture}
              src={shot.src}
              width={shot.width}
              height={shot.height}
              alt={label(index)}
              loading={index === 0 ? 'eager' : 'lazy'}
              {...(index === 0 ? { fetchPriority: 'high' as const } : {})}
              decoding="async"
              onError={() => {
                forget(shot.src);
              }}
            />
          </button>
        ))}
      </div>
      {/* A phone: one photo at a time, swiped. */}
      <ul ref={trackRef} className={styles.track}>
        {shots.map((shot, index) => (
          <li key={shot.src} className={styles.slide}>
            <button
              type="button"
              className={styles.tile}
              aria-label={strings.openPhoto(index + 1, count)}
              onClick={() => {
                setOpen(index);
              }}
            >
              <img
                className={styles.picture}
                src={shot.src}
                width={shot.width}
                height={shot.height}
                alt={label(index)}
                loading={index === 0 ? 'eager' : 'lazy'}
                decoding="async"
                onError={() => {
                  forget(shot.src);
                }}
              />
            </button>
          </li>
        ))}
      </ul>
      {count > 1 && (
        <span className={styles.counter} aria-hidden>
          {`${String(Math.min(shownAt, count - 1) + 1)} / ${String(count)}`}
        </span>
      )}
      {count > 1 && (
        <div className={styles.all}>
          <Button
            variant="secondary"
            icon="image"
            onPress={() => {
              setOpen(0);
            }}
          >
            {strings.seeAllPhotos(count)}
          </Button>
        </div>
      )}
      <Viewer
        photos={shots}
        label={label}
        at={open}
        onMove={setOpen}
        onClose={(at) => {
          setOpen(undefined);
          // Back to the photo the viewer was showing, wherever the page draws it.
          focusLater(() => {
            const wide = rootRef.current?.querySelectorAll<HTMLElement>('[data-shot="mosaic"]').item(at);
            return wide?.offsetParent !== null && wide?.offsetParent !== undefined
              ? wide
              : trackRef.current?.querySelectorAll('button').item(at);
          });
        }}
      />
    </section>
  );
}

/**
 * The viewer: the library's Modal holding one photo large, its place beside its name, Previous and Next in the
 * footer. The arrow keys move while it is open, and a swipe across the photo does too.
 */
function Viewer({
  photos,
  label,
  at,
  onMove,
  onClose,
}: {
  readonly photos: readonly BusinessPhotoItem[];
  readonly label: (index: number) => string;
  readonly at: number | undefined;
  readonly onMove: (index: number) => void;
  readonly onClose: (at: number) => void;
}) {
  const startX = useRef<number | undefined>(undefined);
  // The photo last shown, kept while the viewer closes so its exit draws what it showed.
  const [shown, setShown] = useState(at ?? 0);
  if (at !== undefined && at !== shown) setShown(at);
  const count = photos.length;
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
  const photo = photos[shown] ?? photos[0];
  if (photo === undefined) return null;
  return (
    <Modal
      title={label(shown)}
      variant="window"
      isWide
      status={strings.photoOf(shown + 1, count)}
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
                  {strings.previousPhoto}
                </Button>
                <Button
                  icon="chevron-right"
                  onPress={() => {
                    move(1);
                  }}
                >
                  {strings.nextPhoto}
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
          const travel = event.clientX - from;
          if (Math.abs(travel) >= SWIPE) move(travel < 0 ? 1 : -1);
        }}
      >
        <img
          key={photo.src}
          className={styles.largePicture}
          src={photo.src}
          width={photo.width}
          height={photo.height}
          alt={label(shown)}
          draggable={false}
        />
      </div>
    </Modal>
  );
}
