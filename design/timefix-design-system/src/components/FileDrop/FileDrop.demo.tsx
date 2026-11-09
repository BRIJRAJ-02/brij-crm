import { useEffect, useState } from 'react';
import { FileDrop, FileList, FileRow } from './FileDrop.tsx';

interface Upload {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly progress?: number;
  readonly error?: string;
}

const MAX = 10 * 1024 * 1024;
const MB = 1024 * 1024;
let next = 0;
const id = () => `f${(next += 1)}`;

export function FileDropDemo() {
  const [files, setFiles] = useState<readonly Upload[]>([
    { id: id(), name: 'northwind-logo.png', size: 0.4 * MB, type: 'image/png', progress: 35 },
    { id: id(), name: 'contract-signed-scan.pdf', size: 24 * MB, type: 'application/pdf', error: 'Too large. Files can be up to 10 MB.' },
    { id: id(), name: 'Acme Corp proposal.pdf', size: 2.4 * MB, type: 'application/pdf' },
  ]);

  // Pretend upload: each file in flight gains a little every 300ms until it lands.
  const uploading = files.some((f) => f.progress !== undefined && !f.error);
  useEffect(() => {
    if (!uploading) return;
    const t = window.setInterval(() => {
      setFiles((list) => list.map((f) => {
        if (f.progress === undefined || f.error) return f;
        const p = f.progress + 8 + Math.random() * 14;
        return p >= 100 ? { ...f, progress: undefined } : { ...f, progress: p };
      }));
    }, 300);
    return () => window.clearInterval(t);
  }, [uploading]);

  const add = (list: readonly File[]) =>
    setFiles((cur) => [
      ...list.map((f) => ({ id: id(), name: f.name, size: f.size, type: f.type, ...(f.size > MAX ? { error: 'Too large. Files can be up to 10 MB.' } : { progress: 0 }) })),
      ...cur,
    ]);
  const remove = (fid: string) => setFiles((cur) => cur.filter((f) => f.id !== fid));
  const retry = (fid: string) => setFiles((cur) => cur.map((f) => (f.id === fid ? { id: f.id, name: f.name, size: f.size, type: f.type, progress: 0 } : f)));

  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-24)', alignItems: 'start' }}>
      <div className="tf-stack">
        <FileDrop label="Drop files here" description="PDF, PNG or JPG, up to 10 MB" acceptedFileTypes={['application/pdf', 'image/png', 'image/jpeg']} onFiles={add} />
        <FileDrop variant="compact" label="Attach to Priya Raman" description="Any file, up to 10 MB" onFiles={add} />
      </div>
      <FileList label="Attachments">
        {files.map((f) => (
          <FileRow key={f.id} name={f.name} size={f.size} type={f.type} progress={f.progress} error={f.error} onRemove={() => remove(f.id)} onRetry={() => retry(f.id)} />
        ))}
        {files.length === 0 && <li className="tf-muted" style={{ fontSize: 13, padding: 'var(--space-8)' }}>No attachments yet.</li>}
      </FileList>
    </div>
  );
}
