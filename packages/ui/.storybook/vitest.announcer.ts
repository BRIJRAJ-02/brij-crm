// Runs before every story, in both story projects (`stories` and `visual`).
// React Aria announces through one region it adds to the page and keeps, and
// each announcement stays there for 7 s. A pending Button's is labelled by the
// button's id, so once its story unmounts the label points at nothing and the
// next story's axe check fails on it. Each story starts without the region;
// the next announcement makes a new one.
import { destroyAnnouncer } from '@react-aria/live-announcer';
import { beforeEach } from 'vitest';

beforeEach(() => {
  destroyAnnouncer();
});
