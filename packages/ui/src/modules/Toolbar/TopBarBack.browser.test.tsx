// TopBar's `back` in its real place, a settings page in AppShell, in Chromium (5 November 2026): the chevron shows
// only while the shell hides the sidebar (under 480px), never because the bar beside a visible sidebar is narrow.
// A shell of 480 to about 560px, the settings sidebar or its rail beside the page, drew it next to the sidebar's own
// way back.
// The library's layers first, as every page loads them: a module's CSS loaded ahead would declare its layer first.
import '../../styles/index.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { AppShell } from '../AppShell/AppShell.tsx';
import { NavItem, Sidebar } from '../Sidebar/Sidebar.tsx';
import { TopBar } from './Toolbar.tsx';

let host: HTMLElement;
let view: Root | undefined;

beforeEach(() => {
  host = document.createElement('div');
  host.style.blockSize = '600px';
  document.body.append(host);
  view = createRoot(host);
});

afterEach(() => {
  act(() => {
    view?.unmount();
  });
  host.remove();
});

/** A settings page in a shell `width` pixels wide, as the app draws it: the sidebar hidden on a phone. */
function draw(width: number) {
  host.style.inlineSize = `${String(width)}px`;
  act(() => {
    view?.render(
      <UiProvider locale="en-GB" timeZone="Europe/London" toasts={createToasts()} navigate={() => undefined}>
        <AppShell
          phoneSidebar="hidden"
          sidebar={
            <Sidebar heading="Settings" back={{ label: 'Leave settings', href: '/' }} label="Settings">
              <NavItem icon="user-round" href="/settings/profile" isCurrent>
                Profile
              </NavItem>
            </Sidebar>
          }
          topBar={<TopBar title="Profile" back={{ label: 'All settings', href: '/settings' }} />}
        >
          {null}
        </AppShell>
      </UiProvider>,
    );
  });
  const back = host.querySelector<HTMLElement>('a[aria-label="All settings"]');
  if (back === null) throw new Error('expected the back link in the DOM');
  return back;
}

/** Whether an element takes up room on the page (display none leaves it none). */
const isShown = (element: HTMLElement) => element.getClientRects().length > 0;

describe('TopBar back', () => {
  it('shows on a phone, where the shell hides the sidebar, at the bar’s start', () => {
    const back = draw(400);
    expect(isShown(back)).toBe(true);
    expect(back.getBoundingClientRect().left).toBeLessThan(host.getBoundingClientRect().left + 16);
  });

  it('stays hidden beside the sidebar, however narrow the bar (a 480 to 560px shell)', () => {
    for (const width of [480, 520, 560, 768]) {
      expect(isShown(draw(width)), `${String(width)}px`).toBe(false);
    }
  });
});
