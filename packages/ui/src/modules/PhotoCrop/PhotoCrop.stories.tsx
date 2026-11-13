import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { DISH, LANDSCAPE, PORTRAIT } from '../../workbench/photo-samples.ts';
import { FileDrop } from '../../molecules/FileDrop/FileDrop.tsx';
import { PhotoCrop } from './PhotoCrop.tsx';
import { usePhotoCrop } from './usePhotoCrop.tsx';

const meta = {
  title: 'Modules/PhotoCrop',
  component: PhotoCrop,
  args: { source: PORTRAIT, shape: 'circle', onCancel: fn(), onDone: fn() },
  render: (args) => (
    <Stage>
      <PhotoCrop {...args} />
    </Stage>
  ),
} satisfies Meta<typeof PhotoCrop>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Waits for the dialog and its photo, then settles the dialog's entrance so what follows reads it. */
async function opened() {
  const body = within(document.body);
  const dialog = await body.findByRole('dialog');
  await waitFor(async () => {
    await expect(within(dialog).getByRole('button', { name: 'Use photo' })).toBeEnabled();
  });
  await settleAnimations();
  return within(dialog);
}

/** A face, in a circle: the profile photo and first run's avatar. The preview at the zoom's end is round too. */
export const Circle: Story = {
  parameters: { crm: { preview: true } },
  play: async () => {
    const dialog = await opened();
    await expect(dialog.getByRole('application', { name: 'Photo position' })).toBeInTheDocument();
    await expect(dialog.getByRole('slider', { name: 'Zoom' })).toHaveAttribute('aria-valuetext', '100%');
    await expect(dialog.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
  },
};

/** A logo, square. */
export const Square: Story = {
  args: { source: DISH, shape: 'square' },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    await opened();
  },
};

/** A page's cover, 3:1, on a wider stage so the band has room. */
export const Cover: Story = {
  args: { source: LANDSCAPE, shape: 'cover' },
  play: async () => {
    await opened();
  },
};

/** A dish at 4:3. */
export const Dish: Story = {
  args: { source: DISH, shape: 'dish' },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    await opened();
  },
};

/** The picture a pasted link shows, 1.91:1. */
export const Card: Story = {
  args: { source: LANDSCAPE, shape: 'card' },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    await opened();
  },
};

/** A gallery's picture: free, the person picks the frame, its own shape first. */
export const Free: Story = {
  args: { source: LANDSCAPE, shape: 'free' },
  play: async () => {
    const dialog = await opened();
    await userEvent.click(dialog.getByRole('radio', { name: 'Square' }));
    await expect(dialog.getByRole('radio', { name: 'Square' })).toBeChecked();
  },
};

/**
 * By keyboard alone: the arrows move the photo (said aloud), plus zooms, and Use photo answers the crop in the
 * photo's own pixels. The portrait is 900 by 1200, so its circle starts as the 900 square in its middle.
 */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args }) => {
    const dialog = await opened();
    const stage = dialog.getByRole('application', { name: 'Photo position' });
    stage.focus();
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await waitFor(async () => {
      await expect(dialog.getByRole('status')).toHaveTextContent('Photo centre 50% across, 43% down.');
    });
    await userEvent.keyboard('+');
    await expect(dialog.getByRole('slider', { name: 'Zoom' })).toHaveAttribute('aria-valuetext', '110%');
    await userEvent.click(dialog.getByRole('button', { name: 'Use photo' }));
    await expect(args.onDone).toHaveBeenCalledTimes(1);
    const [crop] = args.onDone.mock.calls[0] as [{ width: number; height: number }];
    await expect(Math.round(crop.width)).toBe(Math.round(900 / 1.1));
    await expect(crop.width).toBeCloseTo(crop.height);
  },
};

/** Moving (spec 0072): while a pointer holds the photo the stage says so (the thirds fade in), and stops on release. */
export const Moving: Story = {
  parameters: { crm: { screenshot: false } },
  // The play's own userEvent keeps the held button between its two calls, so the release reaches the stage.
  play: async ({ userEvent }) => {
    const dialog = await opened();
    const stage = dialog.getByRole('application', { name: 'Photo position' });
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: stage }]);
    await waitFor(() => expect(stage).toHaveAttribute('data-moving'));
    await userEvent.pointer([{ keys: '[/MouseLeft]', target: stage }]);
    await waitFor(() => expect(stage).not.toHaveAttribute('data-moving'));
  },
};

/** The way out by keyboard: Cancel shows ESC, and Esc from the photo leaves with nothing used. */
export const Escape: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args }) => {
    const dialog = await opened();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
    dialog.getByRole('application', { name: 'Photo position' }).focus();
    await userEvent.keyboard('{Escape}');
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await expect(args.onDone).not.toHaveBeenCalled();
  },
};

/** A file the browser can't read: said in the stage, and Use photo stays off. */
export const Unreadable: Story = {
  args: { source: 'data:image/png;base64,AAAA', shape: 'square' },
  play: async () => {
    const body = within(document.body);
    const dialog = within(await body.findByRole('dialog'));
    await expect(await dialog.findByRole('alert')).toHaveTextContent('This picture can’t be opened here.');
    await expect(dialog.getByRole('button', { name: 'Use photo' })).toBeDisabled();
  },
};

/** The way a screen uses it: a picked file goes through the cropper before it is sent. */
function PickThenCrop() {
  const { crop, cropper } = usePhotoCrop();
  return (
    <>
      <FileDrop
        label="Upload photo"
        variant="button"
        acceptedTypes={['image/png', 'image/jpeg']}
        onFiles={(files) => {
          const [file] = files;
          if (file !== undefined) void crop(file, 'circle');
        }}
      />
      {cropper}
    </>
  );
}

/** With `usePhotoCrop`: the picker beside the cropper it opens. Nothing is open until a file is picked. */
export const WithPicker: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <PickThenCrop />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Upload photo' })).toBeEnabled();
  },
};
