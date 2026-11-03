/** PhotoCrop's built in copy. */
export const strings = {
  title: 'Crop photo',
  done: 'Use photo',
  cancel: 'Cancel',
  reset: 'Reset',
  zoom: 'Zoom',
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  frame: 'Shape',
  /** The free crop's frames. */
  frames: {
    original: 'Original',
    square: 'Square',
    landscape: '4:3',
    portrait: '3:4',
    wide: '16:9',
  },
  /** The photo you move: its name, and how to move it, for screen readers. */
  stage: 'Photo position',
  howTo: 'Drag the photo to place it, or use the arrow keys. Hold Shift to move further. Plus and minus zoom.',
  /** Said after a key moves or zooms the photo. */
  moved: (across: number, down: number) => `Photo centre ${String(across)}% across, ${String(down)}% down.`,
  zoomed: (percent: string) => `Zoom ${percent}.`,
  preview: 'Preview',
  opening: 'Opening the photo…',
  unreadable: 'This picture can’t be opened here. Choose another one.',
} as const;
