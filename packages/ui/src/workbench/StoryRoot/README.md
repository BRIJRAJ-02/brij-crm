# StoryRoot

The frame every Storybook story renders in: the page surface, with room around the story so screenshots catch focus rings and shadows.

## Why it exists

The screenshot tests capture one element per story (`data-testid="story-root"`). A focus ring or a shadow drawn outside a component's box would be cut off if the screenshot framed the component itself, so the frame adds padding on the themed surface. Stories may not carry CSS of their own, so the frame is a workbench component.

A menu, popover, dialog or tooltip opens in a portal outside the frame, and a floating panel is fixed to the viewport. While one is open, the screenshot step (`.storybook/vitest.visual.ts`) stretches the frame to the viewport's height, so the screenshot takes the overlay in too.

It is used only by `.storybook/preview.tsx`, and is not exported from `@crm/ui`.

## Use

The Storybook preview wraps every story in it. Stories never render it themselves.
