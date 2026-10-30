// A disabled option (#68) in a real browser: the arrows land on it, so a
// keyboard or screen reader user reaches it and hears why it can't be chosen,
// but Enter, Space and a click never choose it, in a single and a multiple
// choice and with the search on. React Aria's own disabled option is skipped by
// the keyboard; this pins the item level `disabledBehavior` Select relies on.
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { Select, type SelectItem, type SelectProps } from './Select.tsx';

const mounted: (() => void)[] = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

const frame = () => new Promise((resolve) => setTimeout(resolve, 30));

const REASON = 'Up to 20 people';

const ITEMS: readonly SelectItem[] = [
  { id: 'small', label: 'Small team' },
  { id: 'large', label: 'Large team', isDisabled: true, description: REASON },
  { id: 'solo', label: 'Just me' },
];

async function render(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <UiProvider locale="en-US" timeZone="Europe/London" navigate={() => undefined} toasts={createToasts()}>
      {node}
    </UiProvider>,
  );
  mounted.push(() => {
    root.unmount();
    host.remove();
  });
  await frame();
}

function trigger(): HTMLElement {
  const found = document.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
  if (found === null) throw new Error('no Select trigger');
  return found;
}

const listbox = () => document.querySelector('[role="listbox"]');

function optionNamed(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
    option.textContent.includes(label),
  );
  if (found === undefined) throw new Error(`no option ${label}`);
  return found;
}

/** The option the keyboard is on: the focused one, or the search's active descendant. */
function current(): HTMLElement | null {
  const active = document.activeElement;
  const descendant = active?.getAttribute('aria-activedescendant');
  if (descendant !== null && descendant !== undefined && descendant !== '') return document.getElementById(descendant);
  return active instanceof HTMLElement && active.getAttribute('role') === 'option' ? active : null;
}

/** Opens the list from the keyboard and arrows down onto the disabled option. */
async function arrowOntoDisabled() {
  trigger().focus();
  await userEvent.keyboard('{ArrowDown}');
  await expect.poll(listbox).not.toBeNull();
  await expect.poll(() => current()?.textContent).toContain('Small team');
  await userEvent.keyboard('{ArrowDown}');
  await expect.poll(() => current()?.textContent).toContain('Large team');
}

/** The disabled option as the keyboard reaches it: marked disabled, its reason inside it, and it looks disabled. */
function expectAnnouncedDisabled() {
  const on = current();
  expect(on).not.toBeNull();
  expect(on?.getAttribute('aria-disabled')).toBe('true');
  expect(on?.textContent).toContain(REASON);
  expect(on?.hasAttribute('data-disabled')).toBe(true);
}

function single(props: Partial<SelectProps> = {}) {
  const onChange = vi.fn();
  return { onChange, node: <Select label="Team size" items={ITEMS} value={null} onChange={onChange} {...props} /> };
}

function multiple(props: Partial<SelectProps> = {}) {
  const onValuesChange = vi.fn();
  return {
    onValuesChange,
    node: (
      <Select
        label="Team sizes"
        items={ITEMS}
        selectionMode="multiple"
        values={[]}
        onValuesChange={onValuesChange}
        {...props}
      />
    ),
  };
}

describe('a disabled option in a single choice', () => {
  it('is reached by the arrows, announced as disabled with its reason, and Enter and Space leave it unchosen', async () => {
    const { onChange, node } = single();
    await render(node);
    await arrowOntoDisabled();
    expectAnnouncedDisabled();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await frame();
    expect(onChange).not.toHaveBeenCalled();
    // The list stays open on it, so the next arrow moves on and Enter chooses that one.
    expect(listbox()).not.toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => current()?.textContent).toContain('Just me');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('solo');
  });

  it('is reached by typeahead in the open list, and still refused', async () => {
    const { onChange, node } = single();
    await render(node);
    trigger().focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(listbox).not.toBeNull();
    await userEvent.keyboard('La');
    await expect.poll(() => current()?.textContent).toContain('Large team');
    expectAnnouncedDisabled();
    await userEvent.keyboard('{Enter}');
    await frame();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is not chosen from the closed trigger by a typed letter, controlled or not', async () => {
    for (const props of [{ value: 'small' }, { value: undefined, defaultValue: 'small' }]) {
      const { onChange, node } = single(props);
      await render(node);
      trigger().focus();
      // An arrow first (nothing above Small team), so the letter's own key is the one remembered.
      await userEvent.keyboard('{ArrowLeft}');
      await userEvent.keyboard('L');
      await frame();
      expect(onChange).not.toHaveBeenCalled();
      expect(listbox()).toBeNull();
      expect(trigger().textContent).toContain('Small team');
      for (const unmount of mounted.splice(0)) unmount();
    }
  });

  it('is stepped past by the closed trigger’s arrows, both ways', async () => {
    const { onChange, node } = single({ value: undefined, defaultValue: 'small' });
    await render(node);
    trigger().focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => trigger().textContent).toContain('Just me');
    expect(onChange).toHaveBeenLastCalledWith('solo');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.poll(() => trigger().textContent).toContain('Small team');
    expect(onChange).toHaveBeenLastCalledWith('small');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(listbox()).toBeNull();
  });

  it('is stepped past by the closed trigger’s arrow when controlled', async () => {
    const { onChange, node } = single({ value: 'small' });
    await render(node);
    trigger().focus();
    await userEvent.keyboard('{ArrowRight}');
    await frame();
    expect(onChange).toHaveBeenCalledExactlyOnceWith('solo');
  });

  it('is not chosen by a click', async () => {
    const { onChange, node } = single({ defaultOpen: true });
    await render(node);
    await expect.poll(listbox).not.toBeNull();
    // Forced: Playwright waits for an aria-disabled element to be enabled before it clicks.
    await userEvent.click(optionNamed('Large team'), { force: true });
    await frame();
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).not.toBeNull();
  });

  it('is reached and refused with the search on', async () => {
    const { onChange, node } = single({ isSearchable: true });
    await render(node);
    await arrowOntoDisabled();
    expectAnnouncedDisabled();
    await userEvent.keyboard('{Enter}');
    await frame();
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).not.toBeNull();
  });

  it('keeps what was chosen when Enter lands on it with the search on, controlled or not', async () => {
    for (const props of [{ value: 'small' }, { value: undefined, defaultValue: 'small' }]) {
      const { onChange, node } = single({ ...props, isSearchable: true });
      await render(node);
      await arrowOntoDisabled();
      expectAnnouncedDisabled();
      await userEvent.keyboard('{Enter}');
      await frame();
      expect(onChange).not.toHaveBeenCalled();
      expect(listbox()).not.toBeNull();
      expect(trigger().textContent).toContain('Small team');
      for (const unmount of mounted.splice(0)) unmount();
    }
  });
});

const item = (id: string, extra: Partial<SelectItem> = {}): SelectItem => ({ id, label: `Option ${id}`, ...extra });

/** Presses `key` on the closed trigger of `props`, and returns what onChange heard and what the trigger reads. */
async function arrowOnClosed(props: Partial<SelectProps>, key: '{ArrowRight}' | '{ArrowLeft}') {
  const { onChange, node } = single(props);
  await render(node);
  trigger().focus();
  await userEvent.keyboard(key);
  await frame();
  expect(listbox()).toBeNull();
  return { onChange, reads: trigger().textContent };
}

describe('a closed Select’s arrows', () => {
  it('step across a section boundary in the list’s own order', async () => {
    // Listed as One: a, b; Two: c, d. In `items` order, d would come after b.
    const items = [
      item('a', { group: 'One' }),
      item('c', { group: 'Two' }),
      item('b', { group: 'One', isDisabled: true }),
      item('d', { group: 'Two' }),
    ];
    const { onChange } = await arrowOnClosed({ items, value: 'a' }, '{ArrowRight}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('step past two disabled options in a row, and past a disabled one beside an archived one', async () => {
    const twice = await arrowOnClosed(
      { items: [item('a'), item('b', { isDisabled: true }), item('c', { isDisabled: true }), item('d')], value: 'a' },
      '{ArrowRight}',
    );
    expect(twice.onChange).toHaveBeenCalledExactlyOnceWith('d');
    for (const unmount of mounted.splice(0)) unmount();
    const archived = await arrowOnClosed(
      { items: [item('a'), item('b', { isDisabled: true }), item('c', { isArchived: true }), item('d')], value: 'a' },
      '{ArrowRight}',
    );
    expect(archived.onChange).toHaveBeenCalledExactlyOnceWith('d');
  });

  it('keep the value when only a disabled option lies ahead, at the end or before Clear', async () => {
    const items = [item('a'), item('b', { isDisabled: true })];
    for (const props of [
      { items, value: 'a' },
      { items, value: 'a', isClearable: true },
    ]) {
      const { onChange, reads } = await arrowOnClosed(props, '{ArrowRight}');
      expect(onChange).not.toHaveBeenCalled();
      expect(reads).toContain('Option a');
      for (const unmount of mounted.splice(0)) unmount();
    }
  });

  it('with nothing chosen and the first option disabled, both step forward from it', async () => {
    const items = [item('a', { isDisabled: true }), item('b'), item('c')];
    for (const key of ['{ArrowLeft}', '{ArrowRight}'] as const) {
      const { onChange } = await arrowOnClosed({ items, value: null }, key);
      expect(onChange).toHaveBeenCalledExactlyOnceWith('b');
      for (const unmount of mounted.splice(0)) unmount();
    }
  });

  it('never clear the value or create an option', async () => {
    const items = [item('a'), item('b')];
    const clear = await arrowOnClosed({ items, value: 'b', isClearable: true }, '{ArrowRight}');
    expect(clear.onChange).not.toHaveBeenCalled();
    expect(clear.reads).toContain('Option b');
    for (const unmount of mounted.splice(0)) unmount();
    const onCreate = vi.fn();
    const create = await arrowOnClosed({ items, value: 'b', onCreate, defaultSearch: 'Zed' }, '{ArrowRight}');
    expect(create.onChange).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(create.reads).toContain('Option b');
  });
});

describe('a disabled option in a multiple choice', () => {
  it('is reached by the arrows, announced as disabled with its reason, and Enter and Space leave it unchecked', async () => {
    const { onValuesChange, node } = multiple();
    await render(node);
    await arrowOntoDisabled();
    expectAnnouncedDisabled();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await frame();
    expect(onValuesChange).not.toHaveBeenCalled();
    expect(optionNamed('Large team').getAttribute('aria-selected')).toBe('false');
  });

  it('is not chosen from the closed trigger by a typed letter', async () => {
    const { onValuesChange, node } = multiple({ values: ['small'] });
    await render(node);
    trigger().focus();
    await userEvent.keyboard('L');
    await frame();
    expect(onValuesChange).not.toHaveBeenCalled();
  });

  it('is not checked by a click', async () => {
    const { onValuesChange, node } = multiple({ defaultOpen: true });
    await render(node);
    await expect.poll(listbox).not.toBeNull();
    // Forced: Playwright waits for an aria-disabled element to be enabled before it clicks.
    await userEvent.click(optionNamed('Large team'), { force: true });
    await frame();
    expect(onValuesChange).not.toHaveBeenCalled();
  });

  it('is reached and refused with the search on', async () => {
    const { onValuesChange, node } = multiple({ isSearchable: true });
    await render(node);
    await arrowOntoDisabled();
    expectAnnouncedDisabled();
    await userEvent.keyboard('{Enter}');
    await frame();
    expect(onValuesChange).not.toHaveBeenCalled();
  });
});
