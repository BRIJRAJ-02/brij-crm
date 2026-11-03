import { describe, expect, it } from 'vitest';
import {
  baseSize,
  centreCrop,
  clampRect,
  clampView,
  cropOf,
  fitFrame,
  initialView,
  MAX_ZOOM,
  outputSize,
  panBy,
  placement,
  positionOf,
  zoomTo,
} from './crop-math.ts';
import { PHOTO_KINDS, planPhoto } from './prepare.ts';

const LANDSCAPE = { width: 4000, height: 3000 };
// The same sensor's photo taken upright: the browser turns it by its orientation, so it is read 3000 by 4000.
const TURNED = { width: 3000, height: 4000 };

describe('the crop at zoom 1', () => {
  it('is the largest rectangle of the frame’s shape inside the photo', () => {
    expect(baseSize(LANDSCAPE, 1)).toEqual({ width: 3000, height: 3000 });
    expect(baseSize(LANDSCAPE, 3)).toEqual({ width: 4000, height: 4000 / 3 });
    expect(baseSize(TURNED, 3)).toEqual({ width: 3000, height: 1000 });
  });

  it('opens from the photo’s middle', () => {
    expect(cropOf(LANDSCAPE, 1, initialView(LANDSCAPE))).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
    expect(cropOf(TURNED, 3, initialView(TURNED))).toEqual({ x: 0, y: 1500, width: 3000, height: 1000 });
  });
});

describe('moving and zooming', () => {
  it('never lets the crop past an edge', () => {
    const moved = panBy(LANDSCAPE, 1, initialView(LANDSCAPE), 10_000, -10_000);
    expect(cropOf(LANDSCAPE, 1, moved)).toEqual({ x: 1000, y: 0, width: 3000, height: 3000 });
  });

  it('holds the zoom between 1 and the most', () => {
    expect(clampView(LANDSCAPE, 1, { zoom: 0.2, centerX: 2000, centerY: 1500 }).zoom).toBe(1);
    expect(clampView(LANDSCAPE, 1, { zoom: 99, centerX: 2000, centerY: 1500 }).zoom).toBe(MAX_ZOOM);
    expect(clampView(LANDSCAPE, 1, { zoom: Number.NaN, centerX: 2000, centerY: 1500 }).zoom).toBe(1);
  });

  it('keeps the point under the pointer where it is', () => {
    const view = initialView(LANDSCAPE);
    const focus = { x: 1000, y: 1000 };
    const before = cropOf(LANDSCAPE, 1, view);
    const zoomed = zoomTo(LANDSCAPE, 1, view, 2, focus);
    const after = cropOf(LANDSCAPE, 1, zoomed);
    // The focus sits at the same share of the crop across and down, before and after.
    expect((focus.x - after.x) / after.width).toBeCloseTo((focus.x - before.x) / before.width);
    expect((focus.y - after.y) / after.height).toBeCloseTo((focus.y - before.y) / before.height);
    expect(after.width).toBe(1500);
  });

  it('zooms about the middle without a focus', () => {
    const zoomed = zoomTo(LANDSCAPE, 1, initialView(LANDSCAPE), 2);
    expect(cropOf(LANDSCAPE, 1, zoomed)).toEqual({ x: 1250, y: 750, width: 1500, height: 1500 });
  });

  it('says where the crop stands as percentages', () => {
    expect(positionOf(LANDSCAPE, 1, initialView(LANDSCAPE))).toEqual({ across: 50, down: 50 });
  });
});

describe('the frame on screen', () => {
  it('fits the shape inside the stage with room round it', () => {
    expect(fitFrame({ width: 400, height: 300 }, 1, 20)).toEqual({ x: 70, y: 20, width: 260, height: 260 });
    expect(fitFrame({ width: 400, height: 200 }, 3, 20)).toEqual({ x: 20, y: 40, width: 360, height: 120 });
  });

  it('draws the photo so the crop fills the frame exactly', () => {
    const frame = { x: 70, y: 20, width: 260, height: 260 };
    const crop = { x: 500, y: 0, width: 3000, height: 3000 };
    const placed = placement(LANDSCAPE, crop, frame);
    expect(placed.scale).toBeCloseTo(260 / 3000);
    expect(placed.x + crop.x * placed.scale).toBeCloseTo(frame.x);
    expect(placed.y + crop.y * placed.scale).toBeCloseTo(frame.y);
    expect(placed.width).toBeCloseTo(4000 * placed.scale);
  });
});

describe('the rectangle drawn from', () => {
  it('is whole pixels inside the photo, at least one each way', () => {
    expect(clampRect(LANDSCAPE, { x: -20.4, y: 10.6, width: 5000, height: 0.2 })).toEqual({
      x: 0,
      y: 11,
      width: 4000,
      height: 1,
    });
    expect(clampRect(LANDSCAPE, { x: 3999.6, y: 2999.7, width: 50, height: 50 })).toEqual({
      x: 3999,
      y: 2999,
      width: 1,
      height: 1,
    });
  });

  it('holds a crop made on the upright reading inside a photo read turned', () => {
    // A crop at the bottom right of the landscape reading, drawn from a photo read upright.
    expect(clampRect(TURNED, { x: 3000, y: 2000, width: 1000, height: 1000 })).toEqual({
      x: 2999,
      y: 2000,
      width: 1,
      height: 1000,
    });
  });

  it('is the kind’s middle, or the whole photo, when nobody cropped', () => {
    expect(centreCrop(LANDSCAPE, undefined)).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(centreCrop(LANDSCAPE, 3)).toEqual({ x: 0, y: 1500 - 2000 / 3, width: 4000, height: 4000 / 3 });
  });
});

describe('the size a picture is drawn at', () => {
  it('shrinks to the kind’s side, never grows', () => {
    expect(outputSize({ width: 3000, height: 1000 }, 1800)).toEqual({ width: 1800, height: 600 });
    expect(outputSize({ width: 300, height: 100 }, 1800)).toEqual({ width: 300, height: 100 });
  });

  it('plans each kind from its rules', () => {
    expect(planPhoto(LANDSCAPE, 'avatar')).toEqual({
      source: { x: 500, y: 0, width: 3000, height: 3000 },
      width: PHOTO_KINDS.avatar.side,
      height: PHOTO_KINDS.avatar.side,
    });
    expect(planPhoto(LANDSCAPE, 'cover')).toEqual({
      source: { x: 0, y: 833, width: 4000, height: 1333 },
      width: 1800,
      height: 600,
    });
    expect(planPhoto(LANDSCAPE, 'logo')).toEqual({
      source: { x: 0, y: 0, width: 4000, height: 3000 },
      width: 1200,
      height: 900,
    });
    expect(planPhoto(TURNED, 'picture', { x: 100, y: 200, width: 800, height: 600 })).toEqual({
      source: { x: 100, y: 200, width: 800, height: 600 },
      width: 800,
      height: 600,
    });
  });

  it('draws a share picture at the 1.91:1 a pasted link shows', () => {
    const plan = planPhoto(LANDSCAPE, 'share');
    expect(plan.width).toBe(1200);
    expect(plan.height).toBe(630);
  });
});
