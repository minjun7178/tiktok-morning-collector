#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { begin, doctor, finish, initialize, verify } from '../lib/collector.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);
try {
  let result;
  if (['init', 'doctor', 'begin'].includes(command) && args.length) throw new Error(`${command} does not accept extra arguments`);
  if (command === 'init') result = initialize(root);
  else if (command === 'doctor') result = doctor(root);
  else if (command === 'begin') result = begin(root);
  else if (command === 'finish') {
    if (args.length !== 2 || args[0] !== '--run') throw new Error('Usage: npm run finish -- --run UUID');
    result = finish(root, args[1]);
  } else if (command === 'verify') {
    if (args.length !== 1) throw new Error('Usage: npm run verify -- "C:/path/to/output.json"');
    result = verify(root, args[0]);
  } else throw new Error('Commands: init, doctor, begin, finish --run UUID, verify FILE.json');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.status === 'incomplete') process.exitCode = 2;
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
