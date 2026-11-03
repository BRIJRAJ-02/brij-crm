// A dish's sheet and Your picks (spec 0065, H1, AC-6529, AC-6530, AC-6533): what a guest sees when they tap a dish
// on the guest menu (its photo, price, words, allergens in words, sizes and option groups as stacked cards, and Add to
// your picks) and the list of their picks with steppers and the total. Both go inside a `Modal` `sheet`, which holds
// focus and closes on Escape; data comes in through props, and picks are the caller's to keep.
import { choicesAllowed, formatPrice, formatPriceDelta, MENU_LIMITS, pickPrice } from '@crm/contracts/menu';
import type { OptionGroup, PublicMenu, SnapshotItem } from '@crm/contracts';
import { useId, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import styles from './ItemSheet.module.css';
import { strings } from './strings.ts';

/** Where a photo of the menu is served, at a width, versioned (the page's own origin). */
export type MenuPhotoHref = (photoId: string, size: 'large' | 'small', version: string) => string;

/** One dish a guest picked: the item, the size and options they chose, and how many. */
export interface GuestPick {
  readonly key: string;
  readonly itemId: string;
  readonly size?: number;
  readonly optionIds: readonly string[];
  readonly quantity: number;
}

/** The rule a group's choices follow, in words. */
const ruleWords = (group: OptionGroup) =>
  group.rule === 'one'
    ? strings.chooseOne
    : group.rule === 'up_to'
      ? strings.chooseUpTo(group.max ?? 1)
      : strings.chooseAny;

/** An item's bottom sheet (AC-6529, AC-6533): a proper dialog holding focus, closed with Escape. */
export function ItemSheet({
  item,
  menu,
  isSoldOut,
  photoHref,
  onPick,
}: {
  readonly item: SnapshotItem;
  readonly menu: PublicMenu;
  readonly isSoldOut: boolean;
  readonly photoHref?: MenuPhotoHref | undefined;
  readonly onPick?: (pick: Omit<GuestPick, 'key'>) => void;
}) {
  const { currency } = menu.menu;
  const { locale } = menu.place;
  const [size, setSize] = useState<number | undefined>(item.sizes.length > 0 ? 0 : undefined);
  const groups = item.groupIds
    .map((id) => menu.menu.groups[id])
    .filter((group): group is OptionGroup => group !== undefined);
  const [chosen, setChosen] = useState<ReadonlyMap<string, readonly string[]>>(
    new Map(
      groups
        .filter((group) => group.rule === 'one')
        .map((group) => [group.id, group.options[0] === undefined ? [] : [group.options[0].id]]),
    ),
  );
  const [quantity, setQuantity] = useState(1);
  const base = size === undefined ? (item.priceMinor ?? 0) : (item.sizes[size]?.priceMinor ?? 0);
  const deltas = groups.flatMap((group) =>
    (chosen.get(group.id) ?? []).map((id) => group.options.find((option) => option.id === id)?.priceDeltaMinor ?? 0),
  );
  const total = pickPrice(base, deltas, quantity);
  const contains = item.allergens
    .filter((each) => each.level === 'contains')
    .map((each) => strings.allergen[each.code]);
  const may = item.allergens.filter((each) => each.level === 'may').map((each) => strings.allergen[each.code]);
  const hasPrice = item.priceMinor !== undefined || item.sizes.length > 0;
  const name = useId();
  const toggle = (group: OptionGroup, optionId: string) =>
    setChosen((was) => {
      const nextMap = new Map(was);
      const list = was.get(group.id) ?? [];
      if (group.rule === 'one') nextMap.set(group.id, [optionId]);
      else if (list.includes(optionId))
        nextMap.set(
          group.id,
          list.filter((id) => id !== optionId),
        );
      else if (group.rule === 'any' || list.length < (group.max ?? 1)) nextMap.set(group.id, [...list, optionId]);
      return nextMap;
    });
  return (
    <div className={styles.sheet}>
      {item.photo === undefined || photoHref === undefined ? null : (
        <img
          className={styles.sheetPhoto}
          src={photoHref(item.photo.id, 'large', item.photo.version)}
          srcSet={`${photoHref(item.photo.id, 'small', item.photo.version)} 400w, ${photoHref(item.photo.id, 'large', item.photo.version)} 1200w`}
          sizes="(max-width: 480px) 100vw, 480px"
          alt={strings.decorative}
          width={1200}
          height={900}
        />
      )}
      <h2 className={styles.sheetName} id={name}>
        {item.name}
      </h2>
      <p className={styles.sheetMeta}>
        {isSoldOut ? <span className={styles.soldOut}>{strings.soldOut}</span> : null}
        {!isSoldOut && hasPrice ? <span className={styles.price}>{formatPrice(base, currency, locale)}</span> : null}
        {item.priceNote === undefined || hasPrice ? null : <span className={styles.price}>{item.priceNote}</span>}
        {item.kcal === undefined ? null : <span className={styles.quiet}>{strings.kcal(item.kcal)}</span>}
      </p>
      {item.description === undefined ? null : <p className={styles.sheetAbout}>{item.description}</p>}
      <p className={styles.allergens}>
        {contains.length === 0 && may.length === 0
          ? strings.noAllergens
          : [
              contains.length === 0 ? '' : strings.allergensLine(contains),
              may.length === 0 ? '' : strings.mayContainLine(may),
            ]
              .filter((part) => part !== '')
              .join(' ')}
      </p>
      {item.diet.length === 0 ? null : (
        <ul className={styles.dietList}>
          {item.diet.map((mark) => (
            <li key={mark} className={styles.dietMark}>
              {strings.diet[mark]}
            </li>
          ))}
        </ul>
      )}
      {item.sizes.length < 2 ? null : (
        <RadioGroup
          label={strings.sizes}
          variant="cards"
          value={String(size ?? 0)}
          onChange={(value) => setSize(Number(value))}
          isDisabled={isSoldOut}
        >
          {item.sizes.map((each, index) => (
            <Radio key={each.name} value={String(index)} description={formatPrice(each.priceMinor, currency, locale)}>
              {each.name}
            </Radio>
          ))}
        </RadioGroup>
      )}
      {groups.map((group) => {
        const picked = chosen.get(group.id) ?? [];
        const label = `${group.name} · ${ruleWords(group)}`;
        const priceOf = (delta: number) =>
          delta === 0 ? undefined : strings.delta(formatPriceDelta(delta, currency, locale));
        return group.rule === 'one' ? (
          <RadioGroup
            key={group.id}
            label={label}
            variant="cards"
            value={picked[0] ?? null}
            onChange={(value) => toggle(group, value)}
            isDisabled={isSoldOut}
          >
            {group.options.map((option) => {
              const description = priceOf(option.priceDeltaMinor);
              return (
                <Radio key={option.id} value={option.id} {...(description === undefined ? {} : { description })}>
                  {option.name}
                </Radio>
              );
            })}
          </RadioGroup>
        ) : (
          <fieldset key={group.id} className={styles.group}>
            <legend className={styles.groupName}>{label}</legend>
            {group.options.map((option) => {
              const description = priceOf(option.priceDeltaMinor);
              const isChosen = picked.includes(option.id);
              return (
                <Checkbox
                  key={option.id}
                  label={option.name}
                  {...(description === undefined ? {} : { description })}
                  isSelected={isChosen}
                  isDisabled={isSoldOut || (group.rule === 'up_to' && !isChosen && picked.length >= (group.max ?? 1))}
                  onChange={() => toggle(group, option.id)}
                />
              );
            })}
          </fieldset>
        );
      })}
      {onPick === undefined || isSoldOut || !hasPrice ? null : (
        <div className={styles.sheetActions}>
          <div className={styles.stepper} role="group" aria-label={strings.quantity}>
            <Button
              variant="ghost"
              icon="minus"
              label={strings.fewer}
              isDisabled={quantity <= 1}
              onPress={() => setQuantity((was) => Math.max(1, was - 1))}
            />
            <output className={styles.stepValue} aria-live="polite">
              {quantity}
            </output>
            <Button
              variant="ghost"
              icon="plus"
              label={strings.more}
              isDisabled={quantity >= MENU_LIMITS.quantityMax}
              onPress={() => setQuantity((was) => Math.min(MENU_LIMITS.quantityMax, was + 1))}
            />
          </div>
          <Button
            variant="primary"
            isDisabled={!groups.every((group) => choicesAllowed(group, (chosen.get(group.id) ?? []).length))}
            onPress={() =>
              onPick({
                itemId: item.id,
                ...(size === undefined ? {} : { size }),
                optionIds: [...chosen.values()].flat(),
                quantity,
              })
            }
          >
            {strings.addToPicks(formatPrice(total, currency, locale))}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One pick's price, from the menu as it stands (a dish gone from the menu counts nothing). */
function pickTotal(menu: PublicMenu, pick: GuestPick): number {
  const item = menu.menu.items[pick.itemId];
  if (item === undefined) return 0;
  const base = pick.size === undefined ? (item.priceMinor ?? 0) : (item.sizes[pick.size]?.priceMinor ?? 0);
  const deltas = item.groupIds.flatMap((id) =>
    (menu.menu.groups[id]?.options ?? [])
      .filter((option) => pick.optionIds.includes(option.id))
      .map((option) => option.priceDeltaMinor),
  );
  return pickPrice(base, deltas, pick.quantity);
}

/** Every pick's price added up (AC-6530). */
export const picksTotal = (menu: PublicMenu, picks: readonly GuestPick[]) =>
  picks.reduce((sum, pick) => sum + pickTotal(menu, pick), 0);

/** Your picks (AC-6530): the list, the total, and that nothing is sent. */
export function PicksSheet({
  menu,
  picks,
  onPicksChange,
}: {
  readonly menu: PublicMenu;
  readonly picks: readonly GuestPick[];
  readonly onPicksChange: (picks: readonly GuestPick[]) => void;
}) {
  const { currency } = menu.menu;
  const { locale } = menu.place;
  if (picks.length === 0) return <p className={styles.quiet}>{strings.emptyPicks}</p>;
  return (
    <div className={styles.sheet}>
      <h2 className={styles.sheetName}>{strings.yourPicks}</h2>
      <ul className={styles.picks}>
        {picks.map((pick) => {
          const item = menu.menu.items[pick.itemId];
          if (item === undefined) return null;
          const options = item.groupIds
            .flatMap((id) => menu.menu.groups[id]?.options ?? [])
            .filter((option) => pick.optionIds.includes(option.id))
            .map((option) => option.name);
          const sizeName = pick.size === undefined ? undefined : item.sizes[pick.size]?.name;
          const detail = [sizeName, ...options].filter((part) => part !== undefined).join(', ');
          return (
            <li key={pick.key} className={styles.pick}>
              <span className={styles.itemText}>
                <span className={styles.itemName}>{item.name}</span>
                {detail === '' ? null : <span className={styles.itemAbout}>{detail}</span>}
              </span>
              <span className={styles.pickEnd}>
                <span className={styles.price}>{formatPrice(pickTotal(menu, pick), currency, locale)}</span>
                <span className={styles.stepper} role="group" aria-label={strings.quantityOf(item.name)}>
                  <Button
                    variant="ghost"
                    icon={pick.quantity === 1 ? 'trash' : 'minus'}
                    label={pick.quantity === 1 ? strings.removePick(item.name) : strings.fewer}
                    onPress={() =>
                      onPicksChange(
                        pick.quantity === 1
                          ? picks.filter((each) => each.key !== pick.key)
                          : picks.map((each) =>
                              each.key === pick.key ? { ...each, quantity: each.quantity - 1 } : each,
                            ),
                      )
                    }
                  />
                  <output className={styles.stepValue}>{pick.quantity}</output>
                  <Button
                    variant="ghost"
                    icon="plus"
                    label={strings.more}
                    isDisabled={pick.quantity >= MENU_LIMITS.quantityMax}
                    onPress={() =>
                      onPicksChange(
                        picks.map((each) => (each.key === pick.key ? { ...each, quantity: each.quantity + 1 } : each)),
                      )
                    }
                  />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className={styles.total}>
        <span>{strings.picksTotal}</span>
        <span className={styles.price}>{formatPrice(picksTotal(menu, picks), currency, locale)}</span>
      </p>
      <p className={styles.quiet}>{strings.picksNote}</p>
      <Button variant="ghost" onPress={() => onPicksChange([])}>
        {strings.clearPicks}
      </Button>
    </div>
  );
}
