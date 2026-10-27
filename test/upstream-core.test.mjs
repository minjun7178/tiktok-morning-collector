import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlan as versionedPlan, hash, periods, previousPublicationDate, render, validateConfig, validateRun, withDeltas } from '../lib/core.mjs';
import { previousSnapshot, publish, writeReportOutput } from '../lib/storage.mjs';
const buildPlan = (c,d) => versionedPlan(c,d,1); // Historical collection contract regression tests.

const config = validateConfig({
  schema_version: 1, shop_id: '10001', shop_name: 'TEST SHOP', ads_account: 'ads-main', customer_badge_confirmed: true,
  schedule: { timezone: 'Asia/Seoul', weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: '08:40' },
  campaigns: [
    { key: 'bundle', label: '번들', name: 'bundle-campaign', id: '20001' },
    { key: 'single', label: '단품', name: 'single-campaign', id: '20002' },
    { key: 'copper', label: '카퍼', name: 'copper-campaign', id: '20003' }
  ],
  products: [
    { key: 'bundle', label: '번들', id: '30001', sharing: true, voc: true, views: false },
    { key: 'single', label: '단품', id: '30002', sharing: true, voc: true, views: false },
    { key: 'hair', label: '헤어', id: '30003', sharing: true, voc: true, views: false },
    { key: 'pdrn', label: 'PDRN', id: '30004', sharing: true, voc: false, views: false },
    { key: 'copper', label: '카퍼', id: '30005', sharing: true, voc: true, views: true }
  ]
});

test('every publication day uses the previous calendar day', () => {
  assert.deepEqual(periods('2026-09-14'), [{ start: '2026-09-13', end: '2026-09-13' }]);
  assert.deepEqual(periods('2026-09-15'), [{ start: '2026-09-14', end: '2026-09-14' }]);
  assert.deepEqual(periods('2026-09-13'), [{ start: '2026-09-12', end: '2026-09-12' }]);
  assert.deepEqual(periods('2026-09-12'), [{ start: '2026-09-11', end: '2026-09-11' }]);
});

test('EUKA is excluded from the collection plan and rendered report', () => {
  const plan = buildPlan(config, '2026-09-14');
  assert.equal(plan.specs.length, 46);
  assert.equal(plan.specs.some(s => s.key.startsWith('euka.') || s.host === 'app.euka.ai'), false);
  const result = { status: 'incomplete', values: {}, issues: plan.specs.map(s => ({ key: s.key, kind: 'collection', reason: 'test' })) };
  const markdown = render(result, plan, config, { run_id: 'run-no-euka' });
  assert.doesNotMatch(markdown, /EUKA|euka\.|TARGET COLLABORATION/);
});

function observation(s, run) {
  let value = s.signed ? (s.key === 'health.rank_change' ? -2 : 0.04) : 2;
  if (s.unit === 'percent') value = 77.8;
  if (s.unit === 'index') value = 0.4;
  if (s.unit === 'ratio') value = 2.3;
  if (s.unit === 'rank') value = 998;
  if (s.max === 5) value = 4.6;
  if (s.max === 1000) value = 408;
  if (s.key === 'customer.count') value = 0;
  if (s.key === 'ratings.awaiting' || s.proof_kind === 'samples') value = 2;
  const suffix = s.unit === 'KRW' ? ' KRW' : s.unit === 'percent' || s.unit === 'percentage_points' ? '%' : s.unit === 'index' ? 'x' : '';
  const raw = `${value}${suffix}`;
  let evidence = `${s.label} ${raw}`;
  const o = { key: s.key, status: 'ok', raw_value: raw, value, unit: s.unit, basis: s.basis,
    url: `https://${s.host}${s.path}`, shop_id: config.shop_id, identity: config.shop_name,
    collected_at: '2026-09-14T00:10:00Z', evidence, source_delayed: false,
    checks: { loaded: true, identity: true, unique: true, filters: true, complete: true } };
  if (s.source_updated_required) o.source_updated_at = 'visible update label';
  if (s.entity) { o.entity_id = s.entity; o.evidence += ` ${s.entity}`; }
  if (s.direction) { o.direction = value < 0 ? 'down' : value > 0 ? 'up' : 'unchanged'; o.direction_evidence = 'visible arrow'; }
  if (s.period) {
    Object.assign(o, { period_start: s.period.start, period_end: s.period.end, timezone: 'Asia/Seoul', ads_account: config.ads_account, scope: s.scope, campaign_id: s.campaign?.id || null });
    o.checks.period = true;
    o.evidence += ` ${s.period.start} ${s.period.end}`;
    if (s.campaign) o.evidence += ` ${s.campaign.id} ${s.campaign.name}`;
  }
  if (s.key === 'ratings.negative_rate') o.evidence += ' Last 7 days';
  if (s.proof_kind === 'rank') Object.assign(o, { rank_category: 'Beauty & Personal Care', rank_by: 'Total GMV', rank_window: 'Last 30 days', evidence: `${o.evidence} ${config.shop_name}` });
  if (s.proof_kind === 'voc') Object.assign(o, { level: 'Good', source_period: '08/13/2026 - 09/12/2026' });
  if (s.proof_kind === 'reviews') Object.assign(o, { displayed_total: 2, count_stable: true, pages: [{ number: 1, ids: ['review-a', 'review-b'], evidence: 'two review rows', has_next: false }] });
  if (s.proof_kind === 'samples') Object.assign(o, { collaboration_filter: s.collaboration_filter, selection_unit_verified: true, count_stable: true, all_pages_checked: true,
    evidence: `${o.evidence} Free samples > To review > ${s.collaboration_filter}`,
    pages: [{ number: 1, selected: 2, selectable_rows: 2, disabled_count: 1, evidence: 'Page 1; 2 selected', has_next: false,
      selection_scope: 'page', selection_before: 0, selection_after_cleanup: 0, table_settled: true, settled_state_checks: 2,
      next_control_present: true, next_control_disabled: true }] });
  if (s.key === 'customer.count') Object.assign(o, { badge_absent: true, evidence: 'Customer messages button', checks: { ...o.checks, button_present: true, badge_loaded: true } });
  return o;
}

test('a complete observed run validates, renders and can become the baseline', () => {
  const plan = buildPlan(config, '2026-09-14');
  const run = { schema_version: 1, run_id: 'run-a', report_date: plan.report_date, config_hash: plan.config_hash,
    started_at: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T00:20:00Z', observations: [] };
  run.observations = plan.specs.map(s => observation(s, run));
  const result = validateRun(run, plan, config, new Date('2026-09-14T00:21:00Z'));
  assert.equal(result.status, 'complete', JSON.stringify(result.issues));
  assert.match(render(result, plan, config, run), /검증 완료/);
  assert.match(render(result, plan, config, run), /카퍼 \[2\(전일 데이터 없음\) \/ 2\(전일 데이터 없음\) \/ 2\(전일 데이터 없음\)\]/);
  assert.match(render(result, plan, config, run), /\[05\] 샘플 신청\n오픈콜라보: 2건 남음\n타겟 콜라보: 2건 남음/);
  assert.match(render(result, plan, config, run), /VOC: 번들 0\.4\(전일 데이터 없음\) \/ 단품 0\.4\(전일 데이터 없음\)/);
  assert.doesNotMatch(render(result, plan, config, run), /VOC: .*\d(?:\.\d+)?x/);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tmr-'));
  const snapshot = { ...result, schema_version: 1, config_hash: plan.config_hash, report_date: plan.report_date, run_id: run.run_id, input_hash: hash(run), started_at: run.started_at, completed_at: run.completed_at };
  const saved = publish(base, snapshot, 'report');
  assert.equal(saved.duplicate, false);
  assert.equal(previousSnapshot(base, '2026-09-15').report_date, '2026-09-14');
});

test('customer count uses the visible customers unassigned number', () => {
  const plan = buildPlan(config, '2026-09-14');
  const run = { schema_version: 1, run_id: 'run-customer', report_date: plan.report_date, config_hash: plan.config_hash,
    started_at: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T00:20:00Z', observations: [] };
  run.observations = plan.specs.map(s => observation(s, run));
  const customer = run.observations.find(o => o.key === 'customer.count');
  Object.assign(customer, { value: 2, raw_value: '2', customer_indicator: 'unassigned', badge_absent: false,
    evidence: 'TEST SHOP; Customer messages header; 2 customers unassigned; no delay warning.' });
  const result = validateRun(run, plan, config, new Date('2026-09-14T00:21:00Z'));
  assert.equal(result.status, 'complete', JSON.stringify(result.issues));
  assert.match(render(result, plan, config, run), /CUSTOMER MESSAGES 2건/);
});

test('customer count accepts the visible singular unassigned label', () => {
  const plan = buildPlan(config, '2026-09-14');
  const run = { schema_version: 1, run_id: 'run-customer-singular', report_date: plan.report_date, config_hash: plan.config_hash,
    started_at: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T00:20:00Z', observations: [] };
  run.observations = plan.specs.map(s => observation(s, run));
  const customer = run.observations.find(o => o.key === 'customer.count');
  Object.assign(customer, { value: 1, raw_value: '1', customer_indicator: 'unassigned', badge_absent: false,
    evidence: 'TEST SHOP; Customer messages header; 1 customer unassigned; no delay warning.' });
  assert.equal(validateRun(run, plan, config, new Date('2026-09-14T00:21:00Z')).status, 'complete');
});

test('sample zero rejects a transient empty state without reload proof', () => {
  const plan = buildPlan(config, '2026-09-14');
  const run = { schema_version: 1, run_id: 'run-sample-transient-zero', report_date: plan.report_date, config_hash: plan.config_hash,
    started_at: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T00:20:00Z', observations: [] };
  run.observations = plan.specs.map(s => observation(s, run));
  const sample = run.observations.find(o => o.key === 'samples.open.selected');
  Object.assign(sample, { value: 0, raw_value: '0', evidence: 'Open collaboration selected 0; Free samples > To review > Open collaboration; initial empty table', pages: [{
    number: 1, selected: 0, selectable_rows: 0, disabled_count: 0, evidence: 'Page 1; initial empty state', has_next: false,
    selection_scope: 'page', selection_before: 0, selection_after_cleanup: 0, empty_confirmed: true,
    table_settled: true, settled_state_checks: 2, next_control_present: true, next_control_disabled: true,
  }] });
  const result = validateRun(run, plan, config, new Date('2026-09-14T00:21:00Z'));
  assert.equal(result.status, 'incomplete');
  assert.match(result.issues.find(x => x.key === 'samples.open.selected').reason, /three confirmed empty states/);
});

test('sample zero accepts only repeated empty proof after a reload', () => {
  const plan = buildPlan(config, '2026-09-14');
  const run = { schema_version: 1, run_id: 'run-sample-confirmed-zero', report_date: plan.report_date, config_hash: plan.config_hash,
    started_at: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T00:20:00Z', observations: [] };
  run.observations = plan.specs.map(s => observation(s, run));
  const sample = run.observations.find(o => o.key === 'samples.open.selected');
  Object.assign(sample, { value: 0, raw_value: '0', evidence: 'Open collaboration selected 0; Free samples > To review > Open collaboration; empty state confirmed after reload', pages: [{
    number: 1, selected: 0, selectable_rows: 0, disabled_count: 0, evidence: 'Page 1; empty state confirmed after reload', has_next: false,
    selection_scope: 'page', selection_before: 0, selection_after_cleanup: 0, empty_confirmed: true,
    table_settled: true, settled_state_checks: 3, next_control_present: true, next_control_disabled: true,
    empty_state_checks: 3, reloaded_after_empty: true, header_checkbox_disabled: true, empty_state_text: 'No sample requests yet',
  }] });
  assert.equal(validateRun(run, plan, config, new Date('2026-09-14T00:21:00Z')).status, 'complete');
});

test('missing and stale metrics fail closed and do not invent values', () => {
  const plan = buildPlan(config, '2026-09-14');
  const run = { schema_version: 1, run_id: 'run-b', report_date: plan.report_date, config_hash: plan.config_hash,
    started_at: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T00:20:00Z', observations: [] };
  run.observations = plan.specs.slice(0, 1).map(s => observation(s, run));
  run.observations[0].source_delayed = true;
  const result = validateRun(run, plan, config, new Date('2026-09-14T00:21:00Z'));
  assert.equal(result.status, 'incomplete');
  assert.ok(result.issues.length >= plan.specs.length);
  assert.equal(result.issues.find(x => x.key === 'customer.count').kind, 'validation');
  assert.equal(result.issues.find(x => x.key === 'refunds.pending').kind, 'collection');
  const markdown = render(result, plan, config, { ...run, completed_at: '2026-09-14T00:20:00Z' });
  assert.match(markdown, /\[검증 실패\]/);
  assert.match(markdown, /\[수집 실패\]/);
  assert.match(markdown, /CUSTOMER MESSAGES \[검증 실패\] \/ 내용은 사람 확인/);
  assert.match(markdown, /Pending returns \[수집 실패\]/);
  assert.doesNotMatch(markdown, /\[(?:수집|검증) 실패\](?:건|개|명)/);
});

test('every report can be copied to the simple outputs folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmr-output-'));
  const file = writeReportOutput(root, '2026-09-15', 'report body\n');
  assert.equal(file, path.join(root, 'outputs', '2026-09-15.md'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'report body\n');
});

function comparisonFixture() {
  const plan = buildPlan(config, '2026-09-15');
  const values = Object.fromEntries(plan.specs.filter(s => s.delta).map(s => [s.key, observation(s)]));
  const current = { status: 'complete', issues: [], values };
  const previous = { status: 'complete', report_date: '2026-09-14', config_hash: 'older-config', values: structuredClone(values) };
  current.values['creators.total'].value = 120;
  previous.values['creators.total'].value = 100;
  return { plan, current, previous };
}

test('daily deltas survive config, timestamp and source-query changes', () => {
  const { plan, current, previous } = comparisonFixture();
  previous.values['creators.total'].url += '?shop_id=10001&shop_region=US';
  current.values['creators.total'].collected_at = '2026-09-15T00:10:00Z';
  current.values['products.copper.voc'].source_period = '08/14/2026 - 09/13/2026';
  assert.equal(withDeltas(current, plan, previous).values['creators.total'].delta.value, 20);
  assert.equal(withDeltas(current, plan, previous).values['products.copper.voc'].delta.value, 0);
  const markdown = render(withDeltas(current, plan, previous), plan, config, {});
  assert.match(markdown, /총 어필리에이트 풀 120\(\+20\)명/);
  assert.match(markdown, /증감 비교 기준: 2026-09-14 수집값/);
  assert.equal(current.values['creators.total'].delta, undefined);
});

test('missing and non-previous-day data never become a fallback, while valid fields from an incomplete day do', () => {
  const { plan, current, previous } = comparisonFixture();
  assert.equal(withDeltas(current, plan, { ...previous, status: 'incomplete' }).values['creators.total'].delta.value, 20);
  for (const prior of [null, { ...previous, report_date: '2026-09-11' }, { ...previous, report_date: '2026-09-15' }]) {
    const result = withDeltas(current, plan, prior);
    assert.equal(result.values['creators.total'].delta, null);
    assert.equal(result.values['creators.total'].delta_reason, '전일 데이터 없음');
  }
  delete previous.values['creators.total'];
  assert.equal(withDeltas(current, plan, previous).values['creators.total'].delta_reason, '전일 해당 지표 없음');
});

test('compatibility is checked independently per metric', () => {
  const key = 'products.copper.sharing';
  for (const [field, value, reason] of [
    ['entity_id', '99999', '상품 변경'], ['shop_id', '99999', '계정 변경'], ['identity', 'OTHER SHOP', '계정 변경'],
    ['unit', 'percent', '집계 기준 변경'], ['basis', 'last_7_days', '집계 기준 변경'], ['key', 'products.copper.videos', '집계 기준 변경'],
    ['url', 'https://affiliate-global.tiktok.com/other', '수집 화면 변경'], ['url', 'https://other.example/affiliate/collaboration/open-collaboration', '수집 화면 변경'],
    ['url', '', '수집 화면 확인 불가'], ['status', 'error', '검증 정보 없음']
  ]) {
    const { plan, current, previous } = comparisonFixture();
    previous.values[key][field] = value;
    const result = withDeltas(current, plan, previous);
    assert.equal(result.values[key].delta, null, field);
    assert.match(result.values[key].delta_reason, new RegExp(reason), field);
    assert.equal(result.values['creators.total'].delta.value, 20, field);
  }
});

test('baseline selection uses the previous calendar day current ledger', () => {
  assert.equal(previousPublicationDate('2026-09-14'), '2026-09-13');
  assert.equal(previousPublicationDate('2026-09-13'), '2026-09-12');
  assert.equal(previousPublicationDate('2026-09-16'), '2026-09-15');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tmr-baseline-'));
  const { previous } = comparisonFixture();
  publish(base, { ...previous, report_date: '2026-09-13', input_hash: 'sunday' }, 'Sunday');
  assert.equal(previousSnapshot(base, '2026-09-14').report_date, '2026-09-13');
  assert.equal(previousSnapshot(base, '2026-09-15'), null);
  publish(base, { ...previous, input_hash: 'first' }, 'First');
  publish(base, { ...previous, config_hash: 'new-config', input_hash: 'second' }, 'Second');
  assert.equal(previousSnapshot(base, '2026-09-15').input_hash, 'second');
  publish(base, { ...previous, status: 'incomplete', input_hash: 'partial' }, 'Incomplete');
  assert.equal(previousSnapshot(base, '2026-09-15').input_hash, 'partial');
});

test('same-day runs replace the current ledger and identical repeats are idempotent', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tmr-current-'));
  const { previous } = comparisonFixture();
  const snapshot = { ...previous, input_hash: 'same-input' };
  const first = publish(base, snapshot, 'Original');
  assert.equal(path.basename(first.directory), 'current');
  const second = publish(base, snapshot, 'Corrected');
  assert.equal(second.replaced, true);
  assert.equal(fs.readFileSync(path.join(first.directory, 'report.md'), 'utf8'), 'Corrected');
  assert.equal(publish(base, snapshot, 'Corrected').duplicate, true);
  const correctedValues = structuredClone(snapshot);
  correctedValues.values['creators.total'].delta = { value: 1, baseline: '2026-09-11' };
  assert.equal(publish(base, correctedValues, 'Corrected').replaced, true);
});

test('rank output preserves observed direction and explicit sign, including zero and failures', () => {
  const { plan } = comparisonFixture();
  for (const [value, direction, expected] of [[1, 'up', '+1 (1계단 상승)'], [-1, 'down', '-1 (1계단 하락)'], [0, 'unchanged', '0 (변동 없음)']]) {
    const result = { status: 'complete', issues: [], values: { 'health.rank': { value: 1021 }, 'health.rank_change': { value, direction } } };
    assert.ok(render(result, plan, config, {}).includes(`샵랭크: 1,021위 / 화면 변화: ${expected}`));
  }
  const failed = { status: 'incomplete', values: {}, issues: [{ key: 'health.rank_change', kind: 'validation' }] };
  assert.match(render(failed, plan, config, {}), /샵랭크: \[수집 실패\] \/ 화면 변화: \[검증 실패\]/);
});

test('cross-day compatibility does not relax run config integrity', () => {
  const { plan, current, previous } = comparisonFixture();
  assert.equal(withDeltas(current, plan, { ...previous, status: 'incomplete' }).values['creators.total'].delta.value, 20);
  assert.throws(() => validateRun({ schema_version: 1, run_id: 'run', report_date: plan.report_date, config_hash: 'wrong' }, plan, config), /Input does not match/);
});


test('v2 collects 43 metrics, omits manual messages and negative review fields, keeps v1 hash shape', () => {
  const plan = versionedPlan(config, '2026-09-29', 2);
  assert.equal(plan.collection_contract_version, 2);
  assert.equal(plan.specs.length, 43);
  for (const key of ['customer.count','ratings.negative_rate','ratings.site_change']) assert.ok(!plan.specs.some(s=>s.key===key));
  assert.ok(plan.specs.some(s=>s.key==='ratings.awaiting'));
  const legacy = versionedPlan(config,'2026-09-29',1);
  assert.equal(legacy.collection_contract_version, undefined);
  assert.equal(legacy.specs.length,46);
  const withoutBadge = {...config}; delete withoutBadge.customer_badge_confirmed;
  assert.doesNotThrow(()=>versionedPlan(withoutBadge,'2026-09-29'));
  assert.throws(()=>versionedPlan(withoutBadge,'2026-09-29',1));
  const md=render({values:{},issues:[],status:'incomplete'},plan,config,{completed_at:'2026-09-29T01:00:00Z'});
  assert.ok(!md.includes('[00]'));
  assert.ok(!md.includes('부정적 리뷰 비율'));
  assert.ok(md.includes('Awaiting reply'));
});

test('v3 morning runs validate 27 metrics without GMV and reject accidental GMV observations', () => {
  const plan = versionedPlan(config, '2026-09-14', 3);
  assert.equal(plan.collection_contract_version, 3);
  assert.equal(plan.specs.length, 27);
  assert.deepEqual(plan.ranges, []);
  assert.ok(plan.specs.every(s => !s.key.startsWith('gmv.') && s.path !== '/ads-creation/dashboard'));
  const run = { schema_version: 1, run_id: 'morning-v3', report_date: plan.report_date, config_hash: plan.config_hash,
    started_at: '2026-09-14T00:00:00Z', completed_at: '2026-09-14T00:30:00Z', observations: plan.specs.map(s => observation(s)) };
  const result = validateRun(run, plan, config, new Date(run.completed_at));
  assert.equal(result.status, 'complete');
  assert.equal(Object.keys(result.values).length, 27);
  const md = render(result, plan, config, run);
  assert.match(md, /GMV MAX: 아침 자동 수집 제외/);
  assert.doesNotMatch(md, /\[수집 실패\]|\[검증 실패\]|부정적 리뷰 비율|CUSTOMER MESSAGES/);
  const oldPlan = versionedPlan(config, plan.report_date, 2);
  const oldResult = validateRun(run, oldPlan, config, new Date(run.completed_at));
  assert.equal(oldResult.issues.length, 16);
  assert.ok(oldResult.issues.every(i => i.key.startsWith('gmv.')));
  run.observations.push(observation(oldPlan.specs.find(s => s.key.startsWith('gmv.'))));
  assert.throws(() => validateRun(run, plan, config), /Unexpected observation key/);
});

test('v4 collects 23 metrics, keeps manual VOC slots and preserves the v3 contract', () => {
  const legacy = versionedPlan(config, '2026-10-16', 3);
  const plan = versionedPlan(config, '2026-10-16');
  assert.equal(plan.collection_contract_version, 4);
  assert.equal(plan.specs.length, 23);
  assert.deepEqual(plan.specs, legacy.specs.filter(s => s.proof_kind !== 'voc'));
  assert.equal(legacy.specs.filter(s => s.proof_kind === 'voc').length, 4);
  assert.deepEqual(plan.ranges, []);
  const run = {schema_version:1,run_id:'morning-v4',report_date:plan.report_date,config_hash:plan.config_hash,
    started_at:'2026-10-16T00:00:00Z',completed_at:'2026-10-16T00:30:00Z',
    observations:plan.specs.map(s => ({...observation(s),collected_at:'2026-10-16T00:10:00Z'}))};
  const result = validateRun(run, plan, config, new Date(run.completed_at));
  assert.equal(result.status, 'complete');
  assert.equal(Object.keys(result.values).length, 23);
  const md = render(result, plan, config, run);
  assert.equal((md.match(/\[직접 입력\]/g)||[]).length, 4);
  assert.doesNotMatch(md, /\[수집 실패\]|\[검증 실패\]/);
  run.observations.push(observation(legacy.specs.find(s => s.proof_kind === 'voc')));
  assert.throws(() => validateRun(run, plan, config), /Unexpected observation key/);
});
