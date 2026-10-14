// Fetch and build game data for a patch, making it the current one.
// Usage: node scripts/update-data.ts [patch]     (default: latest live patch)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patchArg = process.argv[2] ? [process.argv[2]] : [];
const run = (script: string, args: string[]) => execFileSync(process.execPath, [new URL(script, import.meta.url).pathname, ...args], { stdio: 'inherit' });

run('./fetch-data.ts', patchArg);
// fetch-data prints the resolved patch into data/raw/<patch>/meta.json; build the newest if none given.
run('./build-data.ts', patchArg);
const current = JSON.parse(readFileSync(new URL('../data/generated/current.json', import.meta.url), 'utf8'));
console.log(`current data: patch ${current.patch}`);
