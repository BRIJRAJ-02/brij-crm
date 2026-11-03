// What first run's photo picker takes (27 Oct 2026). The photo is placed in the round cropper and drawn again as the
// avatar by `PhotoCrop` and `preparePhoto` (`@crm/ui`, `@crm/ui/photo`, spec 0068 AC-6809): drawing it again is the
// point, since a phone's photo carries where it was taken and with what, and none of that survives a canvas, so a
// picture that shows on a public booking page never carries its owner's location. The server still checks what
// arrives; this is for the honest file, not against a hostile one.

/** The types a person may pick: what the server takes. */
export const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** The largest file a person may pick, before it is drawn again: a phone's photo is a few megabytes. */
export const PHOTO_PICK_MAX_BYTES = 20 * 1024 * 1024;
