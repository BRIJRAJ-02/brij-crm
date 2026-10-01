// AC-13: a skeleton appears only after 200 ms of loading, then stays at least
// 300 ms, so quick loads never flash one.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedLoading } from './useDelayedLoading.ts';

function Probe({ isLoading }: { isLoading: boolean }) {
  return <output>{useDelayedLoading(isLoading) ? 'skeleton' : 'content'}</output>;
}

let root: Root;
let host: HTMLElement;

function render(isLoading: boolean) {
  act(() => {
    root.render(<Probe isLoading={isLoading} />);
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useDelayedLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  it('shows nothing for a load shorter than 200 ms', () => {
    render(true);
    advance(199);
    expect(host.textContent).toBe('content');
    render(false);
    advance(1_000);
    expect(host.textContent).toBe('content');
  });

  it('shows the skeleton after 200 ms', () => {
    render(true);
    advance(200);
    expect(host.textContent).toBe('skeleton');
  });

  it('keeps the skeleton for at least 300 ms once shown', () => {
    render(true);
    advance(200);
    advance(50);
    render(false);
    advance(249);
    expect(host.textContent).toBe('skeleton');
    advance(1);
    expect(host.textContent).toBe('content');
  });
});
