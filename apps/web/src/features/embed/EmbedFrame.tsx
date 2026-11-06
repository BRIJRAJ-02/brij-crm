// Brief
// Purpose: wraps any screen drawn inside a partner's frame (spec 0070, AC-7032).
// Main task: apply the look the partner asked for, let the page be as tall as it is, and tell the partner its height.
// Leaves out: drawing anything itself, and every message to an origin the partner didn't register.
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { tellPartner } from './messages.ts';

/** Props for EmbedFrame. */
export interface EmbedFrameProps {
  /** The partner's registered frame origins: the only ones that hear the height. */
  readonly origins: readonly string[];
  /** The look the partner asked for; absent, the person's system decides. */
  readonly theme?: 'light' | 'dark' | undefined;
  readonly children: ReactNode;
}

/** The frame around an embedded screen: its look, its natural height, and the height sent to the partner. */
export function EmbedFrame({ origins, theme, children }: EmbedFrameProps) {
  const { theme: controller } = useRouteContext({ from: '__root__' });
  // Before paint, so the screen never flashes in the other look. Kept for this page only (main.tsx gives the
  // controller no storage in a frame), so it never becomes the person's own choice.
  useLayoutEffect(() => {
    if (theme !== undefined) controller.set(theme);
  }, [controller, theme]);
  // As tall as what it shows (the base layer's rule), so its height is the content's: before paint, and undone
  // should the page ever leave the frame's screens.
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-app-root]');
    root?.setAttribute('data-embedded', '');
    return () => {
      root?.removeAttribute('data-embedded');
    };
  }, []);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-app-root]');
    if (root === null) return undefined;
    let last = 0;
    const send = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      tellPartner(window, origins, { type: 'timefix:height', height });
    };
    const observer = new ResizeObserver(send);
    observer.observe(root);
    send();
    return () => {
      observer.disconnect();
    };
  }, [origins]);
  return children;
}
