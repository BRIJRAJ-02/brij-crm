// What the artifact's window.Workspace holds: the library's public surface and
// its heavy entries (the grid, the charts and Ask AI),
// plus the pieces previews draw with (Stage, FieldSurfaces, the icon registry and
// the editor's scoped icon set with its IconScope, a frozen clock, and
// CheckboxMark, which stays off the public entry since screens draw a checkbox
// value through the field set). The reset, base and cursor rules come along, since the preview frame loads
// only the artifact's tokens.css before bundle.css.
import '../../src/styles/reset.css';
import '../../src/styles/base.css';
import '../../src/styles/cursors.css';

export * from '../../src/index.ts';
export * from '../../src/grid.ts';
export * from '../../src/charts.ts';
export * from '../../src/ai.ts';
export { CheckboxMark } from '../../src/atoms/Checkbox/Checkbox.tsx';
export { icons } from '../../src/atoms/Icon/icons.ts';
export { editorIcons } from '../../src/atoms/Icon/editor-icons.ts';
export { IconScope } from '../../src/atoms/Icon/Icon.tsx';
export { createFixedClock } from '../../src/provider/clock.ts';
export { Stage } from '../../src/workbench/Stage/Stage.tsx';
export { FieldSurfaces } from '../../src/workbench/FieldSurfaces/FieldSurfaces.tsx';
// The business page's parts (spec 0066, B4 lite) live on the public booking entry, not the app's; its card draws them.
export {
  BusinessHours,
  BusinessLocation,
  BusinessMenu,
  BusinessPage,
  BusinessReserve,
  businessAction,
} from '../../src/modules/BusinessPage/BusinessPage.tsx';
