// Runs inside an artifact preview frame: renders a card's flagged stories with
// their args, inside UiProvider, as Storybook would (play functions dropped).
// The build points every library import here and in the stories at
// window.Workspace, the bundle the frame preloads, so a preview carries only
// the stories' own code.
import { createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createFixedClock } from '../../src/provider/clock.ts';
import { createToasts } from '../../src/provider/toasts.tsx';
import { UiProvider } from '../../src/provider/UiProvider.tsx';
import { Stage } from '../../src/workbench/Stage/Stage.tsx';

type Args = Record<string, unknown>;

/** A story object, as far as a preview needs it. */
export interface PreviewStory {
  readonly args?: Args;
  readonly render?: (args: Args) => ReactNode;
}

/** A stories file's meta, as far as a preview needs it. */
export interface PreviewMeta {
  readonly component?: ComponentType<Args>;
  readonly args?: Args;
}

/** The moment previews see, as in Storybook: 8 October 2026, 14:30 UTC. */
const PREVIEW_NOW = Date.UTC(2026, 9, 8, 14, 30);

/** Renders `stories` from the stories file whose meta is `meta` into #root. */
export function renderPreview(meta: PreviewMeta, stories: readonly PreviewStory[]) {
  const shown = stories.map((story, index) => {
    const args = { ...meta.args, ...story.args };
    // A story with only args shows its component on a stage, like one with a render.
    const element =
      story.render !== undefined ? (
        story.render(args)
      ) : meta.component === undefined ? null : (
        <Stage>{createElement(meta.component, args)}</Stage>
      );
    return <div key={index}>{element}</div>;
  });

  const root = document.getElementById('root');
  if (root === null) throw new Error('The preview is missing its #root element.');
  createRoot(root).render(
    <UiProvider
      locale="en-US"
      timeZone="Europe/London"
      navigate={() => undefined}
      toasts={createToasts()}
      clock={createFixedClock(PREVIEW_NOW)}
    >
      <Stage direction="column">{shown}</Stage>
    </UiProvider>,
  );
}
