// One Timefix Bookings app over three dummy workspaces: Northwind takes meetings, Lumen books services with staff,
// Olive books tables. The workspace switcher moves between them; each keeps the same shell, sidebar and patterns.
import { useState } from 'react';
import { useToast } from '../Toast/Toast.tsx';
import { BookingsFlow } from '../BookingsFlow/BookingsFlow.tsx';
import type { WorkspaceId } from '../BookingsFlow/parts.tsx';
import { BusinessFlow } from './BusinessFlow.tsx';
import { lumen, olive } from './seed.ts';

/** Props for BookingsApp. */
export interface BookingsAppProps {
  /** Which workspace opens first. */
  readonly start?: WorkspaceId;
}

/** Bookings for any kind of business, as one app: switch workspace from the menu at the top of the sidebar. */
export function BookingsApp({ start = 'northwind' }: BookingsAppProps) {
  const [ws, setWs] = useState<WorkspaceId>(start);
  const { toast } = useToast();
  const go = (id: WorkspaceId) => { setWs(id); toast({ message: id === 'northwind' ? 'Northwind' : id === 'lumen' ? 'Lumen Hair Studio' : 'Olive Kitchen' }); };
  if (ws === 'northwind') return <BookingsFlow showDemoMenu onWorkspace={go} />;
  return <BusinessFlow key={ws} initialState={ws === 'lumen' ? lumen() : olive()} showDemoMenu onWorkspace={go} />;
}
