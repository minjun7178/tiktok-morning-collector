import fs from 'node:fs';
import path from 'node:path';
import { assert, hash, previousPublicationDate } from './core.mjs';

export function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}
export function writeReportOutput(root, reportDate, markdown) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(reportDate), 'Invalid output report date');
  const dir = path.join(root, 'outputs');
  const file = path.join(dir, `${reportDate}.md`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, markdown, { encoding: 'utf8', mode: 0o600 });
  return file;
}
export function previousSnapshot(base, reportDate) {
  const day = previousPublicationDate(reportDate);
  const dir = path.join(base, 'ledger', day);
  if (!fs.existsSync(dir)) return null;
  const current = path.join(dir, 'current', 'snapshot.json');
  if (fs.existsSync(current)) {
    const record = readJSON(current);
    if (record.report_date === day) return record;
  }
  const versions = fs.readdirSync(dir).filter(x => /^rev-\d+$/.test(x))
    .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
  for (const version of versions) {
    const record = readJSON(path.join(dir, version, 'snapshot.json'));
    if (record.report_date === day) return record;
  }
  return null;
}
export function publish(base, snapshot, markdown) {
  assert(['complete', 'incomplete'].includes(snapshot.status), 'Invalid ledger status');
  fs.mkdirSync(base, { recursive: true });
  const lock = path.join(base, 'publish.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch { throw new Error('Another publication is active; inspect publish.lock before recovery'); }
  try {
    const dayDir = path.join(base, 'ledger', snapshot.report_date);
    const dest = path.join(dayDir, 'current');
    fs.mkdirSync(dest, { recursive: true });
    const snapshotFile = path.join(dest, 'snapshot.json');
    const reportFile = path.join(dest, 'report.md');
    if (fs.existsSync(snapshotFile) && fs.existsSync(reportFile)) {
      const old = readJSON(snapshotFile);
      if (old.input_hash === snapshot.input_hash && hash(old.values) === hash(snapshot.values) &&
          fs.readFileSync(reportFile, 'utf8') === markdown)
        return { directory: dest, duplicate: true, replaced: false };
    }
    writeJSON(snapshotFile, snapshot);
    const tempReport = `${reportFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempReport, markdown, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempReport, reportFile);
    return { directory: dest, duplicate: false, replaced: true };
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
