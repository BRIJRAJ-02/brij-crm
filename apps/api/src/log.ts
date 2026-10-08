// One JSON line per event, so Railway can search and filter the logs.
import { safeError } from './query-errors.ts';

type Fields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', message: string, fields?: Fields) {
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

/** An error as a log line may hold it: a failed query names only its SQLSTATE and constraint, never its values. */
export function errorFields(thrown: unknown): Fields {
  const error = safeError(thrown);
  return error instanceof Error
    ? { error: { name: error.name, message: error.message, stack: error.stack } }
    : { error: String(error) };
}

export const log = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};
