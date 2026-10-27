import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildPlan, hash, validateRun } from '../lib/core.mjs';
import { readJSON, writeJSON } from '../lib/storage.mjs';
import { begin, finish, initialize } from '../lib/collector.mjs';
import { attachment, createTransfer, verifyTransfer, MAX_ATTACHMENT_BYTES } from '../lib/transfer.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetProfile = readJSON(path.join(projectRoot, 'profiles/celdyque.json'));
const date = '2026-10-27';
const started = '2026-10-27T00:00:00.000Z';
const completed = '2026-10-27T00:20:00.000Z';
const now = new Date('2026-10-27T00:21:00.000Z');
const id = '11111111-2222-4333-8444-555555555555';

function fixture() {
  const config = structuredClone(targetProfile);
  config.shop_name = 'FIXTURE SHOP';
  config.shop_id = '10001';
  const plan = buildPlan(config, date, 4);
  const input = { schema_version: 1, run_id: id, report_date: date, config_hash: plan.config_hash,
    started_at: started, completed_at: completed, observations: [] };
  input.observations = plan.specs.map(s => {
    const value = s.key === 'health.sps' ? 4.6 : s.unit === 'percent' ? 77.5 : 2;
    const raw = String(value);
    const o = { key: s.key, status: 'ok', reason: '', value, raw_value: raw,
      unit: s.unit, basis: s.basis, url: `https://${s.host}${s.path}`, shop_id: config.shop_id,
      identity: config.shop_name, collected_at: '2026-10-27T00:10:00Z',
      source_delayed: false, evidence: `${s.label} ${raw}; fixture collection proof`,
      checks: { loaded: true, identity: true, unique: true, filters: true, complete: true } };
    if (s.entity) { o.entity_id = s.entity; o.evidence += ` ${s.entity}`; }
    if (s.source_updated_required) o.source_updated_at = 'Updated Oct 27 2026';
    if (s.proof_kind === 'rank') Object.assign(o, { rank_category: 'Beauty & Personal Care', rank_by: 'Total GMV', rank_window: 'Last 30 days', evidence: `${o.evidence}; ${config.shop_name}` });
    if (s.direction) Object.assign(o, { direction: 'up', direction_evidence: 'visible up caret 2' });
    if (s.proof_kind === 'reviews') Object.assign(o, { displayed_total: 2, count_stable: true,
      pages: [{ number: 1, ids: ['fixture-review-a', 'fixture-review-b'], evidence: 'Page 1 two review rows, Next disabled', has_next: false }] });
    if (s.proof_kind === 'samples') Object.assign(o, { collaboration_filter: s.collaboration_filter,
      selection_unit_verified: true, count_stable: true, all_pages_checked: true,
      evidence: `${o.evidence}; Free samples To review ${s.collaboration_filter}`,
      pages: [{ number: 1, selected: 2, selectable_rows: 2, disabled_count: 0,
        evidence: 'Page 1; 2 selected; Next disabled', has_next: false, selection_scope: 'page',
        selection_before: 0, selection_after_cleanup: 0, table_settled: true,
        settled_state_checks: 2, next_control_present: true, next_control_disabled: true }] });
    return o;
  });
  return { manifest: { ...plan, run_id: id, started_at: started }, input, config, now };
}

function workspace(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'celdyque-collector-test-'));
  const root = path.join(temp, '이동한 수집 폴더 with spaces');
  fs.mkdirSync(root);
  for (const folder of ['lib', 'scripts', 'profiles']) fs.cpSync(path.join(projectRoot, folder), path.join(root, folder), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'package.json'), path.join(root, 'package.json'));
  t.after(() => {
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('celdyque-collector-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

test('a self-contained transfer revalidates with exactly the original 23-metric validator', () => {
  const f = fixture(), bundle = createTransfer(f);
  assert.equal(bundle.validation.status, 'complete', JSON.stringify(bundle.validation.issues));
  assert.equal(Object.keys(bundle.validation.values).length, 23);
  assert.equal(bundle.input.observations.length, 23);
  assert.deepEqual(verifyTransfer(bundle, { expectedConfig: f.config, now }), validateRun(bundle.input, buildPlan(f.config, date, 4), f.config, now));
  assert.equal(bundle.input.completed_at, completed);
  assert.equal(Object.values(bundle.validation.values).every(o => o.delta === null), true);
});

test('collection and validation errors remain distinct and keep all original observations', () => {
  const f = fixture();
  Object.assign(f.input.observations.find(o => o.key === 'refunds.pending'), { status: 'error', reason: 'Login required', value: null, raw_value: '' });
  f.input.observations.find(o => o.key === 'products.copper.views').entity_id = 'wrong';
  const bundle = createTransfer(f);
  assert.equal(bundle.validation.status, 'incomplete');
  assert.equal(bundle.input.observations.length, 23);
  assert.equal(Object.keys(bundle.validation.values).length, 21);
  assert.equal(bundle.validation.issues.find(o => o.key === 'refunds.pending').kind, 'collection');
  assert.equal(bundle.validation.issues.find(o => o.key === 'products.copper.views').kind, 'validation');
  assert.deepEqual(verifyTransfer(bundle, { expectedConfig: f.config, now }), bundle.validation);
});

test('missing, duplicate and retired metrics cannot enter the transfer contract', () => {
  const missing = fixture(); missing.input.observations.pop();
  assert.throws(() => createTransfer(missing), /23 observations/);
  const duplicate = fixture(); duplicate.input.observations[1] = duplicate.input.observations[0];
  assert.throws(() => createTransfer(duplicate), /Duplicate observation/);
  const retired = fixture(); retired.input.observations[0].key = 'products.single.voc';
  assert.throws(() => createTransfer(retired), /Unexpected observation/);
  const legacy = fixture(); legacy.manifest.collection_contract_version = 3;
  assert.throws(() => createTransfer(legacy), /Only collection contract v4/);
});

test('manifest changes and another account/config are rejected', () => {
  const f = fixture(); f.manifest.specs[0].unit = 'percent';
  assert.throws(() => createTransfer(f), /Manifest\/config/);
  const good = fixture(), bundle = createTransfer(good);
  assert.throws(() => verifyTransfer(bundle, { expectedConfig: targetProfile, now }), /another account\/config/);
  const credentials = fixture(); credentials.config.password = 'must-never-be-exported';
  assert.throws(() => createTransfer(credentials), /Unexpected config fields/);
});

test('tampering and claimed validation are detected independently', () => {
  const f = fixture(), bundle = createTransfer(f);
  bundle.input.observations[0].value++;
  assert.throws(() => verifyTransfer(bundle, { now }), /integrity mismatch/);
  const forged = createTransfer(f);
  forged.validation.values['refunds.pending'].value = 999;
  const { integrity, ...payload } = forged;
  forged.integrity.payload_sha256 = hash(payload);
  assert.throws(() => verifyTransfer(forged, { now }), /recomputed validation/);
});

test('delayed delivery preserves the original collection time and two-hour window', () => {
  const bundle = createTransfer(fixture());
  assert.equal(verifyTransfer(bundle, { now: new Date('2026-10-28T00:30:00Z') }).status, 'complete');
  assert.equal(bundle.input.completed_at, completed);
  const tooLong = fixture(); tooLong.input.completed_at = '2026-10-27T03:00:00Z';
  assert.throws(() => createTransfer({ ...tooLong, now: new Date('2026-10-27T03:01:00Z') }), /Run duration/);
  const midnight = fixture(); midnight.input.completed_at = '2026-10-27T15:01:00Z';
  assert.throws(() => createTransfer({ ...midnight, now: new Date('2026-10-27T15:02:00Z') }));
});

test('selected evidence is embedded, bounded, hashed and path-safe', () => {
  const f = fixture(); f.attachments = [attachment('pages/proof.txt', Buffer.from('fixture source proof'))];
  const bundle = createTransfer(f);
  assert.equal(Buffer.from(bundle.attachments[0].content, 'base64').toString(), 'fixture source proof');
  assert.equal(verifyTransfer(bundle, { now }).status, 'complete');
  assert.throws(() => attachment('../secret.txt', Buffer.from('x')), /remain relative/);
  assert.throws(() => attachment('C:/secret.txt', Buffer.from('x')), /Invalid evidence path/);
  assert.throws(() => attachment('script.mjs', Buffer.from('x')), /Unsupported evidence file/);
  assert.throws(() => createTransfer({ ...fixture(), attachments: [attachment('big.png', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))] }), /12 MiB/);
  bundle.attachments[0].sha256 = '0'.repeat(64);
  const { integrity, ...payload } = bundle; bundle.integrity.payload_sha256 = hash(payload);
  assert.throws(() => verifyTransfer(bundle, { now }), /bytes\/hash mismatch/);
});

test('init never overwrites configuration and begin seeds 23 errors rather than zeros', t => {
  const root = workspace(t);
  assert.equal(initialize(root).created, true);
  const file = path.join(root, '.local/config.json'), original = fs.readFileSync(file, 'utf8');
  assert.equal(initialize(root).created, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  const run = begin(root, new Date(started)), input = readJSON(run.observations);
  assert.equal(input.observations.length, 23);
  assert.equal(input.observations.every(o => o.status === 'error' && o.value === null), true);
  assert.equal(readJSON(run.manifest).specs.some(s => /gmv\.|\.voc|euka|customer/.test(s.key)), false);
});

test('finish writes JSON only, freezes the run and never touches arbitrary raw files', t => {
  const root = workspace(t); initialize(root);
  const run = begin(root, new Date(started));
  const dir = path.dirname(run.observations);
  fs.mkdirSync(path.join(dir, 'raw'));
  fs.writeFileSync(path.join(dir, 'raw/private-diagnostic.txt'), 'not part of the transfer');
  fs.mkdirSync(run.evidence_directory);
  fs.writeFileSync(path.join(run.evidence_directory, 'proof.txt'), 'minimal safe proof');
  const result = finish(root, run.run_id, new Date(completed));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.failed_metrics, 23);
  assert.deepEqual(fs.readdirSync(path.join(root, 'outputs')), [path.basename(result.output)]);
  const bundle = readJSON(result.output);
  assert.equal(bundle.attachments.length, 1);
  assert.equal(bundle.attachments[0].path, 'proof.txt');
  assert.equal(fs.existsSync(path.join(root, '.local/ledger')), false);
  const bytes = fs.readFileSync(result.output);
  const again = finish(root, run.run_id, new Date('2026-10-28T00:00:00Z'));
  assert.equal(again.duplicate, true);
  assert.equal(again.completed_at, completed);
  assert.deepEqual(fs.readFileSync(result.output), bytes);
  const edited = readJSON(run.observations); edited.observations[0].reason = 'Changed after finish'; writeJSON(run.observations, edited);
  assert.throws(() => finish(root, run.run_id, now), /NEW run/);
  assert.deepEqual(fs.readFileSync(result.output), bytes);
});

test('finish rejects a manifest date path before accessing output paths', t => {
  const root = workspace(t); initialize(root);
  const run = begin(root, new Date(started)), manifest = readJSON(run.manifest);
  manifest.report_date = '../../outside'; writeJSON(run.manifest, manifest);
  assert.throws(() => finish(root, run.run_id, now), /Invalid YYYY-MM-DD/);
  assert.equal(fs.existsSync(path.join(root, 'outputs')), false);
});

test('a fully collected run writes a complete portable JSON and cannot be re-timed', t => {
  const root = workspace(t), f = fixture(); initialize(root);
  writeJSON(path.join(root, '.local/config.json'), f.config);
  const run = begin(root, new Date(started));
  const input = readJSON(run.observations);
  input.observations = f.input.observations;
  writeJSON(run.observations, input);
  const result = finish(root, run.run_id, new Date(completed));
  assert.equal(result.status, 'complete');
  assert.equal(result.validated_metrics, 23);
  assert.equal(result.failed_metrics, 0);
  const bundle = readJSON(result.output);
  assert.equal(verifyTransfer(bundle, { expectedConfig: f.config, now }).status, 'complete');
  assert.equal(bundle.input.completed_at, completed);
  assert.deepEqual(bundle.input.observations, f.input.observations);
  assert.equal(fs.existsSync(path.join(root, '.local/ledger')), false);
});

test('CLI is relocatable, works from another cwd, and returns incomplete with a real output', t => {
  const root = workspace(t), entry = path.join(root, 'scripts/collect.mjs');
  const call = args => spawnSync(process.execPath, [entry, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(call(['init']).status, 0);
  assert.equal(call(['doctor']).status, 0);
  const start = call(['begin']); assert.equal(start.status, 0, start.stderr);
  const run = JSON.parse(start.stdout);
  const end = call(['finish', '--run', run.run_id]);
  assert.equal(end.status, 2, end.stderr);
  const result = JSON.parse(end.stdout);
  assert.equal(fs.existsSync(result.output), true);
  assert.equal(result.validated_metrics, 0);
  assert.equal(result.failed_metrics, 23);
  assert.equal(call(['verify', result.output]).status, 2);
  assert.equal(call(['finish', '--run', '../../outside']).status, 1);
  assert.equal(call(['verify']).status, 1);
  assert.equal(call(['begin', '--date', '2020-01-01']).status, 1);
  assert.equal(fs.readdirSync(path.join(root, 'outputs')).some(f => f.endsWith('.md')), false);
  assert.equal(execFileSync(process.execPath, [entry, 'doctor'], { cwd: os.tmpdir(), encoding: 'utf8' }).includes('NOT_TESTED'), true);
});
