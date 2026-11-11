A toast confirms something that just happened, and offers Undo when it can be undone.

**Use it for**: one short past-tense line after an action ("Changes saved", "Jo Mendes deleted"), with Undo for anything reversible, which is how deletes avoid a confirm dialog. Short failures that need no reading ("Couldn't reach Google Calendar"). **Don't** put errors the user must act on in a toast (use a Callout), or anything that needs a decision (use a dialog).

**The consumer provides**: `ToastProvider` once at the app's root; then `const { toast } = useToast()` and `toast({ message, tone, action })`. `tone` is `success` (drawn tick), `danger`, `info` or `neutral` (no icon). `action` is one `{ label, onAction }`. `createToaster()` makes a queue outside React.

**States**: one (ink pill, bottom centre), several (newest in front, two older ones peek above), spread (hovered or focused), leaving.

**Interaction**: 5 seconds, 8 with an action; timers pause while the stack is hovered or focused. F6 reaches the region; Tab moves through Undo and ×. Arrivals follow transitions.dev banner stacking: the new pill rises 60px from 0.97 over 350ms while older ones step back 12px, shrink 6% and fade; hover spreads them a pill apart. Dismissing drops the pill 16px on the 250ms clock. Success ticks draw in.

**Replaces**: ToastRegion, toasts (createToasts, useToasts).
