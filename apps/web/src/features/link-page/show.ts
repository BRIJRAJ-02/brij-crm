// Making the person's own link page public as they share it (27 Oct 2026). A page made with a membership is private,
// seen only by its owner, until they first edit it or share its link: editing shows it on the server with no call of
// its own, and these are the shares (Make it public, Share, Show QR code). Through the data layer's link page store,
// which is loaded with its own chunk.
import type { DataLayer } from '@crm/data';

/** Makes the caller's page in `slug` public; answers whether it is public now. Never makes it private again. */
export async function showLinkPage(data: DataLayer, slug: string): Promise<boolean> {
  const store = await data.linkPage.load();
  return (await store.show(slug)).isPublic;
}
