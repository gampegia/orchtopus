// Prints `claude logs <id>` rendered as plain screen text.
// Usage: node lib/logs-text.mjs <id> [lines]
import { claude } from './common.mjs';
import { Screen } from './screen.mjs';

const [id, lines = '30'] = process.argv.slice(2);
const res = claude(['logs', id]);
const screen = new Screen(120, 400);
screen.write(res.stdout.replaceAll('\n', '\r\n'));
const text = screen
  .text()
  .split('\n')
  .filter((l) => l.trim());
console.log(text.slice(-Number(lines)).join('\n'));
