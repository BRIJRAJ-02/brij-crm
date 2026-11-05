// Brief
// Purpose: one section or sub section in a drawer (after checklabs' category and sub category sheets): its name, a
// line under it, list or photo grid, and when it serves (narrower than its menu, after checklabs' menu times).
// Main task: name a section and say how it shows.
// Leaves out: its dishes and their order (the section's card in Structure).
import type { MenuDraft, MenuServing, MenuStore, PlaceHours } from '@crm/data';
import { Button, Field, Form, SegmentedControl, type Toasts } from '@crm/ui';
import { useId, useState } from 'react';
import { DrawerForm } from './drawer.tsx';
import { ServingEditor } from './serving.tsx';
import { strings } from './strings.ts';

/** A new section (at the end of the menu, or under `parentId`) or one already made. */
export function SectionDrawer({
  store,
  slug,
  draft,
  menuId,
  sectionId,
  parentId,
  placeHours,
  toasts,
  onClose,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly menuId: string;
  readonly sectionId?: string;
  readonly parentId?: string;
  readonly placeHours?: PlaceHours;
  readonly toasts: Toasts;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const section = draft.sections.find((each) => each.id === sectionId);
  const menu = draft.menus.find((each) => each.id === menuId);
  const parent = parentId ?? section?.parentId;
  const isNew = section === undefined;
  const siblings = draft.sections.filter((each) => each.menuId === menuId && each.parentId === parent).length;
  const [id] = useState(() => section?.id ?? store.newId());
  const [name, setName] = useState(
    section?.name ?? (parent === undefined ? (siblings === 0 ? strings.newSectionName : '') : ''),
  );
  const [description, setDescription] = useState(section?.description ?? '');
  const [layout, setLayout] = useState<'list' | 'grid'>(section?.layout ?? 'list');
  const [serving, setServing] = useState<MenuServing | undefined>(section?.serving);
  const [error, setError] = useState<string>();
  const [isSaving, setSaving] = useState(false);
  const isDirty =
    name !== (section?.name ?? name) ||
    description !== (section?.description ?? '') ||
    layout !== (section?.layout ?? 'list') ||
    JSON.stringify(serving) !== JSON.stringify(section?.serving) ||
    (isNew && name.trim() !== '' && name !== strings.newSectionName);

  const save = async () => {
    if (name.trim() === '') {
      setError(strings.sectionNameMissing);
      return;
    }
    setSaving(true);
    const refused = await store.saveSection(slug, {
      id,
      menuId,
      ...(parent === undefined ? {} : { parentId: parent }),
      name: name.trim(),
      ...(description.trim() === '' ? {} : { description: description.trim() }),
      layout,
      serving: serving ?? null,
    });
    setSaving(false);
    if (refused !== undefined) {
      toasts.toast({ tone: 'danger', message: refused.message });
      return;
    }
    onClose();
  };

  return (
    <DrawerForm
      title={section?.name ?? (parent === undefined ? strings.newSection : strings.addSubsection)}
      isDirty={isDirty}
      isBusy={isSaving}
      onClose={onClose}
      actions={
        <>
          <Button slot="close" isDisabled={isSaving}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isSaving}>
            {strings.saveSection}
          </Button>
        </>
      }
    >
      <Form id={formId} onSubmit={() => void save()}>
        <Field
          label={strings.sectionName}
          value={name}
          onChange={(next) => {
            setName(next);
            if (error !== undefined && next.trim() !== '') setError(undefined);
          }}
          isRequired
          maxLength={60}
          {...(error === undefined ? {} : { error })}
        />
        <Field label={strings.sectionDescription} value={description} onChange={setDescription} maxLength={140} />
        <SegmentedControl
          label={strings.sectionLayout}
          isLabelVisible
          segments={[
            { value: 'list', label: strings.layoutList },
            { value: 'grid', label: strings.layoutGrid },
          ]}
          value={layout}
          onChange={(next: string) => setLayout(next === 'grid' ? 'grid' : 'list')}
        />
        <ServingEditor
          label={strings.sectionServing}
          hint={strings.sectionServingHint}
          value={serving}
          placeHours={menu?.serving === undefined ? placeHours : { weekly: menu.serving.weekly, exceptions: [] }}
          onChange={(next) => setServing(next ?? undefined)}
        />
      </Form>
    </DrawerForm>
  );
}
