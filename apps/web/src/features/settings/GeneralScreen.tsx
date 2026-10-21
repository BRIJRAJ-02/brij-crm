// Brief
// Purpose: Settings › Workspace › General (spec 0031, AC-822, AC-823): the workspace's name, time zone and address.
// Main task: rename it (Save shows once the name changed) or pick its time zone (saved at once); owners can delete it.
// Leaves out: the logo upload (#32; initials until then), the address (fixed), and members (their own page).
import { isDataError, type DataLayer, type WorkspaceSettings } from '@crm/data';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  InfoTip,
  Select,
  SettingsRow,
  SettingsSection,
  SettingsStack,
  type Toasts,
} from '@crm/ui';
import { useMemo, useState } from 'react';
import { zoneItems, zoneLabel, zoneMatches } from '../booking/hours.ts';
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog.tsx';
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
  /** The workspace was deleted: the route moves the owner on. */
  readonly onDeleted: (name: string) => void;
}

/**
 * One Card of rows (name, time zone, address, logo), Save in the bar only
 * while the name differs, and for owners a Danger zone section with Delete
 * workspace, which opens the typed name confirm.
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
  onDeleted,
}: GeneralScreenProps) {
  const [name, setName] = useState(settings.name);
  const [isSaving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const zones = useMemo(() => zoneItems(settings.timeZone, new Date()), [settings.timeZone]);
  const isDirty = name.trim() !== settings.name;
  const fail = (error: unknown) => {
    toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
  };

  const save = () => {
    if (!isDirty || isSaving) return;
    if (name.trim() === '') {
      setNameError(strings.nameMissing);
      return;
    }
    setSaving(true);
    setNameError(undefined);
    data.workspace
      .update(slug, { name: name.trim() })
      .then(async () => {
        await onChanged();
        toasts.toast({ tone: 'success', message: strings.saved });
      })
      .catch((error: unknown) => {
        setNameError(isDataError(error) ? error.message : strings.somethingWrong);
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
      <SettingsStack>
        <SettingsSection title={strings.workspaceSection}>
          <Card>
            <SettingsRow title={strings.name}>
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
            <SettingsRow
              title={strings.timeZone}
              info={<InfoTip label={strings.timeZone}>{strings.timeZoneInfo}</InfoTip>}
            >
              <Select
                label={strings.timeZone}
                isLabelHidden
                showsDescription
                items={zones}
                filter={zoneMatches}
                isSearchable
                value={settings.timeZone}
                isDisabled={!mayManage || zoneBusy}
                onChange={(zone) => {
                  if (zone !== null && zone !== settings.timeZone) setZone(zone, settings.timeZone, true);
                }}
              />
            </SettingsRow>
            <SettingsRow title={strings.address}>
              <Field
                label={strings.address}
                isLabelHidden
                variant="copy"
                copyLabel={strings.copyAddress}
                value={`${origin}/w/${settings.slug}`}
              />
            </SettingsRow>
            <SettingsRow title={strings.logo}>
              <Avatar name={settings.name} id={settings.id} shape="square" size="lg" isDecorative />
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
      </SettingsStack>
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

/** The page while its route loads: the same Card's rows as skeletons. */
export function GeneralPending() {
  return (
    <SettingsPage title={strings.generalTitle} isLoading>
      <EmptyState title={strings.generalTitle} isLoading />
    </SettingsPage>
  );
}
