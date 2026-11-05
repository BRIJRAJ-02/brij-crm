import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Slider } from '../../atoms/Slider/Slider.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import '../../lib/custom-properties.ts';
import {
  clampView,
  cropOf,
  fitFrame,
  initialView,
  MAX_ZOOM,
  panBy,
  placement,
  positionOf,
  zoomTo,
  type CropView,
  type PhotoRect,
  type PhotoSize,
} from '../../lib/photo/crop-math.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './PhotoCrop.module.css';
import { strings } from './strings.ts';

/**
 * The frame a use crops to: `circle` a face (square, drawn round), `square` a logo or a square dish, `cover` a
 * page's 3:1 banner, `dish` a menu dish at 4:3, `card` the 1.91:1 picture a pasted link shows, and `free` a gallery's
 * picture, where the person picks the frame (its own shape, square, 4:3, 3:4 or 16:9).
 */
export type PhotoShape = 'circle' | 'square' | 'cover' | 'dish' | 'card' | 'free';

/** Each fixed shape's width over its height. */
const SHAPE_RATIOS: Readonly<Record<Exclude<PhotoShape, 'free'>, number>> = {
  circle: 1,
  square: 1,
  cover: 3,
  dish: 4 / 3,
  card: 1200 / 630,
};

/** The frames a free crop offers, in the order they show. */
const FREE_FRAMES = ['original', 'square', 'landscape', 'portrait', 'wide'] as const;
type FreeFrame = (typeof FREE_FRAMES)[number];
const FREE_RATIOS: Readonly<Record<Exclude<FreeFrame, 'original'>, number>> = {
  square: 1,
  landscape: 4 / 3,
  portrait: 3 / 4,
  wide: 16 / 9,
};

/** How far one arrow moves the photo, as a share of the frame; Shift moves five times as far. */
const NUDGE = 0.02;
const NUDGE_FAR = 0.1;

/** How much one plus or minus, or one notch of the wheel, zooms. */
const ZOOM_STEP = 1.1;

/** The room round the frame inside the stage, as a share of the stage's shorter side. */
const FRAME_ROOM = 0.08;

/** Props for PhotoCrop. */
export interface PhotoCropProps {
  /**
   * The photo to crop: a file just picked, or the address of one already there (on our own origin) to crop again.
   * Undefined keeps the cropper closed.
   */
  readonly source: Blob | string | undefined;
  /** The frame, fixed by what the photo is for. */
  readonly shape: PhotoShape;
  /** Open while there is a source, unless said otherwise (a caller holding the source through the exit). */
  readonly isOpen?: boolean;
  /** The heading ("Crop photo"), for a step that says more ("Crop photo 2 of 3"). */
  readonly title?: string;
  /** Cancel, Esc, the close button or a click outside: nothing is used. */
  readonly onCancel: () => void;
  /** Use photo: the part of the photo kept, in its own pixels, to hand to `preparePhoto` from `@crm/ui/photo`. */
  readonly onDone: (crop: PhotoRect) => void;
}

/**
 * The one cropper every picture passes through before upload (spec 0068, AC-6809), in a Modal: the photo behind a
 * frame of its use's shape, with what lies outside the frame veiled. Drag it (or pinch, or the wheel) to place and
 * zoom it, the Slider zooms too, the arrows nudge it (Shift further) and plus and minus zoom; a small preview shows
 * it as it will sit. Reset, Cancel and Use photo, which answers the crop in the photo's own pixels.
 */
export function PhotoCrop({ source, shape, isOpen, title = strings.title, onCancel, onDone }: PhotoCropProps) {
  const open = isOpen ?? source !== undefined;
  const [crop, setCrop] = useState<PhotoRect | undefined>(undefined);
  const body = useRef<CropControl | null>(null);
  // Said by the body after each render; the same rectangle keeps the one already held, so nothing renders again.
  const answer = useCallback((next: PhotoRect | undefined) => {
    setCrop((was) => (sameRect(was, next) ? was : next));
  }, []);
  return (
    <Modal
      title={title}
      variant="window"
      isOpen={open}
      isDismissable={false}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      footerStart={
        <Button variant="ghost" icon="undo-2" isDisabled={crop === undefined} onPress={() => body.current?.reset()}>
          {strings.reset}
        </Button>
      }
      actions={
        <>
          {/* The footer's close, as every dialog's Cancel is: it shows ESC, and it leaves the way Esc and the close
              button do, through `onOpenChange`, so `onCancel` is called once whichever way out is taken. */}
          <Button slot="close">{strings.cancel}</Button>
          <Button
            variant="primary"
            isDisabled={crop === undefined}
            onPress={() => {
              if (crop !== undefined) onDone(crop);
            }}
          >
            {strings.done}
          </Button>
        </>
      }
    >
      {source !== undefined && (
        <CropBody key={keyOf(source)} ref={body} source={source} shape={shape} onAnswer={answer} />
      )}
    </Modal>
  );
}

/** Whether two crops are the same rectangle (or both none). */
function sameRect(a: PhotoRect | undefined, b: PhotoRect | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** What the footer asks of the body: Reset. */
interface CropControl {
  readonly reset: () => void;
}

/** A new body for each photo, so nothing of the last one's view carries over. */
function keyOf(source: Blob | string): string {
  return typeof source === 'string'
    ? source
    : `${String(source.size)}:${source.type}:${source instanceof File ? `${source.name}:${String(source.lastModified)}` : ''}`;
}

/** An address the image element can draw `source` from: a file's own `blob:` address for as long as it is shown. */
function useImageAddress(source: Blob | string): string | undefined {
  const [address, setAddress] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (typeof source === 'string') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is owned by this effect, as below
      setAddress(safeImageSrc(source));
      return;
    }
    // Made and revoked by one effect, so a remount (Strict Mode, a new photo) never draws from a revoked address.
    const made = URL.createObjectURL(source);
    setAddress(made);
    return () => {
      URL.revokeObjectURL(made);
    };
  }, [source]);
  return address;
}

/** The size of what a callback ref is put on, kept up to date while it changes. */
function useMeasured(): [(node: HTMLElement | null) => (() => void) | undefined, PhotoSize | undefined] {
  const [size, setSize] = useState<PhotoSize | undefined>(undefined);
  const measure = useCallback((node: HTMLElement | null) => {
    if (node === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [measure, size];
}

/** Props for the cropper's body. */
interface CropBodyProps {
  readonly source: Blob | string;
  readonly shape: PhotoShape;
  /** The crop as it stands (none until the photo is read), for Use photo. */
  readonly onAnswer: (crop: PhotoRect | undefined) => void;
  /** Reset, for the footer's button. */
  readonly ref: Ref<CropControl | null>;
}

/** The stage, the zoom and the preview, for one photo. */
function CropBody({ source, shape, onAnswer, ref }: CropBodyProps) {
  const { locale } = useFormatSettings();
  const address = useImageAddress(source);
  const [natural, setNatural] = useState<PhotoSize | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [frameChoice, setFrameChoice] = useState<FreeFrame>('original');
  const [view, setView] = useState<CropView | undefined>(undefined);
  // Moved by a key or Reset: the photo eases to its place. A pointer, the wheel and the Slider move it at once.
  const [isEasing, setEasing] = useState(false);
  const [isMoving, setMoving] = useState(false);
  const [said, setSaid] = useState('');
  const [measureStage, stage] = useMeasured();
  const [measurePreview, preview] = useMeasured();
  const pointers = useRef(new Map<number, { readonly x: number; readonly y: number }>());
  const pinch = useRef<{ readonly distance: number; readonly zoom: number } | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const howToId = useId();

  const ratio =
    shape !== 'free'
      ? SHAPE_RATIOS[shape]
      : frameChoice === 'original'
        ? natural === undefined
          ? 1
          : natural.width / natural.height
        : FREE_RATIOS[frameChoice];
  const held = natural === undefined || view === undefined ? undefined : clampView(natural, ratio, view);
  const crop = natural === undefined || held === undefined ? undefined : cropOf(natural, ratio, held);
  const frame =
    stage === undefined ? undefined : fitFrame(stage, ratio, Math.min(stage.width, stage.height) * FRAME_ROOM);
  const placed =
    natural === undefined || crop === undefined || frame === undefined ? undefined : placement(natural, crop, frame);
  const previewFrame = preview === undefined ? undefined : { x: 0, y: 0, width: preview.width, height: preview.height };
  const previewPlaced =
    natural === undefined || crop === undefined || previewFrame === undefined
      ? undefined
      : placement(natural, crop, previewFrame);

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (natural === undefined) return;
      setEasing(true);
      setView(initialView(natural));
      if (shape === 'free') setFrameChoice('original');
    },
  }));
  // Use photo reads the crop as it stands.
  useEffect(() => {
    onAnswer(crop);
  }, [crop, onAnswer]);

  const percent = (zoom: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(zoom);
  const nudge = (dx: number, dy: number) => {
    if (natural === undefined || held === undefined || crop === undefined) return;
    const next = panBy(natural, ratio, held, dx * crop.width, dy * crop.height);
    setEasing(true);
    setView(next);
    const at = positionOf(natural, ratio, next);
    setSaid(strings.moved(at.across, at.down));
  };
  const zoomBy = (factor: number, eased: boolean) => {
    if (natural === undefined || held === undefined) return;
    const next = zoomTo(natural, ratio, held, held.zoom * factor);
    setEasing(eased);
    setView(next);
    if (eased) setSaid(strings.zoomed(percent(next.zoom)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? NUDGE_FAR : NUDGE;
    // The arrow moves the photo that way, so the frame's middle moves the other way over it.
    const moves: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      nudge(move[0], move[1]);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP, true);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP, true);
    }
  };

  /** The photo's point under a point on the stage (in the stage's own pixels). */
  const photoPointAt = (x: number, y: number) =>
    crop === undefined || placed === undefined || frame === undefined
      ? undefined
      : { x: crop.x + (x - frame.x) / placed.scale, y: crop.y + (y - frame.y) / placed.scale };
  const stagePoint = (clientX: number, clientY: number) => {
    const box = stageRef.current?.getBoundingClientRect();
    return box === undefined ? { x: 0, y: 0 } : { x: clientX - box.left, y: clientY - box.top };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (held === undefined || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a !== undefined && b !== undefined) {
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: held.zoom };
      }
    }
    setEasing(false);
    setMoving(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const was = pointers.current.get(event.pointerId);
    if (was === undefined || natural === undefined || placed === undefined) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, now);
    const started = pinch.current;
    if (pointers.current.size >= 2 && started !== undefined) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined || started.distance === 0) return;
      const middle = stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const focus = photoPointAt(middle.x, middle.y);
      const zoom = started.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / started.distance);
      setView((current) => (current === undefined ? current : zoomTo(natural, ratio, current, zoom, focus)));
      return;
    }
    const [dx, dy] = [(now.x - was.x) / placed.scale, (now.y - was.y) / placed.scale];
    setView((current) => (current === undefined ? current : panBy(natural, ratio, current, -dx, -dy)));
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
    if (pointers.current.size === 0) setMoving(false);
  };

  // The wheel zooms about the pointer. React's wheel listener is passive, so it can't keep the dialog from
  // scrolling: this one is the stage's own.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (natural === undefined || held === undefined) return;
    event.preventDefault();
    const at = stagePoint(event.clientX, event.clientY);
    const focus = photoPointAt(at.x, at.y);
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002));
    setEasing(false);
    setView(zoomTo(natural, ratio, held, held.zoom * factor, focus));
  });
  useEffect(() => {
    const node = stageRef.current;
    if (node === null) return;
    const listen = (event: WheelEvent) => {
      onWheel(event);
    };
    node.addEventListener('wheel', listen, { passive: false });
    return () => {
      node.removeEventListener('wheel', listen);
    };
  }, []);

  const isRound = shape === 'circle';
  const image = (box: (PhotoRect & { readonly scale: number }) | undefined, kind: 'stage' | 'preview'): ReactNode =>
    address === undefined || failed ? null : (
      <img
        className={kind === 'stage' ? styles.photo : styles.previewPhoto}
        src={address}
        alt={''}
        draggable={false}
        data-placed={box === undefined ? undefined : ''}
        {...(kind === 'stage'
          ? {
              onLoad: (event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (width === 0 || height === 0) {
                  setFailed(true);
                  return;
                }
                setNatural({ width, height });
                setView(initialView({ width, height }));
              },
              onError: () => {
                setFailed(true);
              },
            }
          : {})}
        style={{
          '--photo-crop-x': box === undefined ? undefined : `${String(box.x)}px`,
          '--photo-crop-y': box === undefined ? undefined : `${String(box.y)}px`,
          '--photo-crop-w': box === undefined ? undefined : `${String(box.width)}px`,
          '--photo-crop-h': box === undefined ? undefined : `${String(box.height)}px`,
        }}
      />
    );

  return (
    <div className={styles.root}>
      {shape === 'free' && (
        <SegmentedControl
          label={strings.frame}
          segments={FREE_FRAMES.map((value) => ({ value, label: strings.frames[value] }))}
          value={frameChoice}
          isDisabled={natural === undefined}
          onChange={(next) => {
            const found = FREE_FRAMES.find((each) => each === next);
            if (found === undefined) return;
            setFrameChoice(found);
            setEasing(false);
            if (natural !== undefined) setView(initialView(natural));
          }}
        />
      )}
      {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- the stage is an application: it takes the pointer and the keys that move the photo, named and described for it */}
      <div
        ref={(node) => {
          stageRef.current = node;
          const stop = measureStage(node);
          return () => {
            stop?.();
            stageRef.current = null;
          };
        }}
        className={styles.stage}
        data-shape={shape}
        // Dark in both themes, as a photo editor's stage is: the scrim over what the crop cuts reads as strongly on a
        // light page as on a dark one (the tokens scope to any element with the attribute, as HostedFormPreview's do).
        data-theme="dark"
        data-easing={isEasing || undefined}
        data-moving={isMoving || undefined}
        data-drags={natural === undefined ? undefined : ''}
        data-dragging={isMoving || undefined}
        // An application: a screen reader passes the arrows and plus and minus through to it, as to a map.
        role="application"
        aria-label={strings.stage}
        aria-describedby={howToId}
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- as above: the keys need it in the tab order
        tabIndex={natural === undefined ? -1 : 0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {image(placed, 'stage')}
        {failed ? (
          <p className={styles.problem} role="alert">
            {strings.unreadable}
          </p>
        ) : (
          natural === undefined && (
            <span className={styles.waiting}>
              <Skeleton shape="fill" />
              <VisuallyHidden>{strings.opening}</VisuallyHidden>
            </span>
          )
        )}
        {stage !== undefined && frame !== undefined && natural !== undefined && (
          <svg
            className={styles.veil}
            viewBox={`0 0 ${String(stage.width)} ${String(stage.height)}`}
            aria-hidden="true"
            focusable="false"
          >
            <path className={styles.shade} fillRule="evenodd" d={veilPath(stage, frame, isRound)} />
            <path className={styles.thirds} d={thirdsPath(frame)} />
            {isRound ? (
              <circle
                className={styles.edge}
                cx={frame.x + frame.width / 2}
                cy={frame.y + frame.height / 2}
                r={frame.width / 2}
              />
            ) : (
              <rect className={styles.edge} x={frame.x} y={frame.y} width={frame.width} height={frame.height} />
            )}
          </svg>
        )}
      </div>
      <VisuallyHidden id={howToId}>{strings.howTo}</VisuallyHidden>
      <VisuallyHidden>
        <span role="status" aria-live="polite">
          {said}
        </span>
      </VisuallyHidden>
      <div className={styles.controls}>
        <Button
          variant="ghost"
          icon="minus"
          label={strings.zoomOut}
          isDisabled={held === undefined || held.zoom <= 1}
          onPress={() => {
            zoomBy(1 / ZOOM_STEP, true);
          }}
        />
        <Slider
          label={strings.zoom}
          isLabelHidden
          value={held?.zoom ?? 1}
          minValue={1}
          maxValue={MAX_ZOOM}
          step={0.01}
          formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
          isDisabled={held === undefined}
          onChange={(zoom) => {
            if (natural === undefined) return;
            setEasing(false);
            setView((current) => (current === undefined ? current : zoomTo(natural, ratio, current, zoom)));
          }}
        />
        <Button
          variant="ghost"
          icon="plus"
          label={strings.zoomIn}
          isDisabled={held === undefined || held.zoom >= MAX_ZOOM}
          onPress={() => {
            zoomBy(ZOOM_STEP, true);
          }}
        />
        <span
          ref={measurePreview}
          className={styles.preview}
          data-round={isRound || undefined}
          style={{ '--photo-crop-ratio': String(ratio) }}
          role="img"
          aria-label={strings.preview}
        >
          {image(previewPlaced, 'preview')}
        </span>
      </div>
    </div>
  );
}

/** The veil over the stage with the frame cut out of it (even-odd), a circle or a rectangle. */
function veilPath(stage: PhotoSize, frame: PhotoRect, isRound: boolean): string {
  const outer = `M0 0H${String(stage.width)}V${String(stage.height)}H0Z`;
  if (!isRound) {
    return `${outer}M${String(frame.x)} ${String(frame.y)}h${String(frame.width)}v${String(frame.height)}h${String(-frame.width)}Z`;
  }
  const r = frame.width / 2;
  const [cx, cy] = [frame.x + r, frame.y + frame.height / 2];
  return `${outer}M${String(cx - r)} ${String(cy)}a${String(r)} ${String(r)} 0 1 0 ${String(2 * r)} 0a${String(r)} ${String(r)} 0 1 0 ${String(-2 * r)} 0Z`;
}

/** The two lines each way that cut the frame in thirds, shown while the photo moves. */
function thirdsPath(frame: PhotoRect): string {
  const { x, y, width, height } = frame;
  return [1, 2]
    .flatMap((part) => [
      `M${String(x + (width * part) / 3)} ${String(y)}v${String(height)}`,
      `M${String(x)} ${String(y + (height * part) / 3)}h${String(width)}`,
    ])
    .join('');
}
