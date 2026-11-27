// Sets or clears hook behaviour in policy.json while sessions run.
//
// Usage: node policy.mjs set <label> '<json>'   e.g. set danger '{"mode":"danger","holdMs":60000}'
//        node policy.mjs set http:PermissionRequest '{"mode":"deny","message":"no"}'
//        node policy.mjs clear [<label>]
//        node policy.mjs show
import { paths, readJson, writeJson } from './lib/common.mjs';

const [cmd, label, json] = process.argv.slice(2);
let policy = readJson(paths.policy, {});
if (cmd === 'set') policy[label] = JSON.parse(json);
else if (cmd === 'clear' && label)
  policy = Object.fromEntries(Object.entries(policy).filter(([k]) => k !== label));
else if (cmd === 'clear') policy = {};
else if (cmd !== 'show') throw new Error('usage: policy.mjs set|clear|show');
writeJson(paths.policy, policy);
console.log(JSON.stringify(policy, null, 2));
