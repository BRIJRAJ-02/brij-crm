// Brief
// Purpose: one staff member's profile (spec 0066 B1, AC-6611; Fresha's team member page): photo, name, title, colour
// and bio; where they work and what they do; whether they sign in; their regular week at each place; time off and
// blocks; and archive.
// Main task: get a new person bookable: their photo and title, the services they do, and their week.
// Leaves out: one date's change across the team (Settings › Shifts) and their calendar (B3).
import type { Hue, PlaceHours, ServicesStore, StaffFields, StaffTeamView, StaffView } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { CATALOGUE_LIMITS } from '@crm/data/services';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Field,
  FileDrop,
  Form,
  formatDate,
  HuePicker,
  Modal,
  SaveBar,
  Select,
  SettingsSection,
  Table,
  useFormatSettings,
  usePhotoCrop,
  type SaveBarStatus,
  type SelectItem,
  type Toasts,
} from '@crm/ui';
import { preparePhoto } from '@crm/ui/photo';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { shiftsSettingsHref, staffSettingsHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { NotInstalled } from './NotInstalled.tsx';
import { RegularShifts } from './RegularShifts.tsx';
import { todayIn } from './shifts.ts';
import { strings } from './strings.ts';
import { BlockDialog, TimeOffDialog } from './TimeDialogs.tsx';

/** Props for one profile. */
export interface StaffProfileScreenProps {
  readonly store: ServicesStore;
  readonly slug: string;
  readonly staffId: string;
  readonly toasts: Toasts;
}

/** The profile, or not found. */
export function StaffProfileScreen({ store, slug, staffId, toasts }: StaffProfileScreenProps) {
  const state = useHospitality(store.team(slug));
  if (state.status === 'error') {
    if (state.error.code === 'APP_NOT_INSTALLED') return <NotInstalled slug={slug} title={strings.staffTitle} />;
    return (
      <SettingsPage
        title={strings.staffTitle}
        crumbs={[{ id: 'staff', label: strings.staffTitle, href: staffSettingsHref(slug) }]}
      >
        <EmptyState
          title={strings.failed}
          icon="id-card"
          actions={<Button onPress={() => store.team(slug).retry()}>{strings.retry}</Button>}
        >
          {state.error.message}
        </EmptyState>
      </SettingsPage>
    );
  }
  const team = state.status === 'ready' ? state.value : undefined;
  const person = team?.staff.find((each) => each.id === staffId);
  if (team === undefined || person === undefined) {
    return (
      <SettingsPage
        title={strings.profileTitle}
        crumbs={[{ id: 'staff', label: strings.staffTitle, href: staffSettingsHref(slug) }]}
        isLoading={team === undefined}
      >
        {team === undefined ? null : (
          <EmptyState
            title={strings.failed}
            icon="id-card"
            actions={<ButtonLink href={staffSettingsHref(slug)}>{strings.staffTitle}</ButtonLink>}
          />
        )}
      </SettingsPage>
    );
  }
  // Keyed by the person, so a profile's draft never carries over to another.
  return <Profile key={person.id} store={store} slug={slug} team={team} person={person} toasts={toasts} />;
}

/** The fields Save sends, as typed. */
interface Draft {
  readonly name: string;
  readonly title: string;
  readonly bio: string;
  readonly color: Hue | null;
  readonly placeIds: readonly string[];
  readonly serviceIds: readonly string[];
}

const draftOf = (person: StaffView): Draft => ({
  name: person.name,
  title: person.title ?? '',
  bio: person.bio ?? '',
  color: person.color ?? null,
  placeIds: person.places.map((at) => at.placeId),
  serviceIds: person.serviceIds,
});

function Profile({
  store,
  slug,
  team,
  person,
  toasts,
}: {
  readonly store: ServicesStore;
  readonly slug: string;
  readonly team: StaffTeamView;
  readonly person: StaffView;
  readonly toasts: Toasts;
}) {
  const { locale } = useFormatSettings();
  const navigate = useNavigate();
  const formId = useId();
  const [now] = useState(() => Date.now());
  const [draft, setDraft] = useState<Draft>(() => draftOf(person));
  const [saved, setSaved] = useState<Draft>(() => draftOf(person));
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [failure, setFailure] = useState<string | undefined>();
  const [dialog, setDialog] = useState<'time-off' | 'archive' | { readonly block: string } | undefined>();
  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const status: SaveBarStatus =
    phase === 'saving'
      ? 'saving'
      : phase === 'error'
        ? 'error'
        : isDirty
          ? 'unsaved'
          : phase === 'saved'
            ? 'saved'
            : 'hidden';
  const set = (next: Partial<Draft>) => {
    setDraft((was) => ({ ...was, ...next }));
    if (phase !== 'saving') setPhase('idle');
  };
  const said = (refused: { readonly message: string } | undefined) => {
    if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
    return refused?.message;
  };

  const save = async () => {
    if (draft.name.trim() === '') return;
    const fields: StaffFields = {
      name: draft.name.trim(),
      ...(draft.title.trim() === '' ? {} : { title: draft.title.trim() }),
      ...(draft.bio.trim() === '' ? {} : { bio: draft.bio.trim() }),
      color: draft.color,
      placeIds: [...draft.placeIds],
      serviceIds: [...draft.serviceIds],
    };
    setPhase('saving');
    const refused = await store.saveStaff(slug, person.id, fields);
    if (refused !== undefined) {
      setFailure(refused.message);
      setPhase('error');
      return;
    }
    setSaved(draft);
    setPhase('saved');
  };

  // Their photo: placed in the round cropper, drawn again as an avatar (a phone photo's location left behind), sent.
  const cropping = usePhotoCrop();
  const [isUploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | undefined>();
  const photoSrc = person.photo === undefined ? undefined : store.staffPhotoSrc(slug, person.id, person.photo);
  const uploadPhoto = async (source: File | string) => {
    const crop = await cropping.crop(source, 'circle');
    if (crop === undefined) return;
    setUploading(true);
    setPhotoError(undefined);
    const prepared = await preparePhoto(source, 'avatar', crop).catch(() => undefined);
    if (prepared === undefined) {
      setUploading(false);
      setPhotoError(strings.photoFailed);
      return;
    }
    const refused = await store.uploadStaffPhoto(slug, person.id, prepared.blob);
    setUploading(false);
    if (refused !== undefined) setPhotoError(refused.message);
  };

  const placeItems: readonly SelectItem[] = team.places.map((place) => ({ id: place.id, label: place.name }));
  const categoryName = new Map(team.categories.map((category) => [category.id, category.name]));
  const serviceItems: readonly SelectItem[] = team.services.map((service) => ({
    id: service.id,
    label: service.name,
    ...(service.categoryId === undefined ? {} : { group: categoryName.get(service.categoryId) ?? '' }),
  }));
  const members = team.members ?? [];
  const memberItems: readonly SelectItem[] = [
    { id: '', label: strings.noMember },
    ...members.map((member) => {
      const other = member.staffId !== undefined && member.staffId !== person.id;
      const otherName = team.staff.find((each) => each.id === member.staffId)?.name ?? '';
      return {
        id: member.id,
        label: member.name,
        ...(other ? { isDisabled: true, description: strings.memberTaken(otherName) } : {}),
      };
    }),
  ];
  const [memberId, setMemberId] = useState(person.memberId ?? '');
  const [linkRefusal, setLinkRefusal] = useState<string | undefined>();
  const [isLinking, setLinking] = useState(false);
  const isLinked = person.memberId !== undefined;
  const zone =
    team.places.find((place) => place.id === person.places[0]?.placeId)?.timeZone ?? team.places[0]?.timeZone ?? 'UTC';
  const today = todayIn(zone);
  const coming = [
    ...person.timeOff.map((off) => ({
      kind: 'off' as const,
      id: off.id,
      start: off.start,
      end: off.end,
      words: strings.reasons[off.reason],
    })),
    ...person.blocks.map((block) => ({
      kind: 'block' as const,
      id: block.id,
      start: block.start,
      end: block.end,
      words: block.reason ?? strings.blockTime,
    })),
  ]
    .filter((each) => Date.parse(each.end) > now)
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <SettingsPage
      title={person.name}
      crumbs={[{ id: 'staff', label: strings.staffTitle, href: staffSettingsHref(slug) }]}
      footer={
        <SaveBar
          status={status}
          {...(failure === undefined ? {} : { error: failure })}
          onSave={() => void save()}
          onDiscard={() => {
            setDraft(saved);
            setPhase('idle');
          }}
          {...(draft.name.trim() === '' ? { blockedReason: strings.staffName } : {})}
        />
      }
    >
      <LeaveGuard isDirty={isDirty} />
      {cropping.cropper}
      {person.archived ? (
        <Callout
          tone="info"
          actions={
            <Button onPress={() => void store.restoreStaff(slug, person.id).then(said)}>{strings.restoreStaff}</Button>
          }
        >
          {strings.archivedProfile}
        </Callout>
      ) : null}
      <SettingsSection title={strings.profileTitle}>
        <Card>
          <Form id={formId} onSubmit={() => void save()}>
            <FileDrop
              label={strings.photo}
              acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
              typesText={strings.photoTypes}
              onFiles={(files) => {
                const file = files[0];
                if (file !== undefined) void uploadPhoto(file);
              }}
              isPending={isUploading}
              {...(photoError === undefined ? {} : { error: photoError })}
              {...(photoSrc === undefined
                ? {}
                : { preview: { src: photoSrc, alt: '' }, onAdjust: () => void uploadPhoto(photoSrc) })}
            />
            {photoSrc === undefined ? null : (
              <Button
                variant="ghost"
                size="sm"
                icon="x"
                onPress={() => void store.removeStaffPhoto(slug, person.id).then(said)}
              >
                {strings.removePhoto}
              </Button>
            )}
            <Field
              label={strings.staffName}
              value={draft.name}
              onChange={(name) => set({ name })}
              isRequired
              maxLength={CATALOGUE_LIMITS.staffNameMax}
              {...(draft.name.trim() === '' ? { error: strings.staffName } : {})}
            />
            <Field
              label={strings.staffTitleField}
              value={draft.title}
              onChange={(title) => set({ title })}
              placeholder={strings.staffTitleHint}
              maxLength={CATALOGUE_LIMITS.staffTitleMax}
            />
            <HuePicker
              label={strings.colour}
              isLabelShown
              {...(draft.color === null ? {} : { value: draft.color })}
              onChange={(color) => set({ color })}
            />
            <Field
              label={strings.bio}
              value={draft.bio}
              onChange={(bio) => set({ bio })}
              isMultiline
              hint={strings.bioHint}
              maxLength={CATALOGUE_LIMITS.staffBioMax}
            />
          </Form>
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.worksAtTitle} description={strings.worksAtHint}>
        <Select
          label={strings.places}
          isLabelHidden
          selectionMode="multiple"
          items={placeItems}
          values={draft.placeIds}
          onValuesChange={(placeIds) => set({ placeIds })}
        />
      </SettingsSection>
      <SettingsSection
        title={strings.servicesTitleProfile}
        actions={
          <Button
            variant="ghost"
            size="sm"
            isDisabled={draft.serviceIds.length === team.services.length}
            onPress={() => set({ serviceIds: team.services.map((service) => service.id) })}
          >
            {strings.selectAll}
          </Button>
        }
      >
        <Select
          label={strings.does}
          isLabelHidden
          selectionMode="multiple"
          isSearchable
          items={serviceItems}
          values={draft.serviceIds}
          onValuesChange={(serviceIds) => set({ serviceIds })}
          placeholder={strings.none}
        />
      </SettingsSection>
      <SettingsSection title={strings.linkTitle} description={strings.linkText}>
        <Select
          label={strings.member}
          items={memberItems}
          value={memberId}
          onChange={(chosen) => {
            setMemberId(chosen ?? '');
            setLinkRefusal(undefined);
          }}
          {...(linkRefusal === undefined ? {} : { error: linkRefusal })}
        />
        <Button
          isDisabled={memberId === (person.memberId ?? '')}
          isPending={isLinking}
          onPress={() => {
            setLinking(true);
            const chosen = memberId === '' ? null : memberId;
            void store
              .linkStaff(slug, person.id, chosen, members.find((member) => member.id === chosen)?.name)
              .then((refused) => {
                setLinking(false);
                setLinkRefusal(refused?.message);
                if (refused !== undefined) setMemberId(person.memberId ?? '');
              });
          }}
        >
          {memberId === '' && isLinked ? strings.unlink : strings.link}
        </Button>
      </SettingsSection>
      {person.places.map((works) => {
        const place = team.places.find((each) => each.id === works.placeId);
        if (place === undefined) return null;
        return (
          <SettingsSection
            key={place.id}
            title={`${strings.shiftsTitle} · ${place.name}`}
            actions={
              <ButtonLink variant="ghost" size="sm" href={shiftsSettingsHref(slug, { place: place.id })}>
                {strings.shiftsTitle}
              </ButtonLink>
            }
          >
            <Card>
              <RegularShifts
                name={person.name}
                place={place}
                works={works}
                onSave={(shifts: PlaceHours, outsideHours: boolean) =>
                  store.setShifts(slug, 'team', person.id, place.id, shifts, outsideHours).then(said)
                }
              />
            </Card>
          </SettingsSection>
        );
      })}
      <SettingsSection
        title={strings.upcomingTitle}
        actions={
          isLinked ? undefined : (
            <>
              <Button size="sm" icon="calendar-plus" onPress={() => setDialog('time-off')}>
                {strings.addTimeOff}
              </Button>
              {person.places[0] === undefined ? null : (
                <Button size="sm" icon="clock" onPress={() => setDialog({ block: person.places[0]?.placeId ?? '' })}>
                  {strings.blockTime}
                </Button>
              )}
            </>
          )
        }
      >
        {isLinked ? (
          <Callout tone="info">{strings.linkedTime(person.name)}</Callout>
        ) : (
          <Table
            label={strings.upcomingTitle}
            columns={[
              { id: 'when', label: strings.from, isRowHeader: true },
              { id: 'what', label: strings.reason, size: 'fill' },
              { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
            ]}
            rows={coming}
            getRowId={(row) => row.id}
            renderCell={(row, column) => {
              if (column === 'when') {
                // On the place's own clock: whole days for time off, the day and its hours for a block.
                const first = formatDate(todayIn(zone, new Date(row.start)), locale);
                if (row.kind === 'block') {
                  const time = (iso: string) =>
                    new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(
                      new Date(iso),
                    );
                  return `${first}, ${strings.range(time(row.start), time(row.end))}`;
                }
                const last = formatDate(todayIn(zone, new Date(Date.parse(row.end) - 1)), locale);
                return first === last ? first : `${first} – ${last}`;
              }
              if (column === 'what') return row.words;
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="x"
                  label={strings.removeTimeOff}
                  onPress={() =>
                    void (
                      row.kind === 'off'
                        ? store.removeTimeOff(slug, 'team', row.id)
                        : store.removeBlock(slug, 'team', row.id)
                    ).then(said)
                  }
                />
              );
            }}
            emptyState={<EmptyState title={strings.noUpcoming} icon="calendar-check" />}
          />
        )}
      </SettingsSection>
      {person.archived ? null : (
        <SettingsSection title={strings.archiveTitle} description={strings.archiveText}>
          <Button icon="archive" onPress={() => setDialog('archive')}>
            {strings.archive}
          </Button>
        </SettingsSection>
      )}
      {dialog === 'time-off' ? (
        <TimeOffDialog
          person={person}
          places={team.places}
          today={today}
          onClose={() => setDialog(undefined)}
          onAdd={async (input) => {
            const refused = await store.addTimeOff(slug, 'team', { staffId: person.id, ...input });
            if (refused === undefined) {
              setDialog(undefined);
              toasts.toast({ tone: 'success', message: strings.timeOffDone(person.name) });
            }
            return refused?.message;
          }}
        />
      ) : null}
      {typeof dialog === 'object' ? (
        <BlockDialog
          person={person}
          place={
            team.places.find((place) => place.id === dialog.block) ??
            team.places[0] ?? { id: '', name: '', timeZone: 'UTC', hours: { weekly: {}, exceptions: [] } }
          }
          day={today}
          locale={locale}
          onClose={() => setDialog(undefined)}
          onAdd={async (input) => {
            const refused = await store.addBlock(slug, 'team', { staffId: person.id, placeId: dialog.block, ...input });
            if (refused === undefined) {
              setDialog(undefined);
              toasts.toast({ tone: 'success', message: strings.blockDone });
            }
            return refused?.message;
          }}
        />
      ) : null}
      <Modal
        variant="confirm"
        title={strings.archiveQuestion(person.name)}
        isOpen={dialog === 'archive'}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              isDisabled={person.upcoming > 0}
              onPress={() => {
                setDialog(undefined);
                void store.archiveStaff(slug, person.id).then((refused) => {
                  if (said(refused) === undefined) {
                    toasts.toast({ tone: 'success', message: strings.staffArchived(person.name) });
                    void navigate({ href: staffSettingsHref(slug) });
                  }
                });
              }}
            >
              {strings.archive}
            </Button>
          </>
        }
      >
        {person.upcoming > 0 ? strings.upcomingBlocks(person.upcoming) : strings.archiveLine}
      </Modal>
    </SettingsPage>
  );
}
