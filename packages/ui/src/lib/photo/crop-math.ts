// The cropper's arithmetic (spec 0068, AC-6809), pure so it is tested in Node. Everything is in the photo's own
// pixels, as the browser turns it (its orientation already applied): a crop is a rectangle of the photo, and a
// view is how the cropper stands (how far in, and which point of the photo sits in the middle of the frame).
// The frame on screen is only ever a scale of the crop, so moving and zooming never depend on the screen's size.

/** A rectangle of the photo, in its own pixels: what `preparePhoto` keeps. */
export interface PhotoRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A width and a height, in pixels. */
export interface PhotoSize {
  readonly width: number;
  readonly height: number;
}

/** How the cropper stands: `zoom` 1 is the largest crop of the frame's shape, and the point of the photo at its middle. */
export interface CropView {
  readonly zoom: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** How far in the cropper goes: a quarter of the photo across at most. */
export const MAX_ZOOM = 4;

/** `value` held between `min` and `max`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The largest rectangle of `ratio` (width over height) that fits inside the photo: the crop at zoom 1. */
export function baseSize(size: PhotoSize, ratio: number): PhotoSize {
  return size.width / size.height > ratio
    ? { width: size.height * ratio, height: size.height }
    : { width: size.width, height: size.width / ratio };
}

/** The view a fresh photo opens on: all of it that fits the frame, from its middle. */
export function initialView(size: PhotoSize): CropView {
  return { zoom: 1, centerX: size.width / 2, centerY: size.height / 2 };
}

/** `view` kept inside the photo: its zoom between 1 and `MAX_ZOOM`, and the crop never past an edge. */
export function clampView(size: PhotoSize, ratio: number, view: CropView): CropView {
  const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : 1, 1, MAX_ZOOM);
  const base = baseSize(size, ratio);
  const [halfW, halfH] = [base.width / zoom / 2, base.height / zoom / 2];
  return {
    zoom,
    centerX: clamp(view.centerX, halfW, size.width - halfW),
    centerY: clamp(view.centerY, halfH, size.height - halfH),
  };
}

/** The part of the photo `view` keeps, inside the photo. */
export function cropOf(size: PhotoSize, ratio: number, view: CropView): PhotoRect {
  const held = clampView(size, ratio, view);
  const base = baseSize(size, ratio);
  const [width, height] = [base.width / held.zoom, base.height / held.zoom];
  return { x: held.centerX - width / 2, y: held.centerY - height / 2, width, height };
}

/** `view` moved by `dx`, `dy` photo pixels of the crop's middle, kept inside the photo. */
export function panBy(size: PhotoSize, ratio: number, view: CropView, dx: number, dy: number): CropView {
  return clampView(size, ratio, { ...view, centerX: view.centerX + dx, centerY: view.centerY + dy });
}

/**
 * `view` at `zoom`, keeping the photo's point `focus` where it is on screen (the pointer under a wheel, the middle
 * of a pinch); the frame's middle when left out, as the Slider zooms.
 */
export function zoomTo(
  size: PhotoSize,
  ratio: number,
  view: CropView,
  zoom: number,
  focus?: { readonly x: number; readonly y: number },
): CropView {
  const next = clamp(zoom, 1, MAX_ZOOM);
  if (focus === undefined) return clampView(size, ratio, { ...view, zoom: next });
  const keep = view.zoom / next;
  return clampView(size, ratio, {
    zoom: next,
    centerX: focus.x + (view.centerX - focus.x) * keep,
    centerY: focus.y + (view.centerY - focus.y) * keep,
  });
}

/**
 * The frame inside a stage of `stage` pixels: the largest rectangle of `ratio` that fits with `pad` pixels to spare
 * on every side, centred.
 */
export function fitFrame(stage: PhotoSize, ratio: number, pad: number): PhotoRect {
  const room = { width: Math.max(1, stage.width - pad * 2), height: Math.max(1, stage.height - pad * 2) };
  const fitted = baseSize(room, ratio);
  return {
    x: (stage.width - fitted.width) / 2,
    y: (stage.height - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  };
}

/**
 * Where the whole photo is drawn so that `crop` fills `frame` exactly: its box in the frame's own coordinates
 * (screen pixels), and the scale from photo pixels to screen pixels.
 */
export function placement(size: PhotoSize, crop: PhotoRect, frame: PhotoRect): PhotoRect & { readonly scale: number } {
  const scale = frame.width / crop.width;
  return {
    x: frame.x - crop.x * scale,
    y: frame.y - crop.y * scale,
    width: size.width * scale,
    height: size.height * scale,
    scale,
  };
}

/**
 * `rect` made a whole number of pixels and held inside the photo, at least one pixel each way: what a canvas can
 * draw from. A crop made on one reading of a photo and drawn from another (a turned photo read before its
 * orientation) never reaches past its edge.
 */
export function clampRect(size: PhotoSize, rect: PhotoRect): PhotoRect {
  const x = clamp(Math.round(rect.x), 0, Math.max(0, size.width - 1));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, size.height - 1));
  return {
    x,
    y,
    width: clamp(Math.round(rect.width), 1, size.width - x),
    height: clamp(Math.round(rect.height), 1, size.height - y),
  };
}

/** The middle of the photo that has `ratio`, or all of it without one: what a kind keeps when nobody cropped. */
export function centreCrop(size: PhotoSize, ratio: number | undefined): PhotoRect {
  if (ratio === undefined) return { x: 0, y: 0, width: size.width, height: size.height };
  return cropOf(size, ratio, initialView(size));
}

/** The pixels a picture is drawn at: `rect` shrunk until its long side is at most `side`, never grown. */
export function outputSize(rect: PhotoSize, side: number): PhotoSize {
  const scale = Math.min(1, side / Math.max(rect.width, rect.height));
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

/** Where the crop's middle stands, as whole percentages of the photo across and down: what a screen reader hears. */
export function positionOf(
  size: PhotoSize,
  ratio: number,
  view: CropView,
): { readonly across: number; readonly down: number } {
  const held = clampView(size, ratio, view);
  return {
    across: Math.round((held.centerX / size.width) * 100),
    down: Math.round((held.centerY / size.height) * 100),
  };
}
