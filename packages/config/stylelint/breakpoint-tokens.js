// crm/breakpoint-tokens: CSS variables can't be used inside an @media or
// @container condition, so every length written there must be one of the
// breakpoint tokens: a bp-page-* value in @media, a bp-container-* value in
// @container. Range syntax and min-/max- both work; calc(), em and rem don't.
// It reads packages/tokens/tokens.json by path (not as a dependency, since
// @crm/tokens already depends on this package).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import stylelint from 'stylelint';

const ruleName = 'crm/breakpoint-tokens';
const TOKENS_JSON = path.resolve(import.meta.dirname, '../../tokens/tokens.json');

const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (length, atRule, allowed) =>
    `${length} in @${atRule} isn't a breakpoint token. Use ${allowed || 'a breakpoint token'} (write the range form, e.g. width < 1024px, not an off by one value).`,
  calc: (atRule) => `Don't use calc() in an @${atRule} condition. Use a breakpoint token value.`,
});

// Lengths only: resolutions (2dppx) and ratios (16/9) aren't breakpoints.
const LENGTH =
  /(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+))(px|r?em|ch|ex|vw|vh|vi|vb|vmin|vmax|[sld]v[hw]|cq[whib]|cqmin|cqmax|pt|pc|in|cm|mm|q)\b/gi;

/** The allowed lengths per at-rule, from the `breakpoint` family in tokens.json. */
function allowedLengths() {
  const tokens = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')).breakpoint?.tokens ?? [];
  const values = (prefix) =>
    tokens.filter((token) => token.name.startsWith(prefix)).map((token) => String(token.value));
  return { media: values('bp-page-'), container: values('bp-container-') };
}

const ruleFunction = (primary) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;
  const allowed = allowedLengths();

  root.walkAtRules(/^(media|container)$/i, (atRule) => {
    const kind = atRule.name.toLowerCase() === 'media' ? 'media' : 'container';
    if (/\bcalc\(/i.test(atRule.params)) {
      stylelint.utils.report({ ruleName, result, node: atRule, message: messages.calc(kind) });
    }
    for (const match of atRule.params.matchAll(LENGTH)) {
      const length = match[0].toLowerCase();
      if (!allowed[kind].includes(length)) {
        stylelint.utils.report({
          ruleName,
          result,
          node: atRule,
          word: match[0],
          message: messages.rejected(match[0], kind, allowed[kind].join(', ')),
        });
      }
    }
  });
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

/** The Stylelint plugin for crm/breakpoint-tokens. */
export const breakpointTokens = stylelint.createPlugin(ruleName, ruleFunction);
