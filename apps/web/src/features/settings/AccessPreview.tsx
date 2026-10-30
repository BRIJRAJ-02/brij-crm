// Brief
// Purpose: "Preview as" on an object's Access tab (spec 0032, AC-858): the object as a member, or someone in a team,
// would see it, read through the access door as them.
// Main task: pick a person or team, see their fields and how many records they see, then Exit.
// Leaves out: acting as them (a preview never writes), and the record table itself: a count and the first names.
import {
  isDataError,
  type AccessPreview as Preview,
  type DataLayer,
  type MemberView,
  type PreviewAs,
  type TeamView,
} from '@crm/data';
import {
  Badge,
  Button,
  Callout,
  FieldGroup,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Skeleton,
  type Toasts,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { strings } from './teams-strings.ts';

/** What the preview is doing: nothing, reading, showing someone, or unable to. */
type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly as: PreviewAs }
  | { readonly kind: 'ready'; readonly preview: Preview }
  | { readonly kind: 'failed' };

/** Props for the preview: what the Access tab holds. */
export interface AccessPreviewProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly objectId: string;
  readonly teams: readonly TeamView[];
  readonly members: readonly MemberView[];
}

/** The menu that starts a preview, and the banner that shows it with its Exit. */
export function useAccessPreview({ data, toasts, slug, objectId, teams, members }: AccessPreviewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // The latest ask: an answer for an earlier pick never shows over a later one, or after Exit.
  const asked = useRef(0);

  const start = (as: PreviewAs) => {
    asked.current += 1;
    const mine = asked.current;
    setPhase({ kind: 'loading', as });
    data.accessRules.preview(slug, objectId, as).then(
      (preview) => {
        if (asked.current === mine) setPhase({ kind: 'ready', preview });
      },
      (error: unknown) => {
        if (asked.current !== mine) return;
        setPhase({ kind: 'failed' });
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.previewFailed });
      },
    );
  };
  const exit = () => {
    asked.current += 1;
    setPhase({ kind: 'idle' });
  };

  // Owners and admins see everything, so only the people a rule can restrict are worth previewing.
  const people = members.filter((each) => each.role !== 'owner' && each.role !== 'admin');
  const hasAny = people.length > 0 || teams.length > 0;

  const menu = hasAny ? (
    <MenuTrigger>
      <Button icon="eye">{strings.previewAs}</Button>
      <Menu
        label={strings.previewAs}
        onAction={(key) => {
          const [type, id] = String(key).split(':');
          if (id === undefined) return;
          start(type === 'team' ? { type: 'team', teamId: id } : { type: 'member', memberId: id });
        }}
        {...(people.length + teams.length > 8 ? { search: { label: strings.previewAs } } : {})}
      >
        {people.length > 0 && (
          <MenuSection label={strings.previewMembers}>
            {people.map((each) => (
              <MenuItem key={each.id} id={`member:${each.id}`} icon="user">
                {each.name}
              </MenuItem>
            ))}
          </MenuSection>
        )}
        {teams.length > 0 && (
          <MenuSection label={strings.previewTeams}>
            {teams.map((each) => (
              <MenuItem key={each.id} id={`team:${each.id}`} icon="users-round">
                {each.name}
              </MenuItem>
            ))}
          </MenuSection>
        )}
      </Menu>
    </MenuTrigger>
  ) : null;

  const banner = (() => {
    if (phase.kind === 'idle' || phase.kind === 'failed') return null;
    if (phase.kind === 'loading') {
      return (
        <Callout title={strings.previewLoading} actions={<Button onPress={exit}>{strings.previewExit}</Button>}>
          <Skeleton width="long" />
        </Callout>
      );
    }
    const { preview } = phase;
    return (
      <Callout
        isAnnounced
        title={strings.previewTitle(preview.name)}
        actions={<Button onPress={exit}>{strings.previewExit}</Button>}
      >
        <FieldGroup label={strings.previewSees} layout="row">
          <Badge size="chip" text={strings.previewReadOnly} dot="orange" />
          <Badge size="chip" text={strings.previewLevel[preview.level]} dot="gray" />
          {preview.level !== 'none' && (
            <>
              <Badge size="chip" text={strings.previewRecords(preview.count)} dot="blue" />
              <Badge size="chip" text={strings.previewFields(preview.fields.length)} dot="blue" />
            </>
          )}
        </FieldGroup>
        {preview.level !== 'none' && (
          <>
            <FieldGroup label={strings.fieldsTitle} layout="row">
              {preview.fields.map((field) => (
                <Badge
                  key={field.id}
                  size="chip"
                  text={field.canEdit ? field.title : `${field.title} · ${strings.fieldStates.read}`}
                />
              ))}
            </FieldGroup>
            {preview.sample.length > 0 && (
              <FieldGroup label={strings.previewRecordsLabel} layout="row">
                {preview.sample.map((record) => (
                  <Badge key={record.id} size="chip" text={record.name} />
                ))}
              </FieldGroup>
            )}
          </>
        )}
      </Callout>
    );
  })();

  return { menu, banner };
}
