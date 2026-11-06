// ===== ส่วนกลาง: ข้อมูล การเชื่อมต่อเซิร์ฟเวอร์ สิทธิ์ และฟอร์ม =====
// ข้อมูลทั้งหมดเก็บที่เซิร์ฟเวอร์ (server.py → data/care.db)
// หน้าเว็บโหลดข้อมูลทั้งหมดมาไว้ในหน่วยความจำ แก้ไขแล้วส่งกลับทีละรายการ
// ถ้าเน็ตหลุด รายการที่ยังส่งไม่ได้จะรอในเครื่องและส่งให้เองเมื่อกลับมาออนไลน์

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// localStorage ใช้แค่เก็บรายการที่รอส่ง และอ่านข้อมูลเก่าตอนย้ายเข้าเซิร์ฟเวอร์
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
};

// ---------- ข้อมูลในหน่วยความจำ ----------
const marRows = []; // การให้ยาแต่ละครั้ง: { id: 'วันที่|ยา|รอบ', date, medId, round, status, time, by, reason }
const TABLES = { residents, medications, vitals, nurseNotes, doctorOrders, mar: marRows };
const SEED = JSON.parse(JSON.stringify({ residents, medications, vitals, nurseNotes, doctorOrders })); // ข้อมูลตัวอย่างจาก data.js
const kv = {};        // ค่าตั้งค่า / ความเห็นในรายงาน / ร่างใบส่งตัว
let currentUser = null;
let rev = 0;          // เลขเวอร์ชันข้อมูลล่าสุดที่โหลดมา
let marIndex = null;

const newId = () => Date.now() * 100 + Math.floor(Math.random() * 100);
const sameId = (a, b) => String(a) === String(b);
const marMap = () => marIndex || (marIndex = new Map(marRows.map((x) => [x.id, x])));

const settings = {
  get center() { return kv.settings?.center || '[ชื่อศูนย์ดูแล]'; },
  get address() { return kv.settings?.address ?? '[ที่อยู่ / เบอร์โทร]'; },
  get user() { return currentUser?.name || ''; }
};

// ---------- เรียกเซิร์ฟเวอร์ ----------
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'care' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && document.body.dataset.page !== 'login') {
    location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search);
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`);
  return data;
}

// ---------- บันทึกข้อมูล (ส่งทีละรายการ + คิวรอส่งเมื่อออฟไลน์) ----------
let outbox = store.get('outbox', []);
let flushing = false;
let online = true;
const opKey = (x) => (x.op === 'kv' ? 'kv:' + x.key : `${x.tbl}:${x.op === 'put' ? x.row.id : x.id}`);
const cleanRow = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')));

function queue(item) {
  outbox = outbox.filter((x) => opKey(x) !== opKey(item));
  outbox.push(item);
  store.set('outbox', outbox);
  updateBanner();
  flush();
}

// เพิ่ม/แก้ไข: แก้ข้อมูลในหน่วยความจำก่อน แล้วเรียก put()
const put = (tbl, row) => { if (tbl === 'mar') marIndex = null; queue({ op: 'put', tbl, row: cleanRow(row) }); };
// ลบ: เอาออกจากหน่วยความจำ แล้วส่งคำสั่งลบ
function del(tbl, row) {
  const arr = TABLES[tbl];
  const i = arr.indexOf(row);
  if (i >= 0) arr.splice(i, 1);
  if (tbl === 'mar') marIndex = null;
  queue({ op: 'del', tbl, id: row.id });
}
const kvTimers = {};
function kvSet(key, value, wait = 0) {
  kv[key] = value;
  clearTimeout(kvTimers[key]);
  const send = () => queue({ op: 'kv', key, value });
  if (wait) kvTimers[key] = setTimeout(send, wait); else send();
}

async function sendOne(item) {
  if (item.op === 'put') {
    const res = await api('POST', `/api/rows/${item.tbl}`, { row: item.row });
    const local = TABLES[item.tbl].find((x) => sameId(x.id, item.row.id));
    if (local) Object.keys(res.row).filter((k) => k.startsWith('_')).forEach((k) => (local[k] = res.row[k]));
  } else if (item.op === 'del') {
    await api('DELETE', `/api/rows/${item.tbl}/${encodeURIComponent(item.id)}`);
  } else {
    await api('PUT', `/api/kv/${encodeURIComponent(item.key)}`, { value: item.value });
  }
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (outbox.length) {
      const item = outbox[0];
      try {
        await sendOne(item);
      } catch (e) {
        if (e.status === 0 || e.status >= 500) { setOnline(false); break; }
        // เซิร์ฟเวอร์ปฏิเสธ (เช่น ไม่มีสิทธิ์) → ทิ้งรายการนี้ แจ้งผู้ใช้ และโหลดข้อมูลจริงกลับมา
        outbox = outbox.filter((x) => x !== item);
        store.set('outbox', outbox);
        toast(`บันทึกไม่สำเร็จ: ${e.message}`, 5000);
        await resync();
        continue;
      }
      outbox = outbox.filter((x) => x !== item);
      store.set('outbox', outbox);
      setOnline(true);
    }
  } finally {
    flushing = false;
    updateBanner();
  }
}

function setOnline(v) {
  online = v;
  updateBanner();
}

function updateBanner() {
  let b = $('#net-banner');
  if (!b) {
    if (!document.body) return;
    b = document.createElement('div');
    b.id = 'net-banner';
    b.className = 'net-banner no-print';
    b.setAttribute('role', 'status');
    document.body.append(b);
  }
  const waiting = outbox.length;
  b.hidden = online && !waiting;
  b.textContent = !online
    ? `ติดต่อเซิร์ฟเวอร์ไม่ได้${waiting ? ` มี ${waiting} รายการรอส่ง` : ''} ระบบจะส่งให้เองเมื่อเชื่อมต่อได้ อย่าล้างข้อมูลเบราว์เซอร์`
    : `กำลังบันทึก ${waiting} รายการ…`;
}

window.addEventListener('beforeunload', (e) => {
  if (outbox.length) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- โหลด / อัปเดตข้อมูลจากเซิร์ฟเวอร์ ----------
function replaceInPlace(target, source) {
  Object.keys(target).forEach((k) => delete target[k]);
  Object.assign(target, source);
}

function applyRow({ tbl, id, deleted, row }) {
  const arr = TABLES[tbl];
  if (!arr) return;
  const i = arr.findIndex((x) => sameId(x.id, id));
  if (deleted) { if (i >= 0) arr.splice(i, 1); }
  else if (i >= 0) replaceInPlace(arr[i], row);
  else arr.push(row);
}

// ใส่รายการที่ยังรอส่งทับข้อมูลจากเซิร์ฟเวอร์ เพื่อไม่ให้สิ่งที่เพิ่งกรอกหายไปจากหน้าจอ
function applyOutbox() {
  outbox.forEach((x) => {
    if (x.op === 'put') applyRow({ tbl: x.tbl, id: x.row.id, row: { ...x.row } });
    if (x.op === 'del') applyRow({ tbl: x.tbl, id: x.id, deleted: true });
    if (x.op === 'kv') kv[x.key] = x.value;
  });
}

function applyAll(all) {
  Object.keys(TABLES).forEach((t) => TABLES[t].splice(0, TABLES[t].length, ...(all.tables[t] || [])));
  Object.keys(kv).forEach((k) => delete kv[k]);
  Object.assign(kv, all.kv);
  rev = all.rev;
  currentUser = all.user;
  applyOutbox();
  marIndex = null;
}

async function resync() {
  try {
    applyAll(await api('GET', '/api/all'));
    softRedraw();
  } catch { setOnline(false); }
}

async function poll() {
  await flush();
  if (outbox.length) return;
  try {
    const ch = await api('GET', '/api/changes?since=' + rev);
    setOnline(true);
    rev = ch.rev;
    if (!ch.rows.length && !Object.keys(ch.kv).length) return;
    ch.rows.forEach(applyRow);
    Object.assign(kv, ch.kv);
    marIndex = null;
    softRedraw();
  } catch (e) {
    if (e.status === 0 || e.status >= 500) setOnline(false);
  }
}

// หน้าปัจจุบันตั้งค่าตัวนี้ไว้ เพื่อวาดหน้าใหม่หลังข้อมูลเปลี่ยน
let redraw = () => {};
let redrawPending = false;
function softRedraw() {
  // ไม่วาดใหม่ระหว่างที่กำลังพิมพ์ในฟอร์มหรือในช่องความเห็น เดี๋ยวสิ่งที่พิมพ์จะหาย
  if ($('#form-dialog')?.open || document.activeElement?.isContentEditable) { redrawPending = true; return; }
  redrawPending = false;
  redraw();
}
document.addEventListener('focusout', () => setTimeout(() => { if (redrawPending) softRedraw(); }, 0));

// ---------- วันที่ ----------
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const nowTime = () => new Date().toTimeString().slice(0, 5);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
const daysBetween = (from, to) => { const out = []; for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d); return out; };
const thaiDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const longDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const relDate = (iso) => (iso === todayISO() ? 'วันนี้' : iso === addDays(todayISO(), -1) ? 'เมื่อวาน' : shortDate(iso));
const byDateTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
const inRange = (x, from, to) => x.date >= from && x.date <= to;
const fmtStamp = (ms) => { const d = new Date(ms); return `${relDate(isoOf(d))} ${d.toTimeString().slice(0, 5)} น.`; };

// ---------- สิทธิ์ (ต้องตรงกับ can_write ใน server.py) ----------
const ROLE_LABELS = { admin: 'หัวหน้า / ผู้ดูแลระบบ', nurse: 'พยาบาล', aide: 'ผู้ช่วยดูแล' };
function can(action, tbl, row) {
  const role = currentUser?.role;
  if (role === 'admin') return true;
  if (tbl === 'residents') return role === 'nurse' && action !== 'delete';
  if (tbl === 'medications' || tbl === 'doctorOrders') return role === 'nurse';
  if (tbl === 'settings' || tbl === 'users') return false;
  if (role === 'nurse' || action === 'create' || !row) return true;
  return !row._createdUser || row._createdUser === currentUser.username;
}

// ---------- ผู้สูงอายุ ----------
const getResident = (id) => residents.find((r) => sameId(r.id, id));
const residentIdFromURL = () => {
  const id = new URLSearchParams(location.search).get('id');
  return getResident(id) ? getResident(id).id : residents[0]?.id;
};
const initial = (name) => name.replace(/^(นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.)\s*/, '')[0] || '?';
const residentOptions = () => residents.map((r) => [r.id, `${r.name} — ห้อง ${r.room}`]);
const sortedResidents = () => [...residents].sort((a, b) => String(a.room).localeCompare(String(b.room), 'th', { numeric: true }));

function lastRecord(r) {
  const last = [...vitals, ...nurseNotes].filter((x) => sameId(x.residentId, r.id)).sort(byDateTime).pop();
  return last ? `${relDate(last.date)} ${last.time}` : (r.last || '—');
}

// ---------- สัญญาณชีพ และเกณฑ์ค่าผิดปกติ ----------
const FIELDS = ['t', 'p', 'r', 'bp', 'u', 'o2', 'sugar'];
const FIELD_LABELS = { t: 'อุณหภูมิ', p: 'ชีพจร', r: 'การหายใจ', bp: 'ความดัน', u: 'ปัสสาวะ', o2: 'ออกซิเจน %', sugar: 'น้ำตาล' };

// ช่วงค่าปกติมาตรฐาน (ค่าที่ต่ำกว่า min หรือสูงกว่า max = ผิดปกติ) ตั้งเฉพาะคนได้ที่หน้าประวัติ
const DEFAULT_LIMITS = { tMin: 35.5, tMax: 37.4, pMin: 60, pMax: 100, rMin: 12, rMax: 24, sysMin: 100, sysMax: 159, diaMin: 60, diaMax: 99, o2Min: 92, sugarMin: 70, sugarMax: 250 };
const LIMIT_DEFS = [
  ['อุณหภูมิ', '°C', 'tMin', 'tMax'],
  ['ชีพจร', 'ครั้ง/นาที', 'pMin', 'pMax'],
  ['การหายใจ', 'ครั้ง/นาที', 'rMin', 'rMax'],
  ['ความดันตัวบน', 'mmHg', 'sysMin', 'sysMax'],
  ['ความดันตัวล่าง', 'mmHg', 'diaMin', 'diaMax'],
  ['ออกซิเจนในเลือด', '%', 'o2Min', null],
  ['น้ำตาลในเลือด', 'mg/dL', 'sugarMin', 'sugarMax']
];
const limitsFor = (r) => ({ ...DEFAULT_LIMITS, ...(r?.limits || {}) });
const isCustomLimit = (r, key) => r?.limits?.[key] != null;

function isAbnormal(field, value, r) {
  if (!value) return false;
  const L = limitsFor(r);
  const out = (n, lo, hi) => !isNaN(n) && ((lo != null && n < lo) || (hi != null && n > hi));
  if (field === 'bp') {
    const [sys, dia] = String(value).split('/').map(Number);
    return out(sys, L.sysMin, L.sysMax) || out(dia, L.diaMin, L.diaMax);
  }
  const n = parseFloat(String(value).split(/[-–/]/)[0]);
  if (field === 't') return out(n, L.tMin, L.tMax);
  if (field === 'p') return out(n, L.pMin, L.pMax);
  if (field === 'r') return out(n, L.rMin, L.rMax);
  if (field === 'o2') return out(n, L.o2Min, null);
  if (field === 'sugar') return out(n, L.sugarMin, L.sugarMax);
  return false;
}
const isAbnormalV = (v, f) => isAbnormal(f, v[f], getResident(v.residentId));
const abnormalFields = (v) => FIELDS.filter((f) => isAbnormalV(v, f));
const abnormalText = (v) => abnormalFields(v).map((f) => `${FIELD_LABELS[f]} ${v[f]}`).join(', ');

function limitText(r, [label, unit, lo, hi]) {
  const L = limitsFor(r);
  const range = hi ? `${L[lo]}–${L[hi]}` : `ตั้งแต่ ${L[lo]}`;
  return `${label} ${range} ${unit}`;
}

// ---------- ตารางให้ยา ----------
const roundName = (key) => (key === 'prn' ? 'เมื่อมีอาการ' : ROUNDS.find((x) => x.key === key).label.split(' ')[0]);
const roundTime = (key) => ROUNDS.find((x) => x.key === key).label.split(' ')[1];
const marRowId = (date, m, key) => `${date}|${m.id}|${key}`;
const marGet = (date, m, key) => marMap().get(marRowId(date, m, key));
const prnEntries = (m, from, to) => marRows.filter((x) => sameId(x.medId, m.id) && x.round === 'prn' && x.date >= from && x.date <= to).sort(byDateTime);
const isPRN = (m) => !!m.prn;

function nextRound() {
  const now = nowTime();
  const r = ROUNDS.find((x) => roundTime(x.key) >= now);
  return r ? { key: r.key, date: todayISO() } : { key: ROUNDS[0].key, date: addDays(todayISO(), 1) };
}

// สรุปการให้ยาในช่วงวันที่: ควรได้ / ให้แล้ว / ปฏิเสธ / ไม่มีบันทึก (ไม่นับรอบที่ยังไม่ถึงเวลา)
// ยาให้เมื่อมีอาการ (PRN) ไม่มีรอบ จึงนับเฉพาะจำนวนครั้งที่ให้
function marSummary(meds, from, to) {
  const today = todayISO(), now = nowTime();
  const days = daysBetween(from, to < today ? to : today);
  return meds.map((m) => {
    const s = { med: m, expected: 0, done: 0, miss: [], blank: [], prn: [] };
    if (isPRN(m)) {
      s.prn = prnEntries(m, from, to).filter((x) => x.status === 'done').map((x) => `${shortDate(x.date)} ${x.time}`);
      return s;
    }
    days.forEach((d) => m.rounds.forEach((k) => {
      const e = marGet(d, m, k);
      if (!e && d === today && roundTime(k) > now) return;
      const when = `${shortDate(d)} ${roundName(k)}`;
      s.expected++;
      if (!e) s.blank.push(when);
      else if (e.status === 'miss') s.miss.push(when);
      else s.done++;
    }));
    return s;
  });
}

// ---------- บันทึกพยาบาล ----------
const NOTE_TYPES = Object.keys(QUICK_NOTES);
const NOTE_COLORS = {
  'อาหาร NG': '#24409C', 'ออกซิเจน': '#24409C', 'Suction': '#24409C',
  'แพทย์สั่ง': '#6E4A00', 'พลิกตัว': '#5B6474', 'ทำแผล': '#C02626', 'เหตุการณ์ผิดปกติ': '#C02626', 'ส่งโรงพยาบาล': '#C02626'
};
const allNotes = () => [...nurseNotes].sort(byDateTime).reverse();
const wasEdited = (row) => row._updatedAt && row._createdAt && row._updatedAt - row._createdAt > 1000;
const historyLink = (tbl, row, text = 'ดูประวัติ') => `<a class="link-btn no-print" href="history.html?tbl=${tbl}&id=${encodeURIComponent(row.id)}">${text}</a>`;

function editedMark(tbl, row) {
  if (!wasEdited(row)) return '';
  return ` <a class="edited no-print" href="history.html?tbl=${tbl}&id=${encodeURIComponent(row.id)}" title="แก้ไขล่าสุดโดย ${esc(row._updatedBy)} ${esc(fmtStamp(row._updatedAt))}">(แก้ไขแล้ว)</a>`;
}

function noteHTML(n) {
  return `<div class="note">
    <span class="note-time">${esc(n.time)}</span>
    <div class="note-body">
      <span class="note-tag" style="color:${NOTE_COLORS[n.type] || 'var(--muted)'}">${esc(n.type)}</span>
      <p>${esc(n.text)}</p>
      <span class="note-meta">${esc(n.by)}${editedMark('nurseNotes', n)}
        ${can('update', 'nurseNotes', n) ? `<button type="button" class="link-btn no-print" data-edit="note:${n.id}">แก้ไข</button>` : ''}</span>
    </div>
    <div class="note-io">${n.urine ? `ปัสสาวะ ${esc(n.urine)} cc<br>` : ''}${n.stool ? `อุจจาระ ${esc(n.stool)} ครั้ง` : ''}</div>
  </div>`;
}

// ---------- ข้อความแจ้งสั้นๆ ----------
function toast(msg, ms = 2500) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- หน้าต่างฟอร์ม (ใช้ร่วมกันทุกฟอร์ม เพิ่ม/แก้ไข/ลบ) ----------
function fieldHTML(f, value) {
  const id = 'f-' + f.name;
  const v = value ?? '';
  const label = esc(f.label) + (f.required ? ' <span class="req" aria-hidden="true">*</span>' : '');
  const attrs = [
    f.required && 'required',
    f.placeholder && `placeholder="${esc(f.placeholder)}"`,
    f.min != null && `min="${f.min}"`,
    f.max != null && `max="${f.max}"`,
    f.step && `step="${f.step}"`,
    f.inputmode && `inputmode="${f.inputmode}"`,
    f.autocomplete && `autocomplete="${f.autocomplete}"`,
    f.readonly && 'readonly'
  ].filter(Boolean).join(' ');

  if (f.type === 'checks') {
    return `<fieldset class="field checks${f.wide ? ' wide' : ''}"><legend>${label}</legend><div class="row" style="gap: 8px">
      ${f.options.map(([val, text]) => `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(val)}"${(v || []).includes(val) ? ' checked' : ''}> ${esc(text)}</label>`).join('')}
    </div>${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}</fieldset>`;
  }
  let control;
  if (f.type === 'select') {
    control = `<select id="${id}" name="${f.name}" class="input" ${attrs}>${f.options.map(([val, text]) =>
      `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea id="${id}" name="${f.name}" class="input" rows="3" ${attrs}>${esc(v)}</textarea>`;
  } else {
    control = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" class="input" value="${esc(v)}" ${attrs}>`;
  }
  return `<div class="field${f.wide ? ' wide' : ''}"><label for="${id}">${label}</label>${control}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}</div>`;
}

function readFields(root, fields) {
  const data = {};
  fields.forEach((f) => {
    data[f.name] = f.type === 'checks'
      ? $$(`input[name="${f.name}"]:checked`, root).map((i) => i.value)
      : (root.querySelector(`[name="${f.name}"]`)?.value ?? '').trim();
  });
  return data;
}

// audit = { tbl, row } แสดงว่าใครบันทึก/แก้ไขล่าสุด และลิงก์ไปดูประวัติ
function openForm({ title, intro, fields, values = {}, submitLabel = 'บันทึก', onSave, onDelete, deleteLabel = 'ลบ', deleteConfirm, savedMsg = 'บันทึกแล้ว', audit }) {
  let dlg = $('#form-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'form-dialog';
    dlg.className = 'dialog';
    dlg.addEventListener('close', () => { if (redrawPending) softRedraw(); });
    document.body.append(dlg);
  }
  const a = audit?.row;
  const auditLine = a && a._createdAt
    ? `<p class="form-meta">บันทึกโดย ${esc(a._createdBy)} ${esc(fmtStamp(a._createdAt))}${wasEdited(a) ? ` · แก้ไขล่าสุดโดย ${esc(a._updatedBy)} ${esc(fmtStamp(a._updatedAt))}` : ''}
       ${historyLink(audit.tbl, a, 'ดูประวัติการแก้ไข')}</p>`
    : '';
  dlg.innerHTML = `<form class="dialog-form" novalidate>
    <h2 class="card-title">${esc(title)}</h2>
    ${intro ? `<p class="page-sub" style="margin: 0">${intro}</p>` : ''}
    <div class="dialog-fields">${fields.map((f) => fieldHTML(f, values[f.name])).join('')}</div>
    <p class="form-error" role="alert" hidden></p>
    ${auditLine}
    <div class="row dialog-actions">
      ${onDelete ? `<button type="button" class="btn btn-danger" data-act="delete">${esc(deleteLabel)}</button>` : ''}
      <span style="flex: 1"></span>
      <button type="button" class="btn" data-act="cancel">ยกเลิก</button>
      <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
    </div>
  </form>`;
  const form = $('form', dlg);
  const error = $('.form-error', form);
  const showError = (msg) => { error.textContent = msg; error.hidden = false; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = fields.find((f) => f.required && f.type !== 'checks' && !form.elements[f.name].value.trim());
    if (missing) { showError(`กรุณากรอก "${missing.label}"`); form.elements[missing.name].focus(); return; }
    const bad = $$('input', form).find((i) => !i.checkValidity());
    if (bad) { showError(`ค่าใน "${bad.closest('.field').querySelector('label').textContent.replace('*', '').trim()}" ไม่ถูกต้อง`); bad.focus(); return; }
    const submit = $('[type="submit"]', form);
    submit.disabled = true;
    try {
      const err = await onSave(readFields(form, fields));
      if (typeof err === 'string') { showError(err); return; }
    } catch (ex) {
      showError(ex.message);
      return;
    } finally {
      submit.disabled = false;
    }
    dlg.close();
    if (savedMsg) toast(savedMsg);
  });
  $('[data-act="cancel"]', form).addEventListener('click', () => dlg.close());
  $('[data-act="delete"]', form)?.addEventListener('click', async () => {
    if (!confirm(deleteConfirm || 'ต้องการลบรายการนี้ใช่ไหม? (ยังดูย้อนหลังได้ในประวัติการแก้ไข)')) return;
    try { await onDelete(); } catch (ex) { showError(ex.message); return; }
    dlg.close();
    toast('ลบแล้ว');
  });
  dlg.showModal();
  $('input:not([readonly]), select, textarea', form)?.focus();
}

// ----- ฟอร์มแต่ละประเภท -----
const RESIDENT_FIELDS = [
  { name: 'name', label: 'ชื่อ–นามสกุล (มีคำนำหน้า)', required: true, placeholder: 'เช่น นางสมศรี ใจดี', wide: true },
  { name: 'age', label: 'อายุ (ปี)', type: 'number', min: 0, max: 130, required: true },
  { name: 'room', label: 'ห้อง', required: true },
  { name: 'status', label: 'สถานะ', type: 'select', options: Object.entries(STATUS).map(([k, s]) => [k, s.label]) },
  { name: 'allergy', label: 'แพ้ยา', placeholder: 'เว้นว่างถ้าไม่มี' },
  { name: 'conditions', label: 'โรคประจำตัว', placeholder: 'เช่น เบาหวาน, ความดันโลหิตสูง', hint: 'ถ้ามีหลายโรค คั่นด้วยเครื่องหมายจุลภาค ( , )', wide: true },
  { name: 'food', label: 'อาหาร', placeholder: 'เช่น อาหารอ่อน, Gen DM ทาง NG', wide: true },
  { name: 'caution', label: 'ข้อควรระวัง', type: 'textarea', placeholder: 'เช่น เสี่ยงหกล้ม อาหารลดหวาน', wide: true },
  { name: 'contact', label: 'ญาติผู้ติดต่อ', placeholder: 'ชื่อ (ความสัมพันธ์)' },
  { name: 'phone', label: 'เบอร์โทรญาติ', type: 'tel' },
  { name: 'apptDate', label: 'นัดพบแพทย์ครั้งถัดไป', type: 'date' },
  { name: 'apptPlace', label: 'สถานที่ / เวลานัด', placeholder: 'เช่น รพ.… 09:00' },
  { name: 'idCard', label: 'เลขบัตรประชาชน', placeholder: 'x-xxxx-xxxxx-xx-x', inputmode: 'numeric' },
  { name: 'bloodType', label: 'หมู่เลือด', type: 'select', options: [['', 'ไม่ทราบ'], ['A', 'A'], ['B', 'B'], ['AB', 'AB'], ['O', 'O']] },
  { name: 'rights', label: 'สิทธิการรักษา', type: 'select', options: [['', 'ไม่ระบุ'], ...['บัตรทอง (UC)', 'ประกันสังคม', 'ข้าราชการ', 'ประกันเอกชน', 'ชำระเงินเอง'].map((x) => [x, x])] },
  { name: 'hospital', label: 'โรงพยาบาลประจำ', placeholder: 'โรงพยาบาลที่รักษาประจำ' },
  { name: 'hn', label: 'HN ที่โรงพยาบาลประจำ' }
];

function residentForm(r, done) {
  openForm({
    title: r ? 'แก้ไขข้อมูลผู้สูงอายุ' : 'เพิ่มผู้สูงอายุ',
    fields: RESIDENT_FIELDS,
    values: r ? { ...r, conditions: (r.conditions || []).join(', ') } : { status: 'ok' },
    submitLabel: r ? 'บันทึกการแก้ไข' : 'เพิ่มผู้สูงอายุ',
    savedMsg: r ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มผู้สูงอายุแล้ว',
    audit: r && { tbl: 'residents', row: r },
    onSave(d) {
      const row = { ...d, age: Number(d.age), conditions: d.conditions.split(/\s*,\s*/).filter(Boolean) };
      let target = r;
      if (r) Object.assign(r, row);
      else { target = { id: newId(), last: '—', ...row }; residents.push(target); }
      put('residents', target);
      done(target);
    },
    onDelete: r && can('delete', 'residents', r) && (() => {
      del('residents', r);
      // เซิร์ฟเวอร์ลบยาและบันทึกของคนนี้ให้เอง ที่นี่แค่เอาออกจากหน้าจอ
      ['medications', 'vitals', 'nurseNotes', 'doctorOrders'].forEach((n) => {
        const arr = TABLES[n];
        for (let i = arr.length - 1; i >= 0; i--) if (sameId(arr[i].residentId, r.id)) arr.splice(i, 1);
      });
      done(null);
    }),
    deleteLabel: 'ลบผู้สูงอายุ',
    deleteConfirm: r && `ลบ ${r.name} พร้อมยาและบันทึกทั้งหมดของคนนี้ใช่ไหม? (หัวหน้ายังดูย้อนหลังได้ในประวัติการแก้ไข)`
  });
}

function limitsForm(r, done) {
  const fields = LIMIT_DEFS.flatMap(([label, unit, lo, hi]) => [
    { name: lo, label: `${label} ต่ำสุด (${unit})`, type: 'number', step: 'any', placeholder: `มาตรฐาน ${DEFAULT_LIMITS[lo]}`, wide: !hi },
    ...(hi ? [{ name: hi, label: `${label} สูงสุด (${unit})`, type: 'number', step: 'any', placeholder: `มาตรฐาน ${DEFAULT_LIMITS[hi]}` }] : [])
  ]);
  openForm({
    title: `เกณฑ์ค่าผิดปกติ — ${r.name}`,
    intro: 'ใส่เฉพาะค่าที่แพทย์กำหนดให้คนนี้ต่างจากมาตรฐาน เว้นว่าง = ใช้เกณฑ์มาตรฐาน ค่าที่ต่ำกว่าต่ำสุดหรือสูงกว่าสูงสุดจะขึ้นสีแดง',
    fields,
    values: r.limits || {},
    submitLabel: 'บันทึกเกณฑ์',
    audit: { tbl: 'residents', row: r },
    onSave(d) {
      const limits = {};
      Object.entries(d).forEach(([k, v]) => { if (v !== '') limits[k] = Number(v); });
      const L = { ...DEFAULT_LIMITS, ...limits };
      const bad = LIMIT_DEFS.find(([, , lo, hi]) => hi && L[lo] >= L[hi]);
      if (bad) return `${bad[0]}: ค่าต่ำสุดต้องน้อยกว่าค่าสูงสุด`;
      r.limits = limits;
      put('residents', r);
      done();
    }
  });
}

function medForm(m, defaults, done) {
  openForm({
    title: m ? 'แก้ไขรายการยา' : 'เพิ่มยา',
    fields: [
      { name: 'residentId', label: 'ผู้สูงอายุ', type: 'select', options: residentOptions(), wide: true },
      { name: 'name', label: 'ชื่อยาและความแรง', required: true, placeholder: 'เช่น Metformin 500 mg', wide: true },
      { name: 'dose', label: 'ขนาดที่ให้', required: true, placeholder: 'เช่น 1 เม็ด' },
      { name: 'how', label: 'วิธีใช้', placeholder: 'เช่น หลังอาหาร' },
      { name: 'kind', label: 'การให้ยา', type: 'select', options: [['round', 'ให้ประจำตามรอบ'], ['prn', 'ให้เมื่อมีอาการ (PRN)']], wide: true },
      { name: 'rounds', label: 'รอบที่ให้', type: 'checks', options: ROUNDS.map((x) => [x.key, x.label]), hint: 'ยาให้เมื่อมีอาการไม่ต้องเลือกรอบ', wide: true },
      { name: 'prnNote', label: 'ให้เมื่อ (สำหรับยา PRN)', placeholder: 'เช่น ปวดมากกว่า 5 คะแนน ห่างกันอย่างน้อย 6 ชม. ไม่เกิน 4 ครั้ง/วัน', wide: true }
    ],
    values: m ? { ...m, kind: m.prn ? 'prn' : 'round' } : { residentId: residents[0]?.id, rounds: [], kind: 'round', ...defaults },
    submitLabel: m ? 'บันทึกการแก้ไข' : 'เพิ่มยา',
    audit: m && { tbl: 'medications', row: m },
    onSave(d) {
      const prn = d.kind === 'prn';
      if (!prn && !d.rounds.length) return 'เลือกรอบที่ให้ยาอย่างน้อย 1 รอบ หรือเปลี่ยนเป็น "ให้เมื่อมีอาการ"';
      const { kind, ...rest } = d;
      const row = { ...rest, residentId: Number(d.residentId), prn, rounds: prn ? [] : d.rounds };
      let target = m;
      if (m) Object.assign(m, row);
      else { target = { id: newId(), ...row }; medications.push(target); }
      put('medications', target);
      done();
    },
    onDelete: m && (() => { del('medications', m); done(); }),
    deleteLabel: 'ลบยานี้'
  });
}

// บันทึกการให้ยาหนึ่งรอบ (ใช้กับวันที่ผ่านมาแล้ว หรือเมื่อต้องใส่เหตุผลที่ไม่ได้ให้)
function marEntryForm(m, key, date, entry, preset, done) {
  const r = getResident(m.residentId);
  openForm({
    title: `${m.name} — ${roundName(key)} ${shortDate(date)}`,
    intro: `${esc(r?.name || '')} · ${esc(m.dose)} ${esc(m.how || '')}`,
    fields: [
      { name: 'status', label: 'ผลการให้ยา', type: 'select', options: [['done', 'ให้แล้ว'], ['miss', 'ไม่ได้ให้ / ปฏิเสธ']] },
      { name: 'time', label: 'เวลา', type: 'time', required: true },
      { name: 'reason', label: 'หมายเหตุ / เหตุผลที่ไม่ได้ให้', placeholder: 'เช่น ผู้ป่วยปฏิเสธ, หลับ, งดน้ำงดอาหาร', wide: true }
    ],
    values: entry ? { ...entry, status: preset || entry.status } : { status: preset || 'done', time: date === todayISO() ? nowTime() : roundTime(key) },
    audit: entry && { tbl: 'mar', row: entry },
    onSave(d) {
      if (d.status === 'miss' && !d.reason) return 'กรุณาใส่เหตุผลที่ไม่ได้ให้ยา';
      if (entry && !can('update', 'mar', entry)) return 'แก้ไขได้เฉพาะรายการที่คุณบันทึกเอง';
      let target = entry;
      const row = { date, medId: m.id, round: key, status: d.status, time: d.time, reason: d.reason };
      if (entry) Object.assign(entry, row);
      else { target = { id: marRowId(date, m, key), ...row, by: settings.user }; marRows.push(target); }
      put('mar', target);
      done();
    },
    onDelete: entry && can('delete', 'mar', entry) && (() => { del('mar', entry); done(); }),
    deleteLabel: 'ล้างการบันทึกรอบนี้'
  });
}

function prnForm(m, date, entry, done) {
  const r = getResident(m.residentId);
  openForm({
    title: entry ? `แก้ไขการให้ยา ${m.name}` : `บันทึกการให้ยา ${m.name}`,
    intro: `${esc(r?.name || '')} · ${esc(m.dose)} ${esc(m.how || '')}${m.prnNote ? `<br>ให้เมื่อ: ${esc(m.prnNote)}` : ''}`,
    fields: [
      { name: 'time', label: 'เวลาที่ให้', type: 'time', required: true },
      { name: 'reason', label: 'อาการ / เหตุผลที่ให้', required: true, placeholder: 'เช่น ปวดเข่าซ้าย 6/10', wide: true }
    ],
    values: entry || { time: date === todayISO() ? nowTime() : '' },
    audit: entry && { tbl: 'mar', row: entry },
    onSave(d) {
      if (entry && !can('update', 'mar', entry)) return 'แก้ไขได้เฉพาะรายการที่คุณบันทึกเอง';
      let target = entry;
      if (entry) Object.assign(entry, d);
      else { target = { id: `${date}|${m.id}|prn|${Date.now()}`, date, medId: m.id, round: 'prn', status: 'done', ...d, by: settings.user }; marRows.push(target); }
      put('mar', target);
      done();
    },
    onDelete: entry && can('delete', 'mar', entry) && (() => { del('mar', entry); done(); }),
    deleteLabel: 'ลบรายการนี้'
  });
}

function vitalForm(v, done) {
  openForm({
    title: 'แก้ไขบันทึกการตรวจ',
    fields: [
      { name: 'date', label: 'วันที่', type: 'date', required: true },
      { name: 'time', label: 'เวลา', type: 'time', required: true },
      ...FIELDS.map((f) => ({ name: f, label: FIELD_LABELS[f], placeholder: f === 'bp' ? '120/80' : '', inputmode: f === 'bp' ? undefined : 'decimal' })),
      { name: 'note', label: 'อาการที่ตรวจพบ', wide: true }
    ],
    values: v,
    audit: { tbl: 'vitals', row: v },
    onSave(d) {
      Object.assign(v, d);
      put('vitals', v);
      done();
    },
    onDelete: can('delete', 'vitals', v) && (() => { del('vitals', v); done(); })
  });
}

function noteForm(n, done) {
  openForm({
    title: 'แก้ไขบันทึกทางการพยาบาล',
    fields: [
      { name: 'date', label: 'วันที่', type: 'date', required: true },
      { name: 'time', label: 'เวลา', type: 'time', required: true },
      { name: 'type', label: 'ประเภทงาน', type: 'select', options: NOTE_TYPES.map((t) => [t, t]), wide: true },
      { name: 'text', label: 'ข้อความบันทึก', type: 'textarea', required: true, wide: true },
      { name: 'urine', label: 'ปัสสาวะ (cc)', type: 'number', min: 0 },
      { name: 'stool', label: 'อุจจาระ (ครั้ง)', type: 'number', min: 0 }
    ],
    values: n,
    audit: { tbl: 'nurseNotes', row: n },
    onSave(d) {
      Object.assign(n, { ...d, urine: d.urine || null, stool: d.stool || null });
      put('nurseNotes', n);
      done();
    },
    onDelete: can('delete', 'nurseNotes', n) && (() => { del('nurseNotes', n); done(); })
  });
}

function orderForm(o, residentId, done) {
  openForm({
    title: o ? 'แก้ไขคำสั่งแพทย์' : 'เพิ่มคำสั่งแพทย์',
    fields: [{ name: 'text', label: 'คำสั่งแพทย์', type: 'textarea', required: true, placeholder: 'เช่น พลิกตะแคงตัวทุก 2 ชม.', wide: true }],
    values: o || {},
    submitLabel: o ? 'บันทึกการแก้ไข' : 'เพิ่มคำสั่ง',
    audit: o && { tbl: 'doctorOrders', row: o },
    onSave(d) {
      let target = o;
      if (o) o.text = d.text;
      else { target = { id: newId(), residentId, text: d.text }; doctorOrders.push(target); }
      put('doctorOrders', target);
      done();
    },
    onDelete: o && (() => { del('doctorOrders', o); done(); }),
    deleteLabel: 'ยกเลิกคำสั่งนี้',
    deleteConfirm: 'ยกเลิกคำสั่งแพทย์นี้ใช่ไหม?'
  });
}

function centerForm(done) {
  openForm({
    title: 'ตั้งค่าศูนย์',
    fields: [
      { name: 'center', label: 'ชื่อศูนย์ดูแล', required: true, wide: true },
      { name: 'address', label: 'ที่อยู่ / เบอร์โทรศูนย์ (แสดงบนรายงาน)', wide: true }
    ],
    values: { center: kv.settings?.center || '', address: kv.settings?.address || '' },
    onSave(d) {
      kvSet('settings', d);
      done();
    }
  });
}

function passwordForm() {
  openForm({
    title: 'เปลี่ยนรหัสผ่าน',
    fields: [
      { name: 'old', label: 'รหัสผ่านเดิม', type: 'password', required: true, autocomplete: 'current-password', wide: true },
      { name: 'new', label: 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)', type: 'password', required: true, autocomplete: 'new-password', wide: true },
      { name: 'confirm', label: 'พิมพ์รหัสผ่านใหม่อีกครั้ง', type: 'password', required: true, autocomplete: 'new-password', wide: true }
    ],
    submitLabel: 'เปลี่ยนรหัสผ่าน',
    savedMsg: 'เปลี่ยนรหัสผ่านแล้ว',
    async onSave(d) {
      if (d.new.length < 8) return 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร';
      if (d.new !== d.confirm) return 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน';
      await api('POST', '/api/password', { old: d.old, new: d.new });
    }
  });
}

// ปุ่ม "แก้ไข" ในรายการต่างๆ ใช้ data-edit="ประเภท:id"
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  const [kind, id] = btn.dataset.edit.split(':');
  const find = (arr) => arr.find((x) => sameId(x.id, id));
  const done = () => redraw();
  if (kind === 'note') noteForm(find(nurseNotes), done);
  if (kind === 'vital') vitalForm(find(vitals), done);
  if (kind === 'med') medForm(find(medications), {}, done);
  if (kind === 'order') { const o = find(doctorOrders); orderForm(o, o.residentId, done); }
});

// ---------- เมนูด้านซ้าย ----------
function renderSidebar(active) {
  const links = [
    ['home', 'index.html', 'หน้าหลัก'],
    ['profile', 'profile.html', 'ประวัติผู้สูงอายุ'],
    ['medication', 'medication.html', 'ตารางให้ยา'],
    ['record', 'record.html', 'บันทึกอาการ'],
    ['report', 'report.html', 'รายงาน'],
    ['history', 'history.html', 'ประวัติการแก้ไข'],
    ...(currentUser.role === 'admin' ? [['users', 'users.html', 'จัดการผู้ใช้']] : [])
  ];
  $('#sidebar').innerHTML = `
    <div class="brand">
      <div class="brand-logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s-7-4.5-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 6c-2.3 4.5-9.3 9-9.3 9z"/></svg>
      </div>
      <div><span class="brand-name">${esc(settings.center)}</span><span class="brand-sub">ระบบบันทึกผู้สูงอายุ</span></div>
    </div>
    ${links.map(([key, href, label]) => `<a class="nav-link${key === active ? ' active' : ''}" href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    <div class="sidebar-user">
      <strong>${esc(currentUser.name)}</strong><br>${ROLE_LABELS[currentUser.role]}
      <div class="sidebar-actions">
        <button type="button" id="change-password" class="link-btn">เปลี่ยนรหัสผ่าน</button>
        ${currentUser.role === 'admin' ? `<button type="button" id="open-settings" class="link-btn">ตั้งค่าศูนย์</button>
          <a class="link-btn" href="/api/backup" download>ดาวน์โหลดสำรองข้อมูล</a>` : ''}
        <button type="button" id="logout" class="link-btn">ออกจากระบบ</button>
      </div>
    </div>`;
  $('#change-password').addEventListener('click', passwordForm);
  $('#open-settings')?.addEventListener('click', () => centerForm(() => { renderSidebar(active); redraw(); }));
  $('#logout').addEventListener('click', async () => {
    if (outbox.length && !confirm(`ยังมี ${outbox.length} รายการที่ส่งไม่สำเร็จ ถ้าออกจากระบบตอนนี้รายการเหล่านั้นจะยังรอส่งในเครื่องนี้ ออกจากระบบต่อไหม?`)) return;
    try { await api('POST', '/api/logout'); } catch { /* ออกต่อได้แม้เซิร์ฟเวอร์ไม่ตอบ */ }
    location.href = 'login.html';
  });
}

// ---------- ข้อความเมื่อเปิดหน้าไม่ได้ ----------
function fatal(html) {
  const main = $('.content') || document.body;
  main.innerHTML = `<section class="card" style="max-width: 640px"><h1 class="card-title">เปิดระบบไม่ได้</h1>${html}</section>`;
}
