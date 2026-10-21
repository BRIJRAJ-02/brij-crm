// Brief
// Purpose: a round robin page's Hosts (spec 0029, AC-732; spec 0037, AC-1319, AC-1323): fixed hosts who attend every meeting, and the rotations it books one host from.
// Main task: add, order and remove fixed hosts, pick up to 3 rotations, and choose where a reschedule goes; each host change saves at once.
// Leaves out: a rotation's own members and rules (Settings › Rotations, linked here), and each member's hours (their schedules).
import { isDataError, type BookingPageView, type DataLayer, type MemberSummary, type RotationView } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  Link,
  Modal,
  Radio,
  RadioGroup,
  Select,
  SettingsStack,
  Table,
  type SelectItem,
  type TableColumn,
} from '@crm/ui';
import { useState } from 'react';
import { rotationsSettingsHref } from '../settings/nav.ts';
import { strings } from './rotation-strings.ts';

/** The most fixed hosts, rotations, and hosts in all (spec 0037's numbers; the server checks them too). */
const LIMITS = { fixed: 7, rotations: 3, hosts: 8 } as const;

/** Props for the Hosts card. */
export interface HostsCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  /** The workspace's active members, for the fixed host picker. */
  readonly people: readonly MemberSummary[];
  /** The rotations the reader may see. */
  readonly rotations: readonly RotationView[];
  readonly isLocked: boolean;
  /** The draft's reschedule rule, saved with the page's other settings. */
  readonly rescheduleHost: 'same' | 'rotation';
  readonly onRescheduleChange: (value: 'same' | 'rotation') => void;
  /** A host change saved: the page as the server now has it. */
  readonly onSaved: (page: BookingPageView) => void;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.fixedHosts, isRowHeader: true },
  { id: 'actions', label: strings.hostActions, isLabelHidden: true, align: 'end' },
];

/** The card. */
export function HostsCard({
  data,
  slug,
  page,
  people,
  rotations,
  isLocked,
  rescheduleHost,
  onRescheduleChange,
  onSaved,
}: HostsCardProps) {
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Removing a host or a rotation ends something, so it asks first (house rule).
  const [confirming, setConfirming] = useState<
    { readonly kind: 'fixed' | 'rotation'; readonly id: string } | undefined
  >(undefined);
  const fixed = page.hosts?.fixed ?? [];
  const linked = page.hosts?.rotations ?? [];
  const nameOf = (memberId: string) => people.find((person) => person.id === memberId)?.name ?? '';
  const rotationName = (rotationId: string) => rotations.find((each) => each.id === rotationId)?.name ?? '';
  const isFull = fixed.length + linked.length >= LIMITS.hosts;

  /** Saves the hosts; true once the server has them. */
  const save = (next: {
    readonly fixed: readonly string[];
    readonly rotations: readonly string[];
  }): Promise<boolean> => {
    if (isSaving) return Promise.resolve(false);
    setSaving(true);
    setFailure(undefined);
    return data.bookingPages
      .update(slug, page.id, {}, { hosts: { fixed: [...next.fixed], rotations: [...next.rotations] } })
      .then(
        (saved) => {
          setSaving(false);
          onSaved(saved);
          return true;
        },
        (error: unknown) => {
          setSaving(false);
          setFailure(isDataError(error) ? error.message : strings.somethingWrong);
          return false;
        },
      );
  };
  const move = (index: number, by: -1 | 1) => {
    const other = index + by;
    const here = fixed[index];
    const there = fixed[other];
    if (here === undefined || there === undefined) return;
    void save({
      fixed: fixed.map((each, at) => (at === index ? there : at === other ? here : each)),
      rotations: linked,
    });
  };
  const confirmRemove = () => {
    if (confirming === undefined) return;
    const next =
      confirming.kind === 'fixed'
        ? { fixed: fixed.filter((each) => each !== confirming.id), rotations: linked }
        : { fixed, rotations: linked.filter((each) => each !== confirming.id) };
    void save(next).then((saved) => {
      // A refusal stays in the dialog, saying why.
      if (saved) setConfirming(undefined);
    });
  };
  const rotationItems = (keep?: string): SelectItem[] =>
    rotations
      .filter((each) => each.id === keep || !linked.includes(each.id))
      .map((each) => ({
        id: each.id,
        label: each.name,
        description: strings.summary(each.strategy, each.windowDays, each.pages),
      }));
  const peopleLeft: SelectItem[] = people
    .filter((person) => !fixed.includes(person.id))
    .map((person) => ({ id: person.id, label: person.name, description: person.email }));

  return (
    <Card
      title={strings.hosts}
      description={strings.hostsLine(fixed.map(nameOf), linked.map(rotationName))}
      actions={<Link href={rotationsSettingsHref(slug)}>{strings.manageRotations}</Link>}
    >
      <SettingsStack>
        {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
        <Select
          label={strings.addFixed}
          hint={fixed.length === 0 ? strings.noFixed : strings.fixedHint}
          placeholder={strings.addMemberPlaceholder}
          items={peopleLeft}
          isSearchable
          value={null}
          isReadOnly={isLocked}
          isDisabled={isSaving || fixed.length >= LIMITS.fixed || isFull}
          onChange={(memberId) => {
            if (memberId !== null) void save({ fixed: [...fixed, memberId], rotations: linked });
          }}
        />
        {fixed.length > 0 && (
          <Table
            label={strings.fixedHosts}
            columns={COLUMNS}
            rows={fixed.map((memberId) => ({ id: memberId }))}
            getRowId={(row) => row.id}
            renderCell={(row, column) => {
              if (column === 'name') return nameOf(row.id);
              if (isLocked) return null;
              const index = fixed.indexOf(row.id);
              return (
                <>
                  {index > 0 && (
                    <Button
                      variant="ghost"
                      icon="arrow-up"
                      label={strings.moveUp(nameOf(row.id))}
                      isDisabled={isSaving}
                      onPress={() => {
                        move(index, -1);
                      }}
                    />
                  )}
                  {index < fixed.length - 1 && (
                    <Button
                      variant="ghost"
                      icon="arrow-down"
                      label={strings.moveDown(nameOf(row.id))}
                      isDisabled={isSaving}
                      onPress={() => {
                        move(index, 1);
                      }}
                    />
                  )}
                  <Button
                    variant="ghost"
                    icon="x"
                    label={strings.removeFixed(nameOf(row.id))}
                    isDisabled={isSaving}
                    onPress={() => {
                      setConfirming({ kind: 'fixed', id: row.id });
                    }}
                  />
                </>
              );
            }}
          />
        )}
        {linked.map((rotationId, index) => (
          <SettingsStack key={rotationId}>
            <Select
              label={linked.length === 1 ? strings.rotation : strings.rotationAt(index)}
              items={rotationItems(rotationId)}
              value={rotationId}
              isReadOnly={isLocked}
              isDisabled={isSaving}
              onChange={(next) => {
                if (next === null || next === rotationId) return;
                void save({ fixed, rotations: linked.map((each) => (each === rotationId ? next : each)) });
              }}
            />
            {!isLocked && linked.length > 1 && (
              <Button
                variant="ghost"
                icon="x"
                isDisabled={isSaving}
                onPress={() => {
                  setConfirming({ kind: 'rotation', id: rotationId });
                }}
              >
                {strings.removeRotation(rotationName(rotationId))}
              </Button>
            )}
          </SettingsStack>
        ))}
        {linked.length < LIMITS.rotations && (
          <Select
            label={linked.length === 0 ? strings.rotation : strings.addRotation}
            hint={strings.rotationsHint}
            placeholder={strings.pickRotation}
            items={rotationItems()}
            value={null}
            isReadOnly={isLocked}
            isDisabled={isSaving || isFull}
            onChange={(next) => {
              if (next !== null) void save({ fixed, rotations: [...linked, next] });
            }}
          />
        )}
        <RadioGroup
          label={strings.reschedule}
          value={rescheduleHost}
          isReadOnly={isLocked}
          onChange={(value) => {
            if (value === 'same' || value === 'rotation') onRescheduleChange(value);
          }}
        >
          <Radio value="same">{strings.rescheduleSame}</Radio>
          <Radio value="rotation">{strings.rescheduleRotation}</Radio>
        </RadioGroup>
      </SettingsStack>
      <Modal
        title={
          confirming?.kind === 'rotation'
            ? strings.stopRotationTitle(rotationName(confirming.id))
            : strings.removeFixedTitle(nameOf(confirming?.id ?? ''))
        }
        tone="danger"
        isOpen={confirming !== undefined}
        isBusy={isSaving}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isSaving) setConfirming(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isSaving} kbd="ESC">
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isSaving} onPress={confirmRemove}>
              {isSaving
                ? strings.removing
                : confirming?.kind === 'rotation'
                  ? strings.stopRotationAction
                  : strings.removeFixedAction}
            </Button>
          </>
        }
      >
        {failure ?? (confirming?.kind === 'rotation' ? strings.stopRotationText : strings.removeFixedText)}
      </Modal>
    </Card>
  );
}
