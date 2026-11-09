/** FileDrop's built in copy. */
export const strings = {
  dragOr: 'Drag files here, or',
  /** One file at a time (an import's CSV): the words say so. */
  dragOneOr: 'Drag a file here, or',
  browse: 'browse',
  /** Crops the picture there now again (`onAdjust`). */
  adjust: 'Adjust crop',
  /** The row's button while nothing is there (`variant="row"`). */
  upload: 'Upload',
  /** The row's button while a picture is there. */
  change: 'Change',
  /** The row's buttons' fuller names, so two rows on one screen never share one ("Upload cover photo"). */
  uploadNamed: (label: string) => `Upload ${label.toLowerCase()}`,
  changeNamed: (label: string) => `Change ${label.toLowerCase()}`,
  /** `variant="photo"`: its box's words, then how it takes one. */
  addNamed: (label: string) => `Add ${label.toLowerCase()}`,
  dropPasteOrPress: 'Drop, paste or click',
  /** `variant="photo"`: the remove button's words; its picture is right beside it. */
  removeShort: 'Remove',
  /** The row's trash button, named for what it takes away. */
  remove: (label: string) => `Remove ${label.toLowerCase()}`,
  /** While what was picked is on its way (`isPending` on the zone). */
  sending: 'uploading…',
  upTo: (size: string) => `up to ${size}`,
  wrongType: (name: string, types: string) => `${name} isn’t a file this takes. Choose ${types}.`,
  tooBig: (name: string, size: string) => `${name} is over ${size}. Choose a smaller file, or split it.`,
} as const;
