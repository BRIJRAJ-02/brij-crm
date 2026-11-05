// Brief
// Purpose: the workspace's option groups (after checklabs' modifier groups page: its heading, its line, New group,
// then the groups): shared choices such as Milk or Sides, each a rule and its options, offered by any item.
// Main task: make a group once and offer it on many items.
// Leaves out: which items offer a group (each item's drawer picks its groups, and can make one there too).
import type { MenuDraft } from '@crm/data';
import { Button, Card, EmptyState, LinkList, type LinkRow } from '@crm/ui';
import type { Open } from './MenusScreen.tsx';
import { strings } from './strings.ts';

/** The option groups. */
export function OptionsTab({ draft, onOpen }: { readonly draft: MenuDraft; readonly onOpen: (open: Open) => void }) {
  const rows = draft.groups.map((group): LinkRow => ({
    id: group.id,
    title: group.name,
    address: strings.ruleSummary(group.rule, group.max, group.min),
    chips: [
      group.options.map((option) => option.name).join(', '),
      strings.usedBy(draft.items.filter((item) => item.groupIds.includes(group.id)).length),
    ],
  }));
  // One Card, as the Items tab's, its New group in the same place. Not primary: the header's Publish is the page's one.
  return (
    <Card
      title={strings.optionGroups}
      description={strings.optionGroupsLine}
      {...(draft.canEdit
        ? {
            actions: (
              <Button icon="plus" onPress={() => onOpen({ kind: 'group' })}>
                {strings.newGroupShort}
              </Button>
            ),
          }
        : {})}
    >
      <LinkList
        label={strings.optionGroups}
        density="compact"
        placement="card"
        rows={rows}
        onOpen={(id) => {
          if (draft.canEdit) onOpen({ kind: 'group', groupId: id });
        }}
        searchLabel={strings.optionGroups}
        isToolbarHidden
        emptyState={
          <EmptyState icon="sliders-horizontal" title={strings.noGroups}>
            {strings.noGroupsLine}
          </EmptyState>
        }
      />
    </Card>
  );
}
