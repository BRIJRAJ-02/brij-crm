// The provider hands React Aria's router the app's navigate and useHref, and
// React Aria passes full hrefs (path, search and hash) straight through, so
// library links route with TanStack Router. It also gives components the
// language and time zone, never the browser's.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link } from 'react-aria-components';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createFixedClock } from './clock.ts';
import { createToasts } from './toasts.tsx';
import { UiProvider, useFormatSettings, useNow } from './UiProvider.tsx';

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function Settings() {
  const { locale, timeZone } = useFormatSettings();
  return <output>{`${locale} ${timeZone} ${String(useNow())}`}</output>;
}

describe('UiProvider', () => {
  it('routes a library link through navigate, with its search and hash', async () => {
    const navigate = vi.fn();
    act(() => {
      root.render(
        <UiProvider
          locale="en-GB"
          timeZone="Europe/London"
          navigate={navigate}
          useHref={(href) => `/app${href}`}
          toasts={createToasts()}
          clock={createFixedClock(0)}
        >
          <Link href="/records?q=a#x">Records</Link>
        </UiProvider>,
      );
    });
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/app/records?q=a#x');
    if (link === null) throw new Error('no link');
    await userEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/records?q=a#x', undefined);
  });

  it('gives components the language, the time zone and the shared clock', () => {
    act(() => {
      root.render(
        <UiProvider
          locale="de-DE"
          timeZone="Europe/Berlin"
          navigate={() => undefined}
          toasts={createToasts()}
          clock={createFixedClock(42)}
        >
          <Settings />
        </UiProvider>,
      );
    });
    expect(host.textContent).toBe('de-DE Europe/Berlin 42');
  });

  it('fails loudly when a component is used outside it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => {
      act(() => {
        root.render(<Settings />);
      });
    }).toThrow(/Wrap the app in <UiProvider>/);
  });
});
