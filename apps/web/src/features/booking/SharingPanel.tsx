// Brief
// Purpose: Sharing on a booking page or a rotation (spec 0037, AC-1331): who besides admins may edit it.
// Main task: an admin adds an editor from a person picker or removes one (asked first); an editor sees who else edits.
// Leaves out: teams as editors (lane L3a), what an editor may do (the server's), and the page's or rotation's own settings.
import { isDataError, type DataLayer, type EditorResource, type EditorView } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Avatar,
  Button,
  EmptyState,
  Modal,
  Select,
  SettingsRow,
  SettingsStack,
  Skeleton,
  focusLater,
  type Toasts,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { sharingStrings as strings } from './sharing-strings.ts';

/** The most editors a page or rotation names (spec 0037's Numbers): the server refuses more with EDITOR_LIMIT. */
const EDITORS_MAX = 20;

/** Someone who may be added: an active member of the workspace. */
export interface SharingPerson {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  /** Their role, when known: owners and admins edit everything already, so they are never offered. */
  readonly role?: string;
}

/** Props for the panel. */
export interface SharingPanelProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly resourceType: EditorResource;
  readonly resourceId: string;
  /** The page's title or the rotation's name, for the remove question. */
  readonly resourceName: string;
  /** The reader may change the editors (`booking.admin`); anyone else reads the list. */
  readonly canChange: boolean;
  /** Who an admin may add (the workspace's members who aren't admins); unused when the reader can't change them. */
  readonly people: readonly SharingPerson[];
  readonly toasts: Toasts;
}

/** By name, as the server lists them, so a row added at once doesn't move when the answer lands. */
const byName = (left: EditorView, right: EditorView) => left.name.localeCompare(right.name);

/**
 * The editors, with Add an editor and each row's Remove for an admin. A change shows at once and the picker and the
 * Remove buttons wait for its answer, so two changes never race each other.
 */
export function SharingPanel({
  data,
  slug,
  resourceType,
  resourceId,
  resourceName,
  canChange,
  people,
  toasts,
}: SharingPanelProps) {
  const view = data.editors.view(slug, resourceType, resourceId);
  const state = useCaptureList(view);
  const [removing, setRemoving] = useState<EditorView | undefined>(undefined);
  // The last person asked about stays named while the confirm plays its exit.
  const [asked, setAsked] = useState<EditorView | undefined>(undefined);
  const [isSaving, setSaving] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const editors = state.status === 'ready' ? state.items : [];
  const save = (next: readonly EditorView[], done: string) => {
    setSaving(true);
    data.editors.set(slug, resourceType, resourceId, [...next].sort(byName)).then(
      () => {
        setSaving(false);
        toasts.toast({ tone: 'success', message: done });
        // A removed row took its button with it: focus goes to the picker once it takes picks again.
        focusLater(() => pickerRef.current);
      },
      (error: unknown) => {
        setSaving(false);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.refused });
      },
    );
  };
  if (state.status === 'loading') return <Skeleton lines={2} />;
  if (state.status === 'error') {
    return <EmptyState tone="error" layout="row" title={strings.failed} onRetry={() => view.reload()} />;
  }
  const held = new Set(editors.map((each) => each.id));
  const addable = people.filter((person) => !held.has(person.id) && person.role !== 'owner' && person.role !== 'admin');
  const isFull = editors.length >= EDITORS_MAX;
  return (
    <SettingsStack>
      {canChange && (
        <Select
          triggerRef={pickerRef}
          label={strings.add}
          isLabelHidden
          savesOnPick
          isSearchable
          placeholder={isFull ? strings.full : addable.length === 0 ? strings.nobodyToAdd : strings.addPlaceholder}
          isDisabled={isSaving || isFull || addable.length === 0}
          items={addable.map((person) => ({
            id: person.id,
            label: person.name,
            ...(person.email === undefined ? {} : { description: person.email }),
            leading: <Avatar name={person.name} id={person.id} size="xs" isDecorative />,
          }))}
          value={null}
          onChange={(id) => {
            const person = addable.find((each) => each.id === id);
            if (person === undefined) return;
            save([...editors, { id: person.id, name: person.name }], strings.added(person.name));
          }}
        />
      )}
      {editors.map((editor) => (
        <SettingsRow
          key={editor.id}
          leading={<Avatar name={editor.name} id={editor.id} size="sm" isDecorative />}
          leadingAlign="center"
          title={editor.name}
        >
          {canChange && (
            <Button
              variant="ghost"
              icon="x"
              label={strings.remove(editor.name)}
              isDisabled={isSaving}
              onPress={() => {
                setAsked(editor);
                setRemoving(editor);
              }}
            />
          )}
        </SettingsRow>
      ))}
      {editors.length === 0 && <EmptyState layout="row" icon="users" title={strings.none} />}
      <Modal
        title={strings.removeTitle(asked?.name ?? '')}
        variant="confirm"
        tone="danger"
        isOpen={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.keep}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                const gone = removing;
                setRemoving(undefined);
                if (gone === undefined) return;
                save(
                  editors.filter((each) => each.id !== gone.id),
                  strings.removed(gone.name),
                );
              }}
            >
              {strings.removeAction}
            </Button>
          </>
        }
      >
        <p>{strings.removeText(asked?.name ?? '', resourceName)}</p>
      </Modal>
    </SettingsStack>
  );
}
