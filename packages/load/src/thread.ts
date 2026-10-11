// A worker thread's entry (spec 0011, AC-203): it drives the users the main
// thread gave it and posts back what it measured. The main thread keeps the
// collectors and the report, so a busy thread never delays the samples.
import { parentPort, workerData } from 'node:worker_threads';
import { drive, type DriveInput } from './drive.ts';

if (parentPort !== null) {
  const port = parentPort;
  const output = await drive(workerData as DriveInput);
  port.postMessage(output);
}
