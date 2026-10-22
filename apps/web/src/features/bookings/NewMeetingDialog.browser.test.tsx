// New meeting (spec 0027, AC-709 to AC-711), in Chromium: the day moves in place rather than asking the member to
// close the dialog and draw again (the design pass of 22 October 2026), the note that nobody is invited yet comes
// first, and the guest's zone sits with who it is with.
import type { BookingPageView } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { NewMeetingDialog } from './NewMeetingDialog.tsx';
import type { DrawnSpan } from './span.ts';

const intro = { id: '0190f0f0-0000-7000-8000-000000000002', title: 'Intro call' } as BookingPageView;

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

/** The dialog open on Friday 23 October, 9:30 to 10:15, with no calendar connected. */
async function open() {
  const onSpanChange = vi.fn<(span: DrawnSpan) => void>();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider locale="en-GB" timeZone="UTC" toasts={createToasts()} navigate={() => undefined}>
        <NewMeetingDialog
          span={{ dayKey: '2026-10-23', startMinute: 9 * 60 + 30, endMinute: 10 * 60 + 15 }}
          onSpanChange={onSpanChange}
          locale="en-GB"
          hasCalendar={false}
          pages={[intro]}
          newKey={() => 'key'}
          onBook={() => Promise.resolve()}
          onClose={() => undefined}
        />
      </UiProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { onSpanChange };
}

/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('New meeting', () => {
  it('moves the day in place, keeping the times', async () => {
    const { onSpanChange } = await open();
    const day = page.getByRole('group', { name: 'Day' });
    await expect.element(day).toBeVisible();
    // The day segment (first in en-GB), then Up: the next day, the same times.
    const [daySegment] = day.getByRole('spinbutton').elements();
    if (daySegment === undefined) throw new Error('no day segment');
    await userEvent.click(daySegment);
    await userEvent.keyboard('{ArrowUp}');
    expect(onSpanChange).toHaveBeenLastCalledWith({ dayKey: '2026-10-24', startMinute: 570, endMinute: 615 });
  });

  it('says nobody is invited yet before the fields, and keeps their zone with who it is with', async () => {
    await open();
    const note = page.getByText(/No calendar is connected/).element();
    const name = page.getByRole('textbox', { name: 'With' }).element();
    const email = page.getByRole('textbox', { name: 'Email' }).element();
    const zone = page.getByRole('button', { name: /Their time zone/ }).element();
    const day = page.getByRole('group', { name: 'Day' }).element();
    expect(before(note, name)).toBe(true);
    expect(before(email, zone)).toBe(true);
    expect(before(zone, day)).toBe(true);
    // The name is still where typing starts.
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveFocus();
  });
});
