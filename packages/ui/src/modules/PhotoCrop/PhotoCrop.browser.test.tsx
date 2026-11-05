// The cropper in a real browser (spec 0068, AC-6809): the keys and the Slider move and zoom the photo, Use photo
// answers the crop in the photo's own pixels, and `preparePhoto` draws exactly that part, sized for its kind.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../../styles/index.css';
import type { PhotoRect } from '../../lib/photo/crop-math.ts';
import { preparePhoto } from '../../lib/photo/prepare.ts';
import { createFixedClock } from '../../provider/clock.ts';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { PhotoCrop, type PhotoShape } from './PhotoCrop.tsx';

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

/**
 * A 1000 by 500 photo in four colours, one a quarter, so a pixel of what was drawn says which part was kept: red top
 * left, green top right, blue bottom left, yellow bottom right.
 */
async function quarters(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 500;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No canvas');
  const fills: readonly [string, number, number][] = [
    ['#ff0000', 0, 0],
    ['#00ff00', 500, 0],
    ['#0000ff', 0, 250],
    ['#ffff00', 500, 250],
  ];
  for (const [colour, x, y] of fills) {
    context.fillStyle = colour;
    context.fillRect(x, y, 500, 250);
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('No blob'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** The colour at a point of a picture, as `r,g,b`. */
async function colourAt(blob: Blob, x: number, y: number): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No canvas');
  context.drawImage(bitmap, 0, 0);
  const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
  // A JPEG's colours drift a little: round each to full or none.
  return [r, g, b].map((value) => (value > 127 ? 255 : 0)).join(',');
}

/** Opens the cropper on `source` and waits for the photo to be read. */
async function open(
  source: Blob,
  shape: PhotoShape,
  onDone: (crop: PhotoRect) => void,
  onCancel: () => void = () => undefined,
) {
  act(() => {
    root.render(
      <UiProvider
        locale="en-GB"
        timeZone="Europe/London"
        navigate={() => undefined}
        useHref={(href) => href}
        toasts={createToasts()}
        clock={createFixedClock(0)}
      >
        <PhotoCrop source={source} shape={shape} onCancel={onCancel} onDone={onDone} />
      </UiProvider>,
    );
  });
  await expect.element(page.getByRole('button', { name: 'Use photo' })).toBeEnabled();
}

describe('PhotoCrop', () => {
  it('opens on the middle of the photo in the frame’s shape', async () => {
    const onDone = vi.fn<(crop: PhotoRect) => void>();
    await open(await quarters(), 'square', onDone);
    await userEvent.click(page.getByRole('button', { name: 'Use photo' }));
    expect(onDone).toHaveBeenCalledWith({ x: 250, y: 0, width: 500, height: 500 });
  });

  it('moves by the arrows (Shift further), zooms by the Slider, and answers that crop', async () => {
    const onDone = vi.fn<(crop: PhotoRect) => void>();
    await open(await quarters(), 'square', onDone);
    const stage = page.getByRole('application', { name: 'Photo position' });
    await userEvent.click(stage);
    // The photo moves left, so the frame's middle moves right over it: 2% of the 500 crop, then 10%.
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await expect.element(page.getByRole('status')).toHaveTextContent('Photo centre 56% across, 50% down.');
    // Ten steps of the Slider: 110%.
    const slider = page.getByRole('slider', { name: 'Zoom' });
    // The slider's own input is visually hidden under its knob: focus it as Tab would.
    act(() => {
      (slider.element() as HTMLElement).focus();
    });
    await userEvent.keyboard('{Home}');
    for (let step = 0; step < 10; step += 1) await userEvent.keyboard('{ArrowRight}');
    await expect.element(slider).toHaveAttribute('aria-valuetext', '110%');
    await userEvent.click(page.getByRole('button', { name: 'Use photo' }));
    const [crop] = onDone.mock.calls[0] ?? [];
    if (crop === undefined) throw new Error('No crop');
    expect(crop.width).toBeCloseTo(500 / 1.1, 5);
    expect(crop.height).toBeCloseTo(500 / 1.1, 5);
    expect(crop.x + crop.width / 2).toBeCloseTo(560, 5);
    expect(crop.y + crop.height / 2).toBeCloseTo(250, 5);
  });

  it('shows its way out by keyboard: Cancel says ESC, as every dialog’s Cancel does', async () => {
    await open(await quarters(), 'circle', () => undefined);
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await expect.element(cancel).toBeVisible();
    await expect.element(cancel).toHaveAttribute('aria-keyshortcuts', 'Escape');
  });

  it('leaves on Esc from the photo itself, using nothing, and calls onCancel once', async () => {
    const onDone = vi.fn<(crop: PhotoRect) => void>();
    const onCancel = vi.fn<() => void>();
    await open(await quarters(), 'square', onDone, onCancel);
    // The stage takes the arrows and plus and minus, and lets Esc through to the dialog.
    await userEvent.click(page.getByRole('application', { name: 'Photo position' }));
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('leaves on Esc from the zoom, and on Cancel, each once', async () => {
    const onCancel = vi.fn<() => void>();
    await open(await quarters(), 'square', () => undefined, onCancel);
    act(() => {
      (page.getByRole('slider', { name: 'Zoom' }).element() as HTMLElement).focus();
    });
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Rendered again, open: Cancel leaves through the same door, so it too is heard once.
    onCancel.mockClear();
    await open(await quarters(), 'square', () => undefined, onCancel);
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the photo inside the frame however far it is pushed', async () => {
    const onDone = vi.fn<(crop: PhotoRect) => void>();
    await open(await quarters(), 'cover', onDone);
    await userEvent.click(page.getByRole('application', { name: 'Photo position' }));
    for (let step = 0; step < 20; step += 1) await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await userEvent.click(page.getByRole('button', { name: 'Use photo' }));
    const [crop] = onDone.mock.calls[0] ?? [];
    if (crop === undefined) throw new Error('No crop');
    expect(crop.y + crop.height).toBeCloseTo(500, 5);
    expect(crop.width / crop.height).toBeCloseTo(3, 5);
  });
});

describe('preparePhoto', () => {
  it('draws the crop it is given, sized for its kind', async () => {
    const photo = await quarters();
    // The bottom right quarter alone, as an avatar: all yellow, at the avatar's side.
    const avatar = await preparePhoto(photo, 'avatar', { x: 520, y: 260, width: 220, height: 220 });
    expect(avatar.blob.type).toBe('image/jpeg');
    expect([avatar.width, avatar.height]).toEqual([220, 220]);
    expect(await colourAt(avatar.blob, 110, 110)).toBe('255,255,0');
    // A cover with no crop: the middle band at 3:1, the whole width.
    const cover = await preparePhoto(photo, 'cover');
    expect([cover.width, cover.height]).toEqual([1000, 333]);
    expect(await colourAt(cover.blob, 10, 10)).toBe('255,0,0');
    expect(await colourAt(cover.blob, 990, 320)).toBe('255,255,0');
    // A logo keeps PNG.
    const logo = await preparePhoto(photo, 'logo', { x: 0, y: 0, width: 500, height: 250 });
    expect(logo.blob.type).toBe('image/png');
    expect(await colourAt(logo.blob, 250, 125)).toBe('255,0,0');
  });

  it('crops an address on our own origin again, as a photo already there is', async () => {
    const address = URL.createObjectURL(await quarters());
    try {
      const again = await preparePhoto(address, 'picture', { x: 0, y: 250, width: 500, height: 250 });
      expect([again.width, again.height]).toEqual([500, 250]);
      expect(await colourAt(again.blob, 250, 125)).toBe('0,0,255');
    } finally {
      URL.revokeObjectURL(address);
    }
  });
});
