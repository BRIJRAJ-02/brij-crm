Link is a text link inside a sentence or a meta line, plus the "Learn more" link that leads somewhere further.

**Use it for**: references in running text (a booking page, a person, an email address), links out to another site, quiet links in grey meta lines (`variant="muted"`: "12 submissions"), and `LearnMoreLink` for "Learn more", "See all" and "Continue" at the end of a card or callout. **Don't** use a link for an action that changes data; that is a Button. Don't style a Button to look like a link.

**The consumer provides**: `href` (an app path, `#fragment`, `http(s)`, `mailto` or `tel`) or `onPress`, `children`, `variant` (`default` link colour, `muted` grey), `weight` (`strong` for a line's action), `isExternal` (defaults on for http links), `label` when the words are ambiguous out of context.

**States**: rest (no underline), hover (underline eases in over 150ms, 0.22em under the text), focus-visible (2px ring), external (a 14px arrow-up-right, opens in a new tab, and says "(opens in a new tab)" to screen readers), unsafe href (rendered as plain text).

**Interaction**: Enter follows the link. LearnMoreLink uses transitions.dev 24 learn more hover: on hover the chevron shifts 2px and its arms rotate 8deg apart into an arrow over 350ms with the smooth-out ease, and eases back the same way. Focus and touch keep the resting chevron.

**Replaces**: Link.
