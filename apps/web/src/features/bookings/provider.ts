// Who provides a meeting's video link, in words a Join link can carry.
import { strings } from './strings.ts';

/** Who provides a meeting link, from its host. */
export function providerOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return strings.providers.other;
  }
  if (host === 'meet.google.com') return strings.providers.google;
  if (host.endsWith('teams.microsoft.com') || host.endsWith('teams.live.com')) return strings.providers.microsoft;
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return strings.providers.zoom;
  return strings.providers.other;
}
