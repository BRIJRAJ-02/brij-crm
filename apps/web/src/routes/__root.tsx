import type { DataLayer } from '@crm/data';
import type { Toasts } from '@crm/ui';
import type { ThemeController } from '@crm/ui/theme';
import { createRootRouteWithContext, lazyRouteComponent, Outlet } from '@tanstack/react-router';

/** Routes reach data only through this context, never through their own fetches. */
export interface RouterContext {
  data: DataLayer;
  /** The Light, Dark or System choice. The ThemeSwitch reads and sets it. */
  theme: ThemeController;
  /** The app's toast queue, for a screen's own confirmations and failures. */
  toasts: Toasts;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  // Loaded when first needed (the root route isn't split), so the not found page stays out of the first load.
  notFoundComponent: lazyRouteComponent(() => import('../features/system/SystemStatusScreen.tsx'), 'NotFound'),
});
