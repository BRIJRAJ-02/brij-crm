// Services, staff and shifts (spec 0066 B1), as Settings › Services, Staff and Shifts hold them: the catalogue, and
// the team (profiles, where each works, their shifts, time off and blocks). Loaded on first use
// (`data.services.load()`), never in the first load. Each is one held copy per workspace (the team twice: as Staff
// reads it with `services.manage`, and as Shifts reads it with `services.calendar`). A change shows at once on the
// copy it was made on (a service saved, moved, online or archived; a profile saved; a week of shifts), is sent, and
// the server's answer (the whole copy) replaces it; refused, the copy goes back and the refusal comes back to the
// screen. Every write stores a `visits` change event naming the places it touched: every held copy of the workspace
// reads again, once for a burst, so another tab, or the Staff page beside Shifts, follows.
import type {
  AddBlockInput,
  AddTimeOffInput,
  CatalogueService,
  CatalogueView,
  PlaceHours,
  ServiceFields,
  ServiceTimesInput,
  ServiceTimesView,
  StaffFields,
  StaffTeamView,
  StaffView,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import { holder, type HospitalityHeld } from '../hospitality/store.ts';

type Options = { signal?: AbortSignal };
type Scoped = { workspace: string };
type Write = Scoped & { mutationId: string };

/** The services procedures the store calls, as the data layer's client answers them. */
export interface ServicesProcedures {
  readonly catalogue: (input: Scoped, options: Options) => Promise<CatalogueView>;
  readonly saveCategory: (input: Write & { id: string; name: string }, options: Options) => Promise<CatalogueView>;
  readonly deleteCategory: (input: Write & { categoryId: string }, options: Options) => Promise<CatalogueView>;
  readonly moveCategory: (
    input: Write & { categoryId: string; toIndex: number },
    options: Options,
  ) => Promise<CatalogueView>;
  readonly saveService: (
    input: Write & { id: string; service: ServiceFields },
    options: Options,
  ) => Promise<CatalogueView>;
  readonly moveService: (
    input: Write & { serviceId: string; categoryId: string | null; toIndex: number },
    options: Options,
  ) => Promise<CatalogueView>;
  readonly setOnline: (
    input: Write & { serviceIds: string[]; online: boolean },
    options: Options,
  ) => Promise<CatalogueView>;
  readonly setCategory: (
    input: Write & { serviceIds: string[]; categoryId: string | null },
    options: Options,
  ) => Promise<CatalogueView>;
  readonly archive: (input: Write & { serviceIds: string[] }, options: Options) => Promise<CatalogueView>;
  readonly restore: (input: Write & { serviceIds: string[] }, options: Options) => Promise<CatalogueView>;
  readonly team: (input: Scoped, options: Options) => Promise<StaffTeamView>;
  readonly shifts: (input: Scoped, options: Options) => Promise<StaffTeamView>;
  readonly saveStaff: (input: Write & { id: string; staff: StaffFields }, options: Options) => Promise<StaffTeamView>;
  readonly moveStaff: (input: Write & { staffId: string; toIndex: number }, options: Options) => Promise<StaffTeamView>;
  readonly linkStaff: (
    input: Write & { staffId: string; memberId: string | null },
    options: Options,
  ) => Promise<StaffTeamView>;
  readonly archiveStaff: (input: Write & { staffId: string }, options: Options) => Promise<StaffTeamView>;
  readonly restoreStaff: (input: Write & { staffId: string }, options: Options) => Promise<StaffTeamView>;
  readonly removeStaffPhoto: (input: Write & { staffId: string }, options: Options) => Promise<StaffTeamView>;
  readonly setShifts: (
    input: Write & { staffId: string; placeId: string; shifts: PlaceHours; outsideHours: boolean },
    options: Options,
  ) => Promise<StaffTeamView>;
  readonly copyShifts: (
    input: Write & { staffId: string; placeId: string; toStaffIds: string[] },
    options: Options,
  ) => Promise<StaffTeamView>;
  readonly addTimeOff: (
    input: Omit<AddTimeOffInput, 'workspace' | 'mutationId'> & Write,
    options: Options,
  ) => Promise<StaffTeamView>;
  readonly removeTimeOff: (input: Write & { id: string }, options: Options) => Promise<StaffTeamView>;
  readonly addBlock: (
    input: Omit<AddBlockInput, 'workspace' | 'mutationId'> & Write,
    options: Options,
  ) => Promise<StaffTeamView>;
  readonly removeBlock: (input: Write & { id: string }, options: Options) => Promise<StaffTeamView>;
  readonly times: (input: ServiceTimesInput, options: Options) => Promise<ServiceTimesView>;
}

/** Which copy of the team a screen holds: Staff's (`services.manage`) or Shifts' (`services.calendar`). */
export type TeamCopy = 'team' | 'shifts';

/** Time off as a screen adds it (the id is the store's). */
export type NewTimeOff = Omit<AddTimeOffInput, 'workspace' | 'mutationId' | 'id'>;
/** A block as a screen adds it (the id is the store's). */
export type NewBlock = Omit<AddBlockInput, 'workspace' | 'mutationId' | 'id'>;

/** `items` with `id` taken out and put back at `toIndex`, clamped. */
function placed<Item extends { readonly id: string }>(items: readonly Item[], id: string, toIndex: number): Item[] {
  const moving = items.find((item) => item.id === id);
  if (moving === undefined) return [...items];
  const rest = items.filter((item) => item.id !== id);
  rest.splice(Math.min(Math.max(toIndex, 0), rest.length), 0, moving);
  return rest;
}

/** A catalogue with `service` moved into `categoryId` at `toIndex` among that category's live services. */
export function withServiceMoved(
  view: CatalogueView,
  serviceId: string,
  categoryId: string | null,
  toIndex: number,
): CatalogueView {
  const moving = view.services.find((service) => service.id === serviceId);
  if (moving === undefined) return view;
  const { categoryId: _was, ...rest } = moving;
  const moved: CatalogueService = categoryId === null ? rest : { ...rest, categoryId };
  const others = view.services.filter((service) => service.id !== serviceId);
  const inCategory = others.filter((service) => (service.categoryId ?? null) === categoryId && !service.archived);
  const anchor = inCategory[Math.min(Math.max(toIndex, 0), inCategory.length)];
  const at = anchor === undefined ? others.length : others.indexOf(anchor);
  return { ...view, services: [...others.slice(0, at), moved, ...others.slice(at)] };
}

/** A service as the catalogue will list it, from what the editor sent (new variants get a passing id). */
function serviceOf(id: string, fields: ServiceFields, mintId: () => string): CatalogueService {
  return {
    id,
    name: fields.name.trim(),
    ...(fields.description === undefined || fields.description.trim() === ''
      ? {}
      : { description: fields.description }),
    ...(fields.categoryId === null ? {} : { categoryId: fields.categoryId }),
    bufferAfterMin: fields.bufferAfterMin,
    online: fields.online,
    staffRule: fields.staffRule,
    staffIds: fields.staffRule === 'chosen' ? [...fields.staffIds] : [],
    placeIds: [...fields.placeIds],
    needs: [...fields.needs],
    variants: fields.variants.map((variant) => ({ ...variant, id: variant.id ?? mintId() })),
    ...(fields.cancelNote === undefined || fields.cancelNote.trim() === '' ? {} : { cancelNote: fields.cancelNote }),
    archived: false,
  };
}

/** A team with one profile changed by `change`. */
function withStaff(view: StaffTeamView, staffId: string, change: (staff: StaffView) => StaffView): StaffTeamView {
  return { ...view, staff: view.staff.map((each) => (each.id === staffId ? change(each) : each)) };
}

/** The store, made once by the data layer the first time a screen asks (`data.services.load()`). */
export function openServices(given: {
  readonly api: ServicesProcedures;
  readonly call: <T>(run: (options: Options) => Promise<T>) => Promise<T>;
  readonly mintId: () => string;
  readonly origin: string;
  readonly upload: (workspace: string, staffId: string, body: Blob) => Promise<{ photo: string }>;
  readonly now?: () => number;
}) {
  const { api, call, mintId } = given;
  const now = given.now ?? Date.now;
  const catalogues = new Map<string, ReturnType<typeof holder<CatalogueView>>>();
  const teams = new Map<string, ReturnType<typeof holder<StaffTeamView>>>();

  const catalogueOf = (workspace: string) => {
    let found = catalogues.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => api.catalogue({ workspace }, options)), now);
      catalogues.set(workspace, found);
    }
    return found;
  };
  const teamOf = (workspace: string, copy: TeamCopy) => {
    const key = `${workspace}:${copy}`;
    let found = teams.get(key);
    if (found === undefined) {
      found = holder(
        () =>
          call((options) => (copy === 'team' ? api.team({ workspace }, options) : api.shifts({ workspace }, options))),
        now,
      );
      teams.set(key, found);
    }
    return found;
  };
  /** A catalogue change: `next` shows at once, `send` answers the whole catalogue. */
  const catalogueChange = (
    workspace: string,
    next: (view: CatalogueView) => CatalogueView,
    send: (mutationId: string, options: Options) => Promise<CatalogueView>,
  ): Promise<DataError | undefined> =>
    catalogueOf(workspace).change(next, () => call((options) => send(mintId(), options)));
  /** A team change on the copy the screen holds; the other copy, if held, reads again after. */
  const teamChange = async (
    workspace: string,
    copy: TeamCopy,
    next: (view: StaffTeamView) => StaffTeamView,
    send: (mutationId: string, options: Options) => Promise<StaffTeamView>,
  ): Promise<DataError | undefined> => {
    const refused = await teamOf(workspace, copy).change(next, () => call((options) => send(mintId(), options)));
    if (refused === undefined) {
      const other = teams.get(`${workspace}:${copy === 'team' ? 'shifts' : 'team'}`);
      void other?.read().catch(() => undefined);
      // A profile's places and services show in the catalogue's pickers too.
      void catalogues
        .get(workspace)
        ?.read()
        .catch(() => undefined);
    }
    return refused;
  };

  return {
    /** Settings › Services: the catalogue, the places, staff and resources a service may name, and the checklist. */
    catalogue: (workspace: string): HospitalityHeld<CatalogueView> => catalogueOf(workspace).held,
    /** Adds a category (`id` new) or renames one. */
    saveCategory: (workspace: string, id: string, name: string) =>
      catalogueChange(
        workspace,
        (view) =>
          view.categories.some((category) => category.id === id)
            ? { ...view, categories: view.categories.map((each) => (each.id === id ? { ...each, name } : each)) }
            : { ...view, categories: [...view.categories, { id, name }] },
        (mutationId, options) => api.saveCategory({ workspace, id, name, mutationId }, options),
      ),
    /** Deletes a category; its services stay, with no category. */
    deleteCategory: (workspace: string, categoryId: string) =>
      catalogueChange(
        workspace,
        (view) => ({
          ...view,
          categories: view.categories.filter((each) => each.id !== categoryId),
          services: view.services.map((service) => {
            if (service.categoryId !== categoryId) return service;
            const { categoryId: _gone, ...rest } = service;
            return rest;
          }),
        }),
        (mutationId, options) => api.deleteCategory({ workspace, categoryId, mutationId }, options),
      ),
    /** Moves a category to `toIndex`. */
    moveCategory: (workspace: string, categoryId: string, toIndex: number) =>
      catalogueChange(
        workspace,
        (view) => ({ ...view, categories: placed(view.categories, categoryId, toIndex) }),
        (mutationId, options) => api.moveCategory({ workspace, categoryId, toIndex, mutationId }, options),
      ),
    /** Adds a service (`id` new, from `newId()`) or changes one, whole. */
    saveService: (workspace: string, id: string, service: ServiceFields) =>
      catalogueChange(
        workspace,
        (view) => {
          const made = serviceOf(id, service, mintId);
          return view.services.some((each) => each.id === id)
            ? { ...view, services: view.services.map((each) => (each.id === id ? made : each)) }
            : { ...view, services: [...view.services, made] };
        },
        (mutationId, options) => api.saveService({ workspace, id, service, mutationId }, options),
      ),
    /** Moves a service into a category (null: none) at `toIndex` there. */
    moveService: (workspace: string, serviceId: string, categoryId: string | null, toIndex: number) =>
      catalogueChange(
        workspace,
        (view) => withServiceMoved(view, serviceId, categoryId, toIndex),
        (mutationId, options) => api.moveService({ workspace, serviceId, categoryId, toIndex, mutationId }, options),
      ),
    /** Several services online or off. */
    setOnline: (workspace: string, serviceIds: readonly string[], online: boolean) =>
      catalogueChange(
        workspace,
        (view) => ({
          ...view,
          services: view.services.map((each) => (serviceIds.includes(each.id) ? { ...each, online } : each)),
        }),
        (mutationId, options) => api.setOnline({ workspace, serviceIds: [...serviceIds], online, mutationId }, options),
      ),
    /** Several services into one category (null: none). */
    setCategory: (workspace: string, serviceIds: readonly string[], categoryId: string | null) =>
      catalogueChange(
        workspace,
        (view) => ({
          ...view,
          services: view.services.map((each) => {
            if (!serviceIds.includes(each.id)) return each;
            const { categoryId: _was, ...rest } = each;
            return categoryId === null ? rest : { ...rest, categoryId };
          }),
        }),
        (mutationId, options) =>
          api.setCategory({ workspace, serviceIds: [...serviceIds], categoryId, mutationId }, options),
      ),
    /** Archives services (Undo restores them). */
    archive: (workspace: string, serviceIds: readonly string[]) =>
      catalogueChange(
        workspace,
        (view) => ({
          ...view,
          services: view.services.map((each) => (serviceIds.includes(each.id) ? { ...each, archived: true } : each)),
        }),
        (mutationId, options) => api.archive({ workspace, serviceIds: [...serviceIds], mutationId }, options),
      ),
    /** Restores archived services. */
    restore: (workspace: string, serviceIds: readonly string[]) =>
      catalogueChange(
        workspace,
        (view) => ({
          ...view,
          services: view.services.map((each) => (serviceIds.includes(each.id) ? { ...each, archived: false } : each)),
        }),
        (mutationId, options) => api.restore({ workspace, serviceIds: [...serviceIds], mutationId }, options),
      ),
    /** The team: Staff's copy (`team`) or Shifts' (`shifts`). */
    team: (workspace: string, copy: TeamCopy = 'team'): HospitalityHeld<StaffTeamView> => teamOf(workspace, copy).held,
    /** Adds a profile (`id` new) or changes one. */
    saveStaff: (workspace: string, id: string, staff: StaffFields) =>
      teamChange(
        workspace,
        'team',
        (view) =>
          view.staff.some((each) => each.id === id)
            ? withStaff(view, id, (each) => ({
                ...each,
                name: staff.name.trim(),
                ...(staff.title === undefined ? {} : { title: staff.title }),
                ...(staff.bio === undefined ? {} : { bio: staff.bio }),
                ...(staff.color === null ? {} : { color: staff.color }),
                serviceIds: [...staff.serviceIds],
              }))
            : {
                ...view,
                staff: [
                  ...view.staff,
                  {
                    id,
                    name: staff.name.trim(),
                    ...(staff.title === undefined ? {} : { title: staff.title }),
                    ...(staff.color === null ? {} : { color: staff.color }),
                    archived: false,
                    places: [],
                    serviceIds: [...staff.serviceIds],
                    timeOff: [],
                    blocks: [],
                    upcoming: 0,
                  },
                ],
              },
        (mutationId, options) => api.saveStaff({ workspace, id, staff, mutationId }, options),
      ),
    /** Moves a profile to `toIndex` among the live ones. */
    moveStaff: (workspace: string, staffId: string, toIndex: number) =>
      teamChange(
        workspace,
        'team',
        (view) => {
          const live = placed(
            view.staff.filter((each) => !each.archived),
            staffId,
            toIndex,
          );
          return { ...view, staff: [...live, ...view.staff.filter((each) => each.archived)] };
        },
        (mutationId, options) => api.moveStaff({ workspace, staffId, toIndex, mutationId }, options),
      ),
    /** Links a profile to a member (null unlinks). Refused CONFLICT while their visits and meetings overlap. */
    linkStaff: (workspace: string, staffId: string, memberId: string | null, memberName?: string) =>
      teamChange(
        workspace,
        'team',
        (view) =>
          withStaff(view, staffId, (each) => {
            const { memberId: _was, memberName: _name, ...rest } = each;
            return memberId === null
              ? rest
              : { ...rest, memberId, ...(memberName === undefined ? {} : { memberName }) };
          }),
        (mutationId, options) => api.linkStaff({ workspace, staffId, memberId, mutationId }, options),
      ),
    /** Archives a profile (refused while they have visits to come). */
    archiveStaff: (workspace: string, staffId: string) =>
      teamChange(
        workspace,
        'team',
        (view) => withStaff(view, staffId, (each) => ({ ...each, archived: true })),
        (mutationId, options) => api.archiveStaff({ workspace, staffId, mutationId }, options),
      ),
    /** Restores an archived profile. */
    restoreStaff: (workspace: string, staffId: string) =>
      teamChange(
        workspace,
        'team',
        (view) => withStaff(view, staffId, (each) => ({ ...each, archived: false })),
        (mutationId, options) => api.restoreStaff({ workspace, staffId, mutationId }, options),
      ),
    /** Takes a profile's photo away. */
    removeStaffPhoto: (workspace: string, staffId: string) =>
      teamChange(
        workspace,
        'team',
        (view) =>
          withStaff(view, staffId, (each) => {
            const { photo: _gone, ...rest } = each;
            return rest;
          }),
        (mutationId, options) => api.removeStaffPhoto({ workspace, staffId, mutationId }, options),
      ),
    /**
     * Uploads a profile's photo (already cropped square and drawn again by the screen), then reads the team again so
     * every screen shows it. Answers the refusal, or undefined.
     */
    uploadStaffPhoto: async (workspace: string, staffId: string, body: Blob): Promise<DataError | undefined> => {
      try {
        await given.upload(workspace, staffId, body);
      } catch (error) {
        return toDataError(error);
      }
      for (const copy of ['team', 'shifts'] as const)
        void teams
          .get(`${workspace}:${copy}`)
          ?.read()
          .catch(() => undefined);
      return undefined;
    },
    /** A profile's photo address, by its version (a new upload, a new address). */
    staffPhotoSrc: (workspace: string, staffId: string, version: string): string =>
      new URL(
        `/api/services/staff/${encodeURIComponent(staffId)}/photo?${new URLSearchParams({ workspace, v: version }).toString()}`,
        given.origin,
      ).href,
    /**
     * A staff member's shifts at a place, whole (the weekly pattern and every date change), on the copy the screen
     * holds: copying a week to every week is this one write, so all seven days are saved together.
     */
    setShifts: (
      workspace: string,
      copy: TeamCopy,
      staffId: string,
      placeId: string,
      shifts: PlaceHours,
      outsideHours: boolean,
    ) =>
      teamChange(
        workspace,
        copy,
        (view) =>
          withStaff(view, staffId, (each) => ({
            ...each,
            places: each.places.map((at) => (at.placeId === placeId ? { placeId, shifts, outsideHours } : at)),
          })),
        (mutationId, options) =>
          api.setShifts({ workspace, staffId, placeId, shifts, outsideHours, mutationId }, options),
      ),
    /** Copies one staff member's weekly shifts at a place to others there (each keeps their own date changes). */
    copyShifts: (workspace: string, copy: TeamCopy, staffId: string, placeId: string, toStaffIds: readonly string[]) =>
      teamChange(
        workspace,
        copy,
        (view) => {
          const from = view.staff.find((each) => each.id === staffId)?.places.find((at) => at.placeId === placeId);
          if (from === undefined) return view;
          return {
            ...view,
            staff: view.staff.map((each) =>
              toStaffIds.includes(each.id)
                ? {
                    ...each,
                    places: each.places.map((at) =>
                      at.placeId === placeId
                        ? {
                            ...at,
                            outsideHours: from.outsideHours,
                            shifts: { ...at.shifts, weekly: from.shifts.weekly },
                          }
                        : at,
                    ),
                  }
                : each,
            ),
          };
        },
        (mutationId, options) =>
          api.copyShifts({ workspace, staffId, placeId, toStaffIds: [...toStaffIds], mutationId }, options),
      ),
    /** Adds time off for an unlinked staff member. */
    addTimeOff: (workspace: string, copy: TeamCopy, off: NewTimeOff) => {
      const id = mintId();
      return teamChange(
        workspace,
        copy,
        (view) =>
          withStaff(view, off.staffId, (each) => ({
            ...each,
            timeOff: [
              ...each.timeOff,
              {
                id,
                start: off.start,
                end: off.end,
                reason: off.reason,
                ...(off.placeId === undefined ? {} : { placeId: off.placeId }),
              },
            ],
          })),
        (mutationId, options) => api.addTimeOff({ ...off, id, workspace, mutationId }, options),
      );
    },
    /** Removes one time off. */
    removeTimeOff: (workspace: string, copy: TeamCopy, id: string) =>
      teamChange(
        workspace,
        copy,
        (view) => ({
          ...view,
          staff: view.staff.map((each) => ({ ...each, timeOff: each.timeOff.filter((off) => off.id !== id) })),
        }),
        (mutationId, options) => api.removeTimeOff({ workspace, id, mutationId }, options),
      ),
    /** Blocks time at a place for an unlinked staff member. */
    addBlock: (workspace: string, copy: TeamCopy, block: NewBlock) => {
      const id = mintId();
      return teamChange(
        workspace,
        copy,
        (view) =>
          withStaff(view, block.staffId, (each) => ({
            ...each,
            blocks: [
              ...each.blocks,
              {
                id,
                placeId: block.placeId,
                start: block.start,
                end: block.end,
                ...(block.reason === undefined ? {} : { reason: block.reason }),
              },
            ],
          })),
        (mutationId, options) => api.addBlock({ ...block, id, workspace, mutationId }, options),
      );
    },
    /** Removes one block. */
    removeBlock: (workspace: string, copy: TeamCopy, id: string) =>
      teamChange(
        workspace,
        copy,
        (view) => ({
          ...view,
          staff: view.staff.map((each) => ({ ...each, blocks: each.blocks.filter((block) => block.id !== id) })),
        }),
        (mutationId, options) => api.removeBlock({ workspace, id, mutationId }, options),
      ),
    /** The desk's offered times for one service on a place date, read fresh. Throws the DataError on a refusal. */
    times: (query: ServiceTimesInput): Promise<ServiceTimesView> => call((options) => api.times(query, options)),
    /** A `visits` change event: every held copy of the workspace reads again (each read is permission checked). */
    placesChanged(workspace: string) {
      void catalogues
        .get(workspace)
        ?.read()
        .catch(() => undefined);
      for (const copy of ['team', 'shifts'] as const)
        void teams
          .get(`${workspace}:${copy}`)
          ?.read()
          .catch(() => undefined);
    },
    /** Sign out: every held copy goes. */
    clear() {
      catalogues.clear();
      teams.clear();
    },
  };
}

/** The store's public face. */
export type ServicesStore = ReturnType<typeof openServices>;
