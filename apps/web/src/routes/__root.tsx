import type { DataLayer } from '@crm/data';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

/** Routes reach data only through this context, never through their own fetches. */
export interface RouterContext {
  data: DataLayer;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <main>
      <h1>Page not found</h1>
      <p>There is nothing at this address.</p>
    </main>
  ),
});
