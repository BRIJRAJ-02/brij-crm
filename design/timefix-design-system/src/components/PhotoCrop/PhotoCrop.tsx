import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Circle, ImagePlus, RectangleHorizontal } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Slider } from '../Slider/Slider.tsx';
import { SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import { cx } from '../../lib/cx.ts';
import './PhotoCrop.css';

/** The mask: a round face, or a wide 3:1 cover. */
export type PhotoShape = 'round' | 'wide';

/** The part kept: the offset as a share of the frame (so it fits any size the photo is shown at), the zoom over a cover fit, and the photo's own aspect. */
export interface PhotoCropValue { readonly x: number; readonly y: number; readonly zoom: number; readonly aspect: number; readonly shape: PhotoShape }

const MAX_ZOOM = 3;
const FRAME_ASPECT: Readonly<Record<PhotoShape, number>> = { round: 1, wide: 3 };

/** The photo's size at zoom 1 when it just covers a frame. */
function coverSize(aspect: number, w: number, h: number) {
  return aspect > w / h ? { width: h * aspect, height: h } : { width: w, height: w / aspect };
}
/** Keeps the photo covering the frame: offsets (shares of the frame) clamp to the overhang. */
function clamp(v: PhotoCropValue): PhotoCropValue {
  const base = coverSize(v.aspect, FRAME_ASPECT[v.shape], 1);
  const maxX = Math.max(0, (base.width * v.zoom - FRAME_ASPECT[v.shape]) / 2) / FRAME_ASPECT[v.shape];
  const maxY = Math.max(0, (base.height * v.zoom - 1) / 2);
  return { ...v, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
}

/** A photo shown through its crop at any size: the same arithmetic as the cropper, so what was framed is what shows. */
export function CroppedImage({ src, crop, width, alt = '' }: { readonly src: string; readonly crop: PhotoCropValue; readonly width: number; readonly alt?: string }) {
  const height = width / FRAME_ASPECT[crop.shape];
  const base = coverSize(crop.aspect, width, height);
  const style = { width: base.width, height: base.height, transform: `translate(-50%, -50%) translate(${crop.x * width}px, ${crop.y * height}px) scale(${crop.zoom})` };
  return (
    <span className={cx('tf-cropped', crop.shape === 'round' && 'tf-cropped--round')} style={{ width, height }}>
      <img src={src} alt={alt} className="tf-cropped__img" style={style} draggable={false} />
    </span>
  );
}

/** Props for PhotoCrop. */
export interface PhotoCropProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** A photo already there, to crop again. Left out, the dialog asks for one. */
  readonly src?: string;
  /** Where a photo already there was framed last time, so adjusting starts from it. */
  readonly initialCrop?: PhotoCropValue;
  /** Fixed by the use; leave out to let the owner choose. */
  readonly shape?: PhotoShape;
  readonly defaultShape?: PhotoShape;
  readonly title?: string;
  /** Resolves when the crop is kept; the dialog shows Saved, then closes. */
  readonly onSave: (src: string, crop: PhotoCropValue) => Promise<void> | void;
}

/** The avatar and cover cropper: drop or choose a photo, drag to place it, zoom with the slider, round or wide mask, then Save. Arrow keys move it and + and − zoom. */
export function PhotoCrop({ isOpen, onOpenChange, src, initialCrop, shape, defaultShape = 'round', title = 'Crop photo', onSave }: PhotoCropProps) {
  const [photo, setPhoto] = useState(src);
  const [crop, setCrop] = useState<PhotoCropValue>({ x: 0, y: 0, zoom: 1, aspect: 1, shape: shape ?? defaultShape });
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [moving, setMoving] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ readonly px: number; readonly py: number; readonly x: number; readonly y: number } | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) return;
    setPhoto(src); setPhase('idle');
    setCrop((c) => (initialCrop && src ? initialCrop : { ...c, x: 0, y: 0, zoom: 1, shape: shape ?? c.shape }));
    // Only opening resets it; the consumer's crop object may be new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, src, shape]);
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setFrame({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [photo, crop.shape, isOpen]);

  const update = (patch: Partial<PhotoCropValue>) => setCrop((c) => clamp({ ...c, ...patch }));
  const take = (files: readonly File[]) => { const f = files[0]; if (f) { setPhoto(URL.createObjectURL(f)); update({ x: 0, y: 0, zoom: 1 }); } };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
    setMoving(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !frame.width) return;
    update({ x: d.x + (e.clientX - d.px) / frame.width, y: d.y + (e.clientY - d.py) / frame.height });
  };
  const up = () => { drag.current = undefined; setMoving(false); };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, Partial<PhotoCropValue>> = {
      ArrowLeft: { x: crop.x - step }, ArrowRight: { x: crop.x + step }, ArrowUp: { y: crop.y - step }, ArrowDown: { y: crop.y + step },
      '+': { zoom: Math.min(MAX_ZOOM, crop.zoom + 0.1) }, '=': { zoom: Math.min(MAX_ZOOM, crop.zoom + 0.1) }, '-': { zoom: Math.max(1, crop.zoom - 0.1) },
    };
    const m = moves[e.key];
    if (m) { e.preventDefault(); update(m); }
  };

  const save = async () => {
    if (!photo) return;
    setPhase('saving');
    try {
      await onSave(photo, crop);
      setPhase('saved');
      window.setTimeout(() => onOpenChange(false), 700);
    } catch { setPhase('idle'); }
  };

  const base = coverSize(crop.aspect, frame.width || 1, frame.height || 1);
  const imgStyle = { width: base.width, height: base.height, transform: `translate(-50%, -50%) translate(${crop.x * frame.width}px, ${crop.y * frame.height}px) scale(${crop.zoom})` } as CSSProperties;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={title} size="wide"
      description={photo ? 'Drag to place it. Zoom to fill the frame.' : 'A clear, well lit photo works best.'}
      actions={photo ? (
        <>
          <Button variant="ghost" onPress={() => setPhoto(undefined)} isDisabled={phase !== 'idle'} icon={<ImagePlus size={16} strokeWidth={1.75} />} className="tf-crop__another">Choose another</Button>
          <Button slot="close" isDisabled={phase !== 'idle'}>Cancel</Button>
          <Button variant="primary" onPress={() => void save()} isPending={phase === 'saving'} icon={phase === 'saved' ? <SuccessCheck size={16} /> : undefined}>
            <TextSwap swapKey={phase === 'saved' ? 'saved' : 'save'}>{phase === 'saved' ? 'Saved' : 'Save'}</TextSwap>
          </Button>
        </>
      ) : <Button slot="close">Cancel</Button>}>
      {photo ? (
        <div className="tf-crop">
          <div className="tf-crop__stage" data-theme="dark" data-moving={moving || undefined}
            tabIndex={0} role="group" aria-roledescription="photo position" aria-label="Photo position. Arrow keys move it, plus and minus zoom."
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
            <div ref={frameRef} className={cx('tf-crop__frame', `tf-crop__frame--${crop.shape}`)}>
              <img src={photo} alt="" className="tf-crop__img" style={imgStyle} draggable={false}
                onLoad={(e) => update({ aspect: e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight) })} />
              <span className="tf-crop__mask" aria-hidden="true"><span className="tf-crop__thirds" /></span>
            </div>
          </div>
          <div className="tf-crop__controls">
            <Slider label="Zoom" minValue={1} maxValue={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={(zoom: number) => update({ zoom })}
              formatOptions={{ style: 'percent', maximumFractionDigits: 0 }} className="tf-crop__zoom" />
            {shape === undefined && (
              <SegmentedControl aria-label="Frame" selectedKey={crop.shape} onSelectionChange={(k) => update({ shape: k as PhotoShape, x: 0, y: 0 })}
                items={[{ id: 'round', label: 'Round', icon: <Circle size={14} strokeWidth={1.75} /> }, { id: 'wide', label: 'Wide', icon: <RectangleHorizontal size={14} strokeWidth={1.75} /> }]} />
            )}
          </div>
        </div>
      ) : (
        <FileDrop label="Drop a photo here" description="JPG, PNG or WebP, up to 10 MB" acceptedFileTypes={['image/jpeg', 'image/png', 'image/webp']} allowsMultiple={false} onFiles={take} />
      )}
    </Dialog>
  );
}
