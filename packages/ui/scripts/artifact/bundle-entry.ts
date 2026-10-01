// What the artifact's window.Workspace holds: the library's public surface,
// plus the pieces previews draw with (Stage, the icon registry, a frozen
// clock). The reset and base layers come along, since the preview frame loads
// only the artifact's tokens.css before bundle.css.
import '../../src/styles/reset.css';
import '../../src/styles/base.css';

export * from '../../src/index.ts';
export { icons } from '../../src/atoms/Icon/icons.ts';
export { createFixedClock } from '../../src/provider/clock.ts';
export { Stage } from '../../src/workbench/Stage/Stage.tsx';
