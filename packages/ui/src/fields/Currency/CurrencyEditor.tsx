import { CURRENCY_CODES, type CurrencyValue } from '@crm/contracts/values';
import { useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { formatDecimal } from '../../lib/format.ts';
import { parseAmount, readsDifferently } from '../../lib/parse-input.ts';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { useFormatSettings, useRegionDefaults } from '../../provider/context.ts';
import { strings as fieldStrings } from '../strings.ts';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { isCompactSurface, toCommittable } from '../values.ts';
import { strings } from './strings.ts';

const CODES: ReadonlySet<string> = new Set<string>(CURRENCY_CODES);

/**
 * Currency: the amount in a Field, with its currency code as a searchable
 * picker in front. A new amount starts in the attribute's default, else the
 * workspace's currency. The amount forgives what people paste ("$1,200",
 * "1.2k", "(300)"), and a symbol or code typed with it moves the picker.
 */
export function CurrencyEditor(props: EditorProps<'currency'>) {
  const { locale } = useFormatSettings();
  const region = useRegionDefaults();
  const current = props.value === null || Array.isArray(props.value) ? undefined : (props.value as CurrencyValue);
  const [currency, setCurrency] = useState(current?.currency ?? props.attribute.defaultCurrency ?? region.currency);
  const [amount, setAmount] = useState(current?.amount);
  // Set when a pasted symbol or code moved the picker, so the hint says so; picking by hand clears it.
  const [changedTo, setChangedTo] = useState<string | undefined>(undefined);
  const names = new Intl.DisplayNames(locale, { type: 'currency' });
  const example = formatDecimal('1234.5', locale);

  const picker = (
    <MenuTrigger>
      <Button variant="ghost" iconRight="chevron-down" isDisabled={props.isDisabled === true}>
        {currency}
      </Button>
      <Menu
        label={strings.currencies}
        items={CURRENCY_CODES.map((code) => ({ id: code, name: names.of(code) ?? code }))}
        isVirtualized
        search={{ label: strings.searchCurrencies }}
        selectionMode="single"
        selectedKeys={[currency]}
        onAction={(key) => {
          const code = String(key) as CurrencyValue['currency'];
          setCurrency(code);
          setChangedTo(undefined);
          if (amount !== undefined) {
            const result = toCommittable<'currency'>(props.attribute, { amount, currency: code });
            if (result.ok) props.onCommit(result.value);
          }
        }}
      >
        {(item) => (
          <MenuItem id={item.id} meta={item.id}>
            {item.name}
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );

  return (
    <TextLikeEditor<'currency'>
      {...props}
      initial={current === undefined ? '' : formatDecimal(current.amount, locale)}
      inputMode="decimal"
      align="end"
      prefix={picker}
      placeholder={example}
      {...(isCompactSurface(props.surface)
        ? {}
        : { hint: changedTo === undefined ? strings.hint : strings.changedTo(changedTo) })}
      // What the typed amount saves as, before it saves, when it reads differently: "1.2k" as 1,200.
      hintOf={(draft) => {
        const read = draft.trim() === '' ? undefined : parseAmount(draft, { locale, defaultCurrency: currency });
        return read === undefined || !readsDifferently(draft, read.amount)
          ? undefined
          : fieldStrings.readsAs(formatDecimal(read.amount, locale));
      }}
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'currency'>(props.attribute, null);
        const parsed = parseAmount(draft, { locale, defaultCurrency: currency });
        if (parsed === undefined) return { ok: false, message: strings.invalid(example) };
        const code = parsed.currency !== undefined && CODES.has(parsed.currency) ? parsed.currency : currency;
        if (code !== currency) {
          setCurrency(code);
          setChangedTo(code);
        }
        setAmount(parsed.amount);
        return toCommittable<'currency'>(props.attribute, { amount: parsed.amount, currency: code });
      }}
    />
  );
}
