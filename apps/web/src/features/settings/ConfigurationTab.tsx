// Brief
// Purpose: an object's Configuration tab: its names and look, its API name and id, and archiving it.
// Main task: owners and admins rename or restyle the object and Save; or archive (or restore) it from the danger zone.
// Leaves out: changing the API name (never, AC-224) and the attributes (the Attributes tab).
import { isDataError, type Hue, type ObjectIcon, type ObjectSummary } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  CopyButton,
  Field,
  Form,
  type FormRefusal,
  SettingsSection,
  SettingsStack,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { ArchiveObjectDialog } from './ArchiveObjectDialog.tsx';
import { ObjectHueField, ObjectIconButton } from './ObjectLookFields.tsx';
import { formRefusals, objectWords } from './refusals.ts';
import { strings } from './strings.ts';

/** The form's field names, as the server names them on its refusals. */
const FIELDS = ['singularName', 'pluralName', 'icon', 'hue'] as const;

/** Props for the Configuration tab. */
export interface ConfigurationTabProps {
  readonly slug: string;
  readonly object: ObjectSummary;
}

/**
 * The Configuration tab: the names and look as a form whose Save is on only
 * when something changed (busy while it waits, the fields kept as typed,
 * refusals on their field or in the banner), the API name and id read only
 * with copy buttons, and the danger zone. Members read it all, with nothing to
 * change.
 */
export function ConfigurationTab({ slug, object }: ConfigurationTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canManage = useCan('schema.manage');
  const formId = useId();
  const [singular, setSingular] = useState(object.singularName);
  const [plural, setPlural] = useState(object.pluralName);
  const [icon, setIcon] = useState<ObjectIcon>(object.icon);
  const [hue, setHue] = useState<Hue>(object.hue);
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const [isArchiving, setArchiving] = useState(false);
  const [isRestoring, setRestoring] = useState(false);
  // What the server holds now: a live change from elsewhere moves it, and the form follows unless edited here.
  const [base, setBase] = useState(object);
  if (base !== object) {
    setBase(object);
    if (singular === base.singularName) setSingular(object.singularName);
    if (plural === base.pluralName) setPlural(object.pluralName);
    if (icon === base.icon) setIcon(object.icon);
    if (hue === base.hue) setHue(object.hue);
  }
  const changes = {
    ...(singular.trim() === object.singularName ? {} : { singularName: singular.trim() }),
    ...(plural.trim() === object.pluralName ? {} : { pluralName: plural.trim() }),
    ...(icon === object.icon ? {} : { icon }),
    ...(hue === object.hue ? {} : { hue }),
  };
  const isChanged = Object.keys(changes).length > 0;

  const save = () => {
    if (isBusy || !isChanged) return;
    const missing = [
      ...(singular.trim() === '' ? ['singularName'] : []),
      ...(plural.trim() === '' ? ['pluralName'] : []),
    ].map((field) => ({ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: field }));
    if (missing.length > 0) {
      setRefusals(missing);
      return;
    }
    setBusy(true);
    setRefusals([]);
    // Only what changed is sent (AC-224); the API name never is.
    data.objects.update(slug, object.id, changes).then(
      (saved) => {
        setBusy(false);
        toasts.toast({ tone: 'success', message: strings.saved(saved.pluralName) });
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, FIELDS, objectWords));
      },
    );
  };

  const restore = () => {
    if (isRestoring) return;
    setRestoring(true);
    data.objects.restore(slug, object.id).then(
      () => {
        setRestoring(false);
        toasts.toast({ tone: 'success', message: strings.restoredToast(object.pluralName) });
        // The Restore button gave way to Archive.
        focusTitle();
      },
      (error: unknown) => {
        setRestoring(false);
        const why = isDataError(error) ? error.message : strings.somethingWrong;
        toasts.toast({ tone: 'danger', message: strings.restoreFailed(object.pluralName, why) });
      },
    );
  };

  return (
    <SettingsStack>
      {!canManage && <Callout>{strings.readOnlyNote}</Callout>}
      <SettingsSection title={strings.lookSection} description={strings.lookSectionText}>
        <Card
          {...(canManage
            ? {
                footer: (
                  <Button
                    variant="primary"
                    type="submit"
                    form={formId}
                    isPending={isBusy}
                    isDisabled={!isChanged}
                    kbd="⌘↵"
                  >
                    {isBusy ? strings.saving : strings.save}
                  </Button>
                ),
              }
            : {})}
        >
          <Form
            id={formId}
            isBusy={isBusy}
            isDisabled={!canManage || !isChanged}
            refusals={refusals}
            fieldFor={(refusal) => refusal.attributeId}
            onSubmit={save}
            label={strings.configurationTab}
            columns={2}
          >
            <Field
              label={strings.singularName}
              prefix={<ObjectIconButton icon={icon} hue={hue} onChange={setIcon} isReadOnly={!canManage} />}
              name="singularName"
              autoComplete="off"
              maxLength={100}
              value={singular}
              onChange={setSingular}
              isReadOnly={!canManage}
              {...(canManage ? {} : { readOnlyReason: strings.readOnlyNote })}
            />
            <Field
              label={strings.pluralName}
              name="pluralName"
              autoComplete="off"
              maxLength={100}
              value={plural}
              onChange={setPlural}
              isReadOnly={!canManage}
              {...(canManage ? {} : { readOnlyReason: strings.readOnlyNote })}
            />
            <ObjectHueField hue={hue} onChange={setHue} isReadOnly={!canManage} />
          </Form>
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.idsSection} description={strings.idsSectionText}>
        <Card>
          <Field
            label={strings.apiName}
            value={object.apiSlug}
            isReadOnly
            readOnlyReason={strings.apiNameLocked}
            suffix={<CopyButton value={object.apiSlug} label={strings.copyApiName} isIconOnly variant="ghost" />}
          />
          <Field
            label={strings.objectId}
            value={object.id}
            isReadOnly
            readOnlyReason={strings.objectIdReason}
            suffix={<CopyButton value={object.id} label={strings.copyObjectId} isIconOnly variant="ghost" />}
          />
        </Card>
      </SettingsSection>
      {canManage && (
        <SettingsSection title={object.isArchived ? strings.restoreZone : strings.dangerZone}>
          {object.isArchived ? (
            <Card
              title={strings.dangerRestore(object.pluralName)}
              description={strings.dangerRestoreText}
              actions={
                <Button icon="archive-restore" isPending={isRestoring} onPress={restore}>
                  {isRestoring ? strings.restoring : strings.restore}
                </Button>
              }
            />
          ) : (
            <Card
              title={strings.dangerArchive(object.pluralName)}
              description={strings.dangerArchiveText}
              actions={
                <Button variant="danger" icon="archive" onPress={() => setArchiving(true)}>
                  {strings.archive}
                </Button>
              }
            />
          )}
        </SettingsSection>
      )}
      <ArchiveObjectDialog
        data={data}
        slug={slug}
        object={isArchiving ? object : undefined}
        onClose={() => setArchiving(false)}
        onArchived={(archived) => {
          setArchiving(false);
          toasts.toast({ tone: 'success', message: strings.archivedToast(archived.pluralName) });
          // The Archive button gave way to Restore.
          focusTitle();
        }}
      />
    </SettingsStack>
  );
}
