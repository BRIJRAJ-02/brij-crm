// Which map app a business page's Directions opens first: Apple Maps on an Apple device (an iPhone, an iPad, which
// says Macintosh since iPadOS 13, or a Mac), Google Maps everywhere else. The other app stays a press away.
import type { MapsApp } from '@crm/ui/public-booking';

/** The visitor's own map app, from the browser's user agent. */
export function mapsAppFor(userAgent: string): MapsApp {
  return /iPhone|iPad|iPod|Macintosh/.test(userAgent) ? 'apple' : 'google';
}
