# Code

Code in the mono `code` style: inline, on its own line, or a list of codes, with an optional copy button.

## Why it exists

New. API keys, webhook URLs, field API names and the developer settings (#34, #39) show code the same way, and the copy that goes with it.

## Use

```tsx
<Code>person.email_addresses</Code>
<Code isCopyable copyLabel="Copy the webhook URL">https://hooks.example.com/abc</Code>
<Code variant="block" isCopyable copyLabel="Copy the setup key">JBSW Y3DP EHPK 3PXP</Code>
<Code variant="list" isCopyable copyLabel="Copy the backup codes">{codes.join('\n')}</Code>
```

- `isCopyable` adds an icon only CopyButton after it. A successful copy says so in a toast; if the browser refuses, an error toast says to copy by hand and the text is selected.
- `variant="block"` puts the code on its own line, in a box at the slot's full width, with the copy button inside the box at its end, on the first line. Lines break only between space separated groups, so a setup key's groups of four stay whole; only a group longer than the whole line is ever split.
- `variant="list"` takes one code per line of `children` ("\n" between them) and draws them as two columns of whole codes, read across (ten codes make five rows). Copy, inside the box, copies them one per line, as given.
- Why variants, not a new component: it is the same code, in the same face and the same sunken box, with the same copy button and its failure path. Two factor setup showed its ten backup codes as one run of text that wrapped mid code ("FGVrW-" at a line's end), so someone copying them by hand wrote a wrong code, and its setup key inline, where it wrapped mid group across two lines with its copy button outside the box (SA34 and the owner's A122, 23 October 2026). Only where the code sits changes, so it is a variant of Code.

## States

None of its own; the copy button has Button's. Inline, block and list, each with and without Copy.

## Keyboard

The code takes no focus; the copy button is a button.

## Differences from the artifact

Not in the artifact.
