// ===== รายงานทุกแบบ และใบส่งตัวไปโรงพยาบาล =====
const avg = (arr) => Math.round(arr.reduce((s, n) => s + n, 0) / arr.length);
const commentKey = (key) => 'comment:' + key; // ความเห็นพยาบาลที่พิมพ์ในหน้ารายงาน เก็บที่เซิร์ฟเวอร์
const thaiTime = (t) => (t ? t.replace(':', '.') + ' น.' : '');
const formalDate = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${d.toLocaleDateString('th-TH', { month: 'long' })} พ.ศ. ${d.getFullYear() + 543}`;
};
// ช่องที่ไม่มีข้อมูล พิมพ์เป็นเส้นไข่ปลาให้เขียนด้วยมือ
const dots = (em = 10) => `<span class="dots" style="min-width: ${em}em"></span>`;
const orDots = (v, em) => (v ? esc(v) : dots(em));
const box = (on) => (on ? '☑' : '☐');
const sec = (title) => `<h3 class="sec">${title}</h3>`;

function docHead(title, sub, meta) {
  return `<header class="doc-head">
    <div class="doc-org"><strong>${esc(settings.center)}</strong>${settings.address ? `<span>${esc(settings.address)}</span>` : ''}</div>
    <h2 class="doc-title">${title}</h2>
    ${sub ? `<p class="doc-sub">${sub}</p>` : ''}
    ${meta.length ? `<div class="doc-meta">${meta.map(([k, v]) => `<span>${k} ${v}</span>`).join('')}</div>` : ''}
  </header>`;
}

const docFoot = () => `<footer class="doc-foot">
  <span>เอกสารนี้มีข้อมูลสุขภาพส่วนบุคคล ใช้เพื่อการดูแลรักษาเท่านั้น โปรดเก็บรักษาเป็นความลับ</span>
  <span>พิมพ์เมื่อ ${formalDate(todayISO())} ${thaiTime(nowTime())} โดย ${esc(settings.user)}</span>
</footer>`;

const signBlock = (role, name) => `<div class="sign">
  <span>ลงชื่อ ${dots(13)}</span>
  <span>( ${name ? esc(name) : dots(12)} )</span>
  <span>${role}</span>
  <span>วันที่ ${dots(2.5)}/${dots(2.5)}/${dots(3.5)} เวลา ${dots(4)}</span>
</div>`;

const allergyBox = (r) => (r.allergy
  ? `<div class="allergy-box" role="note"><strong>⚠ แพ้ยา: ${esc(r.allergy)}</strong></div>`
  : '<div class="allergy-box none">ไม่มีประวัติแพ้ยา</div>');

function patientTable(r) {
  const row = (pairs) => `<tr>${pairs.map(([k, v]) => `<th scope="row">${k}</th><td>${v}</td>`).join('')}</tr>`;
  return `<table class="kv">
    ${row([['ชื่อ–สกุล', `<strong>${esc(r.name)}</strong>`], ['อายุ', `${esc(r.age)} ปี`]])}
    ${row([['เลขบัตรประชาชน', orDots(r.idCard, 12)], ['หมู่เลือด', orDots(r.bloodType, 4)]])}
    ${row([['สิทธิการรักษา', orDots(r.rights, 10)], ['ห้องพัก', esc(r.room)]])}
    ${row([['โรงพยาบาลประจำ', orDots(r.hospital, 12)], ['HN', orDots(r.hn, 7)]])}
    <tr><th scope="row">โรคประจำตัว</th><td colspan="3">${esc(r.conditions.join(', ')) || 'ไม่มี'}</td></tr>
    <tr><th scope="row">ญาติผู้ติดต่อ</th><td colspan="3">${r.contact ? esc(r.contact) + (r.phone ? ` โทร ${esc(r.phone)}` : '') : dots(20)}</td></tr>
  </table>
  ${allergyBox(r)}`;
}

function vitalsTable(vs) {
  if (!vs.length) return '<p class="empty">ไม่มีการบันทึกสัญญาณชีพ</p>';
  return `<table>
    <thead><tr><th>วันที่ / เวลา</th><th class="center">T (°C)</th><th class="center">P (/นาที)</th><th class="center">R (/นาที)</th>
      <th class="center">BP (mmHg)</th><th class="center">O₂ (%)</th><th class="center">น้ำตาล</th><th>อาการที่ตรวจพบ</th></tr></thead>
    <tbody>${vs.map((v) => `<tr><td>${esc(shortDate(v.date))} ${esc(thaiTime(v.time))}</td>
      ${['t', 'p', 'r', 'bp', 'o2', 'sugar'].map((f) => `<td class="center ${isAbnormalV(v, f) ? 'abnormal' : ''}">${esc(v[f] || '—')}</td>`).join('')}
      <td>${esc(v.note || '')}</td></tr>`).join('')}</tbody>
  </table>
  <p class="doc-note">ค่าที่ผิดปกติแสดงเป็นตัวหนาและขีดเส้นใต้</p>`;
}

function bpChart(vs) {
  const byDay = {};
  vs.forEach((v) => {
    const sys = Number(String(v.bp || '').split('/')[0]);
    if (sys) (byDay[v.date] = byDay[v.date] || []).push(sys);
  });
  const days = Object.keys(byDay).sort().slice(-14);
  if (!days.length) return '<p class="empty">ไม่มีการวัดความดันในช่วงนี้</p>';
  const vals = days.map((d) => avg(byDay[d]));
  const lo = 60, hi = Math.max(180, Math.max(...vals) + 10), px = 150;
  const h = (v) => Math.max(4, Math.round((v - lo) / (hi - lo) * px));
  const cols = `grid-template-columns: repeat(${days.length}, minmax(0, 1fr))`;
  return `<div class="bars" style="${cols}">
      <div class="threshold" style="bottom: ${h(140)}px"></div>
      ${vals.map((v) => `<div class="bar-col">${v}<div class="bar" style="height: ${h(v)}px; background: ${v > 140 ? 'var(--danger)' : 'var(--primary)'}"></div></div>`).join('')}
    </div>
    <div class="bar-labels" style="${cols}">${days.map((d) => `<span>${shortDate(d)}</span>`).join('')}</div>
    <p class="doc-note">ค่าเฉลี่ยความดันตัวบนรายวัน เส้นประ = เกณฑ์ 140 mmHg</p>`;
}

function marTable(summary, withResident) {
  if (!summary.length) return '<p class="empty">ไม่มีรายการยา</p>';
  const list = (arr) => arr.slice(0, 3).join(', ') + (arr.length > 3 ? ` และอีก ${arr.length - 3} ครั้ง` : '');
  return `<table>
    <thead><tr>${withResident ? '<th>ผู้สูงอายุ</th>' : ''}<th>รายการยา</th><th class="center">ควรได้รับ</th><th class="center">ให้แล้ว</th><th>ไม่ได้ให้ / ปฏิเสธ</th><th>ไม่มีบันทึก</th></tr></thead>
    <tbody>${summary.map((s) => `<tr>
      ${withResident ? `<td>${esc(getResident(s.med.residentId).name)}</td>` : ''}
      <td>${esc(s.med.name)}</td>
      ${isPRN(s.med) ? `<td colspan="4">ยาให้เมื่อมีอาการ: ให้ ${s.prn.length} ครั้ง${s.prn.length ? ` (${esc(list(s.prn))})` : ''}</td></tr>` : `<td class="center">${s.expected}</td><td class="center">${s.done}</td>
      <td class="${s.miss.length ? 'abnormal' : ''}">${s.miss.length ? `${s.miss.length} (${esc(list(s.miss))})` : '—'}</td>
      <td>${s.blank.length ? `${s.blank.length} (${esc(list(s.blank))})` : '—'}</td></tr>`}`).join('')}</tbody>
  </table>`;
}

const marCSV = (s) => (isPRN(s.med)
  ? [getResident(s.med.residentId).name, s.med.name + ' (PRN)', '', s.prn.length, '', s.prn.join(' / '), '']
  : [getResident(s.med.residentId).name, s.med.name, s.expected, s.done, s.miss.length, s.miss.join(' / '), s.blank.length]);
const MAR_CSV_HEAD = ['ผู้สูงอายุ', 'ยา', 'ควรได้รับ', 'ให้แล้ว', 'ไม่ได้ให้/ปฏิเสธ', 'รายละเอียดที่ไม่ได้ให้', 'ไม่มีบันทึก'];

function commentBox(key, title = 'ความเห็นพยาบาล') {
  return `<section class="report-block">${sec(title)}
    <div class="comment" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${title}" data-comment="${key}"
      data-placeholder="คลิกเพื่อพิมพ์ ถ้าเว้นว่างจะพิมพ์เป็นเส้นให้เขียนด้วยมือ">${esc(kv[commentKey(key)] || '')}</div></section>`;
}

function eventsList(items) {
  if (!items.length) return '<p class="empty">ไม่มีเหตุการณ์ผิดปกติในช่วงนี้</p>';
  return `<ul class="event-list">${items.sort(byDateTime).map((x) =>
    `<li><strong>${esc(shortDate(x.date))} ${esc(thaiTime(x.time))}</strong> ${esc(x.text)}</li>`).join('')}</ul>`;
}

// เหตุการณ์สำคัญ = ค่าสัญญาณชีพผิดปกติ + บันทึกพยาบาลตามประเภทที่กำหนด
const EVENT_TYPES = ['เหตุการณ์ผิดปกติ', 'ส่งโรงพยาบาล'];
function eventsOf(r, from, to, types = [...EVENT_TYPES, 'แพทย์สั่ง']) {
  const fromVitals = vitals.filter((v) => sameId(v.residentId, r.id) && inRange(v, from, to) && abnormalFields(v).length)
    .map((v) => ({ date: v.date, time: v.time, kind: 'ค่าผิดปกติ', text: `ค่าผิดปกติ: ${abnormalText(v)}${v.note ? ` (${v.note})` : ''}`, by: v.by, r }));
  const fromNotes = nurseNotes.filter((n) => sameId(n.residentId, r.id) && inRange(n, from, to) && types.includes(n.type))
    .map((n) => ({ date: n.date, time: n.time, kind: n.type, text: `${n.type}: ${n.text.replace(/\n/g, ' ')}`, by: n.by, r }));
  return [...fromVitals, ...fromNotes];
}

const rangeText = (f, t) => (f === t ? `วันที่ ${formalDate(f)}` : `ระหว่างวันที่ ${formalDate(f)} ถึงวันที่ ${formalDate(t)}`);
const whoText = (list) => (list.length === 1 ? `${esc(list[0].name)} ห้อง ${esc(list[0].room)}` : `ทั้งหมด ${list.length} คน`);

function reportHealth(list, from, to) {
  const csv = [['ผู้สูงอายุ', 'วันที่', 'เวลา', ...FIELDS.map((f) => FIELD_LABELS[f]), 'อาการที่ตรวจพบ', 'ผู้ตรวจ']];
  const html = list.map((r) => {
    const vs = vitals.filter((v) => sameId(v.residentId, r.id) && inRange(v, from, to)).sort(byDateTime);
    vs.forEach((v) => csv.push([r.name, v.date, v.time, ...FIELDS.map((f) => v[f] || ''), v.note || '', v.by || '']));
    const bps = vs.map((v) => String(v.bp || '').split('/').map(Number)).filter(([s, d]) => s && d);
    const sugars = vs.map((v) => parseFloat(v.sugar)).filter((n) => !isNaN(n));
    const mar = marSummary(medications.filter((m) => sameId(m.residentId, r.id)), from, to);
    const expected = mar.reduce((s, x) => s + x.expected, 0);
    const done = mar.reduce((s, x) => s + x.done, 0);
    const abnormalCount = vs.filter((v) => abnormalFields(v).length).length;
    return `<section class="report-section">
      <section class="report-block">${sec('ข้อมูลผู้สูงอายุ')}${patientTable(r)}</section>
      <section class="report-block">${sec('สรุปผลในช่วงรายงาน')}
        <table><thead><tr><th class="center">ความดันเฉลี่ย (mmHg)</th><th class="center">น้ำตาลเฉลี่ย (mg/dL)</th><th class="center">ให้ยาตามรอบ</th><th class="center">วัดได้ค่าผิดปกติ</th></tr></thead>
        <tbody><tr>
          <td class="center">${bps.length ? `${avg(bps.map((b) => b[0]))}/${avg(bps.map((b) => b[1]))}` : '—'}</td>
          <td class="center">${sugars.length ? avg(sugars) : '—'}</td>
          <td class="center">${done} จาก ${expected} ครั้ง</td>
          <td class="center ${abnormalCount ? 'abnormal' : ''}">${abnormalCount} ครั้ง</td>
        </tr></tbody></table></section>
      <section class="report-block">${sec('แนวโน้มความดันโลหิต')}${bpChart(vs)}</section>
      <section class="report-block">${sec('การให้ยา')}${marTable(mar, false)}</section>
      <section class="report-block">${sec('เหตุการณ์และบันทึกสำคัญ')}${eventsList(eventsOf(r, from, to))}</section>
      ${commentBox('health-' + r.id)}
    </section>`;
  }).join('');
  return { sub: rangeText(from, to), meta: [], html, csv, signs: [['พยาบาลผู้รายงาน', settings.user], ['หัวหน้าพยาบาล', '']] };
}

function reportMar(list, from, to) {
  const summary = marSummary(medications.filter((m) => list.includes(getResident(m.residentId))), from, to);
  return {
    sub: rangeText(from, to),
    meta: [['ผู้สูงอายุ', whoText(list)]],
    html: `<section class="report-block">${sec('สรุปการให้ยาแยกตามรายการ')}${marTable(summary, list.length > 1)}
        <p class="doc-note">"ไม่มีบันทึก" คือรอบที่ถึงเวลาแล้วแต่ไม่มีการบันทึกในตารางให้ยา</p></section>
      ${commentBox('mar')}`,
    csv: [MAR_CSV_HEAD, ...summary.map(marCSV)],
    signs: [['พยาบาลผู้รายงาน', settings.user], ['หัวหน้าพยาบาล', '']]
  };
}

function reportShift(list, from, to) {
  const day = to;
  const csv = [['หัวข้อ', 'ผู้สูงอายุ', 'ห้อง', 'เวลา', 'รายละเอียด', 'ผู้บันทึก']];
  const watch = list.filter((r) => r.status !== 'ok');
  watch.forEach((r) => csv.push(['ผู้ที่ต้องเฝ้าระวัง', r.name, r.room, '', `${STATUS[r.status].label} ${r.conditions.join(', ')}`, '']));
  const abn = list.flatMap((r) => eventsOf(r, day, day, EVENT_TYPES));
  abn.forEach((x) => csv.push(['เหตุการณ์/ค่าผิดปกติ', x.r.name, x.r.room, x.time, x.text, x.by]));
  const mar = marSummary(medications.filter((m) => list.includes(getResident(m.residentId))), day, day).filter((s) => !isPRN(s.med) && (s.miss.length || s.blank.length));
  mar.forEach((s) => csv.push(['ยาที่ยังไม่ได้ให้', getResident(s.med.residentId).name, getResident(s.med.residentId).room, '', `${s.med.name}: ${[...s.miss.map((x) => x + ' ปฏิเสธ'), ...s.blank.map((x) => x + ' ไม่มีบันทึก')].join(', ')}`, '']));
  const notes = nurseNotes.filter((n) => n.date === day && list.includes(getResident(n.residentId))).sort(byDateTime);
  notes.forEach((n) => csv.push(['บันทึกพยาบาล', getResident(n.residentId).name, getResident(n.residentId).room, n.time, `${n.type}: ${n.text.replace(/\n/g, ' ')}`, n.by]));
  const byResident = {};
  notes.forEach((n) => (byResident[n.residentId] = byResident[n.residentId] || []).push(n));
  const round = (x) => x.split(' ').pop();

  const html = `
    <section class="report-block">${sec(`ผู้ที่ต้องเฝ้าระวัง (${watch.length} คน)`)}
      ${watch.length ? `<table><thead><tr><th>ชื่อ–สกุล</th><th>ห้อง</th><th>สถานะ</th><th>โรคประจำตัว / ข้อควรระวัง</th></tr></thead><tbody>
        ${watch.map((r) => `<tr><td>${esc(r.name)}${r.allergy ? `<br><small class="abnormal">แพ้ยา ${esc(r.allergy)}</small>` : ''}</td><td>${esc(r.room)}</td>
          <td>${STATUS[r.status].label}</td>
          <td>${esc(r.conditions.join(', '))}${r.caution ? `<br><small>${esc(r.caution)}</small>` : ''}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">ไม่มี</p>'}</section>
    <section class="report-block">${sec('เหตุการณ์และค่าผิดปกติ')}
      ${abn.length ? `<ul class="event-list">${abn.sort(byDateTime).map((x) => `<li><strong>${esc(thaiTime(x.time))} ${esc(x.r.name)}</strong> ${esc(x.text)}</li>`).join('')}</ul>` : '<p class="empty">ไม่มี</p>'}</section>
    <section class="report-block">${sec('ยาที่ยังไม่ได้ให้ / ปฏิเสธ')}
      ${mar.length ? `<ul class="event-list">${mar.map((s) => `<li><strong>${esc(getResident(s.med.residentId).name)}</strong> ${esc(s.med.name)}:
        ${s.miss.length ? `<span class="abnormal">ปฏิเสธรอบ${esc(s.miss.map(round).join(', '))}</span> ` : ''}
        ${s.blank.length ? `ยังไม่มีบันทึกรอบ${esc(s.blank.map(round).join(', '))}` : ''}</li>`).join('')}</ul>` : '<p class="empty">ให้ยาครบทุกรอบที่ถึงเวลาแล้ว</p>'}</section>
    <section class="report-block">${sec('บันทึกพยาบาลประจำวัน')}
      ${Object.keys(byResident).length ? Object.entries(byResident).map(([id, ns]) => `<div><strong>${esc(getResident(id).name)}</strong>
        <ul class="event-list">${ns.map((n) => `<li><strong>${esc(thaiTime(n.time))}</strong> ${esc(n.type)}: ${esc(n.text.replace(/\n/g, ' '))} (${esc(n.by)})</li>`).join('')}</ul></div>`).join('') : '<p class="empty">ยังไม่มีบันทึกในวันนี้</p>'}</section>
    ${commentBox('shift', 'เรื่องที่ต้องส่งต่อเวรถัดไป')}`;
  return {
    sub: `ประจำวันที่ ${formalDate(day)}`,
    meta: [['เวร', `${box(false)} เช้า ${box(false)} บ่าย ${box(false)} ดึก`]],
    html, csv,
    signs: [['ผู้ส่งเวร', settings.user], ['ผู้รับเวร', '']]
  };
}

function reportIncident(list, from, to) {
  const items = list.flatMap((r) => eventsOf(r, from, to, EVENT_TYPES)).sort(byDateTime);
  return {
    sub: rangeText(from, to),
    meta: [['ผู้สูงอายุ', whoText(list)]],
    html: `<section class="report-block">${sec('รายการเหตุการณ์')}
      ${items.length ? `<table><thead><tr><th>วันที่ / เวลา</th><th>ผู้สูงอายุ</th><th>รายละเอียด</th><th>ผู้บันทึก</th></tr></thead><tbody>
        ${items.map((x) => `<tr><td>${esc(shortDate(x.date))} ${esc(thaiTime(x.time))}</td><td>${esc(x.r.name)}</td>
          <td class="${x.kind === 'ค่าผิดปกติ' ? 'abnormal' : ''}">${esc(x.text)}</td><td>${esc(x.by)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">ไม่มีเหตุการณ์ผิดปกติในช่วงนี้</p>'}
      <p class="doc-note">รวมค่าสัญญาณชีพที่ผิดปกติ และบันทึกพยาบาลประเภท "เหตุการณ์ผิดปกติ" และ "ส่งโรงพยาบาล"</p></section>
      ${commentBox('incident', 'การแก้ไขและการป้องกัน')}`,
    csv: [['วันที่', 'เวลา', 'ผู้สูงอายุ', 'ห้อง', 'ประเภท', 'รายละเอียด', 'ผู้บันทึก'], ...items.map((x) => [x.date, x.time, x.r.name, x.r.room, x.kind, x.text, x.by])],
    signs: [['ผู้รายงาน', settings.user], ['หัวหน้าพยาบาล', '']]
  };
}

// ----- ใบส่งตัวไปโรงพยาบาล -----
const CONSCIOUS = ['รู้สึกตัวดี', 'สับสน', 'ซึม ปลุกตื่น', 'ไม่รู้สึกตัว'];
const DEVICES = ['สายให้อาหาร (NG)', 'ออกซิเจน', 'สายสวนปัสสาวะ', 'แผลกดทับ / แผล', 'ฟันปลอม', 'แว่นตา / เครื่องช่วยฟัง'];
const TRANSPORT = ['รถของศูนย์', 'รถพยาบาลฉุกเฉิน 1669', 'รถโรงพยาบาล', 'ญาตินำส่ง'];
const TRANSFER_FIELDS = [
  { name: 'hospital', label: 'โรงพยาบาลที่ส่งไป', wide: true },
  { name: 'reason', label: 'เหตุผลที่ส่ง / อาการสำคัญ', type: 'textarea', wide: true, placeholder: 'เช่น หอบเหนื่อย O₂ 85% หลังให้ออกซิเจน 5 L ไม่ดีขึ้น' },
  { name: 'onset', label: 'เริ่มมีอาการเมื่อ', type: 'datetime-local' },
  { name: 'conscious', label: 'ระดับความรู้สึกตัว', type: 'select', options: [['', 'ไม่ระบุ'], ...CONSCIOUS.map((x) => [x, x])] },
  { name: 'devices', label: 'อุปกรณ์ / สิ่งที่ติดตัวไป', type: 'checks', options: DEVICES.map((x) => [x, x]), wide: true },
  { name: 'care', label: 'การดูแลที่ให้ก่อนส่ง', type: 'textarea', wide: true, placeholder: 'เช่น On O₂ mask 10 L, suction, วัดสัญญาณชีพทุก 15 นาที' },
  { name: 'transport', label: 'นำส่งโดย', type: 'select', options: [['', 'ไม่ระบุ'], ...TRANSPORT.map((x) => [x, x])] },
  { name: 'escort', label: 'ผู้นำส่ง (ชื่อ)' },
  { name: 'relative', label: 'แจ้งญาติแล้ว (ชื่อญาติ / เวลา)', wide: true }
];
const draftKey = (r) => 'transfer-draft-' + r.id;
const getDraft = (r) => kv[draftKey(r)] || { hospital: r.hospital || '', onset: `${todayISO()}T${nowTime()}`, devices: [] };

// เวลาที่ให้ยาครั้งล่าสุดใน 3 วัน (รวมยาให้เมื่อมีอาการ)
function lastGiven(m) {
  const from = addDays(todayISO(), -2);
  const last = marRows.filter((x) => sameId(x.medId, m.id) && x.status === 'done' && x.date >= from).sort(byDateTime).pop();
  return last ? `${relDate(last.date)} ${thaiTime(last.time)}` : 'ไม่มีบันทึกใน 3 วัน';
}

function reportTransfer(list) {
  const r = list[0];
  const d = getDraft(r);
  const now = new Date();
  const cutoff = isoOf(new Date(now - 864e5)) + new Date(now - 864e5).toTimeString().slice(0, 5);
  const vs = vitals.filter((v) => sameId(v.residentId, r.id)).sort(byDateTime).slice(-4);
  const notes = nurseNotes.filter((n) => sameId(n.residentId, r.id) && n.date + n.time >= cutoff).sort(byDateTime);
  const meds = medications.filter((m) => sameId(m.residentId, r.id));
  const orders = doctorOrders.filter((o) => sameId(o.residentId, r.id));
  const [onDate, onTime] = (d.onset || '').split('T');
  const lines = (n) => `<div class="blank-lines">${'<span></span>'.repeat(n)}</div>`;
  const checklist = (opts, chosen) => `<span class="checklist">${opts.map((o) => `<span>${box(chosen.includes(o))} ${esc(o)}</span>`).join('')}</span>`;

  const html = `
    <p class="doc-to">เรียน แพทย์ผู้รับผิดชอบ ${d.hospital ? esc(d.hospital) : dots(18)}</p>
    <section class="report-block">${sec('ข้อมูลผู้ป่วย')}${patientTable(r)}</section>
    <section class="report-block">${sec('เหตุผลที่ส่งตัว / อาการสำคัญ')}
      ${d.reason ? `<p class="doc-text">${esc(d.reason)}</p>` : lines(3)}
      <p class="doc-text">เริ่มมีอาการเมื่อ ${onDate ? `${formalDate(onDate)} เวลา ${thaiTime(onTime)}` : dots(16)}</p></section>
    <section class="report-block">${sec('สัญญาณชีพล่าสุด')}${vitalsTable(vs)}</section>
    <section class="report-block">${sec('สภาพผู้ป่วยและการดูแลก่อนส่ง')}
      <table class="kv">
        <tr><th scope="row">ความรู้สึกตัว</th><td>${checklist(CONSCIOUS, [d.conscious])}</td></tr>
        <tr><th scope="row">อุปกรณ์ที่ติดตัวไป</th><td>${checklist(DEVICES, d.devices || [])}</td></tr>
        <tr><th scope="row">การดูแลที่ให้</th><td>${d.care ? esc(d.care) : lines(2)}</td></tr>
        <tr><th scope="row">อาหาร</th><td>${orDots(r.food, 16)}</td></tr>
      </table></section>
    <section class="report-block">${sec('ยาที่ใช้ประจำ')}
      ${meds.length ? `<table><thead><tr><th>รายการยา</th><th>ขนาด / วิธีใช้</th><th>รอบที่ให้</th><th>ให้ครั้งล่าสุด</th></tr></thead><tbody>
        ${meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.dose)} ${esc(m.how)}</td><td>${m.rounds.map(roundName).join(', ')}</td><td>${esc(lastGiven(m))}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">ไม่มียาประจำ</p>'}</section>
    <section class="report-block">${sec('คำสั่งแพทย์และข้อควรระวัง')}
      ${orders.length || r.caution ? `<ul class="event-list">${orders.map((o) => `<li>${esc(o.text)}</li>`).join('')}${r.caution ? `<li>ข้อควรระวัง: ${esc(r.caution)}</li>` : ''}</ul>` : '<p class="empty">ไม่มี</p>'}</section>
    <section class="report-block">${sec('บันทึกพยาบาลใน 24 ชั่วโมงที่ผ่านมา')}
      ${notes.length ? `<ul class="event-list">${notes.map((n) => `<li><strong>${esc(shortDate(n.date))} ${esc(thaiTime(n.time))}</strong> ${esc(n.type)}: ${esc(n.text.replace(/\n/g, ' '))}</li>`).join('')}</ul>` : '<p class="empty">ไม่มีบันทึก</p>'}</section>
    <section class="report-block">${sec('การนำส่ง')}
      <table class="kv">
        <tr><th scope="row">นำส่งโดย</th><td>${checklist(TRANSPORT, [d.transport])}</td></tr>
        <tr><th scope="row">ผู้นำส่ง</th><td>${orDots(d.escort, 16)}</td></tr>
        <tr><th scope="row">แจ้งญาติ</th><td>${d.relative ? esc(d.relative) : `${box(false)} แจ้งแล้ว ชื่อ ${dots(12)} เวลา ${dots(5)}`}</td></tr>
      </table></section>
    <section class="report-block">${sec('สำหรับโรงพยาบาลผู้รับ')}
      <p class="doc-text">ผลการรักษา / คำแนะนำในการดูแลต่อที่ศูนย์</p>${lines(3)}</section>`;

  const csv = [
    ['หัวข้อ', 'รายละเอียด'],
    ['ชื่อ–สกุล', r.name], ['อายุ', r.age], ['เลขบัตรประชาชน', r.idCard || ''], ['สิทธิการรักษา', r.rights || ''], ['HN', r.hn || ''],
    ['แพ้ยา', r.allergy || 'ไม่มี'], ['โรคประจำตัว', r.conditions.join(', ')], ['โรงพยาบาลที่ส่งไป', d.hospital || ''],
    ['เหตุผลที่ส่ง', d.reason || ''], ['เริ่มมีอาการ', d.onset || ''], ['ความรู้สึกตัว', d.conscious || ''],
    ['อุปกรณ์ติดตัว', (d.devices || []).join(', ')], ['การดูแลก่อนส่ง', d.care || ''], ['นำส่งโดย', d.transport || ''], ['ผู้นำส่ง', d.escort || ''],
    ...meds.map((m) => ['ยา', `${m.name} ${m.dose} ${m.how} (ล่าสุด ${lastGiven(m)})`]),
    ...vs.map((v) => ['สัญญาณชีพ', `${v.date} ${v.time} ${FIELDS.filter((f) => v[f]).map((f) => `${FIELD_LABELS[f]} ${v[f]}`).join(', ')}`])
  ];
  return {
    sub: 'สรุปข้อมูลการดูแลจากศูนย์ เพื่อประกอบการรักษา',
    meta: [['เลขที่', dots(6)], ['วันที่', formalDate(todayISO())], ['เวลา', thaiTime(nowTime())]],
    html, csv,
    signs: [['พยาบาลผู้ส่งตัว', settings.user], ['ผู้นำส่ง', d.escort], ['เจ้าหน้าที่โรงพยาบาลผู้รับ', '']]
  };
}

const REPORTS = {
  transfer: { title: 'ใบส่งตัวผู้สูงอายุไปโรงพยาบาล', render: reportTransfer, single: true, noDates: true },
  health: { title: 'รายงานสรุปสุขภาพรายบุคคล', render: reportHealth },
  mar: { title: 'รายงานการให้ยา', render: reportMar },
  shift: { title: 'รายงานส่งเวรประจำวัน', render: reportShift, oneDate: true },
  incident: { title: 'รายงานเหตุการณ์ผิดปกติ', render: reportIncident }
};

function downloadCSV(filename, rows) {
  // ใส่ BOM เพื่อให้ Excel อ่านภาษาไทยถูก
  const text = '﻿' + rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function initReport() {
  const who = $('#rwho'), from = $('#rfrom'), to = $('#rto'), paper = $('#paper');
  const params = new URLSearchParams(location.search);
  who.innerHTML = '<option value="all">ทุกคน</option>' + residentOptions().map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('');
  const urlId = Number(params.get('id'));
  who.value = getResident(urlId) ? urlId : (residents[0]?.id ?? 'all');
  to.value = todayISO();
  from.value = addDays(todayISO(), -6);
  let type = REPORTS[params.get('type')] ? params.get('type') : 'health';
  let current = null;
  const one = () => (who.value === 'all' ? null : getResident(who.value));

  // แผงกรอกข้อมูลการส่งตัว (ไม่พิมพ์ออกมา)
  let panelFor = null;
  const buildPanel = () => {
    const r = one();
    panelFor = r;
    if (!r) { $('#transfer-fields').innerHTML = ''; return; }
    const d = getDraft(r);
    $('#transfer-fields').innerHTML = TRANSFER_FIELDS.map((f) => fieldHTML(f, d[f.name])).join('');
  };
  const readPanel = () => {
    const root = $('#transfer-fields');
    const data = {};
    TRANSFER_FIELDS.forEach((f) => {
      data[f.name] = f.type === 'checks'
        ? $$(`input[name="${f.name}"]:checked`, root).map((i) => i.value)
        : root.querySelector(`[name="${f.name}"]`).value.trim();
    });
    return data;
  };

  const draw = () => {
    const rep = REPORTS[type];
    const list = who.value === 'all' ? residents : [one()].filter(Boolean);
    const f = from.value, t = to.value;
    $$('.report-type').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === type);
      b.setAttribute('aria-pressed', b.dataset.type === type);
    });
    $('#rfrom-wrap').hidden = !!(rep.oneDate || rep.noDates);
    $('#rto-wrap').hidden = !!rep.noDates;
    $('#rto-label').textContent = rep.oneDate ? 'วันที่ส่งเวร' : 'ถึงวันที่';
    $('#transfer-panel').hidden = type !== 'transfer' || !one();
    if (type === 'transfer' && panelFor !== one()) buildPanel();

    const fail = (msg) => { paper.innerHTML = `<p class="empty">${msg}</p>`; current = null; };
    if (!list.length) return fail('ยังไม่มีผู้สูงอายุในระบบ');
    if (rep.single && list.length !== 1) return fail('ใบส่งตัวต้องเลือกผู้สูงอายุทีละ 1 คน เลือกชื่อในช่อง "ผู้สูงอายุ" ด้านบน');
    if (!rep.noDates && (!t || (!rep.oneDate && (!f || f > t)))) return fail('เลือกวันที่ให้ถูกต้อง: "ตั้งแต่วันที่" ต้องไม่อยู่หลัง "ถึงวันที่"');

    current = rep.render(list, f, t);
    current.filename = `${rep.title} ${list.length === 1 ? list[0].name + ' ' : ''}${rep.noDates ? todayISO() : rep.oneDate ? t : `${f} ถึง ${t}`}.csv`;
    paper.setAttribute('aria-label', rep.title);
    paper.innerHTML = `
      ${docHead(rep.title, current.sub, current.meta)}
      ${current.html}
      <div class="signatures">${current.signs.map(([role, name]) => signBlock(role, name)).join('')}</div>
      ${docFoot()}`;
  };

  $$('.report-type').forEach((btn) => btn.addEventListener('click', () => {
    type = btn.dataset.type;
    if (REPORTS[type].single && who.value === 'all' && residents.length) who.value = residents[0].id;
    history.replaceState(null, '', `?type=${type}${one() ? '&id=' + one().id : ''}`);
    draw();
  }));
  [who, from, to].forEach((el) => el.addEventListener('change', draw));
  // ร่างใบส่งตัวเก็บที่เซิร์ฟเวอร์ พยาบาลคนอื่นกรอกต่อได้
  const saveDraft = () => { kvSet(draftKey(panelFor), readPanel(), 800); draw(); };
  $('#transfer-fields').addEventListener('input', saveDraft);
  $('#transfer-fields').addEventListener('change', saveDraft);
  $('#transfer-save').addEventListener('click', () => {
    const r = panelFor, d = readPanel();
    if (!d.hospital || !d.reason) { toast('กรอก "โรงพยาบาลที่ส่งไป" และ "เหตุผลที่ส่ง" ก่อนบันทึก'); return; }
    const note = {
      id: newId(), residentId: r.id, date: todayISO(), time: nowTime(), type: 'ส่งโรงพยาบาล',
      text: `ส่งตัวไป ${d.hospital} ด้วย ${d.reason}${d.transport ? `\nนำส่งโดย ${d.transport}` : ''}${d.escort ? ` (${d.escort})` : ''}`,
      urine: null, stool: null, by: settings.user
    };
    nurseNotes.unshift(note);
    put('nurseNotes', note);
    toast('บันทึกการส่งตัวลงบันทึกพยาบาลแล้ว');
    draw();
  });
  $('#transfer-clear').addEventListener('click', () => {
    if (!confirm('ล้างข้อมูลที่กรอกในใบส่งตัวนี้ใช่ไหม?')) return;
    kvSet(draftKey(panelFor), null);
    buildPanel();
    draw();
  });
  paper.addEventListener('input', (e) => {
    const key = e.target.dataset?.comment;
    if (!key) return;
    kvSet(commentKey(key), (e.target.innerText ?? e.target.textContent).trim(), 800);
  });

  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-pdf').addEventListener('click', () => {
    toast('ในหน้าต่างพิมพ์ ให้เลือกปลายทาง "บันทึกเป็น PDF"');
    setTimeout(() => window.print(), 300);
  });
  $('#btn-excel').addEventListener('click', () => {
    if (!current) { toast('ยังไม่มีรายงานให้ดาวน์โหลด'); return; }
    downloadCSV(current.filename, current.csv);
    toast('ดาวน์โหลดไฟล์แล้ว เปิดด้วย Excel ได้เลย');
  });
  redraw = draw;
  draw();
}

