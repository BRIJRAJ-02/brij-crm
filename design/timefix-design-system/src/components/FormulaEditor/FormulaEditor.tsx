import { Label, Text, TextArea, TextField } from 'react-aria-components';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AtSign, CircleAlert, FunctionSquare } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { ATTRIBUTE_TYPES, AttributeIcon, type AttributeType } from '../AttributeField/AttributeField.tsx';
import { useShake } from '../Field/Field.tsx';
import { Button } from '../Button/Button.tsx';
import { TextSwap } from '../Motion/Motion.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import './FormulaEditor.css';

/** An attribute a formula can read. Formulas compute with numbers, so only number-like types give a value. */
export interface FormulaAttribute { readonly id: string; readonly name: string; readonly type: AttributeType }

/** A function a formula can call: its name, how it is called and one line on what it does. */
export interface FormulaFunction { readonly name: string; readonly signature: string; readonly description: string; readonly arity: readonly [number, number] }

/** The functions every formula can use. */
export const FORMULA_FUNCTIONS: ReadonlyArray<FormulaFunction> = [
  { name: 'ROUND', signature: 'ROUND(value, digits)', description: 'Rounds to a number of decimals', arity: [1, 2] },
  { name: 'IF', signature: 'IF(test, then, else)', description: 'One value when the test holds, another when not', arity: [3, 3] },
  { name: 'MIN', signature: 'MIN(a, b, …)', description: 'The smallest of the values', arity: [1, 20] },
  { name: 'MAX', signature: 'MAX(a, b, …)', description: 'The largest of the values', arity: [1, 20] },
  { name: 'ABS', signature: 'ABS(value)', description: 'The value without its sign', arity: [1, 1] },
  { name: 'SUM', signature: 'SUM(a, b, …)', description: 'Adds the values', arity: [1, 20] },
];

const NUMERIC: ReadonlySet<AttributeType> = new Set<AttributeType>(['number', 'currency', 'percent', 'rating', 'checkbox']);

/** What a formula gives for one record, or why it can't. `at` is the 1-based character the problem starts at. */
export type FormulaResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string; readonly at: number };

interface Stop { readonly formulaStop: true; readonly message: string; readonly at: number }
const isStop = (e: unknown): e is Stop => typeof e === 'object' && e !== null && 'formulaStop' in e;
type Tok = { readonly k: 'num'; readonly v: number; readonly at: number } | { readonly k: 'attr' | 'fn' | 'op'; readonly v: string; readonly at: number };

/** Reads `{Deal value} * {Win chance}` against one record's values (attribute id → number; empty counts as 0). Pure, so the server can run the same. */
export function evaluateFormula(source: string, attributes: ReadonlyArray<FormulaAttribute>, values: Readonly<Record<string, number | undefined>>): FormulaResult {
  const toks: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|\{([^{}]*)\}|([A-Za-z_]+)|(>=|<=|!=|[-+*/(),<>=]))/y;
  let i = 0;
  while (i < source.length) {
    if (source.slice(i).trim() === '') break;
    re.lastIndex = i;
    const m = re.exec(source);
    if (!m) { const j = i + source.slice(i).length - source.slice(i).trimStart().length; return { ok: false, message: `“${source[j] ?? ''}” can't be read here.`, at: j + 1 }; }
    const at = m.index + m[0].length - m[0].trimStart().length + 1;
    if (m[1] !== undefined) toks.push({ k: 'num', v: Number(m[1]), at });
    else if (m[2] !== undefined) toks.push({ k: 'attr', v: m[2], at });
    else if (m[3] !== undefined) toks.push({ k: 'fn', v: m[3].toUpperCase(), at });
    else if (m[4] !== undefined) toks.push({ k: 'op', v: m[4], at });
    i = re.lastIndex;
  }
  if (toks.length === 0) return { ok: false, message: 'Type @ to add an attribute, or a number.', at: 1 };
  let p = 0;
  const fail = (message: string, t?: Tok): never => { throw { formulaStop: true, message, at: t?.at ?? source.length + 1 } satisfies Stop; };
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = toks[p]; return t !== undefined && t.k === 'op' && t.v === v; };
  const expect = (v: string) => { if (!isOp(v)) fail(peek() ? `Expected “${v}” here.` : `Missing “${v}” at the end.`, peek()); p += 1; };
  const primary = (): number => {
    const t = toks[p];
    if (!t) return fail('The formula ends too early.');
    p += 1;
    if (t.k === 'num') return t.v;
    if (t.k === 'attr') {
      const a = attributes.find((x) => x.name.toLowerCase() === t.v.trim().toLowerCase());
      if (!a) return fail(`There is no attribute called {${t.v}}.`, t);
      if (!NUMERIC.has(a.type)) return fail(`${a.name} is ${ATTRIBUTE_TYPES[a.type].label.toLowerCase()}, and formulas compute with numbers.`, t);
      return values[a.id] ?? 0;
    }
    if (t.k === 'fn') {
      const f = FORMULA_FUNCTIONS.find((x) => x.name === t.v);
      if (!f) return fail(`There is no function called ${t.v}.`, t);
      expect('(');
      const args: number[] = [];
      if (!isOp(')')) { args.push(compare()); while (isOp(',')) { p += 1; args.push(compare()); } }
      expect(')');
      if (args.length < f.arity[0] || args.length > f.arity[1]) return fail(`${f.name} takes ${f.arity[0] === f.arity[1] ? f.arity[0] : `${f.arity[0]} to ${f.arity[1]}`} value${f.arity[1] === 1 ? '' : 's'}: ${f.signature}.`, t);
      const [a = 0, b = 0, c = 0] = args;
      switch (f.name) {
        case 'ROUND': { const d = 10 ** Math.round(b); return Math.round(a * d) / d; }
        case 'IF': return a !== 0 ? b : c;
        case 'MIN': return Math.min(...args);
        case 'MAX': return Math.max(...args);
        case 'ABS': return Math.abs(a);
        default: return args.reduce((s, x) => s + x, 0);
      }
    }
    if (t.v === '(') { const v = compare(); expect(')'); return v; }
    if (t.v === '-') return -primary();
    return fail(`“${t.v}” needs a value before it.`, t);
  };
  const mul = (): number => {
    let v = primary();
    while (isOp('*') || isOp('/')) {
      const op = toks[p]; p += 1;
      const r = primary();
      if (op?.v === '/' && r === 0) fail('This divides by zero for the sample record.', op);
      v = op?.v === '*' ? v * r : v / r;
    }
    return v;
  };
  const add = (): number => { let v = mul(); while (isOp('+') || isOp('-')) { const op = toks[p]; p += 1; const r = mul(); v = op?.v === '+' ? v + r : v - r; } return v; };
  const compare = (): number => {
    const v = add();
    const t = peek();
    if (t && t.k === 'op' && ['>', '<', '>=', '<=', '=', '!='].includes(t.v)) {
      p += 1; const r = add();
      return Number(t.v === '>' ? v > r : t.v === '<' ? v < r : t.v === '>=' ? v >= r : t.v === '<=' ? v <= r : t.v === '=' ? v === r : v !== r);
    }
    return v;
  };
  try {
    const value = compare();
    const rest = peek();
    if (rest) return { ok: false, message: `“${rest.v}” needs an operator before it, like + or *.`, at: rest.at };
    return { ok: true, value };
  } catch (e) {
    if (isStop(e)) return { ok: false, message: e.message, at: e.at };
    throw e;
  }
}

/** What the suggestion list offers at the caret: attributes after @, functions after a word. */
type Suggest = { readonly mode: 'attr' | 'fn'; readonly from: number; readonly query: string } | undefined;
function suggestAt(text: string, caret: number): Suggest {
  const before = text.slice(0, caret);
  const opens = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
  if (opens > 0) return undefined;
  const at = /@([^@{}()+\-*/,<>=]{0,24})$/.exec(before);
  if (at) return { mode: 'attr', from: caret - at[0].length, query: at[1] ?? '' };
  const word = /(?:^|[^A-Za-z_\d])([A-Za-z_]{1,12})$/.exec(before);
  if (word?.[1]) return { mode: 'fn', from: caret - word[1].length, query: word[1] };
  return undefined;
}

/** Props for FormulaEditor. */
export interface FormulaEditorProps {
  readonly label?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly attributes: ReadonlyArray<FormulaAttribute>;
  /** A record to try the formula on: its name and its values by attribute id. */
  readonly sample: { readonly name: string; readonly values: Readonly<Record<string, number | undefined>> };
  /** How the result reads (a currency, a percent from a fraction, a plain number). */
  readonly format?: (n: number) => string;
  /** Enter with a formula that works. An invalid one shakes instead. */
  readonly onSubmit?: (value: string) => void;
}

/**
 * A computed attribute's formula: a mono field where attributes read as chips (`{Deal value}`), @ lists attributes to insert,
 * a word lists functions, the result for a sample record updates as you type, and a problem shows its line (and shakes on Enter).
 */
export function FormulaEditor({ label = 'Formula', value, onChange, attributes, sample, format = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 }), onSubmit }: FormulaEditorProps) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const { ref: box, shake } = useShake<HTMLDivElement>();
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<string>();
  const [focused, setFocused] = useState(false);
  const result = evaluateFormula(value, attributes, sample.values);
  // The problem line waits for a pause in typing, so it doesn't flicker on every key.
  const [shown, setShown] = useState<FormulaResult>(result);
  useEffect(() => { const t = window.setTimeout(() => setShown(evaluateFormula(value, attributes, sample.values)), result.ok ? 0 : 600); return () => window.clearTimeout(t); }, [value, attributes, sample.values, result.ok]);

  const s = focused && closedAt !== `${value}|${caret}` ? suggestAt(value, caret) : undefined;
  const items: ReadonlyArray<{ readonly key: string; readonly label: string; readonly sub: string; readonly icon: ReactNode; readonly insert: string; readonly caretBack: number }> =
    s?.mode === 'attr'
      ? attributes.filter((a) => a.name.toLowerCase().includes(s.query.trim().toLowerCase())).slice(0, 8).map((a) => ({ key: a.id, label: a.name, sub: ATTRIBUTE_TYPES[a.type].label, icon: <AttributeIcon type={a.type} size={14} />, insert: `{${a.name}}`, caretBack: 0 }))
      : s?.mode === 'fn'
        ? FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(s.query.toUpperCase()) && f.name !== s.query.toUpperCase()).map((f) => ({ key: f.name, label: f.signature, sub: f.description, icon: <FunctionSquare size={14} strokeWidth={1.75} />, insert: `${f.name}()`, caretBack: 1 }))
        : [];
  const open = items.length > 0;
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const put = (text: string, from: number, to: number, back = 0) => {
    const next = value.slice(0, from) + text + value.slice(to);
    const pos = from + text.length - back;
    onChange(next);
    setCaret(pos);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(pos, pos); });
  };
  const pick = (i: number) => { const it = items[i]; if (it && s) put(it.insert, s.from, caret, it.caretBack); setActive(0); };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setActive((current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length); return; }
    if (open && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(current); return; }
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setClosedAt(`${value}|${caret}`); return; }
    if (e.key === 'Enter') { e.preventDefault(); setShown(result); if (result.ok) onSubmit?.(value); else shake(); }
  };
  const sync = () => { const a = area.current; if (a) { setCaret(a.selectionStart); if (back.current) back.current.scrollTop = a.scrollTop; } };
  const error = !shown.ok && value.trim() !== '' ? shown : undefined;

  return (
    <div className="tf-formulaeditor">
      <TextField value={value} onChange={(v) => { onChange(v); setActive(0); }} className="tf-formulaeditor__field" isInvalid={error !== undefined}>
        <div className="tf-formulaeditor__labelrow">
          <Label className="tf-formulaeditor__label">{label}</Label>
          <Button size="sm" variant="ghost" icon={<AtSign size={14} strokeWidth={1.75} />} onPress={() => put('@', caret, caret)}>Attribute</Button>
        </div>
        <div ref={box} className={cx('tf-formulaeditor__box', error && 'is-error')}>
          <div ref={back} className="tf-formulaeditor__backdrop" aria-hidden="true">{highlight(value, attributes)}{'\n'}</div>
          <TextArea
            ref={area} className="tf-formulaeditor__input" rows={2} spellCheck={false} placeholder="Type @ for an attribute, then + − × ÷"
            role="combobox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-autocomplete="list"
            aria-activedescendant={open ? `${id}-opt-${current}` : undefined}
            onKeyDown={keys} onSelect={sync} onScroll={sync} onKeyUp={sync} onClick={sync}
            onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setShown(result); }}
          />
          {open && (
            <div className="tf-formulaeditor__pop" role="listbox" id={`${id}-list`} aria-label={s?.mode === 'attr' ? 'Attributes' : 'Functions'}>
              <span className="tf-formulaeditor__pophead">{s?.mode === 'attr' ? 'Attributes' : 'Functions'}</span>
              {items.map((it, i) => (
                <div
                  key={it.key} id={`${id}-opt-${i}`} role="option" aria-selected={i === current} className="tf-formulaeditor__opt"
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setActive(i)}
                >
                  <span className="tf-formulaeditor__opticon">{it.icon}</span>
                  <span className={cx('tf-formulaeditor__optlabel', s?.mode === 'fn' && 'is-mono')}>{it.label}</span>
                  <span className="tf-formulaeditor__optsub">{it.sub}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <Text slot="errorMessage" className="tf-formulaeditor__error" aria-live="polite">
          {error && <><CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />{error.message} <span className="tf-formulaeditor__at">Character {error.at}.</span></>}
        </Text>
      </TextField>

      <div className={cx('tf-formulaeditor__result', result.ok ? 'is-ok' : 'is-off')} aria-live="polite">
        <span className="tf-formulaeditor__resultlabel">Result for {sample.name}</span>
        <span className="tf-formulaeditor__resultvalue">
          <TextSwap swapKey={result.ok ? format(result.value) : 'none'}>{result.ok ? format(result.value) : '—'}</TextSwap>
        </span>
      </div>
      <p className="tf-formulaeditor__help"><Kbd>@</Kbd> attributes <Kbd>↑</Kbd><Kbd>↓</Kbd> choose <Kbd>Enter</Kbd> insert <Kbd>Esc</Kbd> close</p>
    </div>
  );
}

/** The backdrop: the same text, with `{Attribute}` drawn as a chip (its braces become the chip's padding) and function names in ink. */
function highlight(text: string, attributes: ReadonlyArray<FormulaAttribute>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{[^{}]*\}|[A-Za-z_]+(?=\s*\()/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index;
    out.push(text.slice(last, at));
    const tok = m[0];
    if (tok.startsWith('{')) {
      const a = attributes.find((x) => x.name.toLowerCase() === tok.slice(1, -1).trim().toLowerCase());
      out.push(<span key={at} className={cx('tf-formulaeditor__chip', !a && 'is-unknown')}><span className="tf-formulaeditor__brace">{'{'}</span>{tok.slice(1, -1)}<span className="tf-formulaeditor__brace">{'}'}</span></span>);
    } else {
      out.push(<span key={at} className="tf-formulaeditor__fn">{tok}</span>);
    }
    last = at + tok.length;
  }
  out.push(text.slice(last));
  return out;
}
