// Brief
// Purpose: a booking page's Live or Hidden, as a pill that opens a menu saying what each means (the owner's mock of
// 9 November 2026), on its card in Bookings › Pages and in its editor's header.
// Main task: see whether guests can book the page, and switch it: the dot changes colour and the word swaps.
// Leaves out: saving it (the screen does, through the data layer, with its Undo) and a draft's first Publish.
import { Button, Menu, MenuItem, MenuTrigger, Tooltip } from '@crm/ui';
import { strings } from './strings.ts';

/** Props for PageStatusMenu. */
export interface PageStatusMenuProps {
  /** The page's title, which names the trigger and the menu. */
  readonly title: string;
  readonly isLive: boolean;
  readonly onChange: (isLive: boolean) => void;
  /** The reader can't change it: the pill shows the state, turned off, with why in a tooltip. */
  readonly lockedReason?: string;
  /** A change on its way: the pill waits. */
  readonly isPending?: boolean;
}

/** Live or Hidden: a secondary pill with a status dot and a swapping word, opening the two choices with their lines. */
export function PageStatusMenu({ title, isLive, onChange, lockedReason, isPending = false }: PageStatusMenuProps) {
  const word = isLive ? strings.pageCard.live : strings.pageCard.hidden;
  const pill = (
    <Button
      dot={isLive ? 'green' : 'gray'}
      animateLabel
      labelReserve={strings.pageCard.hidden}
      iconRight="chevron-down"
      label={strings.pageCard.statusName(title, word)}
      isDisabled={lockedReason !== undefined || isPending}
    >
      {word}
    </Button>
  );
  if (lockedReason !== undefined) {
    return (
      <Tooltip content={lockedReason} isTextTrigger>
        {/* A turned off button takes no focus: the wrapper does, so the reason can be read by keyboard too. */}
        {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex */}
        <span tabIndex={0}>{pill}</span>
      </Tooltip>
    );
  }
  return (
    <MenuTrigger>
      {pill}
      <Menu
        label={strings.pageCard.statusMenu(title)}
        placement="bottom end"
        selectionMode="single"
        selectedKeys={[isLive ? 'live' : 'hidden']}
        onSelectionChange={(keys) => {
          const next = keys.has('live');
          if (keys.size > 0 && next !== isLive) onChange(next);
        }}
      >
        <MenuItem id="live" description={strings.pageCard.liveLine}>
          {strings.pageCard.live}
        </MenuItem>
        <MenuItem id="hidden" description={strings.pageCard.hiddenLine}>
          {strings.pageCard.hidden}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
