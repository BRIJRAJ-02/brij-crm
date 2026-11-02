import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { collapseAway, useDropIn, useRowWash, useValueFade } from './motion.ts';

const meta = {
  title: 'Patterns/Motion',
  parameters: { crm: { screenshot: false } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A row washed once when it changes, whoever changed it. */
export const RowWash: Story = {
  render: function RowWash() {
    const [stage, setStage] = useState('Bea Lund');
    const row = useRowWash(stage);
    return (
      <Stage>
        <table>
          <tbody>
            <tr ref={row} data-testid="row">
              <td>{stage}</td>
            </tr>
          </tbody>
        </table>
        <Button
          onPress={() => {
            setStage('Bea Lund (edited)');
          }}
        >
          Change it
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Change it' }));
    await waitFor(async () => {
      await expect(canvas.getByTestId('row')).toHaveTextContent('edited');
    });
  },
};

/** A new line dropping in at the top of a feed. */
export const DropIn: Story = {
  render: function DropIn() {
    const [lines, setLines] = useState(['Deal moved to Won', 'Note added']);
    const list = useDropIn(lines[0]);
    return (
      <Stage>
        <ul ref={list}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Button
          onPress={() => {
            setLines((was) => ['Jessica replied', ...was]);
          }}
        >
          Add a line
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add a line' }));
    await waitFor(async () => {
      await expect(canvas.getByText('Jessica replied')).toBeInTheDocument();
    });
  },
};

/** A row closing up as it leaves, so the rows below glide into its place. */
export const CollapseAway: Story = {
  render: function CollapseAway() {
    const [lines, setLines] = useState(['Call Ada', 'Send the quote']);
    const rows = useRef(new Map<string, HTMLLIElement | null>());
    return (
      <Stage>
        <ul>
          {lines.map((line) => (
            <li
              key={line}
              ref={(node) => {
                rows.current.set(line, node);
              }}
            >
              {line}{' '}
              <Button
                onPress={() => {
                  collapseAway(rows.current.get(line), () => {
                    setLines((was) => was.filter((other) => other !== line));
                  });
                }}
              >
                {`Done: ${line}`}
              </Button>
            </li>
          ))}
        </ul>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Done: Call Ada' }));
    await waitFor(async () => {
      await expect(canvas.queryByText('Call Ada')).not.toBeInTheDocument();
    });
  },
};

/** A value fading in where the old one stood, rather than swapping. */
export const ValueFade: Story = {
  render: function ValueFade() {
    const [stage, setStage] = useState('Qualified');
    const value = useValueFade(stage);
    return (
      <Stage>
        <span ref={value} data-testid="value">
          {stage}
        </span>
        <Button
          onPress={() => {
            setStage('Won');
          }}
        >
          Move it on
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Move it on' }));
    await waitFor(async () => {
      await expect(canvas.getByTestId('value')).toHaveTextContent('Won');
    });
  },
};
