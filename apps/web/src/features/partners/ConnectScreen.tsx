// Brief
// Purpose: the OAuth connect page (spec 0070, AC-7011, AC-7012): an outside app asks to connect one workspace.
// Main task: see who is asking and exactly what it may do, pick a workspace you own (or name a new one), tick its
// modules, and Connect; Cancel goes back with nothing shared.
// Leaves out: workspaces you don't own (counted, not offered), managing people (the app does that), and settings.
import {
  isDataError,
  type DataLayer,
  type PartnerConnectOffer,
  type PartnerConnectRequest,
  type PartnerModule,
} from '@crm/data';
import {
  AuthLayout,
  Avatar,
  Button,
  Callout,
  Checkbox,
  Field,
  FieldGroup,
  Form,
  Radio,
  RadioGroup,
  sharedStrings,
  type FormRefusal,
} from '@crm/ui';
import { useId, useState } from 'react';
import { PRODUCT_LOGO } from '../../brand.ts';
import { memberNameFor } from '../welcome/names.ts';
import { newWorkspaceSlug, toggled } from './connect-request.ts';
import { BASE_POWER, connectStrings as strings, MODULES } from './strings.ts';

/** The choice of workspace: one the person owns, by address, or a new one. */
const NEW = '__new__';

/** Props for the connect page: what its route loaded, and who is signed in. */
export interface ConnectScreenProps {
  readonly data: DataLayer;
  readonly request: PartnerConnectRequest;
  readonly offer: PartnerConnectOffer;
  readonly user: { readonly name: string; readonly email: string };
  /** Goes to the address the server answered: the partner's registered one. */
  readonly leave: (href: string) => void;
}

/** What the app may do, in one sentence: the base power, then each ticked module's (AC-7012). */
function powersOf(modules: readonly PartnerModule[]): string {
  const first = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return `${[BASE_POWER, ...modules.map((module) => first(MODULES[module].power))].join('; ')}.`;
}

/**
 * AuthLayout with the partner's logo above its title; the sentence of what it may do in a Callout; the person's own
 * workspaces as a RadioGroup (with A new workspace and its name); the modules as Checkboxes; Connect and Cancel.
 */
export function ConnectScreen({ data, request, offer, user, leave }: ConnectScreenProps) {
  const formId = useId();
  const partner = offer.partner.name;
  const [choice, setChoice] = useState<string>(offer.workspaces[0]?.slug ?? NEW);
  const [name, setName] = useState('');
  const [modules, setModules] = useState<readonly PartnerModule[]>(offer.modules);
  const [busy, setBusy] = useState<'approve' | 'deny' | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  // A new workspace keeps its id across a retry, so a lost answer never makes two.
  const [workspaceId] = useState(() => data.workspaces.newId());
  const [madeSlug, setMadeSlug] = useState<string | undefined>(undefined);

  const toggle = (module: PartnerModule, isOn: boolean) => setModules((now) => toggled(now, module, isOn));

  const failed = (error: unknown) => {
    setBusy(undefined);
    setFailure(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
  };

  const approve = async () => {
    if (busy !== undefined) return;
    const problems: FormRefusal[] = [];
    if (choice === NEW && name.trim() === '') {
      problems.push({ code: 'INPUT_INVALID', message: strings.newWorkspaceMissing, attributeId: 'name' });
    }
    if (modules.length === 0) {
      problems.push({ code: 'INPUT_INVALID', message: strings.modulesMissing, attributeId: 'modules' });
    }
    setRefusals(problems);
    if (problems.length > 0) return;
    setBusy('approve');
    setFailure(undefined);
    try {
      let slug = choice;
      if (choice === NEW) {
        slug =
          madeSlug ??
          (
            await data.workspaces.create({
              id: workspaceId,
              name: name.trim(),
              slug: newWorkspaceSlug(name),
              memberName: memberNameFor('', user.name, user.email),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
          ).workspace.slug;
        setMadeSlug(slug);
      }
      const answer = await data.partnerConnect.approve(slug, request, modules);
      // Busy stays on while the browser leaves for the app.
      leave(answer.redirectTo);
    } catch (error) {
      failed(error);
    }
  };

  const deny = () => {
    if (busy !== undefined) return;
    setBusy('deny');
    setFailure(undefined);
    data.partnerConnect.deny(request).then((answer) => leave(answer.redirectTo), failed);
  };

  const modulesError = refusals.find((refusal) => refusal.attributeId === 'modules')?.message;

  return (
    <AuthLayout
      productName={strings.product}
      logo={PRODUCT_LOGO}
      title={strings.title(partner)}
      description={strings.description}
      account={user.email}
      eyebrow={
        <Avatar
          name={partner}
          size="lg"
          shape="square"
          fit="contain"
          {...(offer.partner.logoUrl === undefined ? {} : { src: offer.partner.logoUrl })}
        />
      }
      footer={
        <Button variant="ghost" onPress={deny} isPending={busy === 'deny'} isDisabled={busy === 'approve'}>
          {busy === 'deny' ? strings.leaving : strings.deny}
        </Button>
      }
    >
      <Callout tone="info" title={strings.canDo(partner)}>
        {powersOf(modules)}
      </Callout>
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      <Form
        id={formId}
        label={strings.title(partner)}
        isBusy={busy !== undefined}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={() => void approve()}
      >
        <RadioGroup label={strings.workspace} value={choice} onChange={setChoice}>
          {offer.workspaces.map((workspace) => (
            <Radio
              key={workspace.slug}
              value={workspace.slug}
              {...(workspace.connected ? { description: strings.connectedAlready } : {})}
            >
              {workspace.name}
            </Radio>
          ))}
          <Radio value={NEW} {...(offer.workspaces.length === 0 ? { description: strings.noWorkspaces } : {})}>
            {strings.newWorkspace}
          </Radio>
        </RadioGroup>
        {choice === NEW && (
          <Field
            label={strings.newWorkspaceName}
            placeholder={strings.newWorkspacePlaceholder}
            name="name"
            autoComplete="organization"
            maxLength={80}
            isRequired
            value={name}
            onChange={setName}
          />
        )}
        {offer.otherWorkspaces > 0 && <Callout tone="info">{strings.others(offer.otherWorkspaces)}</Callout>}
        <FieldGroup label={strings.modules} {...(modulesError === undefined ? {} : { error: modulesError })}>
          {offer.modules.map((module) => (
            <Checkbox
              key={module}
              label={MODULES[module].label}
              description={MODULES[module].power}
              isSelected={modules.includes(module)}
              onChange={(isOn) => toggle(module, isOn)}
            />
          ))}
        </FieldGroup>
        <Button
          variant="primary"
          size="lg"
          isFullWidth="center"
          type="submit"
          form={formId}
          isPending={busy === 'approve'}
          isDisabled={busy === 'deny'}
        >
          {busy === 'approve' ? strings.approving : strings.approve}
        </Button>
      </Form>
    </AuthLayout>
  );
}

/** The connect page when the request itself is refused: what's wrong, in the server's words, and nothing to follow. */
export function ConnectRefused({
  text,
  onRetry,
}: {
  readonly text: string | undefined;
  readonly onRetry?: () => void;
}) {
  return (
    <AuthLayout productName={strings.product} logo={PRODUCT_LOGO} title={strings.refusedTitle}>
      <Callout tone="danger">{text ?? strings.refusedText}</Callout>
      {onRetry !== undefined && (
        <Button variant="secondary" onPress={onRetry}>
          {strings.retry}
        </Button>
      )}
    </AuthLayout>
  );
}
