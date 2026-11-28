// Appends one envelope line to the spool. One appendFileSync per call: the file is opened for
// appending and the whole line goes out in one write call, so lines of parallel helpers never
// overwrite or interleave with each other. A helper killed during the write can leave a torn
// last line; the import keeps it with the damaged lines.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function appendToSpool(file: string, line: string): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${line}\n`, 'utf8');
}
