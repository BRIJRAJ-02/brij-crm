import type { DataLayer } from '@crm/data';
import type { ThemeController } from '@crm/ui/theme';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { NotFound } from '../features/system/SystemStatusScreen.tsx';

/** Routes reach data only through this context, never through their own fetches. */
export interface RouterContext {
  data: DataLayer;
  /** The Light, Dark or System choice. The ThemeSwitch (#4) reads and sets it. */
  theme: ThemeController;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
});
