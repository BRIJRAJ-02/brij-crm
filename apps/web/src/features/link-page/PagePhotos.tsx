// Brief
// Purpose: the link page's photo rows (spec 0060, AC-10, AC-13; 9 Nov 2026), shared by the two cards that hold
// them since the profile went first (owner, 10 Nov 2026): Profile holds the profile photo and the cover, Design the
// background. One row each, the same FileDrop row and the same Remove question wherever it stands.
// Main task: upload, change, crop again or remove one photo, saying in one line where it shows.
// Leaves out: the photo's shape (a look choice, in Design) and the account photo itself (Settings › Profile).
import type { PageLookExtras } from '@crm/data';
import { Button, FileDrop, Modal } from '@crm/ui';
import { useState } from 'react';
import { BRAND_PHOTO_PICK_MAX_BYTES, BRAND_PHOTO_TYPES } from './photo-prep.ts';
import { strings } from './strings.ts';

/** A page's three photos, in the order they show on it, top to bottom. */
export type PhotoSlot = 'cover' | 'avatar' | 'ground';

/** What a photo row reads and changes: the page's own photos, and the screen's handlers for them. */
export interface PhotoExtras {
  /** The page's own photos (and the rest of its look); undefined while it loads. */
  readonly look: PageLookExtras | undefined;
  /** Where the owner's browser reads one of their photos. */
  readonly photoSrc: (slot: PhotoSlot, version: string) => string | undefined;
  /**
   * A photo picked for a slot, or the address of the one there to crop again (spec 0068, AC-6809): the screen opens
   * the cropper on it, draws it again and sends it.
   */
  readonly onPhoto: (slot: PhotoSlot, source: File | string) => void;
  readonly onRemovePhoto: (slot: PhotoSlot) => void;
  /** The slot whose photo is on its way. */
  readonly sending?: PhotoSlot;
}

/** Each photo's row: its name, the one line saying where it shows, and the picture's alt text. */
const ROWS: Readonly<Record<PhotoSlot, { readonly label: string; readonly hint: string; readonly alt: string }>> = {
  cover: { label: strings.coverPhoto, hint: strings.coverPhotoHint, alt: strings.coverAlt },
  avatar: { label: strings.avatarPhoto, hint: strings.avatarPhotoHint, alt: strings.avatarAlt },
  ground: { label: strings.groundPhoto, hint: strings.groundPhotoHint, alt: strings.groundAlt },
};

/** What the Remove question says for each photo: which one, and what the page shows instead. */
const REMOVING: Readonly<Record<PhotoSlot, { readonly title: string; readonly text: string }>> = {
  cover: { title: strings.coverRemoving, text: strings.coverRemoveText },
  avatar: { title: strings.avatarRemoving, text: strings.avatarRemoveText },
  ground: { title: strings.groundRemoving, text: strings.groundRemoveText },
};

/** Where one of the page's photos is read from, or undefined while it has none (or the look still loads). */
export function photoSrcOf(extras: PhotoExtras | undefined, slot: PhotoSlot): string | undefined {
  const version = extras?.look?.[slot];
  return version === undefined ? undefined : extras?.photoSrc(slot, version);
}

/** Props for PagePhotos. */
export interface PagePhotosProps {
  /** Which photos, in this order. */
  readonly slots: readonly PhotoSlot[];
  /** Absent or still loading: the rows stand disabled. */
  readonly extras: PhotoExtras | undefined;
  /** What the page shows for its profile photo while it has none of its own (the account photo): nothing to remove. */
  readonly avatarStandIn?: string;
}

/**
 * The photos `slots` names, one FileDrop row each: what is there, Upload or Change, Adjust crop and Remove, and the
 * line saying where it shows. Remove asks first, naming the photo, and keeps its words while the question closes.
 */
export function PagePhotos({ slots, extras, avatarStandIn }: PagePhotosProps) {
  // Whether Remove is being asked, and of which photo, apart: the dialog keeps its words while it closes.
  const [isRemoving, setRemoving] = useState(false);
  const [asked, setAsked] = useState<PhotoSlot>(slots[0] ?? 'cover');
  const look = extras?.look;
  return (
    <>
      {slots.map((slot) => {
        const row = ROWS[slot];
        const src = photoSrcOf(extras, slot);
        // With no photo of its own the page shows the account photo: the row shows it too, offering Change.
        const standIn = slot === 'avatar' ? avatarStandIn : undefined;
        return (
          <FileDrop
            key={slot}
            variant="row"
            label={row.label}
            description={row.hint}
            {...(slot === 'avatar' ? { thumb: 'square' as const } : {})}
            acceptedTypes={BRAND_PHOTO_TYPES}
            typesText={strings.photoTypes}
            maxSize={BRAND_PHOTO_PICK_MAX_BYTES}
            isDisabled={extras === undefined || look === undefined}
            isPending={extras?.sending === slot}
            {...(src === undefined
              ? standIn === undefined
                ? {}
                : { preview: { src: standIn, alt: row.alt } }
              : {
                  preview: { src, alt: row.alt },
                  onAdjust: () => {
                    extras?.onPhoto(slot, src);
                  },
                  onRemove: () => {
                    setAsked(slot);
                    setRemoving(true);
                  },
                })}
            onFiles={(files) => {
              const [file] = files;
              if (file !== undefined) extras?.onPhoto(slot, file);
            }}
          />
        );
      })}
      <Modal
        isOpen={isRemoving}
        onOpenChange={setRemoving}
        title={REMOVING[asked].title}
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button variant="ghost" onPress={() => setRemoving(false)}>
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                extras?.onRemovePhoto(asked);
                setRemoving(false);
              }}
            >
              {strings.photoRemove}
            </Button>
          </>
        }
      >
        {REMOVING[asked].text}
      </Modal>
    </>
  );
}
