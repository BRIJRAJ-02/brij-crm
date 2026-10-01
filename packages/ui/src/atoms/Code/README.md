# Code

Code in the mono `code` style, with an optional copy button.

## Why it exists

New. API keys, webhook URLs, field API names and the developer settings (#34, #39) show code the same way, and the copy that goes with it.

## Use

```tsx
<Code>person.email_addresses</Code>
<Code isCopyable copyLabel="Copy the webhook URL">https://hooks.example.com/abc</Code>
```

- `isCopyable` adds an icon only CopyButton after it. A successful copy says so in a toast; if the browser refuses, an error toast says to copy by hand and the text is selected.

## States

None of its own; the copy button has Button's.

## Keyboard

The code takes no focus; the copy button is a button.

## Differences from the artifact

Not in the artifact.
