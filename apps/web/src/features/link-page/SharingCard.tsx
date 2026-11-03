// Brief
// Purpose: what happens when the page is shared or looked up (spec 0055), in one place beside Appearance.
// Main task: let the owner say whether search engines may show their page, and choose the picture a pasted link
// shows instead of the card we draw.
// Leaves out: the drawn card itself, which the server makes from the name, bio and picture already on this screen.
import { Button, Card, FileDrop, Modal, Switch, usePhotoCrop } from '@crm/ui';
import { preparePhoto } from '@crm/ui/photo';
import type { DataError } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { asBase64, SHARE_IMAGE_MAX_BYTES, SHARE_IMAGE_TYPES } from './share-image.ts';
import { strings } from './strings.ts';

/** The picture a pasted link shows, as the procedure takes it. */
export interface ShareImageChoice {
  readonly type: string;
  readonly base64: string;
}

/** Props for SharingCard. */
export interface SharingCardProps {
  /** Whether search engines may show the page, as it stands now, a change on its way already shown. */
  readonly indexable: boolean;
  /** A change: shown at once by the caller, then saved. A refusal puts the switch back and says why. */
  readonly onChange: (indexable: boolean) => void;
  /** Where the picture its owner chose is served from, absent while the card is the drawn one. */
  readonly shareImage?: string;
  /** A new picture, or `undefined` to go back to the drawn card. */
  readonly onShareImage: (image: ShareImageChoice | undefined) => void;
  /** Why the last change didn't save, said on the card until the next one. */
  readonly refusal?: DataError;
}

/**
 * Sharing and search (spec 0055, AC-5506, AC-5511). The switch is on for everybody: a page is made to be found,
 * and turning it off is the deliberate choice, not the default. The switch moves the moment it is pressed, as
 * every other setting here does, and the reason for a refusal stays on this card rather than passing in a toast.
 *
 * The picture is the library's FileDrop, which already says what it takes and refuses the rest with a sentence;
 * what is there now is its preview, so nobody replaces a picture they cannot see. Going back to the drawn card
 * asks first, as every ending action here does, because the picture itself is gone afterwards.
 */
export function SharingCard({ indexable, onChange, shareImage, onShareImage, refusal }: SharingCardProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const [isAsking, setAsking] = useState(false);
  // The picture goes through the cropper at the 1.91:1 a pasted link shows (spec 0068, AC-6809), then is drawn
  // again as a JPEG under 500 kB, leaving a photo's location behind; the one there may be cropped again.
  const cropping = usePhotoCrop();
  const take = (source: File | string) => {
    void cropping.crop(source, 'card').then(async (crop) => {
      if (crop === undefined) return;
      const prepared = await preparePhoto(source, 'share', crop).catch(() => undefined);
      if (prepared === undefined) {
        toasts.toast({ tone: 'danger', message: strings.shareImageUnreadable });
        return;
      }
      onShareImage({ type: prepared.blob.type, base64: await asBase64(prepared.blob) });
    });
  };
  return (
    <Card
      title={strings.sharing}
      description={strings.sharingText}
      {...(refusal === undefined ? {} : { footerNote: refusal.message })}
    >
      <Switch label={strings.indexable} isSelected={indexable} onChange={onChange} />
      <FileDrop
        label={shareImage === undefined ? strings.shareImageDrop : strings.shareImage}
        acceptedTypes={SHARE_IMAGE_TYPES}
        typesText={strings.shareImageTypes}
        maxSize={SHARE_IMAGE_MAX_BYTES}
        {...(shareImage === undefined
          ? {}
          : {
              preview: { src: shareImage, alt: strings.shareImageAlt },
              onAdjust: () => {
                take(shareImage);
              },
            })}
        onFiles={(files) => {
          const [file] = files;
          if (file !== undefined) take(file);
        }}
      />
      {cropping.cropper}
      {shareImage !== undefined && (
        <Button
          variant="ghost"
          size="md"
          onPress={() => {
            setAsking(true);
          }}
        >
          {strings.shareImageRemove}
        </Button>
      )}
      <Modal
        isOpen={isAsking}
        onOpenChange={setAsking}
        title={strings.shareImageRemoving}
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button
              variant="ghost"
              onPress={() => {
                setAsking(false);
              }}
            >
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                setAsking(false);
                onShareImage(undefined);
              }}
            >
              {strings.shareImageRemove}
            </Button>
          </>
        }
      >
        {strings.shareImageRemoveText}
      </Modal>
    </Card>
  );
}
