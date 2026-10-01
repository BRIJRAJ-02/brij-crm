# Stage

Lays out a story's pieces with the artifact's stage spacing, for Storybook stories and the artifact previews made from them.

## Why it exists

Stories may not carry CSS of their own (every CSS module belongs to one component), yet most stories show several pieces side by side. The artifact draws its previews on a `ws-stage` utility class; Stage is that class as a component, so the previews built from stories look the same.

It is not exported from `@crm/ui`. Screens lay out with real modules (app shell, panels, cards), never with Stage.

## Use

```tsx
<Stage>
  <Button>Cancel</Button>
  <Button variant="primary">Save</Button>
</Stage>
<Stage direction="column">…</Stage>
```

- `direction`: `row` (the default) wraps pieces side by side, centred on one line; `column` stacks them, aligned to the start.

## Differences from the artifact

The artifact has two utility classes, `ws-stage` and `ws-stage-col`. Here they are one component with a `direction` prop.
