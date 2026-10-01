import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FileIcon, fileIconName } from './FileIcon.tsx';

const meta = {
  title: 'Atoms/FileIcon',
  component: FileIcon,
  args: { contentType: 'application/pdf' },
} satisfies Meta<typeof FileIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

const TYPES = [
  'application/pdf',
  'image/png',
  'video/mp4',
  'audio/mpeg',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/json',
  'application/octet-stream',
];

/** One icon per kind of file. */
export const Kinds: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      {TYPES.map((type) => (
        <FileIcon key={type} contentType={type} label={type} />
      ))}
    </Stage>
  ),
  play: async () => {
    await expect(fileIconName('image/jpeg')).toBe('image');
    await expect(fileIconName('text/csv')).toBe('file-spreadsheet');
    await expect(fileIconName('application/x-unknown')).toBe('file');
  },
};
