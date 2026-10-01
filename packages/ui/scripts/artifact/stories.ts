// Finds the stories each artifact card shows: the ones flagged
// `parameters: { crm: { preview: true } }`, read from the stories file's
// syntax tree, so nothing has to run to know them.
import ts from 'typescript';

/** One component card for the artifact, from one stories file. */
export interface StoryCard {
  /** The card's name: the last segment of the story title ("Atoms/Button" gives Button). */
  readonly name: string;
  /** Its group on the artifact page: the title's first segment (Atoms, Molecules, Modules). */
  readonly group: string;
  /** The story title, as written. */
  readonly title: string;
  /** The exported stories flagged for the preview, in file order. */
  readonly previews: readonly string[];
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of object.properties) {
    if (ts.isPropertyAssignment(member) && member.name.getText() === name) return unwrap(member.initializer);
  }
  return undefined;
}

function isFlagged(story: ts.ObjectLiteralExpression): boolean {
  const parameters = property(story, 'parameters');
  if (parameters === undefined || !ts.isObjectLiteralExpression(parameters)) return false;
  const crm = property(parameters, 'crm');
  if (crm === undefined || !ts.isObjectLiteralExpression(crm)) return false;
  return property(crm, 'preview')?.kind === ts.SyntaxKind.TrueKeyword;
}

/** The meta object: `export default { … }`, or `export default meta` with `const meta = { … }`. */
function findMeta(source: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  let meta: ts.ObjectLiteralExpression | undefined;
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
        if (value !== undefined && ts.isObjectLiteralExpression(value)) objects.set(declaration.name.getText(), value);
      }
    }
    if (ts.isExportAssignment(statement)) {
      const value = unwrap(statement.expression);
      meta = ts.isObjectLiteralExpression(value) ? value : objects.get(value.getText());
    }
  }
  return meta;
}

/** The card a stories file makes, or undefined when it flags no story for the preview. */
export function readStoryCard(fileName: string, code: string): StoryCard | undefined {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const meta = findMeta(source);
  const titleNode = meta === undefined ? undefined : property(meta, 'title');
  if (titleNode === undefined || !ts.isStringLiteralLike(titleNode)) return undefined;

  const previews = source.statements.flatMap((statement) => {
    const exported = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!ts.isVariableStatement(statement) || exported !== true) return [];
    return statement.declarationList.declarations.flatMap((declaration) => {
      const value = declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
      return value !== undefined && ts.isObjectLiteralExpression(value) && isFlagged(value)
        ? [declaration.name.getText()]
        : [];
    });
  });
  if (previews.length === 0) return undefined;

  const segments = titleNode.text.split('/');
  return {
    name: segments.at(-1) ?? titleNode.text,
    group: segments[0] ?? titleNode.text,
    title: titleNode.text,
    previews,
  };
}
