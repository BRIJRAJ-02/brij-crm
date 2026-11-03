import { useCallback, useState, type ReactNode } from 'react';
import type { PhotoRect } from '../../lib/photo/crop-math.ts';
import { PhotoCrop, type PhotoShape } from './PhotoCrop.tsx';

/** One photo waiting in the cropper, and who hears how it ended. */
interface Asked {
  readonly source: Blob | string;
  readonly shape: PhotoShape;
  readonly title?: string;
  readonly settle: (crop: PhotoRect | undefined) => void;
}

/** What `usePhotoCrop` answers. */
export interface PhotoCropping {
  /**
   * Opens the cropper on `source` in `shape`, and answers the crop on Use photo, or `undefined` on Cancel. A second
   * ask while one is open answers the first `undefined`.
   */
  readonly crop: (
    source: Blob | string,
    shape: PhotoShape,
    options?: { readonly title?: string },
  ) => Promise<PhotoRect | undefined>;
  /** The cropper, to render once anywhere in the screen (it opens in a portal). */
  readonly cropper: ReactNode;
}

/**
 * The cropper as one awaited step, for a screen that picks a file and then sends it: `const crop = await
 * crop(file, 'cover'); if (crop) send(await preparePhoto(file, 'cover', crop))`. It keeps the last photo while the
 * Modal plays its exit, so the dialog never empties as it closes.
 */
export function usePhotoCrop(): PhotoCropping {
  const [asked, setAsked] = useState<Asked | undefined>(undefined);
  const [isOpen, setOpen] = useState(false);
  const crop = useCallback<PhotoCropping['crop']>(
    (source, shape, options) =>
      new Promise<PhotoRect | undefined>((resolve) => {
        setAsked((was) => {
          was?.settle(undefined);
          return { source, shape, settle: resolve, ...(options?.title === undefined ? {} : { title: options.title }) };
        });
        setOpen(true);
      }),
    [],
  );
  const end = (answer: PhotoRect | undefined) => {
    asked?.settle(answer);
    setOpen(false);
  };
  return {
    crop,
    cropper: (
      <PhotoCrop
        source={asked?.source}
        shape={asked?.shape ?? 'free'}
        isOpen={isOpen}
        {...(asked?.title === undefined ? {} : { title: asked.title })}
        onCancel={() => {
          end(undefined);
        }}
        onDone={end}
      />
    ),
  };
}
