The AI surface: Ask AI about a record, see it think, read the answer as it streams, and the violet marks that show what AI filled.

**Use it for**: Ask AI on records, meetings and forms; marking AI enriched values and tags. **Don't** use the `ai` violet anywhere else: not for buttons, links or selection.

**The consumer provides**: for `AIAssist`, the `context` name, `suggestions`, `thinking` status lines, `onAsk` (a promise of the answer), `onInsertNote`, `onClose`. `AITag`, `AIMark` and `StreamText` are exported for other surfaces (enrichment progress, AI attributes); the shimmer and thinking line are Motion's `ShimmerText` and `ThinkingLine`.

**States**: start (headline and suggestion chips), thinking, streaming (Stop replaces Ask), done (Copy, Save as note), stopped.

**Interaction**: the start headline and sub-line rise 12px out of, 40ms apart, and the chips follow (texts reveal, 500ms). While it works, one shimmering status line swaps every 2 seconds, the old line rising out as the next rises in (thinking states). The answer resolves word by word through (streaming text, 350ms per word). Enter asks, Shift+Enter breaks a line. Copy swaps to a tick (icon swap).

**Replaces**: the AI attribute marks and the assistant panel bits.
