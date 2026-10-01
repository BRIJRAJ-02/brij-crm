import type { FileDisplay as FileDisplayShape, FileValue } from '@crm/contracts/values';
import { FileItem } from '../../molecules/FileItem/FileItem.tsx';
import { ChipRow, EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList } from '../values.ts';

/** File: FileItem chips with type icons, "+N" past `maxVisible`; download links from #32's display shapes. */
export function FileDisplay({ attribute, value, display, surface, maxVisible }: DisplayProps<'file'>) {
  const files = asList<FileValue>(value);
  if (files.length === 0) return <EmptyValue surface={surface} />;
  const displays = asList<FileDisplayShape>(display);
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={files.map((file) => {
        const href = displays.find((shape) => shape.fileId === file.fileId)?.href;
        return {
          key: file.fileId,
          node: (
            <FileItem
              variant="chip"
              name={file.name}
              size={file.size}
              contentType={file.contentType}
              {...(href === undefined ? {} : { href })}
            />
          ),
        };
      })}
    />
  );
}
