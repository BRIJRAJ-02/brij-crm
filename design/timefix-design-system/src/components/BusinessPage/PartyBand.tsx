import { Phone } from 'lucide-react';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';

/** Props for PartyBand. */
export interface PartyBandProps {
  readonly value: number;
  readonly onChange: (size: number) => void;
  /** The largest party booked online; its chip reads "8+" and asks bigger parties to call. */
  readonly max?: number;
  /** The place's phone, for parties of `max` or more. */
  readonly phone?: string;
}

/** A restaurant table's party size: 1 to 7 and 8+ as chips, with a line opening under them for a bigger party. */
export function PartyBand({ value, onChange, max = 8, phone }: PartyBandProps) {
  const items = Array.from({ length: max }, (_, n) => ({ id: String(n + 1), label: n + 1 === max ? `${max}+` : String(n + 1) }));
  const big = value >= max;
  return (
    <div className="tf-party">
      <ChoiceChips label="Party size" items={items} selectedKeys={[String(Math.min(value, max))]}
        onSelectionChange={(keys) => { const k = [...keys][0]; if (k) onChange(Number(k)); }} />
      {/* 21 accordion: the note opens in flow and pushes what follows down. */}
      <div className="tf-party__more" data-open={big || undefined} aria-hidden={!big}>
        <div className="tf-party__clip">
          <p className="tf-party__note">
            <Phone size={14} strokeWidth={1.75} aria-hidden />
            {phone
              ? <span>For {max} or more, call <a className="tf-party__link" href={`tel:${phone.replace(/\s/g, '')}`} tabIndex={big ? 0 : -1}>{phone}</a> and we'll set a table.</span>
              : <span>For {max} or more, call the restaurant.</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
