import { createHash } from 'node:crypto';
import { assert, buildPlan, hash, validateConfig, validateRun } from './core.mjs';

export const FORMAT = 'celdyque.tiktok-morning.transfer';
export const VERSION = '1.0.0';
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const extensions = new Set(['json', 'txt', 'png', 'jpg', 'jpeg', 'webp']);

function configShape(config) {
  validateConfig(config, 4);
  const allowed = ['schema_version', 'shop_id', 'shop_name', 'ads_account', 'customer_badge_confirmed', 'schedule', 'campaigns', 'products'];
  assert(Object.keys(config).every(key => allowed.includes(key)), 'Unexpected config fields; credentials do not belong in a transfer');
  for (const c of config.campaigns) assert(Object.keys(c).every(k => ['key', 'label', 'name', 'id'].includes(k)), 'Unexpected campaign fields');
  for (const p of config.products) assert(Object.keys(p).every(k => ['key', 'label', 'id', 'sharing', 'voc', 'views'].includes(k)), 'Unexpected product fields');
  assert(Object.keys(config.schedule).every(k => ['timezone', 'weekdays', 'start_time'].includes(k)), 'Unexpected schedule fields');
}

export function validateAttachmentPath(name) {
  assert(typeof name === 'string' && name.length > 0 && name.length <= 200, 'Invalid evidence filename');
  assert(!name.includes('\\') && !/[:\x00-\x1f]/.test(name), 'Invalid evidence path');
  assert(name.split('/').every(part => part && part !== '.' && part !== '..'), 'Evidence path must remain relative');
  assert(extensions.has(name.split('.').at(-1).toLowerCase()), 'Unsupported evidence file type');
}

function verifyAttachments(attachments) {
  assert(Array.isArray(attachments), 'attachments must be an array');
  const names = new Set();
  let bytes = 0;
  for (const a of attachments) {
    validateAttachmentPath(a.path);
    assert(!names.has(a.path), 'Duplicate evidence filename');
    names.add(a.path);
    assert(a.encoding === 'base64' && typeof a.content === 'string', 'Evidence must use base64 encoding');
    assert(Number.isSafeInteger(a.bytes) && a.bytes >= 0, 'Invalid evidence byte count');
    bytes += a.bytes;
    assert(bytes <= MAX_ATTACHMENT_BYTES, 'Evidence exceeds 12 MiB; keep only required, redacted collection proof');
    assert(a.content.length === 4 * Math.ceil(a.bytes / 3), 'Invalid evidence encoding size');
    const decoded = Buffer.from(a.content, 'base64');
    assert(decoded.toString('base64') === a.content, 'Invalid evidence encoding');
    assert(decoded.length === a.bytes && digest(decoded) === a.sha256, 'Evidence bytes/hash mismatch');
  }
}

function verifyInput(manifest, input, config, now) {
  configShape(config);
  assert(manifest?.collection_contract_version === 4, 'Only collection contract v4 is supported');
  assert(uuid.test(manifest.run_id), 'Invalid run UUID');
  const { run_id, started_at, ...savedPlan } = manifest;
  const plan = buildPlan(config, manifest.report_date, 4);
  assert(plan.specs.length === 23 && hash(savedPlan) === hash(plan), 'Manifest/config does not match the fixed 23-metric plan');
  assert(input.run_id === run_id && input.started_at === started_at, 'Manifest/input run identity mismatch');
  assert(input.observations.length === 23, 'Keep all 23 observations, including collection errors');
  return validateRun(input, plan, config, now);
}

export function createTransfer({ manifest, input, config, attachments = [], now = new Date() }) {
  const validation = verifyInput(manifest, input, config, now);
  verifyAttachments(attachments);
  const payload = {
    format: FORMAT,
    schema_version: 1,
    collection_contract_version: 4,
    producer: { name: 'celdyque-tiktok-morning-collector', version: VERSION },
    report_date: input.report_date,
    run_id: input.run_id,
    config: structuredClone(config),
    manifest: structuredClone(manifest),
    input: structuredClone(input),
    validation,
    attachments: structuredClone(attachments)
  };
  return { ...payload, integrity: { algorithm: 'sha256-canonical-json', payload_sha256: hash(payload) } };
}

export function verifyTransfer(bundle, { expectedConfig, now = new Date() } = {}) {
  assert(bundle?.format === FORMAT && bundle.schema_version === 1 && bundle.collection_contract_version === 4, 'Unsupported transfer format');
  const { integrity, ...payload } = bundle;
  assert(integrity?.algorithm === 'sha256-canonical-json' && integrity.payload_sha256 === hash(payload), 'Transfer integrity mismatch');
  assert(bundle.report_date === bundle.input?.report_date && bundle.run_id === bundle.input?.run_id, 'Transfer header/input mismatch');
  if (expectedConfig) assert(hash(bundle.config) === hash(expectedConfig), 'Transfer belongs to another account/config');
  const result = verifyInput(bundle.manifest, bundle.input, bundle.config, now);
  verifyAttachments(bundle.attachments);
  assert(hash(result) === hash(bundle.validation), 'Stored validation differs from recomputed validation');
  return result;
}

export function attachment(path, bytes) {
  validateAttachmentPath(path);
  return { path, encoding: 'base64', bytes: bytes.length, sha256: digest(bytes), content: bytes.toString('base64') };
}
