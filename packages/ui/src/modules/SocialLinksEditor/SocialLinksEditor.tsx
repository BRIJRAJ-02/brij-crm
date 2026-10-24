// Brief
// Purpose: where a person keeps their own social links (booking socials, 25 Oct 2026): Settings › Profile, and the
// booking page editor's Edit social links dialog, the same editor in both.
// Main task: add a network from the fixed set, type a handle or paste a link once, and put the links in order.
// Leaves out: saving (the screen's SaveBar or the dialog's Save), and the networks' own sign in or verification.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { SOCIAL_LINK_NAMES, SOCIAL_LINK_NETWORKS, type SocialLinkNetwork } from '@crm/contracts/social-networks';
import { socialLinkPlaceholder, socialLinkPrefix } from '@crm/contracts/values';
import { Button, ButtonGroup } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { SettingsRow } from '../SettingsLayout/SettingsLayout.tsx';
import { checkedRow, type SocialLinkDraft } from './draft.ts';
import { strings } from './strings.ts';

/** Props for SocialLinksEditor. */
export interface SocialLinksEditorProps {
  /** The draft's rows, in order: one per network. */
  readonly rows: readonly SocialLinkDraft[];
  /** Every change: a row added, typed in, checked as it is left, moved or removed. */
  readonly onChange: (rows: readonly SocialLinkDraft[]) => void;
  /** Shows the links with no way to change them, and why in each field's tooltip. */
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
  /** While a save is out: the rows stay as typed, and Add and each row's menu wait for it. */
  readonly isDisabled?: boolean;
  /** While the links are read: two rows' shapes in the card. */
  readonly isLoading?: boolean;
  /**
   * `default` in its own Card, Add social link in its footer (Settings › Profile); `bare` with no frame and Add as
   * the last row, in a dialog that frames it and has a footer of its own.
   */
  readonly tone?: 'default' | 'bare';
  /** Bumped by the screen when a save found rows that won't save: the first of them takes focus. */
  readonly errorFocus?: number;
}

/** Where focus goes once a menu has gone: a row's field, or Add social link (no rows left). */
type FocusTarget = { readonly network: SocialLinkNetwork } | { readonly add: true };

/** A network's mark: its brand's own, or Lucide’s link for a website. */
function NetworkMark({ network }: { readonly network: SocialLinkNetwork }) {
  return network === 'website' ? <Icon name="link" /> : <ProviderMark provider={network} />;
}

/** True when the text is a whole link, which then shows without the field's prefix. */
function isWholeLink(text: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(text.trim()) || text.includes('/');
}

/** A row's own menu: Move up, Move down, Remove. A draft's row goes at once; the screen's Discard brings it back. */
function RowMenu({
  network,
  at,
  count,
  isDisabled,
  onMove,
  onRemove,
}: {
  readonly network: SocialLinkNetwork;
  readonly at: number;
  readonly count: number;
  readonly isDisabled: boolean;
  readonly onMove: (to: number) => void;
  readonly onRemove: () => void;
}) {
  const label = strings.rowMenu(SOCIAL_LINK_NAMES[network]);
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={label} isDisabled={isDisabled} />
      <Menu
        label={label}
        onAction={(key) => {
          if (key === 'remove') onRemove();
          else onMove(key === 'up' ? at - 1 : at + 1);
        }}
      >
        {at > 0 && (
          <MenuItem id="up" icon="chevron-up">
            {strings.moveUp}
          </MenuItem>
        )}
        {at < count - 1 && (
          <MenuItem id="down" icon="chevron-down">
            {strings.moveDown}
          </MenuItem>
        )}
        {count > 1 && <MenuSeparator />}
        <MenuItem id="remove" icon="trash" isDanger>
          {strings.remove}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

/** "Add social link": a menu of the networks not used yet, each with its mark. */
function AddMenu({
  unused,
  isDisabled,
  onAdd,
  buttonRef,
}: {
  readonly unused: readonly SocialLinkNetwork[];
  readonly isDisabled: boolean;
  readonly onAdd: (network: SocialLinkNetwork) => void;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <MenuTrigger>
      <Button variant="dashed" icon="plus" isDisabled={isDisabled} ref={buttonRef}>
        {strings.add}
      </Button>
      <Menu
        label={strings.networks}
        onAction={(key) => {
          const network = unused.find((each) => each === key);
          if (network !== undefined) onAdd(network);
        }}
      >
        {unused.map((network) => (
          <MenuItem key={network} id={network} leading={<NetworkMark network={network} />}>
            {SOCIAL_LINK_NAMES[network]}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

/**
 * A person's social links as settings rows (owner ask, 25 Oct 2026): each row the network's mark and name, a field
 * with the network's address before it ("linkedin.com/in/") taking a handle or a pasted link, and a menu to move or
 * remove it; under them, Add social link offers the networks not used yet. A field is checked as it is left, by the
 * same rule the server keeps (a pasted profile link becomes its handle; a link to another network, or to a post, is
 * refused in plain words). Controlled: the screen holds the draft and saves it.
 */
export function SocialLinksEditor({
  rows,
  onChange,
  isReadOnly = false,
  readOnlyReason,
  isDisabled = false,
  isLoading = false,
  tone = 'default',
  errorFocus,
}: SocialLinksEditorProps) {
  // After a menu action, focus goes where the person is working: the row just added, the row now in a removed one's
  // place, or Add social link when none is left. It moves once that menu has gone, since a menu hands focus back to
  // its own button as it leaves (`menuLabel` names which menu to wait for).
  const [pending, setPending] = useState<{ readonly target: FocusTarget; readonly menuLabel: string } | undefined>(
    undefined,
  );
  const fields = useRef(new Map<SocialLinkNetwork, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pending === undefined) return;
    let frames = 0;
    let frame = 0;
    const focus = () => {
      const leaving = [...document.querySelectorAll('[role="menu"]')].some(
        (menu) => menu.getAttribute('aria-label') === pending.menuLabel,
      );
      if (leaving && frames < 60) {
        frames += 1;
        frame = requestAnimationFrame(focus);
        return;
      }
      if ('add' in pending.target) addButton.current?.focus();
      else fields.current.get(pending.target.network)?.focus();
      setPending(undefined);
    };
    frame = requestAnimationFrame(focus);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pending]);
  // A save that found rows that won't save: the first of them takes focus, so its reason is read and in view.
  const lastErrorFocus = useRef(errorFocus);
  useEffect(() => {
    if (errorFocus === lastErrorFocus.current) return;
    lastErrorFocus.current = errorFocus;
    const wrong = rows.find((row) => row.error !== undefined);
    if (wrong !== undefined) fields.current.get(wrong.network)?.focus();
  }, [errorFocus, rows]);
  const used = new Set(rows.map((row) => row.network));
  const unused = SOCIAL_LINK_NETWORKS.filter((network) => !used.has(network));
  const replace = (index: number, row: SocialLinkDraft) => {
    onChange(rows.map((each, at) => (at === index ? row : each)));
  };
  const move = (from: number, to: number) => {
    const row = rows[from];
    if (row === undefined || to < 0 || to >= rows.length) return;
    const rest = rows.filter((_each, at) => at !== from);
    onChange([...rest.slice(0, to), row, ...rest.slice(to)]);
  };
  const add = (network: SocialLinkNetwork) => {
    setPending({ target: { network }, menuLabel: strings.networks });
    onChange([...rows, { network, text: '' }]);
  };
  const remove = (index: number) => {
    const rest = rows.filter((_each, at) => at !== index);
    const next = rest[index] ?? rest[index - 1];
    const row = rows[index];
    setPending({
      target: next === undefined ? { add: true } : { network: next.network },
      menuLabel: row === undefined ? '' : strings.rowMenu(SOCIAL_LINK_NAMES[row.network]),
    });
    onChange(rest);
  };
  const canEdit = !isReadOnly;
  const addControl =
    canEdit && unused.length > 0 ? (
      <AddMenu unused={unused} isDisabled={isDisabled} onAdd={add} buttonRef={addButton} />
    ) : undefined;
  const body = isLoading ? (
    <>
      {[0, 1].map((index) => (
        <SettingsRow key={index} title={strings.loadingRow} leading={<Skeleton shape="tile" />} control="field">
          <Skeleton shape="field" />
        </SettingsRow>
      ))}
    </>
  ) : rows.length === 0 ? (
    <SettingsRow title={strings.emptyTitle} description={strings.emptyText}>
      {addControl}
    </SettingsRow>
  ) : (
    <>
      {rows.map((row, index) => {
        const name = SOCIAL_LINK_NAMES[row.network];
        const prefix = socialLinkPrefix(row.network);
        return (
          <SettingsRow key={row.network} title={name} leading={<NetworkMark network={row.network} />} control="field">
            <Field
              label={name}
              isLabelHidden
              value={row.text}
              placeholder={socialLinkPlaceholder(row.network)}
              {...(prefix !== '' && !isWholeLink(row.text) ? { prefix } : {})}
              type={row.network === 'website' ? 'url' : 'text'}
              inputMode={row.network === 'website' ? 'url' : 'text'}
              autoComplete="off"
              maxLength={2_000}
              isReadOnly={isReadOnly}
              {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
              ref={(element: (HTMLInputElement & HTMLTextAreaElement) | null) => {
                if (element === null) fields.current.delete(row.network);
                else fields.current.set(row.network, element);
              }}
              onChange={(text) => {
                replace(index, { network: row.network, text });
              }}
              onBlur={() => {
                const checked = checkedRow(row);
                if (checked.text !== row.text || checked.error !== row.error) replace(index, checked);
              }}
              {...(row.error === undefined ? {} : { error: row.error })}
              {...(canEdit
                ? {
                    // Inside the box, as Your page's Copy is, so every field on the screen ends on one line.
                    suffix: (
                      <RowMenu
                        network={row.network}
                        at={index}
                        count={rows.length}
                        isDisabled={isDisabled}
                        onMove={(to) => {
                          move(index, to);
                        }}
                        onRemove={() => {
                          remove(index);
                        }}
                      />
                    ),
                  }
                : {})}
            />
          </SettingsRow>
        );
      })}
    </>
  );
  const trailing = !isLoading && rows.length > 0 ? addControl : undefined;
  // In a dialog, Add is the last row rather than a second grey band over the dialog's own footer.
  return (
    <Card tone={tone} isBusy={isLoading} {...(trailing === undefined || tone === 'bare' ? {} : { footer: trailing })}>
      {body}
      {trailing !== undefined && tone === 'bare' && (
        <ButtonGroup label={strings.add} layout="row">
          {trailing}
        </ButtonGroup>
      )}
    </Card>
  );
}
