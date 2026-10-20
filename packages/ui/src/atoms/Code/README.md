# Code

Code in the mono `code` style, inline or as a block to paste, with an optional copy button.

## Why it exists

New. API keys, webhook URLs, field API names and the developer settings (#34, #39) show code the same way, and the copy that goes with it.

## Use

```tsx
<Code>person.email_addresses</Code>
<Code isCopyable copyLabel="Copy the webhook URL">https://hooks.example.com/abc</Code>
```

- `variant="block"` is a snippet to paste (an embed snippet, a form's HTML): its own box with lines kept and wrapped, and a Copy button inside its top end, always. `isClamped` holds a long one to eight lines under a fade, with "Show all" under it. Why a variant and not a read only Field: a read only Field draws a lock, which reads as a permission problem on something you are meant to copy, and a snippet is code, not a value you could edit.
- `isCopyable` adds an icon only CopyButton after it. A successful copy says so in a toast; if the browser refuses, an error toast says to copy by hand and the text is selected.

## States

Inline and block; block clamped and opened. The copy button has Button's.

## Keyboard

The code takes no focus; the copy button and Show all are buttons.

## Differences from the artifact

Not in the artifact.
