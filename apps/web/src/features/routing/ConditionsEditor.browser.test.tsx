// The rule editor's "is any of" (spec 0043, AC-1602), in Chromium: on a choice the comparison offers it, the value
// becomes a Select of several holding what "is" had, each pick lands in the list's order, and going back to "is"
// keeps the first value.
import type { ShowWhen } from '@crm/data/forms';
import { createToasts, UiProvider } from '@crm/ui';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ConditionsEditor } from './ConditionsEditor.tsx';
import type { Fact } from './facts.ts';

const company: Fact = { key: 'company', label: 'Company', kind: 'text' };

const budget: Fact = {
  key: 'budget',
  label: 'Budget',
  kind: 'choice',
  options: ['Small', 'Large', 'Huge'].map((choice) => ({ id: choice, label: choice })),
};

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

/** The editor holding its conditions as a form's draft would, each change also told to `onChange`. */
function Editor({
  start,
  onChange,
  isReadOnly = false,
}: {
  readonly start: ShowWhen;
  readonly onChange: (next: ShowWhen) => void;
  readonly isReadOnly?: boolean;
}) {
  const [value, setValue] = useState(start);
  return (
    <ConditionsEditor
      value={value}
      facts={[budget, company]}
      isReadOnly={isReadOnly}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

async function draw(start: ShowWhen, isReadOnly = false) {
  const onChange = vi.fn<(next: ShowWhen) => void>();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider locale="en-US" timeZone="UTC" toasts={createToasts()} navigate={() => undefined}>
        <Editor start={start} onChange={onChange} isReadOnly={isReadOnly} />
      </UiProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  // A Select's trigger, by the name its hidden label gives it.
  const trigger = (name: string) => page.getByRole('button', { name: new RegExp(name) }).element();
  return { host, onChange, trigger };
}

/** Picks the option named `name` in the list now open. */
async function pick(name: string) {
  await vi.waitFor(() => {
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  });
  const option = [...document.querySelectorAll('[role="option"]')].find((each) => each.textContent.trim() === name);
  if (option === undefined) throw new Error(`No option ${name}.`);
  await userEvent.click(option);
}

describe('ConditionsEditor', () => {
  it('turns "is" into "is any of" with the same value, takes several, and goes back to one', async () => {
    const { onChange, trigger } = await draw({ join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] });
    await userEvent.click(trigger('Comparison'));
    await pick('is any of');
    expect(onChange).toHaveBeenLastCalledWith({
      join: 'all',
      rules: [{ key: 'budget', op: 'is_any_of', value: ['Large'] }],
    });
    // The value is now a Select of several, naming what it holds.
    await vi.waitFor(() => {
      expect(trigger('Value').textContent).toContain('Large');
    });
    await userEvent.click(trigger('Value'));
    await pick('Huge');
    expect(onChange).toHaveBeenLastCalledWith({
      join: 'all',
      rules: [{ key: 'budget', op: 'is_any_of', value: ['Large', 'Huge'] }],
    });
    await vi.waitFor(() => {
      expect(trigger('Value').textContent).toContain('Large, Huge');
    });
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeNull();
    });
    await userEvent.click(trigger('Comparison'));
    await pick('is');
    expect(onChange).toHaveBeenLastCalledWith({ join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] });
  });

  it('says what a typed value wants, since its box has no label over it (Q65)', async () => {
    await draw({ join: 'all', rules: [{ key: 'company', op: 'is', value: '' }] });
    const box = page.getByRole('textbox', { name: 'Value' }).element();
    expect(box.getAttribute('placeholder')).toBe('Set value…');
  });

  it('shows no placeholder read only, so an empty value isn’t read as an ask to type', async () => {
    await draw({ join: 'all', rules: [{ key: 'company', op: 'is', value: '' }] }, true);
    const box = page.getByRole('textbox', { name: 'Value' }).element();
    expect(box.getAttribute('placeholder')).toBeNull();
  });
});
