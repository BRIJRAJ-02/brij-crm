// A dish's sheet and Your picks (spec 0065, H1, AC-6529, AC-6530, AC-6533), after the checklabs guest app's flow: what
// a guest sees when they tap a dish (its photo, name, price, words, sizes and option groups as cards with their price,
// allergens in words, calories, then a foot that stays in view with the quantity and "Add to your selection" carrying the
// live price) and the list of their picks (each line with its choices, price and stepper, Undo after a removal, the
// total with any tax inside it and service on top). Both are the body of a `Modal` (`sheet-card`, `sheet-side`), which
// holds focus and closes on Escape; data comes in through props, and picks are the caller's to keep.
import {
  choicesAllowed,
  formatPrice,
  formatPriceDelta,
  formatRate,
  MENU_LIMITS,
  pickPrice,
  picksTotal as billOf,
  type PicksTotal,
} from '@crm/contracts/menu';
import type { OptionGroup, PublicMenu, SnapshotItem, SnapshotMenu } from '@crm/contracts';
import { useId, useRef, useState } from 'react';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { NumberPop } from '../../atoms/NumberPop/NumberPop.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stepper } from '../../molecules/Stepper/Stepper.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import styles from './ItemSheet.module.css';
import { livePicks, pickKey, sizePrice, type GuestPick } from './picks.ts';
import { strings } from './strings.ts';

export { livePicks, pickKey, type GuestPick };

/** Where a photo of the menu is served, at a width, versioned (the page's own origin). */
export type MenuPhotoHref = (photoId: string, size: 'large' | 'small', version: string) => string;

/** The rule a group's choices follow, in words, with "Required" when the guest must pick. */
const ruleWords = (group: OptionGroup) => {
  const rule =
    group.rule === 'one'
      ? strings.chooseOne
      : group.rule === 'up_to'
        ? strings.chooseUpTo(group.max ?? 1)
        : strings.chooseAny;
  return (group.min ?? 0) > 0 ? `${rule} · ${strings.required}` : rule;
};

/** Why Add waits, in one line, for the first group whose choices aren't allowed yet; undefined when none waits. */
function waitingFor(groups: readonly OptionGroup[], chosen: ReadonlyMap<string, readonly string[]>) {
  const group = groups.find((each) => !choicesAllowed(each, (chosen.get(each.id) ?? []).length));
  if (group === undefined) return undefined;
  const least = Math.max(1, group.min ?? 0);
  return least === 1 ? strings.chooseFrom(group.name) : strings.chooseAtLeast(least, group.name);
}

/** An item's sheet (AC-6529, AC-6533): the body of a `Modal` `sheet-card`. */
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
  const price = (minor: number) => formatPrice(minor, currency, locale);
  const [size, setSize] = useState<string | undefined>(item.sizes[0]?.id);
  const groups = item.groupIds
    .map((id) => menu.menu.groups[id])
    .filter((group): group is OptionGroup => group !== undefined);
  // A choose one group starts on its first option, as checklabs' does, unless the guest must decide.
  const [chosen, setChosen] = useState<ReadonlyMap<string, readonly string[]>>(
    new Map(
      groups
        .filter((group) => group.rule === 'one' && (group.min ?? 0) === 0)
        .map((group) => [group.id, group.options[0] === undefined ? [] : [group.options[0].id]]),
    ),
  );
  const [quantity, setQuantity] = useState(1);
  const base = size === undefined ? (item.priceMinor ?? 0) : (sizePrice(item, size) ?? 0);
  const deltas = groups.flatMap((group) =>
    (chosen.get(group.id) ?? []).map((id) => group.options.find((option) => option.id === id)?.priceDeltaMinor ?? 0),
  );
  const total = pickPrice(base, deltas, quantity);
  const contains = item.allergens
    .filter((each) => each.level === 'contains')
    .map((each) => strings.allergen[each.code]);
  const may = item.allergens.filter((each) => each.level === 'may').map((each) => strings.allergen[each.code]);
  const hasPrice = item.priceMinor !== undefined || item.sizes.length > 0;
  const waiting = waitingFor(groups, chosen);
  const reasonId = useId();
  const toggle = (group: OptionGroup, optionId: string) =>
    setChosen((was) => {
      const next = new Map(was);
      const list = was.get(group.id) ?? [];
      if (group.rule === 'one') next.set(group.id, [optionId]);
      else if (list.includes(optionId))
        next.set(
          group.id,
          list.filter((id) => id !== optionId),
        );
      else if (group.rule === 'any' || list.length < (group.max ?? 1)) next.set(group.id, [...list, optionId]);
      return next;
    });
  const canPick = onPick !== undefined && !isSoldOut && hasPrice;
  return (
    <div className={styles.sheet}>
      {item.photo === undefined || photoHref === undefined ? null : (
        <img
          className={styles.sheetPhoto}
          src={photoHref(item.photo.id, 'large', item.photo.version)}
          srcSet={`${photoHref(item.photo.id, 'small', item.photo.version)} 400w, ${photoHref(item.photo.id, 'large', item.photo.version)} 1200w`}
          sizes="(max-width: 480px) 100vw, 448px"
          alt={strings.decorative}
          width={1200}
          height={900}
        />
      )}
      <div
        className={styles.sheetBody}
        data-bare={item.photo === undefined || photoHref === undefined ? '' : undefined}
      >
        <div className={styles.sheetHead}>
          <h2 className={styles.sheetName}>{item.name}</h2>
          <p className={styles.sheetMeta}>
            {isSoldOut ? <span className={styles.soldOut}>{strings.soldOut}</span> : null}
            {!isSoldOut && hasPrice ? (
              <span className={styles.price}>
                {item.sizes.length > 1
                  ? strings.priceFrom(price(Math.min(...item.sizes.map((s) => s.priceMinor))))
                  : price(base)}
              </span>
            ) : null}
            {item.priceNote === undefined || hasPrice ? null : <span className={styles.price}>{item.priceNote}</span>}
            {item.kcal === undefined ? null : <span className={styles.quiet}>{strings.kcal(item.kcal)}</span>}
          </p>
        </div>
        {item.description === undefined ? null : <p className={styles.sheetAbout}>{item.description}</p>}
        {item.diet.length === 0 ? null : (
          <ul className={styles.dietList} aria-label={strings.dietary}>
            {item.diet.map((mark) => (
              <li key={mark}>
                <Badge text={strings.diet[mark]} size="chip" isWhole />
              </li>
            ))}
          </ul>
        )}
        {item.sizes.length < 2 ? null : (
          <div className={styles.group}>
            <p className={styles.groupName} aria-hidden="true">
              {strings.sizes}
            </p>
            <RadioGroup
              label={strings.sizes}
              isLabelHidden
              variant="cards"
              value={size ?? ''}
              onChange={setSize}
              isDisabled={isSoldOut}
            >
              {item.sizes.map((each) => (
                <Radio key={each.id} value={each.id} description={price(each.priceMinor)}>
                  {each.name}
                </Radio>
              ))}
            </RadioGroup>
          </div>
        )}
        {groups.map((group) => {
          const picked = chosen.get(group.id) ?? [];
          const label = `${group.name} · ${ruleWords(group)}`;
          const priceOf = (delta: number) =>
            delta === 0 ? undefined : strings.delta(formatPriceDelta(delta, currency, locale));
          return group.rule === 'one' ? (
            <div key={group.id} className={styles.group}>
              <p className={styles.groupName} aria-hidden="true">
                {label}
              </p>
              <RadioGroup
                label={label}
                isLabelHidden
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
            </div>
          ) : (
            <fieldset key={group.id} className={styles.group}>
              <legend className={styles.groupName} data-legend="">
                {label}
              </legend>
              <div className={styles.choices}>
                {group.options.map((option) => {
                  const description = priceOf(option.priceDeltaMinor);
                  const isChosen = picked.includes(option.id);
                  return (
                    <Checkbox
                      key={option.id}
                      label={option.name}
                      {...(description === undefined ? {} : { description })}
                      isSelected={isChosen}
                      isDisabled={
                        isSoldOut || (group.rule === 'up_to' && !isChosen && picked.length >= (group.max ?? 1))
                      }
                      onChange={() => toggle(group, option.id)}
                    />
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        {/* ALLERGENS, then each as a chip (checklabs' dish sheet), only when the dish names any; "may contain" ones
          say so on their chip. */}
        {contains.length === 0 && may.length === 0 ? null : (
          <div className={styles.group}>
            <h3 className={styles.groupName}>{strings.allergens}</h3>
            <ul className={styles.dietList}>
              {contains.map((name) => (
                <li key={name}>
                  <Badge text={name} size="chip" isWhole />
                </li>
              ))}
              {may.map((name) => (
                <li key={name}>
                  <Badge text={strings.mayContainChip(name)} size="chip" isWhole />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {canPick ? (
        <div className={styles.sheetActions}>
          {waiting === undefined ? null : (
            <p className={styles.reason} id={reasonId} aria-live="polite">
              {waiting}
            </p>
          )}
          <div className={styles.actionRow}>
            <Stepper
              size="lg"
              tone="filled"
              label={strings.quantity}
              isLabelHidden
              value={quantity}
              min={1}
              max={MENU_LIMITS.quantityMax}
              onChange={setQuantity}
            />
            <span className={styles.addSlot}>
              <Button
                variant="primary"
                size="sheet"
                isFullWidth
                isRound
                amount={price(total)}
                isDisabled={waiting !== undefined}
                {...(waiting === undefined ? {} : { 'aria-describedby': reasonId })}
                onPress={() =>
                  onPick({
                    itemId: item.id,
                    ...(size === undefined ? {} : { sizeId: size }),
                    optionIds: [...chosen.values()].flat(),
                    quantity,
                  })
                }
              >
                {strings.addToPicks}
              </Button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One pick's price, from the menu as it stands (a dish gone from the menu counts nothing). */
function pickTotal(menu: PublicMenu, pick: GuestPick): number {
  const item = menu.menu.items[pick.itemId];
  if (item === undefined) return 0;
  const base = pick.sizeId === undefined ? (item.priceMinor ?? 0) : (sizePrice(item, pick.sizeId) ?? 0);
  const deltas = item.groupIds.flatMap((id) =>
    (menu.menu.groups[id]?.options ?? [])
      .filter((option) => pick.optionIds.includes(option.id))
      .map((option) => option.priceDeltaMinor),
  );
  return pickPrice(base, deltas, pick.quantity);
}

/** Every pick's price added up, before any service (AC-6530). */
export const picksTotal = (menu: PublicMenu, picks: readonly GuestPick[]) =>
  picks.reduce((sum, pick) => sum + pickTotal(menu, pick), 0);

/** Which of the place's menus holds an item (the first that shows it), for its rates and its group in Your picks. */
function menuOf(menu: PublicMenu, itemId: string): SnapshotMenu | undefined {
  return menu.menu.menus.find((each) =>
    each.sections.some(
      (section) => section.itemIds.includes(itemId) || section.sections.some((sub) => sub.itemIds.includes(itemId)),
    ),
  );
}

/**
 * Your picks added up (AC-6530): each menu's picks with that menu's rates (tax inside its prices, service on top,
 * checklabs' rollup), summed. A guest with no rates on any menu sees the subtotal as the total.
 */
export function picksBill(menu: PublicMenu, picks: readonly GuestPick[]): PicksTotal {
  const byMenu = new Map<SnapshotMenu | undefined, number>();
  for (const pick of picks) {
    const owner = menuOf(menu, pick.itemId);
    byMenu.set(owner, (byMenu.get(owner) ?? 0) + pickTotal(menu, pick));
  }
  return [...byMenu].reduce<PicksTotal>(
    (sum, [owner, subtotal]) => {
      const part = billOf(subtotal, owner?.taxRate ?? 0, owner?.serviceRate ?? 0);
      return {
        subtotal: sum.subtotal + part.subtotal,
        tax: sum.tax + part.tax,
        service: sum.service + part.service,
        total: sum.total + part.total,
      };
    },
    { subtotal: 0, tax: 0, service: 0, total: 0 },
  );
}

/** Your picks (AC-6530): the lines grouped by menu, Undo after a removal, the total, and that nothing is sent. */
export function PicksSheet({
  menu,
  picks,
  onPicksChange,
  photoHref,
}: {
  readonly menu: PublicMenu;
  readonly picks: readonly GuestPick[];
  readonly onPicksChange: (picks: readonly GuestPick[]) => void;
  readonly photoHref?: MenuPhotoHref | undefined;
}) {
  const { currency } = menu.menu;
  const { locale } = menu.place;
  const price = (minor: number) => formatPrice(minor, currency, locale);
  // The picks as they were before the last removal or Clear all, and what that was: one press puts them back.
  const [undo, setUndo] = useState<{ readonly said: string; readonly picks: readonly GuestPick[] } | undefined>();
  const undoRef = useRef<HTMLButtonElement>(null);
  const change = (next: readonly GuestPick[], said?: string) => {
    setUndo(said === undefined ? undefined : { said, picks });
    onPicksChange(next);
    // A removal takes the pressed button with its line: focus goes to Undo, the next thing to do, never to Close.
    if (said !== undefined) focusLater(() => undoRef.current);
  };
  const bill = picksBill(menu, picks);
  const count = picks.reduce((sum, pick) => sum + pick.quantity, 0);
  // Grouped under their menu's name when the picks come from more than one menu (Dinner, then Wine list).
  const groups = new Map<string, { readonly name: string | undefined; readonly picks: GuestPick[] }>();
  for (const pick of picks) {
    const owner = menuOf(menu, pick.itemId);
    const key = owner?.id ?? '';
    const group = groups.get(key) ?? { name: owner?.name, picks: [] };
    group.picks.push(pick);
    groups.set(key, group);
  }
  const isGrouped = groups.size > 1;
  const rates = new Set(
    picks.flatMap((pick) => {
      const owner = menuOf(menu, pick.itemId);
      return owner === undefined ? [] : [`${String(owner.taxRate ?? 0)}|${String(owner.serviceRate ?? 0)}`];
    }),
  );
  // One rate across every pick names its percent; mixed rates say only the amounts.
  const [oneRate] = rates.size === 1 ? [...rates] : [];
  const [taxRate, serviceRate] = (oneRate ?? '0|0').split('|').map(Number);
  const undoLine =
    undo === undefined ? null : (
      <p className={styles.undo} role="status">
        <span>{undo.said}</span>
        <Button
          ref={undoRef}
          variant="ghost"
          onPress={() => {
            onPicksChange(undo.picks);
            setUndo(undefined);
          }}
        >
          {strings.undo}
        </Button>
      </p>
    );
  if (picks.length === 0)
    return (
      <div className={styles.picksSheet}>
        <div className={styles.picksHead}>
          <h2 className={styles.picksTitle}>{strings.yourPicks}</h2>
        </div>
        <div className={styles.picksBody}>
          {undoLine}
          <EmptyState title={strings.emptyPicksTitle} icon="utensils">
            {strings.emptyPicks}
          </EmptyState>
        </div>
      </div>
    );
  return (
    <div className={styles.picksSheet}>
      <div className={styles.picksHead}>
        <h2 className={styles.picksTitle}>{strings.yourPicks}</h2>
        <p className={styles.picksCount}>{strings.picksCount(count)}</p>
      </div>
      <div className={styles.picksBody}>
        {[...groups.values()].map((group) => (
          <section key={group.name ?? ''} className={styles.pickGroup} aria-label={group.name ?? strings.yourPicks}>
            {isGrouped && group.name !== undefined ? <h3 className={styles.groupName}>{group.name}</h3> : null}
            <ul className={styles.picks}>
              {group.picks.map((pick) => {
                const item = menu.menu.items[pick.itemId];
                if (item === undefined) return null;
                const options = item.groupIds
                  .flatMap((id) => menu.menu.groups[id]?.options ?? [])
                  .filter((option) => pick.optionIds.includes(option.id))
                  .map((option) => option.name);
                const sizeName = item.sizes.find((each) => each.id === pick.sizeId)?.name;
                const detail = [sizeName, ...options].filter((part) => part !== undefined).join(', ');
                const photo = item.photo === undefined || photoHref === undefined ? undefined : item.photo;
                return (
                  <li key={pick.key} className={styles.pick}>
                    {photo === undefined || photoHref === undefined ? null : (
                      <img
                        className={styles.pickThumb}
                        src={photoHref(photo.id, 'small', photo.version)}
                        alt={strings.decorative}
                        loading="lazy"
                        width={400}
                        height={400}
                      />
                    )}
                    <span className={styles.itemText}>
                      <span className={styles.itemName}>{item.name}</span>
                      {detail === '' ? null : <span className={styles.itemAbout}>{detail}</span>}
                      <span className={styles.price}>
                        <NumberPop value={price(pickTotal(menu, pick))} />
                      </span>
                    </span>
                    <Stepper
                      label={strings.quantityOf(item.name)}
                      value={pick.quantity}
                      isLabelHidden
                      min={0}
                      max={MENU_LIMITS.quantityMax}
                      fewerLabel={pick.quantity === 1 ? strings.removePick(item.name) : strings.fewer}
                      onChange={(next) =>
                        next === 0
                          ? change(
                              picks.filter((each) => each.key !== pick.key),
                              strings.removed(item.name),
                            )
                          : change(picks.map((each) => (each.key === pick.key ? { ...each, quantity: next } : each)))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {undoLine}
      </div>
      <div className={styles.picksFoot}>
        <dl className={styles.bill}>
          {bill.service > 0 ? (
            <div className={styles.billLine}>
              <dt>{strings.subtotal}</dt>
              <dd className={styles.price}>{price(bill.subtotal)}</dd>
            </div>
          ) : null}
          {bill.tax > 0 ? (
            <div className={styles.billLine} data-quiet="">
              <dt>
                {taxRate === undefined || taxRate === 0
                  ? strings.includesTax
                  : strings.includesTaxAt(formatRate(taxRate))}
              </dt>
              <dd className={styles.price}>{price(bill.tax)}</dd>
            </div>
          ) : null}
          {bill.service > 0 ? (
            <div className={styles.billLine} data-quiet="">
              <dt>
                {serviceRate === undefined || serviceRate === 0
                  ? strings.service
                  : strings.serviceAt(formatRate(serviceRate))}
              </dt>
              <dd className={styles.price}>{`+${price(bill.service)}`}</dd>
            </div>
          ) : null}
          <div className={styles.billLine} data-total="">
            <dt>{strings.picksTotal}</dt>
            <dd className={styles.price}>
              <NumberPop value={price(bill.total)} />
            </dd>
          </div>
        </dl>
        <p className={styles.note}>{strings.picksNote}</p>
        <Button variant="ghost" icon="trash" onPress={() => change([], strings.cleared)}>
          {strings.clearPicks}
        </Button>
      </div>
    </div>
  );
}
