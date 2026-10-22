// Brief
// Purpose: Settings › Workspace › General (spec 0031, AC-822, AC-823): the workspace's name, time zone and address.
// Main task: rename it or move its web address (one Save, shown once either changed; a new address asks first), or
// pick its time zone (saved at once); owners can delete it.
// Leaves out: the logo (no row until upload arrives with #32), and members (their own page).
import { isDataError, type DataLayer, type WorkspaceSettings } from '@crm/data';
import {
  Button,
  Card,
  Field,
  Icon,
  InfoTip,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Spinner,
  VisuallyHidden,
  type Toasts,
} from '@crm/ui';
import { useBlocker } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { addressAsTyped, addressCandidates, SLUG_MAX } from '../address/address.ts';
import { useAddress, type Address } from '../address/useAddress.ts';
import { zoneItems, zoneLabel, zoneMatches } from '../booking/hours.ts';
import { ChangeAddressDialog } from './ChangeAddressDialog.tsx';
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog.tsx';
import { generalChange, isChanged } from './general-form.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { strings } from './workspace-strings.ts';

/** Props for the General page. */
export interface GeneralScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly settings: WorkspaceSettings;
  /** Whether the reader may rename it and change its time zone (`workspace.manage`). */
  readonly mayManage: boolean;
  /** Whether the reader may delete it (`workspace.delete`, owners). */
  readonly mayDelete: boolean;
  /** The app's address, for the workspace's full link. */
  readonly origin: string;
  /** A change landed: the route reads the settings again. */
  readonly onChanged: () => Promise<void>;
  /** The workspace moved to a new address: the route opens this page there. */
  readonly onMoved: (slug: string) => Promise<void>;
  /** The workspace was deleted: the route moves the owner on. */
  readonly onDeleted: (name: string) => void;
}

/**
 * A Card of rows (name, web address, time zone), the whole link in a Card of
 * its own, Save in the bar only while the name or the address differs (a new
 * address opens the confirm first), and for owners a Danger zone section
 * with Delete workspace, which opens the typed name confirm.
 */
export function GeneralScreen({
  data,
  toasts,
  slug,
  settings,
  mayManage,
  mayDelete,
  origin,
  onChanged,
  onMoved,
  onDeleted,
}: GeneralScreenProps) {
  const [name, setName] = useState(settings.name);
  const [slugDraft, setSlugDraft] = useState(settings.slug);
  const [isSaving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [slugError, setSlugError] = useState<string | undefined>(undefined);
  const [isConfirming, setConfirming] = useState(false);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  // Set once a new address saved, so moving to it isn't stopped by the leave check (the drafts still differ).
  const isLeaving = useRef(false);
  const zones = useMemo(() => zoneItems(settings.timeZone, new Date()), [settings.timeZone]);
  // The address checked as typed, through the one address check; the workspace's own address counts as free.
  const check = useCallback(
    (candidate: string) =>
      candidate === settings.slug ? Promise.resolve(true) : data.workspaces.slugAvailable(candidate),
    [data, settings.slug],
  );
  const candidates = useMemo(
    () => addressCandidates(slugDraft.replaceAll('-', ' '), '').filter((each) => each !== settings.slug),
    [slugDraft, settings.slug],
  );
  const address = useAddress(check, candidates, slugDraft);
  const change = mayManage ? generalChange(settings, name, slugDraft) : {};
  const isDirty = isChanged(change);
  // Unsaved changes aren't lost by leaving the page without a word.
  useBlocker({
    shouldBlockFn: () => isDirty && !isLeaving.current && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => isDirty && !isLeaving.current,
  });
  const fail = (error: unknown) => {
    toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
  };

  // Save: the fields are checked here first, and a new address asks before anything is sent.
  const save = () => {
    if (!isDirty || isSaving) return;
    const nameProblem = change.name === '' ? strings.nameMissing : undefined;
    const slugProblem =
      change.slug === undefined
        ? undefined
        : address.state === 'invalid'
          ? strings.addressInvalid
          : address.state === 'taken'
            ? strings.addressTakenSaid(change.slug)
            : undefined;
    setNameError(nameProblem);
    setSlugError(slugProblem);
    if (nameProblem !== undefined || slugProblem !== undefined) return;
    if (change.slug !== undefined) setConfirming(true);
    else commit();
  };
  const commit = () => {
    if (isSaving) return;
    setSaving(true);
    data.workspace
      .update(slug, change)
      .then(async (updated) => {
        setConfirming(false);
        if (updated.slug !== slug) {
          isLeaving.current = true;
          toasts.toast({ tone: 'success', message: strings.moved(updated.slug) });
          await onMoved(updated.slug);
          return;
        }
        await onChanged();
        toasts.toast({ tone: 'success', message: strings.saved });
      })
      .catch((error: unknown) => {
        setConfirming(false);
        isLeaving.current = false;
        const message = isDataError(error) ? error.message : strings.somethingWrong;
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        if (isDataError(error) && (error.code === 'SLUG_TAKEN' || field === 'slug')) setSlugError(message);
        else if (field === 'name') setNameError(message);
        else toasts.toast({ tone: 'danger', message });
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const setZone = (zone: string, previous: string, withUndo: boolean) => {
    setZoneBusy(true);
    data.workspace
      .update(slug, { timeZone: zone })
      .then(async () => {
        await onChanged();
        toasts.toast({
          tone: 'success',
          message: strings.zoneChanged(zoneLabel(zone)),
          ...(withUndo
            ? {
                action: {
                  label: strings.undo,
                  onAction: () => {
                    setZone(previous, zone, false);
                  },
                },
              }
            : {}),
        });
      })
      .catch(fail)
      .finally(() => {
        setZoneBusy(false);
      });
  };

  return (
    <SettingsPage
      title={strings.generalTitle}
      actions={
        mayManage && isDirty ? (
          <Button variant="primary" isPending={isSaving} onPress={save}>
            {strings.save}
          </Button>
        ) : undefined
      }
    >
      <SettingsSection title={strings.workspaceSection}>
        <Card>
          <SettingsRow title={strings.name} control="field">
            <Field
              label={strings.name}
              isLabelHidden
              value={name}
              onChange={(next) => {
                setName(next);
                setNameError(undefined);
              }}
              onSubmit={save}
              maxLength={64}
              isReadOnly={!mayManage}
              {...(mayManage ? {} : { readOnlyReason: strings.readOnly })}
              {...(nameError === undefined ? {} : { error: nameError })}
            />
          </SettingsRow>
          <SettingsRow title={strings.webAddress} control="field">
            <AddressField
              value={slugDraft}
              saved={settings.slug}
              address={address}
              mayManage={mayManage}
              error={slugError}
              onChange={(next) => {
                setSlugDraft(next);
                setSlugError(undefined);
              }}
              onSubmit={save}
            />
          </SettingsRow>
          <SettingsRow
            title={strings.timeZone}
            control="field"
            meta={<InfoTip label={strings.timeZone}>{strings.timeZoneInfo}</InfoTip>}
          >
            <Select
              label={strings.timeZone}
              isLabelHidden
              showsDescription
              items={zones}
              filter={zoneMatches}
              isSearchable
              value={settings.timeZone}
              isReadOnly={!mayManage}
              {...(mayManage ? {} : { readOnlyReason: strings.readOnly })}
              isDisabled={zoneBusy}
              onChange={(zone) => {
                if (zone !== null && zone !== settings.timeZone) setZone(zone, settings.timeZone, true);
              }}
            />
          </SettingsRow>
        </Card>
        {/* The whole link in a Card of its own, wrapping where it must: a row's end would cut it off. */}
        <Card title={strings.address}>
          <Field
            label={strings.address}
            isLabelHidden
            variant="copy"
            isWrapping
            copyLabel={strings.copyAddress}
            value={`${origin}/w/${settings.slug}`}
          />
        </Card>
      </SettingsSection>
      {mayDelete && (
        <SettingsSection title={strings.danger}>
          <Card>
            <SettingsRow title={strings.deleteRow} description={strings.deleteRowText}>
              <Button variant="danger" onPress={() => setDeleting(true)}>
                {strings.deleteAction}
              </Button>
            </SettingsRow>
          </Card>
        </SettingsSection>
      )}
      {mayManage && (
        <ChangeAddressDialog
          from={settings.slug}
          to={slugDraft}
          isOpen={isConfirming}
          isBusy={isSaving}
          onClose={() => setConfirming(false)}
          onConfirm={commit}
        />
      )}
      {mayDelete && (
        <DeleteWorkspaceDialog
          data={data}
          slug={slug}
          name={settings.name}
          isOpen={isDeleting}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onDeleted(settings.name);
          }}
        />
      )}
    </SettingsPage>
  );
}

/** Props for the web address field. */
interface AddressFieldProps {
  readonly value: string;
  /** The address saved now: no check, hint or mark while the field still holds it. */
  readonly saved: string;
  readonly address: Address;
  readonly mayManage: boolean;
  /** Save's refusal, or the server's. */
  readonly error: string | undefined;
  readonly onChange: (slug: string) => void;
  readonly onSubmit: () => void;
}

/**
 * The address after a quiet "/w/", checked as typed the way first run checks
 * it (a spinner while it asks, a tick and "Available", "Taken" on the field
 * with free ones to pick under it), and read only, with who may change it,
 * to everyone else.
 */
function AddressField({ value, saved, address, mayManage, error, onChange, onSubmit }: AddressFieldProps) {
  const isEdited = mayManage && value !== saved;
  const state = isEdited ? address.state : undefined;
  const suggestions = isEdited ? address.suggestions : [];
  const hint =
    state === 'invalid'
      ? strings.addressRule
      : state === 'checking'
        ? strings.addressChecking
        : state === 'free'
          ? strings.addressFree
          : state === 'unknown'
            ? strings.addressUnknown
            : undefined;
  const shown = error ?? (state === 'taken' ? strings.addressTaken : undefined);
  // A refusal outranks the check's answer: no tick beside it, and no "Available" said.
  const settled = error === undefined ? state : undefined;
  return (
    <>
      <Field
        label={strings.webAddress}
        isLabelHidden
        autoComplete="off"
        maxLength={SLUG_MAX}
        prefix={strings.addressPrefix}
        value={value}
        onChange={(next) => {
          onChange(addressAsTyped(next));
        }}
        onSubmit={onSubmit}
        isReadOnly={!mayManage}
        {...(mayManage ? {} : { readOnlyReason: strings.readOnly })}
        {...(hint === undefined || shown !== undefined ? {} : { hint })}
        {...(shown === undefined ? {} : { error: shown })}
        {...(suggestions.length === 0
          ? {}
          : { suggestions: { label: strings.addressSuggestions, items: suggestions, onPick: onChange } })}
        {...(settled === 'checking'
          ? { suffix: <Spinner size="sm" label={strings.addressChecking} /> }
          : settled === 'free'
            ? { suffix: <Icon name="circle-check" size="sm" tone="success" /> }
            : {})}
      />
      {/* The answer is said once it settles, and a refusal when it comes; the field carries each on screen. */}
      <VisuallyHidden>
        <span role="status">
          {error !== undefined
            ? error
            : settled === 'free' || settled === 'taken'
              ? [
                  settled === 'free' ? strings.addressFreeSaid(value) : strings.addressTakenSaid(value),
                  ...(suggestions.length > 0 ? [strings.addressOthers(suggestions)] : []),
                ].join(' ')
              : ''}
        </span>
      </VisuallyHidden>
    </>
  );
}

/** The page while its route loads: its rows as they will stand, each control's box a Skeleton. */
export function GeneralPending() {
  // The danger zone only for those who get it; held back while access still loads, it may then arrive late.
  const mayDelete = useCan('workspace.delete');
  return (
    <SettingsPage title={strings.generalTitle} isLoading>
      <SettingsSection title={strings.workspaceSection}>
        <Card isBusy>
          <SettingsRow title={strings.name} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.webAddress} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.timeZone} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
        </Card>
        <Card title={strings.address} isBusy>
          <Skeleton shape="field" width="full" />
        </Card>
      </SettingsSection>
      {mayDelete && (
        <SettingsSection title={strings.danger}>
          <Card>
            <SettingsRow title={strings.deleteRow} description={strings.deleteRowText}>
              <Button variant="danger" isDisabled>
                {strings.deleteAction}
              </Button>
            </SettingsRow>
          </Card>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
