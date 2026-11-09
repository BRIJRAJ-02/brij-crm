import { Code, CodeBlock, SecretKey } from './Code.tsx';

const EMBED = `<!-- Timefix booking embed: Discovery call (30 min) -->
<div class="timefix-embed" data-page="priya-raman/discovery-call" data-theme="auto" data-hide-details="false"></div>
<script src="https://timefix.com/embed.js" async></script>`;

export function CodeDemo() {
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-16)' }}>
      <p style={{ margin: 0 }}>
        Filter by <Code>company.owner.email</Code>, or send events to the webhook with the header <Code>X-Timefix-Signature</Code>.
      </p>
      <CodeBlock title="Embed snippet · HTML" code={EMBED} canWrap copyLabel="Copy embed snippet" />
      <CodeBlock code="https://api.timefix.com/v1/hooks/wh_8Kq2xNorthwind" copyLabel="Copy webhook URL" />
      <div className="tf-stack" style={{ gap: 'var(--space-6)', maxWidth: 'var(--size-dialog)' }}>
        <span className="tf-demo-label" style={{ margin: 0 }}>API key</span>
        <SecretKey label="API key" value="tfx_live_9cE4rQ7mZ2bW8kLp3f9a" />
      </div>
    </div>
  );
}
