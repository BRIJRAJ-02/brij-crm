// Notifications in Chromium (spec 0038, AC-1179; SA27, SA28, SA31, SA32): an InfoTip on each kind and on the digest,
// the shorter section line, "Notifications saved" with Undo once a switch lands, and a refused switch put back with
// no saved toast.
import type { DataError, DataLayer, InboxSettings, InboxSettingsState, NotificationSettingsChange } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { NotificationSettingsScreen } from './NotificationSettingsScreen.tsx';

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/**
 * A settings store as the data layer keeps it: a change shows at once; a refusal puts it back and answers the
 * error (the real store also raises its own toast, left out here).
 */
function store(refuse = false) {
  let state: InboxSettingsState = {
    status: 'ready',
    settings: {
      emailMentions: true,
      emailReplies: false,
      emailAssignments: true,
      digest: false,
      timeZone: 'Europe/London',
      version: 1,
    },
  };
  const listeners = new Set<() => void>();
  const announce = () => {
    for (const listener of listeners) listener();
  };
  const sent: NotificationSettingsChange[] = [];
  const settings: InboxSettings = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
  };
  const setSettings = async (_workspace: string, change: NotificationSettingsChange) => {
    sent.push(change);
    const before = state;
    if (before.settings === undefined) return undefined;
    const { timeZone: _zone, ...switches } = change;
    state = { status: 'ready', settings: { ...before.settings, ...switches } };
    announce();
    await Promise.resolve();
    if (!refuse) return undefined;
    state = before;
    announce();
    return { code: 'INTERNAL', message: 'Something went wrong' } as DataError;
  };
  const data = { inbox: { setSettings } } as unknown as Partial<DataLayer>;
  return { settings, data, sent };
}

async function render(refuse = false) {
  const { settings, data, sent } = store(refuse);
  shown = await renderInApp(() => <NotificationSettingsScreen slug="acme" settings={settings} />, {
    data,
    pattern: '/w/$slug/settings/account/notifications',
    at: '/w/acme/settings/account/notifications',
  });
  return sent;
}

/** Presses a switch from the keyboard, as its visible track is drawn over the input. */
async function press(control: ReturnType<typeof page.getByRole>) {
  (control.element() as HTMLElement).focus();
  await userEvent.keyboard('[Space]');
}

describe('Notifications', () => {
  it('says when each email comes, in an InfoTip on its row', async () => {
    await render();
    await expect
      .element(page.getByText('Everything shows in your Inbox. Pick what also comes by email.'))
      .toBeVisible();
    for (const [name, tip] of [
      ['Mentions', 'When someone @mentions you in a comment or a note.'],
      ['Replies', 'When someone replies in a comment thread you wrote in.'],
      ['Task assignments', 'When someone gives you a task.'],
      [
        'Daily digest',
        'One email at 8 in the morning with everything still unread, even kinds switched off above. It uses the time zone your browser had when you turned it on.',
      ],
    ] as const) {
      await page.getByRole('button', { name: `About ${name}` }).click();
      await expect.element(page.getByText(tip)).toBeVisible();
      await userEvent.keyboard('{Escape}');
      await expect.element(page.getByText(tip)).not.toBeInTheDocument();
    }
  });

  it('says Notifications saved once a switch lands, and Undo puts it back', async () => {
    const sent = await render();
    const replies = page.getByRole('switch', { name: 'Replies' });
    await press(replies);
    await expect.element(replies).toBeChecked();
    await expect.element(page.getByText('Notifications saved')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.element(replies).not.toBeChecked();
    await expect.element(page.getByText('Change undone')).toBeVisible();
    expect(sent).toEqual([{ emailReplies: true }, { emailReplies: false }]);
  });

  it('keeps one saved toast when several switches change', async () => {
    await render();
    await press(page.getByRole('switch', { name: 'Replies' }));
    await expect.element(page.getByText('Notifications saved')).toBeVisible();
    await press(page.getByRole('switch', { name: 'Mentions' }));
    await vi.waitFor(() => {
      expect(page.getByText('Notifications saved').elements()).toHaveLength(1);
    });
    await expect.element(page.getByRole('switch', { name: 'Mentions' })).not.toBeChecked();
  });

  it('puts a refused switch back, with no saved toast', async () => {
    const sent = await render(true);
    const replies = page.getByRole('switch', { name: 'Replies' });
    await press(replies);
    await vi.waitFor(() => {
      expect(sent).toEqual([{ emailReplies: true }]);
    });
    await expect.element(replies).not.toBeChecked();
    await expect.element(page.getByText('Notifications saved')).not.toBeInTheDocument();
  });
});
