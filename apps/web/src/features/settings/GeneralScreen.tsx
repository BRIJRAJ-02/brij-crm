// Brief
// Purpose: Settings › Workspace › General (spec 0031, AC-822, AC-823): the workspace's name, web address and time zone.
// Main task: rename it (saved once the edit ends, with Undo), copy its link or move it to a new address (Change opens its
// own dialog), or pick its time zone (saved at once, with Undo); owners can delete it.
// Leaves out: a SaveBar and a leave check (each change saves at once, the owner's save rule of 21 October 2026), the
// logo (no row until upload arrives with #32), and members (their own page).
import { isDataError, type DataLayer, type WorkspaceSettings } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  CopyButton,
  Field,
  InfoTip,
  Select,
  SettingsRow,
  SettingsSection,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useMemo, useRef, useState } from 'react';
import { zoneItems, zoneLabel, zoneMatches } from '../booking/hours.ts';
import { ChangeAddressDialog } from './ChangeAddressDialog.tsx';
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog.tsx';
import { nameEdit } from './general-form.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { strings } from './workspace-strings.ts';

/** Props for the General page. */
export interface GeneralScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly settings: WorkspaceSettings;
  /** Whether the reader may rename it, move it and change its time zone (`workspace.manage`). */
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
 * For readers without `workspace.manage`, one read only Callout first (the fields keep their locks). Then a Details
 * Card of rows: the name, saved on Enter or on leaving the field once it changed, with "Name changed." and Undo (an
 * empty name says so on the field, and Esc puts the saved one back); the web address as its whole link with Copy,
 * and Change for owners and admins, which opens the address dialog; and the time zone, saved at once with Undo.
 * For owners, a Danger zone section with Delete workspace, which opens the typed name confirm.
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
  // The name as typed, while it differs from the saved one; left out, the field shows the saved name.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  // The name on its way, so Enter and then leaving the field send it once.
  const sending = useRef<string | undefined>(undefined);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  // Change opens the address dialog afresh each time (its key), so it starts from the address now.
  const [moving, setMoving] = useState({ isOpen: false, opened: 0 });
  const zones = useMemo(() => zoneItems(settings.timeZone, new Date()), [settings.timeZone]);
  const link = `${origin}/w/${settings.slug}`;
  const fail = (error: unknown) => {
    toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
  };

  /** Renames it to `name`; `previous` is what Undo puts back, and Undo itself offers none. */
  const rename = (name: string, previous: string | undefined, typed: string) => {
    sending.current = name;
    data.workspace
      .update(slug, { name })
      .then(async () => {
        await onChanged();
        // The field shows the saved name again, unless typing went on meanwhile.
        setDraft((current) => (current === typed ? undefined : current));
        toasts.toast({
          tone: 'success',
          message: strings.nameChanged,
          ...(previous === undefined
            ? {}
            : {
                action: {
                  label: strings.undo,
                  onAction: () => {
                    rename(previous, undefined, previous);
                  },
                },
              }),
        });
      })
      .catch((error: unknown) => {
        // Said on the field, the typed name kept to fix; Esc puts the saved one back.
        if (previous === undefined) fail(error);
        else setNameError(isDataError(error) ? error.message : strings.somethingWrong);
      })
      .finally(() => {
        sending.current = undefined;
      });
  };
  // An edit of the name ends (Enter, or focus leaving the field): saved when it changed, said when it is empty.
  const endNameEdit = () => {
    if (!mayManage || draft === undefined) return;
    const edit = nameEdit(settings.name, draft);
    if (edit.kind === 'missing') {
      setNameError(strings.nameMissing);
      return;
    }
    if (edit.kind === 'same') {
      setDraft(undefined);
      return;
    }
    if (sending.current === edit.name) return;
    rename(edit.name, settings.name, draft);
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
    <SettingsPage title={strings.generalTitle}>
      {/* Why the fields are locked, said once for the page rather than on each field. */}
      {!mayManage && <Callout>{strings.readOnly}</Callout>}
      <SettingsSection title={strings.workspaceSection}>
        <Card>
          <SettingsRow title={strings.name} control="field">
            <Field
              label={strings.name}
              isLabelHidden
              value={draft ?? settings.name}
              onChange={(next) => {
                setDraft(next);
                setNameError(undefined);
              }}
              onSubmit={endNameEdit}
              onBlur={endNameEdit}
              onEscape={() => {
                setDraft(undefined);
                setNameError(undefined);
              }}
              maxLength={64}
              isReadOnly={!mayManage}
              {...(nameError === undefined ? {} : { error: nameError })}
            />
          </SettingsRow>
          {/* Read only: moving everyone is rare, so it has its own dialog, never an always editable field. */}
          <SettingsRow title={strings.webAddress} description={link}>
            <CopyButton value={link} label={strings.copyAddress} isLabelCollapsible />
            {mayManage && (
              <Button
                onPress={() => {
                  setMoving((was) => ({ isOpen: true, opened: was.opened + 1 }));
                }}
              >
                {strings.changeAddress}
              </Button>
            )}
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
              isDisabled={zoneBusy}
              onChange={(zone) => {
                if (zone !== null && zone !== settings.timeZone) setZone(zone, settings.timeZone, true);
              }}
            />
          </SettingsRow>
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
          key={moving.opened}
          data={data}
          toasts={toasts}
          slug={settings.slug}
          isOpen={moving.isOpen}
          onClose={() => {
            setMoving((was) => ({ ...was, isOpen: false }));
          }}
          onMoved={onMoved}
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

/** The page while its route loads: its rows as they will stand, each control's box a Skeleton. */
export function GeneralPending() {
  // Change and the danger zone only for those who get them; held back while access still loads, they may arrive late.
  const mayManage = useCan('workspace.manage');
  const mayDelete = useCan('workspace.delete');
  return (
    <SettingsPage title={strings.generalTitle} isLoading>
      <SettingsSection title={strings.workspaceSection}>
        <Card isBusy>
          <SettingsRow title={strings.name} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.webAddress} description={<Skeleton width="long" />}>
            <CopyButton value="" label={strings.copyAddress} isLabelCollapsible isDisabled />
            {mayManage && <Button isDisabled>{strings.changeAddress}</Button>}
          </SettingsRow>
          <SettingsRow title={strings.timeZone} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
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
