import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert, buildPlan, dateOnly, hash, todayKST, validateConfig } from './core.mjs';
import { readJSON, writeJSON } from './storage.mjs';
import { attachment, createTransfer, verifyTransfer, MAX_ATTACHMENT_BYTES } from './transfer.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const localConfigPath = root => path.join(root, '.local', 'config.json');
const config = root => validateConfig(readJSON(localConfigPath(root)), 4);

export function initialize(root) {
  const profile = validateConfig(readJSON(path.join(root, 'profiles', 'celdyque.json')), 4);
  const file = localConfigPath(root);
  if (fs.existsSync(file)) return { config: file, created: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(profile, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { config: file, created: true };
}

export function doctor(root) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert(major > 22 || major === 22 && minor >= 14, 'Node.js 22.14 or later is required');
  const c = config(root);
  const plan = buildPlan(c, todayKST(), 4);
  assert(plan.specs.length === 23, 'Expected 23 v4 metrics');
  return { config_valid: true, node: process.versions.node, shop_name: c.shop_name, shop_id: c.shop_id,
    collection_contract_version: 4, required_metrics: 23,
    browser_access: 'NOT_TESTED — Codex must verify logged-in Chrome on this computer',
    automation: 'NOT_CREATED — this repository does not install a schedule',
    output: 'outputs/YYYY-MM-DD-RUN_ID.json' };
}

export function begin(root, now = new Date()) {
  const c = config(root);
  const plan = buildPlan(c, todayKST(now), 4);
  assert(plan.specs.length === 23, 'Expected 23 v4 metrics');
  const run_id = randomUUID(), started_at = now.toISOString();
  const dir = path.join(root, '.local', 'runs', run_id);
  const manifest = { ...plan, run_id, started_at };
  const observations = plan.specs.map(s => ({
    key: s.key, status: 'error', reason: '아직 수집하지 않음', value: null, raw_value: '',
    unit: s.unit, basis: s.basis, url: `https://${s.host}${s.path}`, shop_id: c.shop_id,
    identity: '', collected_at: '', evidence: '', source_delayed: null,
    checks: { loaded: false, identity: false, unique: false, filters: false, complete: false },
    ...(s.entity ? { entity_id: '' } : {})
  }));
  writeJSON(path.join(dir, 'manifest.json'), manifest);
  writeJSON(path.join(dir, 'observations.json'), { schema_version: 1, run_id, report_date: plan.report_date,
    config_hash: plan.config_hash, started_at, observations });
  return { run_id, report_date: plan.report_date, collection_contract_version: 4, required_metrics: 23,
    manifest: path.join(dir, 'manifest.json'), observations: path.join(dir, 'observations.json'),
    evidence_directory: path.join(dir, 'evidence') };
}

function evidenceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  assert(!fs.lstatSync(dir).isSymbolicLink() && fs.lstatSync(dir).isDirectory(), 'Evidence root must be an ordinary directory');
  const files = [];
  let bytes = 0;
  function walk(current, relative = '') {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      assert(!e.isSymbolicLink(), 'Evidence symlinks are not allowed');
      const name = relative ? `${relative}/${e.name}` : e.name;
      const file = path.join(current, e.name);
      if (e.isDirectory()) walk(file, name);
      else {
        assert(e.isFile(), 'Evidence must be ordinary files');
        bytes += fs.statSync(file).size;
        assert(bytes <= MAX_ATTACHMENT_BYTES, 'Evidence exceeds 12 MiB');
        files.push(attachment(name, fs.readFileSync(file)));
      }
    }
  }
  walk(dir);
  return files;
}

function summary(bundle, file, duplicate) {
  return { run_id: bundle.run_id, report_date: bundle.report_date, status: bundle.validation.status,
    validated_metrics: Object.keys(bundle.validation.values).length,
    failed_metrics: bundle.validation.issues.length, errors: bundle.validation.issues,
    output: file, bytes: fs.statSync(file).size, payload_sha256: bundle.integrity.payload_sha256,
    completed_at: bundle.input.completed_at, duplicate };
}

export function finish(root, id, now = new Date()) {
  assert(uuid.test(id || ''), 'finish requires --run UUID');
  const dir = path.join(root, '.local', 'runs', id);
  assert(fs.existsSync(dir), 'Unknown run');
  const lock = path.join(dir, 'finish.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch { throw new Error('This run is already being finalized; inspect finish.lock before recovery'); }
  try {
    const manifest = readJSON(path.join(dir, 'manifest.json'));
    const raw = readJSON(path.join(dir, 'observations.json'));
    dateOnly(manifest.report_date);
    assert(manifest.run_id === id && raw.run_id === id, 'Run files do not belong to the requested UUID');
    const c = config(root);
    const output = path.join(root, 'outputs', `${manifest.report_date}-${id}.json`);
    const finalized = path.join(dir, 'finalized.json');
    const inputHash = hash(raw);
    if (fs.existsSync(finalized) || fs.existsSync(output)) {
      const saved = fs.existsSync(finalized) ? readJSON(finalized) : null;
      if (saved) assert(saved.input_hash === inputHash, 'Finalized observations changed; begin a NEW run');
      assert(fs.existsSync(output), 'Finalized output is missing; preserve the run and investigate');
      const bundle = readJSON(output);
      verifyTransfer(bundle, { expectedConfig: c, now });
      const { completed_at, ...original } = bundle.input;
      assert(hash(original) === inputHash && hash(bundle.manifest) === hash(manifest), 'Finalized input/manifest changed; begin a NEW run');
      if (saved) assert(saved.payload_sha256 === bundle.integrity.payload_sha256, 'Finalized output changed');
      else writeJSON(finalized, { completed_at, input_hash: inputHash, payload_sha256: bundle.integrity.payload_sha256 });
      return summary(bundle, output, true);
    }
    const input = { ...raw, completed_at: now.toISOString() };
    const bundle = createTransfer({ manifest, input, config: c, attachments: evidenceFiles(path.join(dir, 'evidence')), now });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const staged = path.join(dir, 'transfer.staged.json');
    writeJSON(staged, bundle);
    fs.renameSync(staged, output);
    writeJSON(finalized, { completed_at: input.completed_at, input_hash: inputHash, payload_sha256: bundle.integrity.payload_sha256 });
    return summary(bundle, output, false);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function verify(root, filename, now = new Date()) {
  assert(typeof filename === 'string' && filename.length, 'verify requires a JSON file path');
  const bundle = readJSON(path.resolve(filename));
  const expectedConfig = fs.existsSync(localConfigPath(root)) ? config(root) : readJSON(path.join(root, 'profiles', 'celdyque.json'));
  verifyTransfer(bundle, { expectedConfig, now });
  return summary(bundle, path.resolve(filename), true);
}
