// The attribute dialog's "Change type" step (the field types pass, 31 October 2026): the new type, its own setting
// when it has one (a currency's code, a phone's country), and what the change would do, read from every value
// before anything is written. Shown in AttributeSettings' Modal through its `step`, as a relationship's is, so the
// scrim, the dialog and where focus returns stay as they were. Presentational: the targets, the check and the
// answer's refusal come in; the choice, Back and Change type go out.
import { PICKER_TYPES, type AttributeType } from '@crm/contracts/values';
import { useEffect } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { fieldTypeOf } from '../../fields/registry.ts';
import { formatNumber } from '../../lib/format.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Select } from '../../molecules/Select/SelectWithFaces.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { useRegionDefaults } from '../../provider/region.ts';
import type { DialogStep } from '../RelationshipSettings/RelationshipSettings.tsx';
import { pickerLabel, TypeSettings } from './AttributeSettings.tsx';
import { strings } from './strings.ts';

/** What a type change would do, as the screen read it: the server's own check. */
export interface TypeChangePreview {
  /** Values held in live records, every record counted, including any the reader can't open. */
  readonly total: number;
  readonly converts: number;
  readonly fails: number;
  /** What else changes ("Unique turns off."). */
  readonly consequences: readonly string[];
  /** Why it can't happen now: values that don't convert first, then what uses the field and can't follow. */
  readonly blockers: readonly string[];
}

/** What `typeChangeStep` takes. */
export interface TypeChangeStepProps {
  /** The picker keys the attribute may become (`typeChangeTargets`), in order. */
  readonly targets: readonly string[];
  /** The picker key chosen. */
  readonly target: string;
  /**
   * The chosen type's settings: a currency's `defaultCurrency` (the step fills in the workspace's at once when it
   * has none, so a check always names one), a phone's `defaultCountry`.
   */
  readonly config: Readonly<Record<string, unknown>>;
  readonly onTargetChange: (target: string) => void;
  readonly onConfigChange: (config: Readonly<Record<string, unknown>>) => void;
  /** The check of the chosen target: `loading` while it is read, `error` when it couldn't be. */
  readonly check: TypeChangePreview | 'loading' | 'error';
  readonly onRetry: () => void;
  /** The table filtered to the records whose values can't convert, shown with the first blocker. */
  readonly failedLink?: { readonly label: string; readonly href: string } | undefined;
  /** The server's refusal of Change type, if it refused. */
  readonly error?: string | undefined;
  readonly isBusy: boolean;
  readonly onBack: () => void;
  readonly onApply: () => void;
}

/** Whether the change may be made: the check is in, nothing fails and nothing stops it. */
export function canApplyTypeChange(check: TypeChangeStepProps['check']): boolean {
  return typeof check === 'object' && check.fails === 0 && check.blockers.length === 0;
}

/**
 * The type change step's title, footer and body, for AttributeSettings' `step`: Back returns to the settings,
 * Change type is on only once the check found nothing in the way.
 */
export function typeChangeStep(props: TypeChangeStepProps): DialogStep {
  const { isBusy, onBack, onApply, check } = props;
  return {
    title: strings.changeType,
    actions: (
      <>
        <Button icon="arrow-left" isDisabled={isBusy} onPress={onBack}>
          {strings.back}
        </Button>
        <Button variant="primary" isDisabled={!canApplyTypeChange(check)} isPending={isBusy} onPress={onApply}>
          {isBusy ? strings.changingType : strings.changeType}
        </Button>
      </>
    ),
    body: <TypeChangeBody {...props} />,
  };
}

/** The step's body: the new type, its setting, and the check. */
function TypeChangeBody({
  targets,
  target,
  config,
  onTargetChange,
  onConfigChange,
  check,
  onRetry,
  failedLink,
  error,
  isBusy,
}: TypeChangeStepProps) {
  const { locale } = useFormatSettings();
  const region = useRegionDefaults();
  const entry = PICKER_TYPES.find((each) => each.key === target);
  const type: AttributeType = entry?.type ?? 'text';
  const count = (n: number) => formatNumber(String(n), locale);
  // A currency needs its code before anything is checked: the workspace's (else the language's region's), as a
  // new Currency attribute starts in, until the person picks another.
  const needsCurrency = type === 'currency' && typeof config.defaultCurrency !== 'string';
  useEffect(() => {
    if (needsCurrency) onConfigChange({ ...config, defaultCurrency: region.currency });
  }, [needsCurrency, config, region.currency, onConfigChange]);
  const items = PICKER_TYPES.filter((each) => targets.includes(each.key)).map((each) => ({
    id: each.key,
    label: pickerLabel(each),
    icon: fieldTypeOf(each.type).icon,
  }));
  return (
    <>
      <Select
        label={strings.newType}
        // Focus lands on the step's one question as it replaces the settings, as the relationship step's does.
        autoFocus={!isBusy}
        items={items}
        value={target}
        onChange={(next) => {
          if (next !== null) onTargetChange(next);
        }}
        {...(isBusy ? { isDisabled: true } : {})}
      />
      <TypeSettings
        type={type}
        config={config}
        defaultCurrency={region.currency}
        isReadOnly={isBusy}
        error={undefined}
        onChange={onConfigChange}
      />
      {check === 'loading' && <Callout>{strings.checkingValues}</Callout>}
      {check === 'error' && (
        <Callout
          tone="danger"
          actions={
            <Button size="sm" onPress={onRetry}>
              {strings.retry}
            </Button>
          }
        >
          {strings.checkFailed}
        </Callout>
      )}
      {typeof check === 'object' && check.blockers.length > 0 && (
        <Callout
          tone="warning"
          isAnnounced
          {...(failedLink === undefined || check.fails === 0
            ? {}
            : { actions: <Link href={failedLink.href}>{failedLink.label}</Link> })}
        >
          {check.blockers.join(' ')}
        </Callout>
      )}
      {/* One line for a change that can go ahead: every value converting, then what else changes with it. */}
      {typeof check === 'object' && canApplyTypeChange(check) && (
        <Callout tone="success" isAnnounced>
          {[
            check.total === 0 ? strings.noValues : strings.allConvert(count(check.total), check.total),
            ...check.consequences,
          ].join(' ')}
        </Callout>
      )}
      {error !== undefined && (
        <Callout tone="danger" isPolite>
          {error}
        </Callout>
      )}
    </>
  );
}
