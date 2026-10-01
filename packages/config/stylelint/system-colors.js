// crm/system-colors: CSS system colours (Highlight, CanvasText, ButtonText...)
// follow the operating system's high contrast palette, so they belong only
// inside @media (forced-colors: active). Anywhere else they would bypass the
// tokens and break both themes.
import stylelint from 'stylelint';

const ruleName = 'crm/system-colors';

const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (color) =>
    `${color} is a system colour. Use it only inside @media (forced-colors: active); elsewhere use a token.`,
});

/** The CSS system colours. The token rule lets them through; this rule decides where they may go. */
export const SYSTEM_COLORS = [
  'AccentColor',
  'AccentColorText',
  'ActiveText',
  'ButtonBorder',
  'ButtonFace',
  'ButtonText',
  'Canvas',
  'CanvasText',
  'Field',
  'FieldText',
  'GrayText',
  'Highlight',
  'HighlightText',
  'LinkText',
  'Mark',
  'MarkText',
  'SelectedItem',
  'SelectedItemText',
  'VisitedText',
];

// Whole words outside var() names and strings: `--canvas-x` or `"Field"` don't count.
const SYSTEM_COLOR = new RegExp(`(?<![\\w-])(${SYSTEM_COLORS.join('|')})(?![\\w-])`, 'gi');

function insideForcedColors(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.type === 'atrule' &&
      parent.name.toLowerCase() === 'media' &&
      /forced-colors\s*:\s*active/i.test(parent.params)
    ) {
      return true;
    }
  }
  return false;
}

const ruleFunction = (primary) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;

  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--') || insideForcedColors(decl)) return;
    const value = decl.value.replaceAll(/(["']).*?\1/g, '');
    for (const match of value.matchAll(SYSTEM_COLOR)) {
      stylelint.utils.report({ ruleName, result, node: decl, word: match[0], message: messages.rejected(match[0]) });
    }
  });
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

/** The Stylelint plugin for crm/system-colors. */
export const systemColors = stylelint.createPlugin(ruleName, ruleFunction);
