// Brief
// Purpose: ask before removing someone (spec 0031, AC-816), saying what their removal does: the booking pages that
// pause, the calendars disconnected, the open tasks and records that name them.
// Main task: read what happens (two lines, the rest behind Show more), see their open tasks and records go to the
// person removing them (or pick another, or keep them), then Remove member.
// Leaves out: the removal's rules (the server's), the hand over's progress (Background jobs) and the toast (the page's).
import { isDataError, type DataLayer, type MemberView, type RemovalPreview } from '@crm/data';
import { Avatar, Button, Callout, Disclosure, Modal, Select, Skeleton, useDelayedLoading } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './members-strings.ts';

/** Props for the remove dialog. */
export interface RemoveMemberDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly workspaceName: string;
  /** The member removing them: their open tasks and records go to this person unless another is picked. */
  readonly meId: string | undefined;
  /** Who is being removed; undefined while closed. */
  readonly member: MemberView | undefined;
  readonly onClose: () => void;
  /** The server agreed: the page says `message` and reads its lists again. */
  readonly onDone: (message: string) => void;
}

/** What the dialog has read: the counts and the people who could take over, or that the read failed. */
type Read =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly preview: RemovalPreview; readonly people: readonly MemberView[] }
  | { readonly status: 'failed' };

/**
 * A danger Modal like every confirm on the Members page (Cancel with ESC
 * first, the verb last, busy while it runs, a refusal inside), which also
 * reads what the removal will do and, when open tasks or records name them,
 * offers a person to hand those to.
 */
export function RemoveMemberDialog({
  data,
  slug,
  workspaceName,
  meId,
  member,
  onClose,
  onDone,
}: RemoveMemberDialogProps) {
  // The last member stays while the Modal plays its exit.
  const [last, setLast] = useState(member);
  if (member !== undefined && member !== last) setLast(member);
  const shown = member ?? last;
  return shown === undefined ? null : (
    <Asked
      key={shown.id}
      data={data}
      slug={slug}
      workspaceName={workspaceName}
      meId={meId}
      member={shown}
      isOpen={member !== undefined}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function Asked({
  data,
  slug,
  workspaceName,
  meId,
  member,
  isOpen,
  onClose,
  onDone,
}: Omit<RemoveMemberDialogProps, 'member'> & { readonly member: MemberView; readonly isOpen: boolean }) {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const [heir, setHeir] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const showSkeleton = useDelayedLoading(read.status === 'loading');

  useEffect(() => {
    let isCurrent = true;
    Promise.all([data.members.removalPreview(slug, member.id), data.members.list(slug)]).then(
      ([preview, people]) => {
        if (!isCurrent) return;
        const others = people.filter((each) => each.id !== member.id);
        setRead({ status: 'ready', preview, people: others });
        // Their work goes to the person removing them unless they pick otherwise: nobody's tasks are orphaned.
        if (preview.openTasks + preview.records > 0 && others.some((each) => each.id === meId)) setHeir(meId ?? null);
      },
      () => {
        if (isCurrent) setRead({ status: 'failed' });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, member.id, meId]);

  const commit = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    const to =
      heir === null ? undefined : (read.status === 'ready' ? read.people : []).find((each) => each.id === heir);
    data.members.remove(slug, member.id, to?.id).then(
      (removed) => {
        setBusy(false);
        onDone(
          removed.jobId === undefined || to === undefined
            ? strings.removed(member.name)
            : strings.removedHandingOn(member.name, to.name),
        );
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };

  // Two sentences said; the rest folded, so the question stays short.
  const effects = read.status === 'ready' ? strings.removalEffects(read.preview) : [];
  const said = effects.slice(0, 2).join(' ');
  const more = effects.slice(2).join(' ');
  return (
    <Modal
      title={strings.removeTitle(member.name, workspaceName)}
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" isPending={isBusy} isDisabled={read.status === 'loading'} onPress={commit}>
            {strings.removeAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <p>{strings.removeText}</p>
      {read.status === 'loading' && <div aria-busy="true">{showSkeleton && <Skeleton lines={2} />}</div>}
      {read.status === 'failed' && <Callout tone="warning">{strings.previewFailed}</Callout>}
      {read.status === 'ready' && read.preview.requiredDefaults > 0 && (
        <Callout tone="warning">{strings.requiredDefaultsLost(read.preview.requiredDefaults)}</Callout>
      )}
      {said !== '' && <p>{said}</p>}
      {more !== '' && (
        <Disclosure title={strings.showMoreEffects} variant="quiet">
          <p>{more}</p>
        </Disclosure>
      )}
      {read.status === 'ready' && read.preview.openTasks + read.preview.records > 0 && (
        <Select
          label={strings.handTo}
          placeholder={strings.handToNobody}
          items={read.people.map((person) => ({
            id: person.id,
            label: person.name,
            description: person.email,
            leading: (
              <Avatar
                name={person.name}
                id={person.id}
                size="xs"
                {...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl })}
                isDecorative
              />
            ),
          }))}
          value={heir}
          onChange={setHeir}
          isSearchable
          searchLabel={strings.handToSearch}
          isClearable
          isDisabled={isBusy}
        />
      )}
    </Modal>
  );
}
