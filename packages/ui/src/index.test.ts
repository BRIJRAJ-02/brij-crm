// The component library's public surface: what screens import from '@crm/ui'.
// The theme logic stays on its own subpath, '@crm/ui/theme', so the boot script
// test and other tools can load it without React. Workbench pieces (Stage,
// StoryRoot) and the provider's hooks stay inside the library.
import { describe, expect, it } from 'vitest';
import * as ui from './index.ts';

describe('@crm/ui', () => {
  it('exports the data hues', () => {
    expect(ui.HUES).toEqual(['gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple']);
  });

  it('exports exactly the components, the provider, the toast factory and the shared helpers', () => {
    expect(Object.keys(ui).sort()).toEqual([
      'Avatar',
      'AvatarStack',
      'Badge',
      'Button',
      'Checkbox',
      'Code',
      'CopyButton',
      'Currency',
      'FileIcon',
      'HUES',
      'Icon',
      'Kbd',
      'Link',
      'LinkChip',
      'Mention',
      'Meter',
      'Path',
      'Popover',
      'ProgressBar',
      'Radio',
      'RadioGroup',
      'Rating',
      'RecordChip',
      'RelativeTime',
      'RemoteCursor',
      'Separator',
      'Skeleton',
      'Spinner',
      'SplitButton',
      'StatusDot',
      'Switch',
      'Tag',
      'TagList',
      'ToggleButton',
      'Tooltip',
      'TruncatedText',
      'UiProvider',
      'Variable',
      'VisuallyHidden',
      'arraySource',
      'createToasts',
      'fileIconName',
      'safeHref',
      'safeImageSrc',
      'useDelayedLoading',
    ]);
  });
});
