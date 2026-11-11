PhotoCrop is the one cropper every picture passes through before upload: drop or choose a photo, drag it into place, zoom, and save it round (a face) or wide (a cover).

**Use it for**: profile photos, logos, booking and business page covers, staff and dish photos. **Don't use it for** files that are not pictures (FileDrop alone) or for editing a photo's colours.

**The consumer provides**: `isOpen` and `onOpenChange`, `src` for a photo already there (left out, the dialog asks for one), `shape` when the use fixes it (`round`, `wide`, or `square` for a dish or product; left out, a Round and Wide control shows), `title`, and `onSave(src, crop)`, which may return a promise. The crop is `{ x, y, zoom, aspect, shape }`, offsets as shares of the frame, so `CroppedImage` shows the same framing at any size; `cropToDataUrl(src, crop, width)` draws it once into a finished picture for places that keep one (a dish photo).

**States**: empty (the drop zone), placing, moving (thirds fade in), saving (Save spins), saved (Save becomes Saved with a drawn check, then the dialog closes), and a failed save that leaves it open.

**Interaction**: drag with a pointer or finger; on the focused stage the arrow keys move it (Shift for larger steps) and + and − zoom. The zoom is a Slider from 100% to 300%. The photo always covers the frame. The dialog opens and closes as a modal; the mask's corners ease between round and wide; Save to Saved crossfades with a success check. All instant under reduced motion.

**Replaces**: PhotoCrop and usePhotoCrop.
