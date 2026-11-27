// <data>\api.json tells the hook helper where the API listens: { port, pid, startedAt }.
// Written after the server listens, deleted on a clean close.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface PortFile {
  port: number;
  pid: number;
  startedAt: string;
}

/** Writes the file through a temp file and a rename, so a reader never sees half of it. */
export async function writePortFile(file: string, content: PortFile): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temp, `${JSON.stringify(content)}\n`, 'utf8');
  await rename(temp, file);
}

export async function removePortFile(file: string): Promise<void> {
  await rm(file, { force: true });
}
