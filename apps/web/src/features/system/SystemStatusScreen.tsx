// Brief
// Purpose: prove the stack boots, from this screen through the API to Postgres.
// Main task: show whether the API and the database answer.
// Leaves out: styling, navigation and sign in. The app shell from the component
// library (#4) replaces this page, so it carries no styles and no raw values.
import type { SystemStatus } from '@crm/data';
import { useRouter } from '@tanstack/react-router';

export function SystemStatusScreen({ status }: { status: SystemStatus }) {
  return (
    <main>
      <h1>CRM</h1>
      <p>The API and the database are answering.</p>
      <dl>
        <dt>Environment</dt>
        <dd>{status.environment}</dd>
        <dt>Postgres</dt>
        <dd>{status.database.serverVersion}</dd>
        <dt>Database round trip</dt>
        <dd>{status.database.latencyMs} ms</dd>
        <dt>Checked at</dt>
        <dd>
          <time dateTime={status.checkedAt}>{new Date(status.checkedAt).toLocaleString()}</time>
        </dd>
      </dl>
    </main>
  );
}

export function SystemStatusPending() {
  return (
    <main aria-busy="true">
      <h1>CRM</h1>
      <p>Checking the API and the database…</p>
    </main>
  );
}

export function SystemStatusError() {
  const router = useRouter();
  return (
    <main>
      <h1>CRM</h1>
      <p role="alert">The API or the database did not answer. Check that both are running.</p>
      <button type="button" onClick={() => void router.invalidate()}>
        Try again
      </button>
    </main>
  );
}
