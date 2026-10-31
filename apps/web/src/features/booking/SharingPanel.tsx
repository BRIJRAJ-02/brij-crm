// Brief
// Purpose: Sharing on a booking page or a rotation (spec 0037, AC-1331): who besides admins may edit it.
// Main task: an admin adds an editor from a person picker or removes one (asked first); an editor sees who else edits.
// Leaves out: teams as editors (lane L3a), what an editor may do (the server's), and the page's or rotation's own settings.
import type { DataLayer, EditorResource, EditorView } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Modal,
  Select,
  SettingsRow,
  Skeleton,
  focusLater,
  type Toasts,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { sharingStrings as strings } from './sharing-strings.ts';

/** The most editors a page or rotation names (spec 0037's Numbers). */
const EDITORS_MAX = 20;

/** Someone who may be added: an active member of the workspace. */
export interface SharingPerson {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
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
  /** Who an admin may add (the workspace's active members); unused when the reader can't change them. */
  readonly people: readonly SharingPerson[];
  readonly toasts: Toasts;
}

/** A person as a row's mark. */
const mark = (person: { readonly id: string; readonly name: string }) => (
  <Avatar name={person.name} id={person.id} size="sm" isDecorative />
);

/** The editors, with Add an editor and each row's Remove for an admin. Every change shows at once. */
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
  const pickerRef = useRef<HTMLButtonElement>(null);
  const editors = state.status === 'ready' ? state.items : [];
  const save = (next: readonly EditorView[], done: string) => {
    data.editors.set(slug, resourceType, resourceId, next).then(
      () => {
        toasts.toast({ tone: 'success', message: done });
      },
      (error: unknown) => {
        toasts.toast({ tone: 'danger', message: error instanceof Error ? error.message : strings.refused });
      },
    );
  };
  if (state.status === 'loading') return <Skeleton lines={2} />;
  if (state.status === 'error') {
    return <EmptyState tone="error" layout="row" title={strings.failed} onRetry={() => view.reload()} />;
  }
  const held = new Set(editors.map((each) => each.id));
  const addable = people.filter((person) => !held.has(person.id));
  const isFull = editors.length >= EDITORS_MAX;
  return (
    <Card>
      {canChange && (
        <SettingsRow title={strings.add} control="field">
          <Select
            triggerRef={pickerRef}
            label={strings.add}
            isLabelHidden
            savesOnPick
            isSearchable
            placeholder={isFull ? strings.full : strings.addPlaceholder}
            isDisabled={isFull || addable.length === 0}
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
        </SettingsRow>
      )}
      {editors.map((editor) => (
        <SettingsRow
          key={editor.id}
          leading={mark(editor)}
          leadingAlign="center"
          title={editor.name}
          description={strings.editorLine}
        >
          {canChange && (
            <Button
              variant="ghost"
              icon="x"
              label={strings.remove(editor.name)}
              onPress={() => {
                setRemoving(editor);
              }}
            />
          )}
        </SettingsRow>
      ))}
      {editors.length === 0 && <EmptyState layout="row" icon="users" title={strings.none} />}
      <Modal
        title={strings.removeTitle(removing?.name ?? '')}
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
                // The row goes with its button: focus moves to the picker.
                focusLater(() => pickerRef.current);
              }}
            >
              {strings.removeAction}
            </Button>
          </>
        }
      >
        <p>{strings.removeText(removing?.name ?? '', resourceName)}</p>
      </Modal>
    </Card>
  );
}
