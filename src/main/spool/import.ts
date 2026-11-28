// Imports the spool: envelopes the hook helper could not deliver while the app was closed or
// busy (spec section 8). The live file is renamed first, so helpers that start now append to a
// new file; then the renamed file is read in order and every envelope becomes a log event whose
// id is the envelope id, so a line imported twice is skipped. Damaged lines are kept in
// spool\damaged\ and reported with one spool.damaged event, never dropped silently.
//
// A helper that opened events.jsonl just before the rename can still write its line into the
// renamed file. The import therefore waits a moment after the rename and reads the file again
// until it stops growing, before it deletes it.
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpoolDamagedPayload } from '../../shared/events';
import { parseEnvelope } from '../../shared/hook-envelope';
import type { DataPaths } from '../data-folder';
import { envelopeToEvent } from '../hooks/envelope-event';
import { renameWithRetry } from '../hooks/install';
import type { Store } from '../store/event-log';

export interface SpoolImportResult {
  imported: number;
  duplicates: number;
  damaged: number;
}

/** Time a helper that opened the old file has to finish its one write. */
export const SETTLE_MS = 25;

const IMPORTING = /^events\.importing-(\d+)\.jsonl$/;
const NEWLINE = 0x0a;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'ENOENT';
}

/** Leftover importing files (from a crash) by their epoch, oldest first. */
async function importingFiles(spoolDir: string): Promise<{ name: string; epoch: number }[]> {
  let names: string[];
  try {
    names = await readdir(spoolDir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names
    .flatMap((name) => {
      const match = IMPORTING.exec(name);
      return match ? [{ name, epoch: Number(match[1]) }] : [];
    })
    .sort((a, b) => a.epoch - b.epoch);
}

/** Moves events.jsonl aside; false when there is none. */
async function takeLiveFile(paths: DataPaths, epoch: number): Promise<boolean> {
  try {
    await renameWithRetry(
      paths.spoolFile,
      join(paths.spoolDir, `events.importing-${String(epoch)}.jsonl`),
    );
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

class ImportRun {
  readonly result: SpoolImportResult = { imported: 0, duplicates: 0, damaged: 0 };
  /** Damaged lines not yet written to the damaged file. */
  private pendingDamaged: string[] = [];
  private damagedFile: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly damagedDir: string,
  ) {}

  /** Imports complete lines in one transaction. */
  private importLines(lines: string[]): void {
    this.store.transaction(() => {
      for (const line of lines) {
        if (line.trim() === '') continue;
        const envelope = parseLine(line);
        if (envelope === null) {
          this.pendingDamaged.push(line);
          this.result.damaged++;
          continue;
        }
        const { duplicate } = this.store.append(envelopeToEvent(this.store.db, envelope));
        if (duplicate) this.result.duplicates++;
        else this.result.imported++;
      }
    });
  }

  /** Reads one importing file until it stops growing, then deletes it. */
  async drain(file: string): Promise<void> {
    let offset = 0;
    let fragment = Buffer.alloc(0);
    for (;;) {
      const content = await readFile(file);
      if (content.length <= offset) break;
      const chunk = Buffer.concat([fragment, content.subarray(offset)]);
      offset = content.length;
      const end = chunk.lastIndexOf(NEWLINE);
      fragment = chunk.subarray(end + 1);
      if (end >= 0) this.importLines(chunk.subarray(0, end).toString('utf8').split('\n'));
      await delay(SETTLE_MS);
    }
    // A last line without a newline is torn; it is kept with the damaged lines.
    if (fragment.length > 0) this.importLines([fragment.toString('utf8')]);
    // Damaged lines are safe in damaged\ before their source file goes.
    await this.writeDamaged();
    await rm(file, { force: true });
  }

  private async writeDamaged(): Promise<void> {
    if (this.pendingDamaged.length === 0) return;
    this.damagedFile ??= `${String(Date.now())}-${randomUUID().slice(0, 8)}.jsonl`;
    await mkdir(this.damagedDir, { recursive: true });
    const text = this.pendingDamaged.map((line) => `${line}\n`).join('');
    await appendFile(join(this.damagedDir, this.damagedFile), text, 'utf8');
    this.pendingDamaged = [];
  }

  /** One spool.damaged event for this import, with the count. */
  report(at: string): void {
    if (this.damagedFile === null) return;
    const payload: SpoolDamagedPayload = {
      file: `damaged/${this.damagedFile}`,
      line: 1,
      reason: 'not a valid envelope',
      count: this.result.damaged,
    };
    this.store.append({ id: randomUUID(), type: 'spool.damaged', at, payload });
  }
}

function parseLine(line: string): ReturnType<typeof parseEnvelope> {
  try {
    return parseEnvelope(JSON.parse(line));
  } catch {
    return null;
  }
}

async function runImport(store: Store, paths: DataPaths): Promise<SpoolImportResult> {
  const leftovers = await importingFiles(paths.spoolDir);
  // The new file sorts after every leftover, so events stay in the order they were spooled.
  const epoch = Math.max(Date.now(), (leftovers.at(-1)?.epoch ?? 0) + 1);
  const files = leftovers.map((f) => join(paths.spoolDir, f.name));
  if (await takeLiveFile(paths, epoch)) {
    files.push(join(paths.spoolDir, `events.importing-${String(epoch)}.jsonl`));
  }
  const run = new ImportRun(store, paths.damagedDir);
  if (files.length > 0) await delay(SETTLE_MS);
  for (const file of files) await run.drain(file);
  run.report(new Date().toISOString());
  return run.result;
}

const running = new Map<string, Promise<unknown>>();

/** Imports the spool. Calls for the same spool folder run one after the other. */
export function importSpool(store: Store, paths: DataPaths): Promise<SpoolImportResult> {
  const previous = running.get(paths.spoolDir) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => runImport(store, paths));
  running.set(paths.spoolDir, next);
  void next
    .finally(() => {
      if (running.get(paths.spoolDir) === next) running.delete(paths.spoolDir);
    })
    .catch(() => undefined);
  return next;
}
