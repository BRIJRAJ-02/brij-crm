// Brief
// Purpose: a signed in person without a workspace makes their first one.
// Main task: confirm your name and the workspace's name and address, then Create workspace.
// Leaves out: inviting teammates, picking a template and settings; they come later (#23).
import { isDataError, type DataLayer, type SignedInUser } from '@crm/data';
import { AuthLayout, Button, Field, Form, type Toasts } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { SLUG_MAX, SLUG_RULE, slugFrom, suggestedWorkspaceName } from './names.ts';
import { strings } from './strings.ts';

/** A refusal for this form: the field it is about by `name`, or none (shown above the fields). */
interface WelcomeRefusal {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

const FIELDS = { memberName: 'memberName', name: 'name', slug: 'slug' } as const;

/** The server's refusals and input problems as this form's refusals; anything else above the fields. */
function refusalsOf(error: unknown): WelcomeRefusal[] {
  if (!isDataError(error)) return [{ code: 'INTERNAL', message: String(error) }];
  const refusals = (error.data?.refusals ?? []).map((refusal) => ({
    code: refusal.code,
    message: refusal.message,
    ...(refusal.field === undefined ? {} : { field: refusal.field }),
  }));
  const issues = (error.data?.issues ?? []).map((issue) => {
    const [field] = issue.path;
    return { code: error.code, message: issue.message, ...(typeof field === 'string' ? { field } : {}) };
  });
  const all = [...refusals, ...issues];
  return all.length > 0 ? all : [{ code: error.code, message: error.message }];
}

/** What is wrong with the typed values before they are sent, in the server's words. */
function problemsWith(memberName: string, name: string, slug: string): WelcomeRefusal[] {
  return [
    ...(memberName.trim() === '' ? [{ code: 'MISSING', message: strings.nameMissing, field: FIELDS.memberName }] : []),
    ...(name.trim() === '' ? [{ code: 'MISSING', message: strings.workspaceNameMissing, field: FIELDS.name }] : []),
    ...(SLUG_RULE.test(slug) ? [] : [{ code: 'INVALID', message: strings.slugInvalid, field: FIELDS.slug }]),
  ];
}

/** Props for the welcome screen. */
export interface WelcomeScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly user: SignedInUser;
}

/** The welcome page: AuthLayout and a Form that creates the workspace, then opens it. */
export function WelcomeScreen({ data, toasts, user }: WelcomeScreenProps) {
  const navigate = useNavigate();
  // One id per visit, sent again on every try, so a retry after a lost answer makes nothing twice.
  const [id, setId] = useState(() => data.workspaces.newId());
  const [memberName, setMemberName] = useState(user.name);
  // The workspace name follows "Your name", and the address follows the workspace name, until each is edited.
  const [typedName, setTypedName] = useState<string | undefined>(undefined);
  const [typedSlug, setTypedSlug] = useState<string | undefined>(undefined);
  const name = typedName ?? suggestedWorkspaceName(memberName, strings.possessive);
  const slug = typedSlug ?? slugFrom(name);
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly WelcomeRefusal[]>([]);
  const [isSigningOut, setSigningOut] = useState(false);

  const create = () => {
    const problems = problemsWith(memberName, name, slug);
    setRefusals(problems);
    if (problems.length > 0) return;
    setBusy(true);
    data.workspaces.create({ id, name: name.trim(), slug, memberName: memberName.trim() }).then(
      ({ workspace }) => {
        void navigate({ to: '/w/$slug', params: { slug: workspace.slug }, replace: true });
      },
      (failure: unknown) => {
        // Someone else's workspace has this id (vanishingly rare): the next try gets a new one.
        if (isDataError(failure) && failure.code === 'ID_TAKEN') setId(data.workspaces.newId());
        setBusy(false);
        setRefusals(refusalsOf(failure));
      },
    );
  };

  const signOut = () => {
    setSigningOut(true);
    data.auth.signOut().then(
      () => {
        void navigate({ to: '/sign-in', replace: true });
      },
      () => {
        setSigningOut(false);
        toasts.toast({ tone: 'danger', message: strings.signOutFailed });
      },
    );
  };

  return (
    <AuthLayout
      productName={strings.product}
      title={strings.title}
      description={strings.description}
      footer={
        <Button variant="ghost" onPress={signOut} isPending={isSigningOut}>
          {strings.signOut}
        </Button>
      }
    >
      <Form<WelcomeRefusal>
        submitLabel={strings.create}
        busyLabel={strings.creating}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.field}
        onSubmit={create}
      >
        <Field
          label={strings.yourName}
          name={FIELDS.memberName}
          autoComplete="name"
          isRequired
          maxLength={80}
          value={memberName}
          onChange={setMemberName}
        />
        <Field
          label={strings.workspaceName}
          name={FIELDS.name}
          autoComplete="organization"
          isRequired
          maxLength={80}
          value={name}
          onChange={setTypedName}
        />
        <Field
          label={strings.webAddress}
          name={FIELDS.slug}
          autoComplete="off"
          isRequired
          maxLength={SLUG_MAX}
          value={slug}
          onChange={(next) => {
            setTypedSlug(next.toLowerCase());
          }}
          hint={strings.webAddressHint(SLUG_RULE.test(slug) ? slug : '')}
        />
      </Form>
    </AuthLayout>
  );
}
