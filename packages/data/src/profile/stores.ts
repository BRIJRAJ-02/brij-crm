// The person's picture choice and social links, made together when Settings › Profile, the booking editor or the
// photo switch first asks (`lazy.ts`), so neither store rides in the app's first load. The profile's read goes
// through the social links store (which takes the picture store's read), so an older read never undoes a change
// that landed.
import type { MyProfile, UpdateMyProfileInput } from '@crm/contracts';
import type { Notice } from '../notice.ts';
import { createPictureChoiceStore } from './picture.ts';
import { createSocialLinksStore } from './socials.ts';

/** What the two stores are made with: the profile's read and update, and the layer's ids and toasts. */
export interface ProfileStoresDeps {
  readonly get: (input: { readonly workspace: string }) => Promise<MyProfile>;
  readonly update: (input: UpdateMyProfileInput) => Promise<MyProfile>;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
}

/** Both stores, over one read of the profile. */
export function openProfileStores(deps: ProfileStoresDeps) {
  const picture = createPictureChoiceStore({
    api: { get: deps.get, update: deps.update },
    mintId: deps.mintId,
    notify: deps.notify,
  });
  const socials = createSocialLinksStore({
    read: (workspace) => picture.read(workspace),
    update: deps.update,
    mintId: deps.mintId,
    notify: deps.notify,
  });
  return { picture, socials };
}

/** Both stores, as `lazyProfileStores` answers them once loaded. */
export type ProfileStores = ReturnType<typeof openProfileStores>;
