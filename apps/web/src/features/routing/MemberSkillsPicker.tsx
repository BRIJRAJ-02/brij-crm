// Brief
// Purpose: one member's skills as a picker (spec 0037, AC-1382), on Routing › Skills and on each Round robin row.
// Main task: add or remove skills from a member; each change saves at once and comes back on a refusal.
// Leaves out: making or renaming skills (Routing › Skills), and what a skill does in a rule (the rule's dialog).
import { isDataError, type DataLayer, type RoutingSkill, type SkillsView } from '@crm/data';
import { Select, type Toasts } from '@crm/ui';
import { skillStrings as strings } from './skills-strings.ts';

/** Props for MemberSkillsPicker. */
export interface MemberSkillsPickerProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly memberId: string;
  readonly memberName: string;
  /** The workspace's skills and who holds them, as the data layer shows them. */
  readonly view: SkillsView;
  /** Without routing.manage: the member's skills, read only. */
  readonly isReadOnly?: boolean;
  readonly toasts: Toasts;
  readonly size?: 'sm' | 'md';
}

/** A skill's group, as the list heads it. */
const groupOf = (skill: RoutingSkill) => strings.groups[skill.group];

/** One member's skills: a multiple Select of the workspace's skills, by group, searchable. */
export function MemberSkillsPicker({
  data,
  slug,
  memberId,
  memberName,
  view,
  isReadOnly = false,
  toasts,
  size = 'sm',
}: MemberSkillsPickerProps) {
  const held = view.members.find((member) => member.memberId === memberId)?.skillIds ?? [];
  return (
    <Select
      label={strings.skillsOf(memberName)}
      isLabelHidden
      size={size}
      selectionMode="multiple"
      optionStyle="tag"
      isSearchable
      maxVisible={3}
      placeholder={strings.pickSkills}
      isReadOnly={isReadOnly}
      items={view.skills.map((skill) => ({ id: skill.id, label: skill.name, group: groupOf(skill) }))}
      values={held}
      onValuesChange={(ids) => {
        data.routing.skills.setMember(slug, memberId, ids).catch((error: unknown) => {
          toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failed });
        });
      }}
    />
  );
}
