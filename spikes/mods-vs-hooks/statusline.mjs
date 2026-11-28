// Status line command: logs that it ran (and the session id), prints one short line.
import { appendJsonl, paths } from './lib.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
let session;
try {
  session = JSON.parse(raw).session_id;
} catch {
  session = undefined;
}
appendJsonl(paths.statusLog, { at: new Date().toISOString(), session });
process.stdout.write('orch-spike status line');
