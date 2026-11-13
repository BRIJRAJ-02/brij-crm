# PhotoCrop

The one cropper every picture passes through before upload (spec 0068, AC-6809): a profile photo, a logo, a cover, a link page's pictures and gallery, a share picture, and the menu dishes, staff, events and business galleries that adopt it next.

## Why it exists

New (4 November 2026). The owner asked for "crop and all across" on photos. Before it, each picker took a fixed middle (the avatar's middle square, a cover's middle 3:1 band) with no say. Nothing in the library placed a picture behind a frame: Avatar and FileDrop show a picture, they don't move one. It is a module because it composes the library's own parts (Modal, Slider, SegmentedControl, Button, Skeleton) around one new element, the stage.

## Use

```tsx
// A screen that picks a file and sends it awaits the crop in one step:
const { crop, cropper } = usePhotoCrop();
const send = async (file: File) => {
  const kept = await crop(file, 'cover');
  if (kept === undefined) return; // Cancel
  const { blob } = await preparePhoto(file, 'cover', kept); // from '@crm/ui/photo'
  upload(blob);
};
return <>{/* … the FileDrop that calls send … */}{cropper}</>;

// Or held by the screen itself:
<PhotoCrop source={picked} shape="circle" onCancel={() => setPicked(undefined)} onDone={(crop) => …} />
```

- `source`: a `File`/`Blob` just picked, or the address of a picture already there (our own origin, `safeImageSrc`) to crop again. Undefined keeps it closed. Pair it with FileDrop's `onAdjust`, which offers "Adjust crop" beside a picture that is there.
- `shape`: fixed by the use. `circle` a face (a square drawn round, as Avatar shows it), `square` a logo or a square dish, `cover` 3:1, `dish` 4:3, `card` 1.91:1 (a pasted link's picture), `free` a gallery's picture, where a SegmentedControl picks the frame: its own shape (first), Square, 4:3, 3:4 or 16:9.
- `title`: "Crop photo" unless a step says more ("Crop photo 2 of 3" for several picked at once).
- `onDone(crop)`: the part kept, `{ x, y, width, height }` in the photo's own pixels as the browser turns it (its orientation applied). Hand it to `preparePhoto(source, kind, crop)` from `@crm/ui/photo`, which draws that part again (leaving a photo's location and camera behind), sizes it for the kind and writes the kind's file type, so the server keeps receiving finished files. The original is never kept.

The kinds `preparePhoto` takes, and the shape each opens with: `avatar` (512 square JPEG, `circle`), `logo` (1200, PNG keeps transparency, `square` or `free`), `cover` (1800, 3:1 JPEG, `cover`), `ground` (2400 JPEG, `free`), `picture` (1600 JPEG under 1.5 MB, `free` or `square`), `share` (1200 × 630 JPEG under 500 kB, `card`), `dish` (1600 JPEG, `dish` or `square`).

## Built by hand, not on react-easy-crop

The drag, pinch and wheel are about 150 lines of pointer events over pure arithmetic (`lib/photo/crop-math.ts`, tested in Node). `react-easy-crop` would have saved those lines but not the rest: its keyboard support is a few arrow keys on a div with no name, no description and no announcement, its zoom slider is ours to draw anyway, and by default it injects a `<style>` element at runtime, which the app's CSP (`style-src 'self'` plus one hash) refuses (turned off, its stylesheet with raw values becomes ours to carry). Owning the stage keeps it inside the CSP, on tokens, and complete for the keyboard and screen readers.

## Anatomy

- The Modal is a `window` (`size-dialog-wide`), so the stage is about 750px across on a desk and the window's width on a phone (round 2, 4 November 2026: at 560px the photo was too small to place).
- The stage: 4:3 (2:1 for a cover), at most 55% of the window's height, in the dark theme whatever the page's (`data-theme="dark"` on it, as HostedFormPreview scopes its theme): `surface-subtle` under the photo, and the dark `scrim` (55%) over all of it but the frame, so what the crop cuts reads as clearly on a light page as on a dark one (a light wash was too pale to show it). The frame's edge is in the accent, and thirds fade in while the photo moves.
- Under it: the zoom's minus, Slider and plus, then a preview a bar high in the frame's shape (round for a face): the crop as it will sit.
- The footer: Reset at its start, then Cancel (with its `ESC` keycap) and Use photo.

## States

Opening (a Skeleton fills the stage and Use photo waits), ready, moving (thirds show, the grabbing cursor), easing (after a key or Reset, the photo eases to its place over `duration-fast`; a pointer, the wheel and the Slider move it at once), unreadable (a sentence in the stage, Use photo stays off). Reduced motion drops the easing; forced colours draw the frame's edge in Highlight.

## Keyboard and screen readers

The stage is an `application` named "Photo position", described by how to move it. Arrows move the photo that way (2% of the frame; Shift 10%), plus and minus zoom (10%), and after each key a polite status says where the photo's centre stands ("Photo centre 50% across, 43% down.") or the zoom. The Slider is a real slider (Home, End, Page Up and Page Down too). Esc and Cancel leave with nothing used, from anywhere in the dialog, the stage included (it passes Esc through), and `onCancel` is heard once. Cancel is the footer's close (`slot="close"`), so it shows the `ESC` keycap every dialog's Cancel shows (5 November 2026: it was a plain button with no key, so the cropper read as having no way out by keyboard while Esc already left it). No line in the footer spells out the keys; the keycaps are the hint, as in every Modal.

## Pointer and touch

Drag places it; the wheel zooms about the pointer; two fingers pinch about their middle. The crop never leaves the photo and the zoom stays between 100% and 400%.

## Differences from the artifact

The artifact has no PhotoCrop card yet; this is the code first version, published with the next `pnpm ui:artifact`.
