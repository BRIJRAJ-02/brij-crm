// Brief
// Purpose: Settings › Workspace › General (spec 0031, AC-822, AC-823): the workspace's name, web address and time zone.
// Main task: rename it (saved when the field is left or on Enter, with Undo), change its address (its own dialog), or
// pick its time zone (saved at once, with Undo); owners can delete it.
// Leaves out: a Save bar and a leave check (each change saves on its own), the logo (no row until upload arrives with #32), and members (their own page).
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { zoneItems, zoneLabel, zoneMatches } from '../booking/hours.ts';
import { ChangeAddressDialog } from './ChangeAddressDialog.tsx';
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog.tsx';
import { nameCommit } from './general-form.ts';
import { useCan, useMyAccess } from '../workspace/WorkspacePage.tsx';
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
 * A Card of rows, each saving on its own (the owner's save rule, 21 October 2026): the name, saved when the field is
 * left, on Enter or when the page goes with it still typed, with "Name changed." and Undo (an empty name is refused on
 * the field, and Esc puts it back; a failure for any other reason is also a toast, as focus may have left); the
 * web address as its whole link with Copy, and Change, which opens the address dialog; the time zone, saved at once
 * with Undo. Readers who can't change them get one note at the top and locked fields. Owners also get a Danger zone
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
  // The name as typed, until the page reads the saved one back; left undefined, the field shows what is saved.
  const [nameDraft, setNameDraft] = useState<string | undefined>(undefined);
  const name = nameDraft ?? settings.name;
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  // The name on its way, so Enter and then leaving the field send it once.
  const sending = useRef<string | undefined>(undefined);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [isChanging, setChanging] = useState(false);
  // A fresh address dialog per opening, so its field starts from the address again.
  const [opened, setOpened] = useState(0);
  const [isDeleting, setDeleting] = useState(false);
  const zones = useMemo(() => zoneItems(settings.timeZone, new Date()), [settings.timeZone]);
  const link = `${origin}/w/${settings.slug}`;
  const fail = (error: unknown) => {
    toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
  };

  // Renames it, then reads the settings back; Undo is the same rename the other way, with no Undo of its own.
  const rename = (to: string, from: string, withUndo: boolean) => {
    sending.current = to;
    data.workspace
      .update(slug, { name: to })
      .then(async () => {
        await onChanged();
        // The field shows the saved name again, unless more was typed meanwhile.
        setNameDraft((typed) => (typed === undefined || typed.trim() === to ? undefined : typed));
        toasts.toast({
          tone: 'success',
          message: strings.nameChanged,
          ...(withUndo
            ? {
                action: {
                  label: strings.undo,
                  onAction: () => {
                    rename(from, to, false);
                  },
                },
              }
            : {}),
        });
      })
      .catch((error: unknown) => {
        // Refused or lost: the typed name stays in the field for Enter to try again. A refusal of the name says why on
        // the field; anything else is a toast too, said even after focus has left the field.
        const isNameRefused =
          isDataError(error) && error.data?.refusals?.some((each) => each.field === 'name') === true;
        if (isNameRefused) {
          setNameError(error.message);
          return;
        }
        setNameError(strings.nameNotSaved);
        fail(error);
      })
      .finally(() => {
        sending.current = undefined;
      });
  };
  const commitName = () => {
    if (!mayManage) return;
    const commit = nameCommit(settings.name, name);
    if (commit.kind === 'missing') {
      setNameError(strings.nameMissing);
      return;
    }
    setNameError(undefined);
    if (commit.kind === 'same') {
      setNameDraft(undefined);
      return;
    }
    if (sending.current === commit.name) return;
    rename(commit.name, settings.name, true);
  };
  // A name still typed when the page goes (Back, a link from the keyboard) is saved as leaving the field would: not
  // every browser says the field was left as it is taken away.
  const commitOnLeave = useRef(commitName);
  useEffect(() => {
    commitOnLeave.current = commitName;
  });
  useEffect(
    () => () => {
      commitOnLeave.current();
    },
    [],
  );

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
      {/* Said once for the page; each field keeps its lock. */}
      {!mayManage && <Callout tone="info">{strings.readOnly}</Callout>}
      <SettingsSection title={strings.workspaceSection}>
        <Card>
          <SettingsRow title={strings.name} control="field">
            <Field
              label={strings.name}
              isLabelHidden
              value={name}
              onChange={(next) => {
                setNameDraft(next);
                setNameError(undefined);
              }}
              onBlur={commitName}
              onSubmit={commitName}
              onEscape={() => {
                setNameDraft(undefined);
                setNameError(undefined);
              }}
              maxLength={64}
              isReadOnly={!mayManage}
              {...(nameError === undefined ? {} : { error: nameError })}
            />
          </SettingsRow>
          <SettingsRow
            title={strings.webAddress}
            // The whole link under the row's title, with its copy; changing it is rare and moves everyone, so it
            // happens in its own dialog (SS-G3).
            description={
              <>
                {link} <CopyButton value={link} label={strings.copyAddress} isIconOnly variant="ghost" size="sm" />
              </>
            }
          >
            {mayManage && (
              <Button
                label={strings.changeAddressLabel}
                onPress={() => {
                  setOpened((count) => count + 1);
                  setChanging(true);
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
          key={opened}
          data={data}
          slug={slug}
          from={settings.slug}
          isOpen={isChanging}
          onClose={() => setChanging(false)}
          onMoved={async (to) => {
            toasts.toast({ tone: 'success', message: strings.moved(to) });
            await onMoved(to);
          }}
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
  // Change and the danger zone only for those who get them, the read only note only for those who don't; each
  // held back while access still loads, so it may then arrive late.
  const access = useMyAccess();
  const mayManage = useCan('workspace.manage');
  const mayDelete = useCan('workspace.delete');
  return (
    <SettingsPage title={strings.generalTitle} isLoading>
      {access !== undefined && !mayManage && <Callout tone="info">{strings.readOnly}</Callout>}
      <SettingsSection title={strings.workspaceSection}>
        <Card isBusy>
          <SettingsRow title={strings.name} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
          <SettingsRow title={strings.webAddress} description={<Skeleton width="long" />}>
            {mayManage && (
              <Button label={strings.changeAddressLabel} isDisabled>
                {strings.changeAddress}
              </Button>
            )}
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
