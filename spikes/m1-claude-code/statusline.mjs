// Status line command: logs every JSON input it receives and prints one line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJsonl, paths } from './lib/common.mjs';

const raw = readFileSync(0, 'utf8');
let input;
try {
  input = JSON.parse(raw);
} catch {
  input = { unparsed: raw };
}
appendJsonl(join(paths.logs, 'statusline.jsonl'), { pid: process.pid, ppid: process.ppid, input });

const ctx = input.context_window?.used_percentage;
const five = input.rate_limits?.five_hour?.used_percentage;
const seven = input.rate_limits?.seven_day?.used_percentage;
const fmt = (v) => (typeof v === 'number' ? `${Math.round(v)}%` : '--');
process.stdout.write(`orch-spike ctx ${fmt(ctx)} 5h ${fmt(five)} 7d ${fmt(seven)}`);
