// The artifact card for a stories file: its name and group from the title,
// and the stories flagged `parameters.crm.preview`, found without running it.
import { describe, expect, it } from 'vitest';
import { readStoryCard } from './stories.ts';

const STORIES = `
import type { Meta, StoryObj } from '@storybook/react-vite';
const meta = { title: 'Atoms/Button', component: Button } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Variants: Story = { parameters: { crm: { preview: true } }, render: () => null };
export const Keyboard: Story = { parameters: { crm: { screenshot: false } } };
export const Pending: Story = { args: { isPending: true }, parameters: { crm: { preview: true } } };
const NotExported = { parameters: { crm: { preview: true } } };
`;

describe('readStoryCard', () => {
  it('names the card after the title and lists the flagged stories in file order', () => {
    expect(readStoryCard('Button.stories.tsx', STORIES)).toEqual({
      name: 'Button',
      group: 'Atoms',
      title: 'Atoms/Button',
      previews: ['Variants', 'Pending'],
    });
  });

  it('reads a meta object exported directly', () => {
    const code =
      "export default { title: 'Molecules/Menu' };\nexport const Open = { parameters: { crm: { preview: true } } };\n";
    expect(readStoryCard('Menu.stories.tsx', code)?.name).toBe('Menu');
  });

  it('makes no card when nothing is flagged, or the file has no title', () => {
    expect(readStoryCard('A.stories.tsx', "export default { title: 'Provider/Toasts' };\nexport const A = {};\n")).toBe(
      undefined,
    );
    expect(readStoryCard('B.stories.tsx', 'export const B = { parameters: { crm: { preview: true } } };\n')).toBe(
      undefined,
    );
  });
});
