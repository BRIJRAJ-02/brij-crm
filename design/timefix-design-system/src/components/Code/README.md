Code shows text that must be copied exactly: a field's API name in a sentence, an embed snippet, a webhook URL or an API key.

**Use it for**: `Code` inline in a sentence (`company.owner.email`); `CodeBlock` for snippets and URLs people paste elsewhere (booking and form embeds, webhook payloads); `SecretKey` for API keys and signing secrets, masked by default. `CopyButton` stands alone wherever one value is copied. **Don't** use Code for emphasis, or show a secret unmasked by default.

**The consumer provides**: Code `children`. CodeBlock `code`, an optional `title` header ("Embed snippet · HTML"), `isCopyable` (on), `copyLabel`, `canWrap` and `defaultWrapped`. SecretKey `value`, `label` ("API key"), `visibleEnd` (4). CopyButton `value`, `label`.

**States**: CodeBlock scrolls long lines, or wraps them when the wrap toggle is pressed (`aria-pressed`). Without a title its buttons float at the top right. SecretKey shows its prefix (`tfx_live_`), twelve dots and the last four; revealed, the whole key. Copy confirms with a check for 1.6s and announces "Copied".

**Interaction**: the code area is focusable so it scrolls with the keyboard. Copy and reveal use transitions.dev 09 icon swap (Motion's `IconSwap`): the copy icon fades and shrinks to 0.25 as the check grows in, 250ms in-out; the eye swaps to eye-off the same way. Tooltips name each button.

**Replaces**: Code (inline, block and list), CopyButton's icon-only use.
