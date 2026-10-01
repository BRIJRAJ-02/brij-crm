import { CURRENCY_CODES, type CurrencyValue } from '@crm/contracts/values';
import { useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { parseLocaleDecimal } from '../../lib/decimal.ts';
import { formatDecimal } from '../../lib/format.ts';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';
import { strings } from './strings.ts';

/** Currency: the amount in a Field, with its currency code as a searchable picker in front. */
export function CurrencyEditor(props: EditorProps<'currency'>) {
  const { locale } = useFormatSettings();
  const current = props.value === null || Array.isArray(props.value) ? undefined : (props.value as CurrencyValue);
  const [currency, setCurrency] = useState(current?.currency ?? props.attribute.defaultCurrency ?? 'USD');
  const [amount, setAmount] = useState(current?.amount);
  const names = new Intl.DisplayNames(locale, { type: 'currency' });
  const example = formatDecimal('1234.5', locale);

  const picker = (
    <MenuTrigger>
      <Button variant="ghost" iconRight="chevron-down">
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
      prefix={picker}
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'currency'>(props.attribute, null);
        const canonical = parseLocaleDecimal(draft, locale);
        if (canonical === undefined) return { ok: false, message: strings.invalid(example) };
        setAmount(canonical);
        return toCommittable<'currency'>(props.attribute, { amount: canonical, currency });
      }}
    />
  );
}
