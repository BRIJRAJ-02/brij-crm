# ViewHeader

The top of a view in the home page's live demo: the object's tile, its name and count, and its actions, as the app's top bar draws a page.

## Why it exists

The library's `TopBar` always renders its title as the page's `h1`; on the home page the `h1` is the site's promise, so the demo's view names are `h2`s. It draws the same row: `size-bar` tall under a hairline, the title type, the Icon tile and the Badge from the library.

## Use

```tsx
<ViewHeader icon="users" hue="green" title="People" count={12} actions={<Button>New person</Button>} />
```

## States

Static. The actions bring their own states.
