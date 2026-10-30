// Brief
// Purpose: an object's Configuration tab: its names and look, the attribute its records are named by, its API name
// and id, and archiving it.
// Main task: owners and admins rename or restyle the object and save from the SaveBar at the view's foot, pick a
// custom object's name attribute; or archive (or restore) it from the danger zone.
// Leaves out: changing the API name (never, AC-224) and the attributes (the Attributes tab).
import {
  canNameRecords,
  isDataError,
  type AttributeDefinition,
  type Hue,
  type ObjectIcon,
  type ObjectSummary,
} from '@crm/data';
import {
  Button,
  Callout,
  Card,
  CopyButton,
  Field,
  iconOf,
  InfoTip,
  Form,
  type FormRefusal,
  SaveBar,
  type SaveBarStatus,
  Select,
  SettingsRow,
  SettingsSection,
  SettingsStack,
  typeLabelOf,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { pageHeading } from '../navigation/focus.ts';
import { focusTitle } from '../navigation/focus-title.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { ArchiveObjectDialog } from './ArchiveObjectDialog.tsx';
import { ObjectHueField, ObjectIconButton } from './ObjectLookFields.tsx';
import { formRefusals, objectWords } from './refusals.ts';
import { strings } from './strings.ts';

/** The form's field names, as the server names them on its refusals. */
const FIELDS = ['singularName', 'pluralName', 'icon', 'hue'] as const;

/**
 * The object's names and look as edited, held by the object's page (not the tab), so the SaveBar at the view's foot
 * says "Unsaved changes" on either tab and a tab change keeps what was typed.
 */
export interface ObjectConfiguration {
  readonly singular: string;
  readonly plural: string;
  readonly icon: ObjectIcon;
  readonly hue: Hue;
  readonly setSingular: (value: string) => void;
  readonly setPlural: (value: string) => void;
  readonly setIcon: (value: ObjectIcon) => void;
  readonly setHue: (value: Hue) => void;
  readonly isBusy: boolean;
  readonly isChanged: boolean;
  readonly refusals: readonly FormRefusal[];
  readonly save: () => void;
  /** The SaveBar for the page's footer; undefined for a reader who may not change the object. */
  readonly footer: ReactNode;
}

/**
 * The names and look of an object being edited, and their SaveBar: Save on only when something changed (busy while
 * it waits, the fields kept as typed, refusals on their field or in the form's banner), Discard putting back what the
 * server holds. A live change from elsewhere moves the fields that weren't edited here.
 */
export function useObjectConfiguration(slug: string, object: ObjectSummary): ObjectConfiguration {
  const { data } = useRouteContext({ from: '__root__' });
  const canManage = useCan('schema.manage');
  const [singular, setSingular] = useState(object.singularName);
  const [plural, setPlural] = useState(object.pluralName);
  const [icon, setIcon] = useState<ObjectIcon>(object.icon);
  const [hue, setHue] = useState<Hue>(object.hue);
  const [isBusy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
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
  const isNameMissing = singular.trim() === '' || plural.trim() === '';

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
      () => {
        setBusy(false);
        setJustSaved(true);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, FIELDS, objectWords));
      },
    );
  };
  // An edit starts afresh: no "Saved", no failure said for the last answer.
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setJustSaved(false);
    };
  const failure = refusals[0]?.message;
  const status: SaveBarStatus = isBusy
    ? 'saving'
    : isChanged
      ? failure === undefined
        ? 'unsaved'
        : 'error'
      : justSaved
        ? 'saved'
        : 'hidden';
  const footer = canManage ? (
    <SaveBar
      status={status}
      {...(failure === undefined ? {} : { error: failure })}
      {...(isNameMissing && isChanged ? { blockedReason: strings.nameMissing } : {})}
      onSave={save}
      onDiscard={() => {
        setSingular(object.singularName);
        setPlural(object.pluralName);
        setIcon(object.icon);
        setHue(object.hue);
        setRefusals([]);
      }}
      onFocusAway={() => pageHeading(document)?.focus()}
    />
  ) : undefined;
  return {
    singular,
    plural,
    icon,
    hue,
    setSingular: edited(setSingular),
    setPlural: edited(setPlural),
    setIcon: edited(setIcon),
    setHue: edited(setHue),
    isBusy,
    isChanged,
    refusals,
    save,
    footer,
  };
}

/** Props for the Configuration tab. */
export interface ConfigurationTabProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The names and look as edited, from useObjectConfiguration on the object's page. */
  readonly configuration: ObjectConfiguration;
  /**
   * The object's live attributes, for its name attribute: `unavailable` when they couldn't be read (the choice shows
   * read only, saying so), undefined while the object is archived (they come back with it).
   */
  readonly attributes: readonly AttributeDefinition[] | 'unavailable' | undefined;
}

/** Props for the name attribute's row. */
interface RecordNameRowProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[] | 'unavailable';
}

/**
 * The attribute that names the object's records (late trap #15), saved as it is picked, as General's time zone is:
 * it changes no record, only how each one reads, and Undo in its toast puts the old one back. Only the attributes
 * that can name records are offered (`canNameRecords`, the engine's own rule). A standard object's stays its Name,
 * read only with the reason, as it is for someone who may not shape the schema.
 */
function RecordNameRow({ slug, object, attributes }: RecordNameRowProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canManage = useCan('schema.manage');
  const current = object.primaryAttributeId;
  // What the row shows: the choice from the moment it is picked (put back on a refusal), and the server's once a
  // change from elsewhere arrives (another admin's, or this save read back).
  const [chosen, setChosen] = useState(current);
  const [base, setBase] = useState(current);
  if (base !== current) {
    setBase(current);
    setChosen(current);
  }
  // The name attribute as shown now and whether a save is out, for an Undo pressed later (refs, as the toast
  // outlives the render it came from): never over a newer change, nor beside one still on its way.
  const shown = useRef(chosen);
  const sending = useRef(false);
  useEffect(() => {
    shown.current = chosen;
  });
  // The last saved toast: a newer pick closes it as it starts, and so does leaving the tab, so no older Undo is left
  // to press (General's Q99).
  const lastSaved = useRef<string | undefined>(undefined);
  const closeSaved = () => {
    if (lastSaved.current !== undefined) toasts.dismiss(lastSaved.current);
    lastSaved.current = undefined;
  };
  useEffect(
    () => () => {
      if (lastSaved.current !== undefined) toasts.dismiss(lastSaved.current);
    },
    [toasts],
  );
  const known = attributes === 'unavailable' ? [] : attributes;
  const items = known
    .filter((attribute) => attribute.id === current || canNameRecords(attribute))
    .map((attribute) => ({
      id: attribute.id,
      label: attribute.title,
      icon: iconOf(attribute),
      description: typeLabelOf(attribute.type),
    }));
  const titleOf = (id: string | undefined) => known.find((attribute) => attribute.id === id)?.title ?? '';
  // Someone who may not shape the schema gets the lock alone: the tab's own Callout says why, once for the page.
  const readOnlyReason =
    attributes === 'unavailable'
      ? canManage
        ? strings.recordNameUnavailable
        : undefined
      : object.isStandard
        ? strings.recordNameStandard(titleOf(current))
        : canManage && items.length < 2
          ? strings.recordNameNone
          : undefined;
  const isReadOnly = readOnlyReason !== undefined || !canManage || attributes === 'unavailable';

  const fail = (error: unknown) => {
    const why = isDataError(error) ? error.message : strings.somethingWrong;
    toasts.toast({ tone: 'danger', message: strings.recordNameFailed(why) });
  };

  // Undo only while the object still holds this change, read through the data layer (another admin's change since
  // wins), and never beside a save still on its way.
  const undo = (from: string, to: string) => {
    const stale = () => {
      toasts.toast({ tone: 'info', message: strings.recordNameUndoStale });
    };
    if (sending.current || shown.current !== to) {
      stale();
      return;
    }
    data.objects
      .all(slug)
      .then((list) => {
        const now = list.find((each) => each.id === object.id)?.primaryAttributeId;
        if (sending.current || now !== to) stale();
        else choose(from, false);
      })
      .catch(fail);
  };

  const choose = (to: string, withUndo: boolean) => {
    const from = shown.current;
    closeSaved();
    sending.current = true;
    setChosen(to);
    shown.current = to;
    data.objects.update(slug, object.id, { primaryAttributeId: to }).then(
      () => {
        sending.current = false;
        lastSaved.current = toasts.toast({
          tone: 'success',
          message: strings.recordNameChanged(object.pluralName, titleOf(to)),
          ...(withUndo && from !== undefined
            ? {
                action: {
                  label: strings.undo,
                  onAction: () => {
                    undo(from, to);
                  },
                },
              }
            : {}),
        });
      },
      (error: unknown) => {
        sending.current = false;
        if (shown.current === to) setChosen(from);
        fail(error);
      },
    );
  };

  return (
    <SettingsRow title={strings.recordNameTitle} description={strings.recordNameText} control="field">
      <Select
        label={strings.recordNameTitle}
        isLabelHidden
        items={items}
        value={chosen ?? null}
        isReadOnly={isReadOnly}
        {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
        // Never disabled while a save is out, so focus stays on the field: a second pick waits for the first.
        onChange={(id) => {
          if (id !== null && id !== chosen && !sending.current) choose(id, true);
        }}
      />
    </SettingsRow>
  );
}

/**
 * The Configuration tab: the names and look as a form (saved from the SaveBar at the view's foot), the attribute its
 * records are named by (saved as it is picked), the API name and id read only with copy buttons, and the danger
 * zone. Members read it all, with nothing to change.
 */
export function ConfigurationTab({ slug, object, configuration, attributes }: ConfigurationTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canManage = useCan('schema.manage');
  const formId = useId();
  const { singular, plural, icon, hue, setSingular, setPlural, setIcon, setHue, isBusy, isChanged, refusals, save } =
    configuration;
  const [isArchiving, setArchiving] = useState(false);
  const [isRestoring, setRestoring] = useState(false);

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
      <SettingsSection title={strings.lookSection}>
        <Card>
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
            />
            <Field
              label={strings.pluralName}
              name="pluralName"
              autoComplete="off"
              maxLength={100}
              value={plural}
              onChange={setPlural}
              isReadOnly={!canManage}
            />
            <ObjectHueField hue={hue} onChange={setHue} isReadOnly={!canManage} />
          </Form>
        </Card>
      </SettingsSection>
      {attributes !== undefined && (
        <SettingsSection title={strings.recordNameSection}>
          <Card>
            <RecordNameRow slug={slug} object={object} attributes={attributes} />
          </Card>
        </SettingsSection>
      )}
      <SettingsSection title={strings.idsSection}>
        <Card>
          <Field
            label={strings.apiName}
            info={
              <InfoTip label={strings.apiName} example={strings.idsExample}>
                {strings.idsHelp}
              </InfoTip>
            }
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
