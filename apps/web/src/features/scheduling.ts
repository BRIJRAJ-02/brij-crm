// The scheduling pages' look (Bookings, Availability, Booking pages and Forms, the sidebar's Scheduling section,
// spec 0034): one tile hue for all of them, so their TopBars carry a tile as an object's page does (the owner, 21
// October 2026: the scheduling pages' chrome as the CRM pages'), in a hue no standard object takes.
import type { Hue } from '@crm/ui';

/** The tile hue every scheduling page's TopBar shows its icon on. */
export const SCHEDULING_HUE: Hue = 'orange';
