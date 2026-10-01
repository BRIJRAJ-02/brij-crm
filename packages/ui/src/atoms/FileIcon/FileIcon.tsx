import { Icon, type IconSize } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';

/** Props for FileIcon. */
export interface FileIconProps {
  /** The file's MIME type, such as `application/pdf`. */
  readonly contentType: string;
  readonly size?: IconSize;
  /** Give it only when the icon stands alone; beside a file name it is decorative. */
  readonly label?: string;
}

const BY_TYPE: readonly (readonly [RegExp, IconName])[] = [
  [/^image\//, 'image'],
  [/^video\//, 'film'],
  [/^audio\//, 'music'],
  [/^text\/csv$|spreadsheet|excel|numbers/, 'file-spreadsheet'],
  [/presentation|powerpoint|keynote/, 'presentation'],
  [/zip|compressed|x-tar|x-7z|gzip|x-rar/, 'file-archive'],
  [/json|javascript|typescript|xml|x-sh|x-python|^text\/html$/, 'file-code'],
  [/^text\/|pdf|msword|wordprocessing|rtf/, 'file-text'],
];

/** The icon for a MIME type: an image, a film, a spreadsheet, a document, or a plain file. */
export function fileIconName(contentType: string): IconName {
  const type = contentType.toLowerCase();
  return BY_TYPE.find(([pattern]) => pattern.test(type))?.[1] ?? 'file';
}

/** A file's type as an icon, beside its name in a file chip, an upload or an attachment. */
export function FileIcon({ contentType, size = 'md', label }: FileIconProps) {
  return <Icon name={fileIconName(contentType)} size={size} tone="muted" {...(label === undefined ? {} : { label })} />;
}
