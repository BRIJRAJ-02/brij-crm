import { Badge } from '../../atoms/Badge/Badge.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { SelectBase, SelectFacesContext, type SelectFaces, type SelectProps } from './Select.tsx';

/** The dot and badge faces Select gives its options. */
const SELECT_FACES: SelectFaces = {
  dot: (item) => (
    <StatusDot hue={item.hue ?? 'gray'} isArchived={item.isArchived ?? false}>
      {item.label}
    </StatusDot>
  ),
  badge: (text) => <Badge text={text} />,
};

/**
 * Choose one of a short list (up to about 15): a stage, a status, an owner.
 * Its options show as tags, status dots or people, the same as the value
 * everywhere else. Built on React Aria's Select, so it opens with the arrow
 * keys, types to jump, and puts focus back when it closes. The body is
 * SelectBase (`Select.tsx`); this file adds the dot and badge faces.
 */
export function Select(props: SelectProps) {
  return (
    <SelectFacesContext value={SELECT_FACES}>
      <SelectBase {...props} />
    </SelectFacesContext>
  );
}
