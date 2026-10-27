import { createHash } from 'node:crypto';

const DAY = 86400000;
export function assert(ok, message) { if (!ok) throw new Error(message); }
export function hash(value) {
  const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function dateOnly(s) {
  assert(typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s), 'Invalid YYYY-MM-DD');
  const t = Date.parse(`${s}T00:00:00Z`);
  assert(Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s, 'Invalid calendar date');
  return t;
}
export function todayKST(now = new Date()) { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function periods(reportDate) {
  const t = dateOnly(reportDate);
  const at = n => new Date(t - n * DAY).toISOString().slice(0, 10);
  return [{ start: at(1), end: at(1) }];
}
export function validateConfig(c, contractVersion = 2) {
  assert(c?.schema_version === 1, 'Unsupported config schema');
  for (const k of ['shop_id', 'shop_name', 'ads_account'])
    assert(typeof c[k] === 'string' && c[k].trim().length > 0, `Configure ${k}`);
  assert(/^\d+$/.test(c.shop_id), 'shop_id must be a numeric string');
  if (contractVersion === 1) assert(typeof c.customer_badge_confirmed === 'boolean', 'customer_badge_confirmed must be boolean');
  assert(c.schedule?.timezone === 'Asia/Seoul' && c.schedule?.start_time === '08:40'
    && JSON.stringify(c.schedule.weekdays) === '[0,1,2,3,4,5,6]', 'Schedule must be daily at 08:40 Asia/Seoul');
  for (const [group, expected] of [['campaigns', ['bundle', 'single', 'copper']], ['products', ['bundle', 'single', 'hair', 'pdrn', 'copper']]]) {
    assert(Array.isArray(c[group]) && c[group].length === expected.length, `Invalid ${group}`);
    assert(new Set(c[group].map(x => x.key)).size === expected.length && expected.every(k => c[group].some(x => x.key === k)), `Invalid keys: ${group}`);
    for (const x of c[group]) {
      assert(typeof x.label === 'string' && x.label.trim(), `Missing ${group} label`);
      assert(typeof x.id === 'string' && /^\d+$/.test(x.id), `Missing verified ID: ${group}.${x.key}`);
      if (group === 'campaigns') assert(typeof x.name === 'string' && x.name.trim(), `Missing campaign name: ${x.key}`);
      else for (const field of ['sharing', 'views', 'voc']) assert(typeof x[field] === 'boolean', `Invalid product flag ${field}`);
    }
    assert(new Set(c[group].map(x => x.id)).size === expected.length, `Duplicate ${group} IDs`);
  }
  for (const p of c.products) {
    assert(p.views === (p.key === 'copper'), 'Only copper Views is in scope');
    assert(p.sharing === ['bundle', 'single', 'hair', 'pdrn', 'copper'].includes(p.key), 'Sharing scope differs from confirmed five products');
    assert(p.voc === (p.key !== 'pdrn'), 'VOC scope differs from confirmed four products');
  }
  return c;
}

const seller = 'seller-global-us.tiktok.com', affiliate = 'affiliate-global.tiktok.com';
function spec(key, section, label, unit, host, path, extra = {}) {
  return { key, section, label, unit, host, path, basis: 'snapshot', delta: false, ...extra };
}
export function buildPlan(c, reportDate, contractVersion = 4) {
  assert([1, 2, 3, 4].includes(contractVersion), 'Unsupported collection contract');
  validateConfig(c, contractVersion);
  const priorPeriods = periods(reportDate); // Validate the date even when GMV is excluded.
  const ranges = contractVersion >= 3 ? [] : priorPeriods;
  const out = [
    spec('customer.count', '01', 'Customer messages', 'count', seller, '/homepage', { needs_badge_confirmation: true }),
    spec('refunds.pending', '04', 'Pending returns', 'count', seller, '/homepage'),
    spec('samples.open.selected', '05', 'Open collaboration selected', 'count', affiliate, '/affiliate/sample/sample-request', {
      proof_kind: 'samples', collaboration_filter: 'Open collaboration'
    }),
    spec('samples.target.selected', '05', 'Target collaboration selected', 'count', affiliate, '/affiliate/sample/sample-request', {
      proof_kind: 'samples', collaboration_filter: 'Target collaboration'
    }),
    spec('ratings.negative_rate', '07', 'Seller-related Negative Review Rate', 'percent', seller, '/product/rating', { basis: 'last_7_days', source_updated_required: true }),
    spec('ratings.site_change', '07', 'vs 7 days ago', 'percentage_points', seller, '/product/rating', { signed: true, basis: 'last_7_days', direction: true }),
    spec('ratings.awaiting', '07', 'Awaiting reply', 'count', seller, '/product/rating', { proof_kind: 'reviews' }),
    spec('creators.total', '09', 'Total rows', 'count', affiliate, '/affiliate/assets/creator-management', { delta: true }),
    spec('health.rank', '11', 'Rank', 'rank', seller, '/compass/analytics-rankings', { proof_kind: 'rank', source_updated_required: true }),
    spec('health.rank_change', '11', 'Ranking change', 'count', seller, '/compass/analytics-rankings', { signed: true, direction: true, proof_kind: 'rank' }),
    spec('health.sps', '11', 'Overview', 'score', seller, '/health-center/experience-score', { delta: true, max: 5, source_updated_required: true }),
    spec('health.ahr', '11', 'Account health rating', 'score', seller, '/health-center', { delta: true, max: 1000 }),
    spec('health.chr', '11', 'Creator Health Rating', 'score', seller, '/creator', { delta: true, max: 1000 }),
    spec('health.positive_rate', '11', 'Positive product-rating rate', 'percent', seller, '/health-center/experience-score/shop-tier', { delta: true }),
    spec('health.positive_target', '11', 'Positive product-rating rate', 'percent', seller, '/health-center/experience-score/shop-tier'),
  ];
  for (const p of c.products) {
    if (p.views) out.push(spec(`products.${p.key}.views`, '10', 'Views', 'count', seller, '/product/manage', { entity: p.id, delta: true }));
    if (p.sharing) {
      out.push(spec(`products.${p.key}.sharing`, '10', 'Creators sharing', 'count', affiliate, '/affiliate/collaboration/open-collaboration', { entity: p.id, delta: true }));
      out.push(spec(`products.${p.key}.videos`, '10', 'Videos authorized for Shop Ads', 'count', affiliate, '/affiliate/collaboration/open-collaboration', { entity: p.id, delta: true }));
    }
    if (p.voc && contractVersion < 4) out.push(spec(`products.${p.key}.voc`, '11', 'Index', 'index', seller, '/health-center/voc', { entity: p.id, delta: true, proof_kind: 'voc', source_updated_required: true }));
  }
  for (const range of ranges) for (const scope of [{ key: 'overall' }, ...c.campaigns]) {
    for (const [metric, label, unit] of [['cost', 'Cost', 'KRW'], ['orders', 'SKU orders', 'count'], ['revenue', 'Gross revenue', 'KRW'], ['roi', 'ROI', 'ratio']])
      out.push(spec(`gmv.${range.start}_${range.end}.${scope.key}.${metric}`, '03', label, unit, seller, '/ads-creation/dashboard', {
        basis: 'reporting_period', period: range, campaign: scope.key === 'overall' ? null : { name: scope.name, id: scope.id }, scope: scope.key
      }));
  }
  const plan = { schema_version: 1, config_hash: hash(c), report_date: reportDate, ranges, specs: out };
  // Keep the byte-equivalent v1 plan/hash for already issued manifests.
  if (contractVersion >= 2) {
    plan.collection_contract_version = contractVersion;
    plan.specs = out.filter(s => !['customer.count', 'ratings.negative_rate', 'ratings.site_change'].includes(s.key));
  }
  return plan;
}

const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
export function numeric(raw, unit) {
  assert(typeof raw === 'string', 'raw_value must be text copied from screen');
  let s = raw.trim();
  if (unit === 'KRW') s = s.replace(/\s*KRW$/, '').trim();
  if (unit === 'percent' || unit === 'percentage_points') s = s.replace(/%$/, '').trim();
  if (unit === 'index') s = s.replace(/x$/i, '').trim();
  assert(/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s), `Unparseable number: ${raw}`);
  const n = Number(s.replaceAll(',', ''));
  assert(Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER, 'Unsafe number');
  if (['count', 'rank'].includes(unit)) assert(Number.isSafeInteger(n), 'Count must be an integer');
  return n;
}
function timestamp(s) {
  assert(typeof s === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)), 'Timestamp requires explicit timezone');
  return Date.parse(s);
}
function validatePages(pages, kind) {
  assert(Array.isArray(pages) && pages.length > 0, 'Missing page evidence');
  const all = new Set(); let total = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    assert(p.number === i + 1, 'Pages must start at 1 with no gaps or duplicates');
    assert(p.has_next === (i < pages.length - 1), 'Last-page proof is inconsistent');
    assert(typeof p.evidence === 'string' && p.evidence.trim().length > 0, 'Missing page evidence text');
    if (kind === 'samples') {
      assert(p.table_settled === true && Number.isSafeInteger(p.settled_state_checks) && p.settled_state_checks >= 2,
        'Sample table must be stable across at least two fresh states');
      assert(p.next_control_present === true && p.next_control_disabled === !p.has_next,
        'Sample pagination control state is unverified');
      assert(Number.isSafeInteger(p.selected) && p.selected >= 0, 'Missing selected counter');
      assert(Number.isSafeInteger(p.selectable_rows) && p.selectable_rows >= 0, 'Missing selectable row count');
      assert(p.selected === p.selectable_rows, 'Selected counter and selectable rows differ');
      assert(p.selection_scope === 'page' && p.selection_before === 0 && p.selection_after_cleanup === 0, 'Page selection must be isolated and cleared');
      assert(norm(p.evidence).includes(norm(`${p.selected} selected`)) || (p.selected === 0 && p.empty_confirmed === true), 'Missing selected counter evidence');
      assert(Number.isSafeInteger(p.disabled_count) && p.disabled_count >= 0, 'Missing disabled count');
      if (p.selected === 0) {
        assert(p.empty_confirmed === true && Number.isSafeInteger(p.empty_state_checks) && p.empty_state_checks >= 3,
          'Sample zero requires three confirmed empty states');
        assert(p.reloaded_after_empty === true, 'Sample zero requires one reload after the initial empty state');
        assert(p.header_checkbox_disabled === true && typeof p.empty_state_text === 'string' && p.empty_state_text.trim(),
          'Sample zero requires a disabled header checkbox and visible empty-state text');
      }
      total += p.selected;
    } else {
      assert(Array.isArray(p.ids) && p.ids.every(x => typeof x === 'string' && x), 'Missing row/review identifiers');
      for (const id of p.ids) { assert(!all.has(id), 'Duplicate item across pages'); all.add(id); }
      total += p.ids.length;
    }
  }
  return total;
}
export function validateObservation(o, s, c, run) {
  assert(o && o.key === s.key, 'Missing observation');
  assert(o.status === 'ok', o.reason || `Status: ${o.status || 'missing'}`);
  if (s.needs_badge_confirmation) assert(c.customer_badge_confirmed, 'Customer badge mapping not confirmed in local setup');
  assert(o.identity === c.shop_name, 'Wrong observed shop');
  assert(o.shop_id === c.shop_id, 'Wrong shop_id');
  const url = new URL(o.url);
  assert(url.protocol === 'https:' && url.hostname === s.host && url.pathname.replace(/\/$/, '') === s.path, 'Wrong source page');
  assert(!url.username && !url.password, 'Credential URL rejected');
  assert(o.basis === s.basis && o.unit === s.unit, 'Wrong unit or time basis');
  for (const check of ['loaded', 'identity', 'unique', 'filters', 'complete']) assert(o.checks?.[check] === true, `Unverified check: ${check}`);
  const at = timestamp(o.collected_at);
  assert(at >= timestamp(run.started_at) && at <= timestamp(run.completed_at), 'Observation is outside this run');
  assert(typeof o.evidence === 'string' && o.evidence.length >= 8, 'Missing source evidence');
  if (s.key === 'customer.count')
    assert(norm(o.evidence).includes('customer messages') || norm(o.evidence).includes('customers unassigned'), 'Customer message indicator missing in evidence');
  else assert(norm(o.evidence).includes(norm(s.label)), 'Metric label missing in evidence');
  assert(o.value === numeric(o.raw_value, s.unit), 'Value differs from raw screen text');
  assert(s.signed || o.value >= 0, 'Unexpected negative value');
  if (s.unit === 'percent') assert(o.value <= 100, 'Percentage outside range');
  if (s.max != null) assert(o.value <= s.max, 'Score outside range');
  if (s.unit === 'rank') assert(o.value >= 1, 'Rank must be positive');
  if (s.direction) {
    assert(['up', 'down', 'unchanged'].includes(o.direction), 'Missing visible direction');
    const sign = { up: 1, down: -1, unchanged: 0 }[o.direction];
    assert(Math.sign(o.value) === sign, 'Direction and signed value disagree');
    assert(typeof o.direction_evidence === 'string' && o.direction_evidence.trim(), 'Missing arrow evidence');
  }
  const unsignedRaw = o.raw_value.replace(/^[+-]/, '');
  if (s.key === 'customer.count') {
    if (o.value > 0) {
      assert(o.customer_indicator === 'unassigned', 'Positive customer count must come from the unassigned indicator');
      const label = o.value === 1 ? `${o.raw_value} customer unassigned` : `${o.raw_value} customers unassigned`;
      assert(norm(o.evidence).includes(norm(label)), 'Visible unassigned count missing from evidence');
    } else {
      assert(o.count_indicator_absent === true || o.badge_absent === true, 'Zero requires an absent customer count indicator');
      assert(o.checks.button_present === true && o.checks.badge_loaded === true, 'Zero requires loaded Customer messages control');
    }
  } else if (s.proof_kind === 'samples') { /* Total is derived from independently verified page counters. */ }
  else
    assert(norm(o.evidence).includes(norm(o.raw_value)) || (s.direction && norm(o.evidence).includes(norm(unsignedRaw))), 'Raw value not found in evidence');
  assert(o.source_delayed === false, 'Source freshness not verified or delay warning exists');
  if (s.source_updated_required) assert(typeof o.source_updated_at === 'string' && o.source_updated_at.trim(), 'Missing source update label');
  if (s.entity) assert(o.entity_id === s.entity && o.evidence.includes(s.entity), 'Wrong/missing product ID evidence');
  if (s.period) {
    assert(o.period_start === s.period.start && o.period_end === s.period.end, 'Wrong reporting period');
    assert(o.timezone === 'Asia/Seoul' && o.ads_account === c.ads_account && o.checks.period === true, 'Ad period/account/timezone unverified');
    assert(o.evidence.includes(s.period.start) && o.evidence.includes(s.period.end), 'Selected dates missing from evidence');
    assert(o.scope === s.scope, 'Wrong campaign scope');
    if (s.campaign) assert(o.campaign_id === s.campaign.id && o.evidence.includes(s.campaign.id) && o.evidence.includes(s.campaign.name), 'Wrong campaign detail');
  }
  if (s.basis === 'rolling_24h') assert(norm(o.evidence).includes('rolling 24 hours'), 'Rolling 24-hour label missing');
  if (s.key === 'ratings.negative_rate') assert(norm(o.evidence).includes('last 7 days'), 'Last 7 days not verified');
  if (s.proof_kind === 'rank') {
    assert(o.rank_category === 'Beauty & Personal Care' && o.rank_by === 'Total GMV' && o.rank_window === 'Last 30 days', 'Wrong ranking filters');
    assert(o.evidence.includes(c.shop_name), 'Ranking shop row missing');
  }
  if (s.proof_kind === 'voc') assert(['Good', 'Fair', 'Poor'].includes(o.level) && o.source_period, 'VOC level/period missing');
  if (s.proof_kind === 'reviews' || s.proof_kind === 'samples') {
    const total = validatePages(o.pages, s.proof_kind);
    assert(total === o.value, 'Count does not match all-page evidence');
    assert(o.count_stable === true, 'Count changed during collection');
    if (s.proof_kind === 'reviews') assert(o.displayed_total === o.value, 'Ratings total mismatch');
    else {
      assert(o.collaboration_filter === s.collaboration_filter && norm(o.evidence).includes(norm(s.collaboration_filter)),
        'Sample collaboration filter is unverified');
      assert(norm(o.evidence).includes('to review') && o.selection_unit_verified === true && o.all_pages_checked === true,
        'Sample selection unit/tab/all-page scope unverified');
    }
  }
  return { ...o, delta: null };
}

export function validateRun(input, plan, c, now = new Date()) {
  assert(input.schema_version === 1 && input.run_id && input.report_date === plan.report_date && input.config_hash === plan.config_hash, 'Input does not match its run/config');
  const start = timestamp(input.started_at), end = timestamp(input.completed_at);
  assert(end >= start && end - start <= 2 * 3600000 && end <= now.getTime() + 60000, 'Run duration or timestamp invalid');
  assert(todayKST(new Date(start)) === plan.report_date && todayKST(new Date(end)) === plan.report_date, 'Run must collect on the report publication date');
  assert(Array.isArray(input.observations), 'observations must be an array');
  const keys = input.observations.map(o => o.key);
  assert(keys.length === new Set(keys).size, 'Duplicate observation keys');
  const expected = new Set(plan.specs.map(s => s.key));
  assert(keys.every(k => expected.has(k)), 'Unexpected observation key');
  const values = {}, issues = [];
  for (const s of plan.specs) {
    const o = input.observations.find(x => x.key === s.key);
    if (!o || o.status !== 'ok') {
      issues.push({ key: s.key, kind: 'collection', reason: o?.reason || '화면에서 값을 수집하지 못함' });
      continue;
    }
    try { values[s.key] = validateObservation(o, s, c, input); }
    catch (e) { issues.push({ key: s.key, kind: 'validation', reason: e.message }); }
  }
  return { values, issues, status: issues.length ? 'incomplete' : 'complete' };
}

export function previousPublicationDate(reportDate) {
  return new Date(dateOnly(reportDate) - DAY).toISOString().slice(0, 10);
}
function comparisonProblem(current, before, spec) {
  if (!before) return '전일 해당 지표 없음';
  if (before.status !== 'ok' || !Number.isFinite(before.value)) return '전일 지표 검증 정보 없음';
  if (!current.shop_id || before.shop_id !== current.shop_id || !current.identity || before.identity !== current.identity)
    return '계정 변경으로 비교 불가';
  if (spec.entity && (current.entity_id !== spec.entity || before.entity_id !== spec.entity)) return '상품 변경으로 비교 불가';
  if (before.key !== spec.key || current.key !== spec.key || before.unit !== spec.unit || current.unit !== spec.unit ||
      before.basis !== spec.basis || current.basis !== spec.basis) return '지표·단위·집계 기준 변경으로 비교 불가';
  try {
    for (const o of [current, before]) {
      const url = new URL(o.url);
      if (url.protocol !== 'https:' || url.hostname !== spec.host || url.pathname.replace(/\/$/, '') !== spec.path)
        return '수집 화면 변경으로 비교 불가';
    }
  } catch { return '수집 화면 확인 불가'; }
  return null;
}
export function withDeltas(result, plan, previous) {
  const out = structuredClone(result);
  const baseline = previousPublicationDate(plan.report_date);
  const available = previous?.report_date === baseline;
  for (const s of plan.specs.filter(x => x.delta)) {
    const current = out.values[s.key];
    if (!current) continue;
    current.delta = null;
    current.delta_reason = available ? comparisonProblem(current, previous.values?.[s.key], s) : '전일 데이터 없음';
    if (!current.delta_reason) {
      current.delta = { value: Math.round((current.value - previous.values[s.key].value) * 1e8) / 1e8, baseline };
      delete current.delta_reason;
    }
  }
  return out;
}
const fmt = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 8 });
const safe = s => String(s).replace(/[\r\n|<>]/g, ' ').replace(/[`\[\]\\]/g, '').trim();
function delta(o, unit = '') {
  if (!o?.delta) return `(${safe(o?.delta_reason || '전일 데이터 없음')})`;
  const v = o.delta.value;
  return v === 0 ? '(-)' : `(${v > 0 ? '+' : ''}${fmt(v)}${unit})`;
}
export function render(result, plan, c, run) {
  const v = result.values;
  const issues = new Map(result.issues.map(issue => [issue.key, issue]));
  const failure = k => issues.get(k)?.kind === 'validation' ? '[검증 실패]' : '[수집 실패]';
  const show = (k, d = false, unit = '', suffix = '') => v[k] ? `${fmt(v[k].value)}${unit}${d ? delta(v[k], unit === '%' ? '%p' : '') : ''}${suffix}` : failure(k);
  const lines = [`발행일: ${plan.report_date}`, plan.collection_contract_version >= 3 ? 'GMV MAX: 아침 자동 수집 제외' : `대상 실적: ${plan.ranges[0].start} ~ ${plan.ranges[0].end}`,
    `수집 완료: ${run.completed_at}`, `상태: ${result.status === 'complete' ? '검증 완료' : '미완성 — 실패 항목 확인 필요'}`,
    '※ 현재 건수·최근 7일·최근 24시간·누적 지표는 각 화면 기준입니다.', '', '[00] 특이사항',
    v['customer.count'] ? (v['customer.count'].value > 0 ? 'Customer message 존재' : '없음') : failure('customer.count'), '', '[01] CUSTOMER',
    `CUSTOMER MESSAGES ${show('customer.count', false, '', '건')} / 내용은 사람 확인`, '', '[02] 모바일 샵', '보류 — 추후 진행', '', '[03] GMV MAX 지표'];
  for (const p of plan.ranges) {
    const prefix = `gmv.${p.start}_${p.end}`;
    const won = m => v[`${prefix}.overall.${m}`] ? `${(Math.round(v[`${prefix}.overall.${m}`].value / 1000) / 10).toFixed(1)}만` : failure(`${prefix}.overall.${m}`);
    lines.push(`${p.start}${p.start !== p.end ? ` ~ ${p.end}` : ''}`, `광고비: ${won('cost')} / 매출: ${won('revenue')} / 판매량: ${show(`${prefix}.overall.orders`, false, '', '개')} / ROI: ${show(`${prefix}.overall.roi`)}`,
      `상세: ${c.campaigns.map(a => `${safe(a.label)} ${show(`${prefix}.${a.key}.orders`, false, '', '개')} ROI ${show(`${prefix}.${a.key}.roi`)}`).join(' / ')}`, '');
  }
  if (plan.collection_contract_version >= 3) lines.push('아침 자동 수집 제외 — 별도 기간 수집은 필요 시 진행', '');
  else lines.push('※ Base budget 괄호 표기는 미확정으로 제외.');
  lines.push('[04] 환불', `Pending returns ${show('refunds.pending', false, '', '건')}`, '', '[05] 샘플 신청',
    `오픈콜라보: ${show('samples.open.selected', false, '', '건 남음')}`,
    `타겟 콜라보: ${show('samples.target.selected', false, '', '건 남음')}`);
  for (const [key, label] of [['samples.open.selected', '오픈콜라보'], ['samples.target.selected', '타겟 콜라보']]) {
    const samples = v[key];
    if (samples) {
      const disabled = samples.pages.reduce((n, p) => n + p.disabled_count, 0);
      if (disabled) lines.push(`${label} 선택 불가 ${disabled}건 별도 확인`);
    }
  }
  lines.push('', '[06] TIKTOK ONE 진행 사항', '수동 작성', '', '[07] PRODUCT RATINGS',
    `지난 7일간 부정적 리뷰 비율: ${show('ratings.negative_rate', false, '%')}`,
    `화면의 7일 전 대비: ${v['ratings.site_change'] ? `${v['ratings.site_change'].value > 0 ? '+' : ''}${fmt(v['ratings.site_change'].value)}%p` : failure('ratings.site_change')}`,
    `신규 리뷰: ${show('ratings.awaiting', false, '', '건')} (Awaiting reply)`, '', '[09] MANAGE CREATORS',
    `총 어필리에이트 풀 ${show('creators.total', true, '', '명')}`, '', '[10] 비디오 업로드 현황',
    '제품명 [노출수 / 제품 공유 / 전체 영상]',
    `${safe(c.products.find(p => p.key === 'copper').label)} [${show('products.copper.views', true)} / ${show('products.copper.sharing', true)} / ${show('products.copper.videos', true)}]`,
    '제품명 [제품 공유 / 전체 영상]');
  for (const p of c.products.filter(p => p.sharing && p.key !== 'copper')) lines.push(`${safe(p.label)} [${show(`products.${p.key}.sharing`, true)} / ${show(`products.${p.key}.videos`, true)}]`);
  const rankChange = v['health.rank_change'];
  const rankMovement = !rankChange ? failure('health.rank_change') : rankChange.direction === 'unchanged' ? '0 (변동 없음)'
    : `${rankChange.value > 0 ? '+' : ''}${fmt(rankChange.value)} (${fmt(Math.abs(rankChange.value))}계단 ${rankChange.direction === 'up' ? '상승' : '하락'})`;
  lines.push('', '[11] ACCOUNT HEALTH', `샵랭크: ${show('health.rank', false, '', '위')} / 화면 변화: ${rankMovement}`,
    `SPS: ${show('health.sps', true)} / AHR: ${show('health.ahr', true)} / CHR: ${show('health.chr', true)}`,
    `Top Rated Seller - 목표: ${show('health.positive_target', false, '%')} / 현 ${show('health.positive_rate', true, '%')}`,
    `VOC: ${c.products.filter(p => p.voc).map(p => `${safe(p.label)} ${plan.collection_contract_version >= 4 ? '[직접 입력]' : show(`products.${p.key}.voc`, true)}`).join(' / ')}`);
  const baselines = [...new Set(Object.values(v).filter(o => o.delta).map(o => o.delta.baseline))];
  lines.push('', `증감 비교 기준: ${previousPublicationDate(plan.report_date)} 수집값${baselines.length ? '' : ' (비교 가능한 전일 지표 없음)'}`);
  const updates = Object.entries(v).filter(([k, o]) => o.source_updated_at).map(([k, o]) => `${k}: ${safe(o.source_updated_at)}${o.source_period ? ` / ${safe(o.source_period)}` : ''}`);
  if (updates.length) lines.push('', '화면 갱신 정보:', ...updates.map(x => `- ${x}`));
  const collectionFailures = result.issues.filter(x => x.kind !== 'validation');
  const validationFailures = result.issues.filter(x => x.kind === 'validation');
  if (collectionFailures.length) lines.push('', '수집 실패:', ...collectionFailures.map(x => `- ${safe(x.key)}: ${safe(x.reason)}`));
  if (validationFailures.length) lines.push('', '검증 실패:', ...validationFailures.map(x => `- ${safe(x.key)}: ${safe(x.reason)}`));
  if (plan.collection_contract_version >= 2) {
    const start = lines.indexOf('[00] 특이사항');
    const end = lines.indexOf('[03] GMV MAX 지표');
    lines.splice(start, end - start, '[01] 특이사항 / CUSTOMER / CREATOR / WHATSAPP MESSAGES',
      '웹 보고서에서 직접 작성', '', '[02] 모바일 샵 확인 · 리뷰 & 평점', '웹 보고서에서 직접 작성', '');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('지난 7일간 부정적 리뷰 비율:') || lines[i].startsWith('화면의 7일 전 대비:')) lines.splice(i, 1);
    }
  }
  return lines.join('\n') + '\n';
}
