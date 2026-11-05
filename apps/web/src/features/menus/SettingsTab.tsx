// Brief
// Purpose: one menu's settings (after checklabs' menu Settings: General, Availability, Tax and service): its name and
// places, when it serves, the tax inside its prices and the service added, the note at its foot, and the phone guests
// call with the currency and time zone it reads in, from the business profile.
// Main task: say when the menu serves and what its prices include.
// Leaves out: the look (H5 presets), the phone, currency and time zone themselves (the business profile's, linked),
// Delete (the header's ⋯, as checklabs has it), and sections and items (Structure).
import type { Menu as MenuShape, MenuDraft, MenuStore, PlaceHours } from '@crm/data';
import { formatRate, parseRate, rateNote } from '@crm/data/menu';
import { ButtonLink, Card, ChoiceChips, DescriptionList, Field } from '@crm/ui';
import { useState } from 'react';
import { ServingEditor } from './serving.tsx';
import { strings } from './strings.ts';

type Said = (refused: { readonly message: string } | undefined) => void;

/** One menu's settings. */
export function SettingsTab({
  store,
  slug,
  draft,
  menuId,
  placeHours,
  phone,
  timeZone,
  profileHref,
  said,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly menuId: string;
  readonly placeHours?: PlaceHours;
  /** The business profile's phone, shown read only (guests tap it to call). */
  readonly phone?: string;
  /** The place's time zone, which serving times read in. */
  readonly timeZone?: string;
  /** Where the phone, currency and time zone are changed: Settings › Business. */
  readonly profileHref: string;
  readonly said: Said;
}) {
  const menu = draft.menus.find((each) => each.id === menuId);
  if (menu === undefined) return null;
  const save = (change: Partial<Parameters<MenuStore['saveMenu']>[1]>) =>
    void store
      .saveMenu(slug, {
        id: menu.id,
        name: menu.name,
        placeIds: menu.placeIds,
        ...(menu.note === undefined ? {} : { note: menu.note }),
        ...change,
      })
      .then(said);
  const isReadOnly = !draft.canEdit;
  return (
    <>
      <Card title={strings.general} description={strings.generalLine}>
        <SavedText
          label={strings.menuName}
          value={menu.name}
          isReadOnly={isReadOnly}
          check={(next) => (next.trim() === '' ? strings.menuNameMissing : undefined)}
          onSave={(name) => save({ name })}
        />
        {draft.places.length > 1 ? (
          <ChoiceChips
            label={strings.showsAt}
            choices={draft.places.map((place) => ({ id: place.id, label: place.name }))}
            selected={menu.placeIds}
            onChange={(placeIds) => save({ placeIds: [...placeIds] })}
            isDisabled={isReadOnly}
          />
        ) : null}
      </Card>
      <Card title={strings.servingCard}>
        <ServingEditor
          label={strings.servingTimes}
          hint={strings.servingLine}
          value={menu.serving}
          placeHours={placeHours}
          isReadOnly={isReadOnly}
          onChange={(serving) => save({ serving })}
        />
      </Card>
      <Card title={strings.taxCard} description={strings.taxLine}>
        <Rates menu={menu} isReadOnly={isReadOnly} onSave={save} />
      </Card>
      {/* The phone guests call, and the currency and time zone the menu reads in: the profile's, read only here. */}
      <Card
        title={strings.regionCard}
        description={strings.regionLine}
        actions={
          <ButtonLink href={profileHref} variant="ghost" icon="pencil">
            {strings.editProfile}
          </ButtonLink>
        }
      >
        <DescriptionList
          items={[
            phone === undefined || phone.trim() === ''
              ? { term: strings.phone, description: strings.noPhone, isPlaceholder: true }
              : { term: strings.phone, description: phone },
            { term: strings.currency, description: draft.currency },
            ...(timeZone === undefined ? [] : [{ term: strings.timeZone, description: timeZone }]),
          ]}
        />
      </Card>
    </>
  );
}

/** The two rates and the foot note they write while the owner hasn't written their own. */
function Rates({
  menu,
  isReadOnly,
  onSave,
}: {
  readonly menu: MenuShape;
  readonly isReadOnly: boolean;
  readonly onSave: (change: { taxRate?: number; serviceRate?: number; note?: string }) => void;
}) {
  // The note follows the rates while it is empty or still the words the rates wrote.
  const follows = (menu.note ?? '') === '' || menu.note === rateNote(menu.taxRate, menu.serviceRate);
  const rate = (which: 'taxRate' | 'serviceRate', next: number) => {
    const rates = { taxRate: menu.taxRate, serviceRate: menu.serviceRate, [which]: next };
    onSave({ [which]: next, ...(follows ? { note: rateNote(rates.taxRate, rates.serviceRate) } : {}) });
  };
  return (
    <>
      <SavedText
        label={strings.taxRate}
        value={formatRate(menu.taxRate)}
        hint={strings.rateHint}
        inputMode="decimal"
        suffix="%"
        isReadOnly={isReadOnly}
        check={(next) => (parseRate(next === '' ? '0' : next) === undefined ? strings.rateInvalid : undefined)}
        onSave={(next) => rate('taxRate', parseRate(next === '' ? '0' : next) ?? 0)}
      />
      <SavedText
        label={strings.serviceRate}
        value={formatRate(menu.serviceRate)}
        hint={strings.rateHint}
        inputMode="decimal"
        suffix="%"
        isReadOnly={isReadOnly}
        check={(next) => (parseRate(next === '' ? '0' : next) === undefined ? strings.rateInvalid : undefined)}
        onSave={(next) => rate('serviceRate', parseRate(next === '' ? '0' : next) ?? 0)}
      />
      <SavedText
        label={strings.menuNote}
        hint={strings.menuNoteHint}
        value={menu.note ?? ''}
        isReadOnly={isReadOnly}
        check={(next) => (next.length > 300 ? strings.noteTooLong : undefined)}
        onSave={(note) => onSave({ note })}
        allowsEmpty
      />
    </>
  );
}

/**
 * A field saved when it loses focus (or Enter), never on every key; what doesn't pass stays as typed with why
 * (inline, before anything is sent), so nothing typed is lost to a silent revert.
 */
export function SavedText({
  label,
  value,
  hint,
  suffix,
  inputMode,
  isReadOnly = false,
  allowsEmpty = false,
  check,
  onSave,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly suffix?: string;
  readonly inputMode?: 'decimal' | 'numeric';
  readonly isReadOnly?: boolean;
  readonly allowsEmpty?: boolean;
  readonly check: (next: string) => string | undefined;
  readonly onSave: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string>();
  // The server's answer (or another edit) replaces what is shown, unless the person is mid change.
  if (value !== seen) {
    setSeen(value);
    setText(value);
    setError(undefined);
  }
  const commit = () => {
    const next = text.trim();
    const problem = !allowsEmpty && next === '' ? check('') : check(next);
    setError(problem);
    if (problem === undefined && next !== value) onSave(next);
  };
  return (
    <Field
      label={label}
      value={text}
      onChange={(next) => {
        setText(next);
        if (error !== undefined) setError(check(next.trim()));
      }}
      onBlur={commit}
      onSubmit={commit}
      isReadOnly={isReadOnly}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(suffix === undefined ? {} : { suffix })}
      {...(inputMode === undefined ? {} : { inputMode })}
    />
  );
}
