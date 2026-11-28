// Appends one envelope line to the spool. One appendFileSync per call: the file is opened for
// appending, so lines of parallel helpers never overwrite each other, and a line under 4 KiB
// goes out in one write, so it is never torn.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function appendToSpool(file: string, line: string): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${line}\n`, 'utf8');
}
