import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'UPSTREAM.json'), 'utf8'));

test('unchanged upstream code and identifier profile remain byte-exact', () => {
  for (const file of provenance.files.filter(f => f.unchanged)) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(root, file.destination))).digest('hex');
    assert.equal(digest, file.sha256, file.destination);
  }
});

test('skill references and Windows calculator are self-contained in this repository', () => {
  const skillRoot = path.join(root, '.agents/skills/tiktok-morning-collector');
  for (const file of ['SKILL.md', 'references/collection.md', 'references/captcha-recovery.md', 'references/observations.md']) {
    const full = path.join(skillRoot, file);
    const text = fs.readFileSync(full, 'utf8');
    for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(m[1])) continue;
      assert.equal(fs.existsSync(path.resolve(path.dirname(full), m[1])), true, `${file}: ${m[1]}`);
    }
  }
  assert.equal(fs.existsSync(path.join(root, 'scripts/measure-distance.mjs')), true);
});
