// Brief
// Purpose: the booking page editor's Social links card (booking socials, 25 Oct 2026): whether this page shows its
// owner's social links, which ones, and a way to change them without leaving the editor.
// Main task: turn the page's links on or off, and open Edit social links to change the person's set.
// Leaves out: the set's own editing rules (SocialLinksEditor, the same as Settings › Profile's) and team pages,
// which name no host before booking (AC-754).
import { describeLink } from '@crm/contracts/values';
import type { DataLayer, PublicSocialLink, SocialLink } from '@crm/data';
import { useSocialLinks } from '@crm/data/react';
import {
  Button,
  Callout,
  Card,
  Modal,
  SettingsRow,
  Skeleton,
  SocialLinks,
  SocialLinksEditor,
  Switch,
  isSocialLinksDraftChanged,
  socialLinksDraftOf,
  socialLinksOfDraft,
  type SocialLinkDraft,
} from '@crm/ui';
import { useRef, useState } from 'react';
import { strings } from './socials-strings.ts';

/** The person's stored links as a public page draws them, labelled as the server labels them. */
export function previewSocials(links: readonly SocialLink[]): readonly PublicSocialLink[] {
  return links.map((link) => ({ network: link.network, href: link.href, label: describeLink(link.href).label }));
}

/** Props for SocialsCard. */
export interface SocialsCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** A team page shows no one's links, and says why. */
  readonly isTeam: boolean;
  /** The reader owns the page: only they turn its links on or off, and only their own set is theirs to change. */
  readonly isOwner: boolean;
  /** The page's draft switch, saved with the editor's other settings. */
  readonly isShown: boolean;
  readonly isLocked: boolean;
  readonly onShownChange: (isShown: boolean) => void;
}

/** Edit social links: the same editor as Settings › Profile's, in a dialog; Save replaces the person's set. */
function EditDialog({
  data,
  slug,
  links,
  onClose,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly links: readonly SocialLink[];
  readonly onClose: () => void;
}) {
  const [rows, setRows] = useState<readonly SocialLinkDraft[]>(() => socialLinksDraftOf(links));
  const [errorFocus, setErrorFocus] = useState(0);
  const [isLeaving, setLeaving] = useState(false);
  // One save per dialog: a second press while it closes sends nothing more.
  const isSent = useRef(false);
  const isChanged = isSocialLinksDraftChanged(rows, links);
  const save = () => {
    if (isSent.current) return;
    const checked = socialLinksOfDraft(rows);
    if (!checked.ok) {
      setRows(checked.rows);
      setErrorFocus((count) => count + 1);
      return;
    }
    isSent.current = true;
    // Nothing changed: nothing to send.
    if (isChanged) {
      // Shown at once on the card and the preview; a refusal puts the set back and says so with Try again.
      void data.profile.setSocials(slug, checked.links);
    }
    onClose();
  };
  // Closing with changes asks first (the owner's rule for ending actions); with none, it just closes.
  const leave = () => {
    if (isChanged) setLeaving(true);
    else onClose();
  };
  return (
    <Modal
      title={strings.dialogTitle}
      variant="window"
      icon="link"
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) leave();
      }}
      actions={
        <>
          <Button kbd="ESC" onPress={leave}>
            {strings.cancel}
          </Button>
          <Button variant="primary" onPress={save}>
            {strings.save}
          </Button>
        </>
      }
    >
      <SocialLinksEditor rows={rows} onChange={setRows} tone="bare" errorFocus={errorFocus} />
      {isLeaving && (
        <Modal
          title={strings.discardTitle}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setLeaving(false);
          }}
          actions={
            <>
              <Button
                kbd="ESC"
                onPress={() => {
                  setLeaving(false);
                }}
              >
                {strings.keepEditing}
              </Button>
              <Button variant="danger-solid" onPress={onClose}>
                {strings.discard}
              </Button>
            </>
          }
        >
          {strings.discardText}
        </Modal>
      )}
    </Modal>
  );
}

/**
 * The card: "Show my social links" (the page's own switch, on by default), the marks the person has set, as the page
 * will show them, and Edit social links. A colleague's page shows its switch read only; a team page says why it has
 * none.
 */
export function SocialsCard({ data, slug, isTeam, isOwner, isShown, isLocked, onShownChange }: SocialsCardProps) {
  if (isTeam) {
    return <Card title={strings.title} description={strings.team} />;
  }
  if (!isOwner) {
    return (
      <Card title={strings.title}>
        <SettingsRow title={strings.shown} description={strings.notOwner}>
          <Switch label={strings.shown} isLabelHidden isSelected={isShown} isReadOnly />
        </SettingsRow>
      </Card>
    );
  }
  return <OwnSocialsCard data={data} slug={slug} isShown={isShown} isLocked={isLocked} onShownChange={onShownChange} />;
}

function OwnSocialsCard({
  data,
  slug,
  isShown,
  isLocked,
  onShownChange,
}: Pick<SocialsCardProps, 'data' | 'slug' | 'isShown' | 'isLocked' | 'onShownChange'>) {
  const held = data.profile.socials(slug);
  const state = useSocialLinks(held);
  const [isEditing, setEditing] = useState(false);
  const links = state.status === 'ready' ? state.links : [];
  const marks =
    state.status === 'loading' ? (
      <Skeleton width="short" />
    ) : state.status === 'error' ? undefined : links.length === 0 ? (
      strings.none
    ) : !isShown ? (
      // Off, the card says so rather than showing marks the page won't.
      strings.hiddenHere
    ) : (
      <SocialLinks links={previewSocials(links)} isInline />
    );
  // A member with no sign in of their own has no links to keep: no button, rather than one that never works.
  const edit =
    state.status === 'error' || (state.status === 'ready' && !state.canChange) ? undefined : (
      <Button
        isDisabled={state.status !== 'ready'}
        onPress={() => {
          setEditing(true);
        }}
      >
        {links.length === 0 ? strings.add : strings.edit}
      </Button>
    );
  return (
    <Card title={strings.title} description={strings.everywhere} {...(edit === undefined ? {} : { actions: edit })}>
      <SettingsRow title={strings.shown} {...(marks === undefined ? {} : { description: marks })}>
        <Switch
          label={strings.shown}
          isLabelHidden
          isSelected={isShown}
          isReadOnly={isLocked}
          onChange={onShownChange}
        />
      </SettingsRow>
      {state.status === 'error' && (
        <Callout
          tone="danger"
          title={strings.failed}
          actions={<Button onPress={held.retry}>{strings.tryAgain}</Button>}
        >
          {state.message}
        </Callout>
      )}
      {isEditing && state.status === 'ready' && (
        <EditDialog
          data={data}
          slug={slug}
          links={links}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
    </Card>
  );
}
