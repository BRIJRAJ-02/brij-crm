// Brief
// Purpose: the workspace's option groups (after checklabs' modifier groups, which it left unlinked): shared choices
// such as Milk or Sides, each a rule and its options, offered by any dish.
// Main task: make a group once and offer it on many dishes.
// Leaves out: which dishes offer a group (each dish's drawer picks its groups).
import type { MenuDraft } from '@crm/data';
import { Button, EmptyState, LinkList, type LinkRow } from '@crm/ui';
import type { Open } from './MenusScreen.tsx';
import { strings } from './strings.ts';

/** The option groups. */
export function OptionsTab({ draft, onOpen }: { readonly draft: MenuDraft; readonly onOpen: (open: Open) => void }) {
  const rows = draft.groups.map((group): LinkRow => ({
    id: group.id,
    title: group.name,
    address: strings.ruleSummary(group.rule, group.max, group.min),
    description: group.options.map((option) => option.name).join(', '),
    chips: [strings.usedBy(draft.items.filter((item) => item.groupIds.includes(group.id)).length)],
  }));
  return (
    <LinkList
      label={strings.optionGroups}
      rows={rows}
      onOpen={(id) => {
        if (draft.canEdit) onOpen({ kind: 'group', groupId: id });
      }}
      searchLabel={strings.optionGroups}
      isToolbarHidden={draft.groups.length === 0}
      actions={
        draft.canEdit ? (
          <Button icon="plus" onPress={() => onOpen({ kind: 'group' })}>
            {strings.newGroup}
          </Button>
        ) : undefined
      }
      emptyState={
        <EmptyState
          icon="sliders-horizontal"
          title={strings.noGroups}
          actions={
            draft.canEdit ? (
              <Button variant="primary" icon="plus" onPress={() => onOpen({ kind: 'group' })}>
                {strings.newGroup}
              </Button>
            ) : undefined
          }
        >
          {strings.noGroupsLine}
        </EmptyState>
      }
    />
  );
}
