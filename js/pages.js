// ===== โค้ดของแต่ละหน้า =====
// แต่ละหน้ากำหนด <body data-page="..."> แล้วไฟล์นี้จะเรียกฟังก์ชันของหน้านั้น

// ---------- หน้าหลัก ----------
function initHome() {
  $('#today').textContent = thaiDate(todayISO());
  let filter = 'all';
  $('#add-resident').hidden = !can('create', 'residents');

  const draw = () => {
    const today = todayISO();
    $('#stat-total').textContent = residents.length;
    $('#stat-warn').textContent = residents.filter((r) => r.status === 'warn').length;

    const next = nextRound();
    $('#stat-next-label').textContent = `ยารอบ${roundName(next.key)} ${roundTime(next.key)}${next.date !== today ? ' พรุ่งนี้' : ''} ที่ยังไม่ได้ให้`;
    $('#stat-next').textContent = medications.filter((m) => getResident(m.residentId) && !isPRN(m) && m.rounds.includes(next.key) && !marGet(next.date, m, next.key)).length;

    const weekEnd = addDays(today, 7);
    $('#stat-appt').textContent = residents.filter((r) => r.apptDate && r.apptDate >= today && r.apptDate <= weekEnd).length;

    const q = $('#search').value.trim();
    const rows = sortedResidents().filter((r) =>
      (filter === 'all' || r.status === filter) &&
      (!q || r.name.includes(q) || String(r.room).includes(q) || (r.conditions || []).some((c) => c.includes(q))));
    $('#resident-rows').innerHTML = rows.map((r) => `
      <tr>
        <td><a class="person-link" href="profile.html?id=${r.id}">
          <span class="avatar">${esc(initial(r.name))}</span>
          <span><strong>${esc(r.name)}</strong><small>อายุ ${esc(r.age)} ปี</small></span></a></td>
        <td>${esc(r.room)}</td>
        <td>${esc((r.conditions || []).join(', ') || '—')}</td>
        <td class="${r.allergy ? 'abnormal' : ''}">${esc(r.allergy || '—')}</td>
        <td style="color: var(--muted)">${esc(lastRecord(r))}</td>
        <td><span class="badge ${STATUS[r.status].cls}">${STATUS[r.status].label}</span></td>
      </tr>`).join('')
      || `<tr><td colspan="6" class="empty">${residents.length ? 'ไม่พบชื่อที่ค้นหา ลองพิมพ์ชื่อหรือเลขห้องใหม่' : 'ยังไม่มีผู้สูงอายุในระบบ กด "+ เพิ่มผู้สูงอายุ" เพื่อเริ่ม'}</td></tr>`;
  };

  $('#search').addEventListener('input', draw);
  $$('[data-filter]').forEach((btn) => btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    $$('[data-filter]').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn);
    });
    draw();
  }));
  $('#add-resident').addEventListener('click', () => residentForm(null, (r) => { location.href = `profile.html?id=${r.id}`; }));
  redraw = draw;
  draw();
}

// ---------- หน้าประวัติ ----------
function initProfile() {
  const r = getResident(residentIdFromURL());
  if (!r) {
    $('.content').innerHTML = '<p>ไม่พบข้อมูลผู้สูงอายุคนนี้ <a href="index.html">กลับไปรายชื่อ</a></p>';
    return;
  }
  $('#p-edit').hidden = !can('update', 'residents', r);
  $('#p-limits').hidden = !can('update', 'residents', r);
  $('#p-add-med').hidden = !can('create', 'medications');

  const draw = () => {
    if (!residents.includes(r)) {
      $('.content').innerHTML = '<p>ข้อมูลผู้สูงอายุคนนี้ถูกลบแล้ว <a href="index.html">กลับไปรายชื่อ</a></p>';
      return;
    }
    document.title = `${r.name} — ระบบบันทึกผู้สูงอายุ`;
    $('#p-avatar').textContent = initial(r.name);
    $('#p-name').textContent = r.name;
    $('#p-status').textContent = STATUS[r.status].label;
    $('#p-status').className = 'badge ' + STATUS[r.status].cls;
    $('#p-info').textContent = `อายุ ${r.age} ปี · ห้อง ${r.room}${r.food ? ' · อาหาร: ' + r.food : ''}`;
    $('#p-contact').textContent = r.contact ? `ญาติผู้ติดต่อ: ${r.contact}${r.phone ? ' โทร ' + r.phone : ''}` : 'ยังไม่ได้ใส่ข้อมูลญาติผู้ติดต่อ';
    $('#p-allergy').innerHTML = `<strong>แพ้ยา:</strong> ${esc(r.allergy)}`;
    $('#p-allergy-box').style.display = r.allergy ? '' : 'none';
    $('#p-conditions').innerHTML = (r.conditions || []).map((c) => `<span class="tag">${esc(c)}</span>`).join('') || '<p class="empty">ไม่มี</p>';
    $('#p-caution').textContent = r.caution || 'ยังไม่ได้ระบุ';
    $('#p-caution').classList.toggle('empty', !r.caution);
    $('#p-appt').innerHTML = r.apptDate
      ? `<strong>${esc(longDate(r.apptDate))}</strong>${r.apptPlace ? '<br>' + esc(r.apptPlace) : ''}`
      : '<span class="empty">ยังไม่มีนัด</span>';
    $('#p-record-link').href = `record.html?id=${r.id}`;
    $('#p-transfer-link').href = `report.html?type=transfer&id=${r.id}`;
    $('#p-history-link').href = `history.html?tbl=residents&id=${r.id}`;

    $('#p-limit-list').innerHTML = LIMIT_DEFS.map((d) => {
      const custom = isCustomLimit(r, d[2]) || (d[3] && isCustomLimit(r, d[3]));
      return `<li${custom ? ' class="custom"' : ''}>${esc(limitText(r, d))}${custom ? ' <strong>(เฉพาะคนนี้)</strong>' : ''}</li>`;
    }).join('');

    const meds = medications.filter((m) => sameId(m.residentId, r.id));
    const canMed = can('update', 'medications');
    $('#p-meds').innerHTML = meds.map((m) => `
      <tr><td><strong>${esc(m.name)}</strong></td><td>${esc(m.dose)}</td><td>${esc(m.how)}</td>
        <td>${isPRN(m) ? `เมื่อมีอาการ${m.prnNote ? `<br><small style="color: var(--muted)">${esc(m.prnNote)}</small>` : ''}` : m.rounds.map(roundName).join(', ')}</td>
        <td class="center">${canMed ? `<button type="button" class="link-btn" data-edit="med:${m.id}">แก้ไข</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">ยังไม่มีรายการยา</td></tr>';

    const notes = allNotes().filter((n) => sameId(n.residentId, r.id)).slice(0, 5);
    $('#p-notes').innerHTML = notes.map(noteHTML).join('') || '<p class="empty">ยังไม่มีบันทึก</p>';
  };

  $('#p-edit').addEventListener('click', () => residentForm(r, (res) => (res ? draw() : (location.href = 'index.html'))));
  $('#p-limits').addEventListener('click', () => limitsForm(r, draw));
  $('#p-add-med').addEventListener('click', () => medForm(null, { residentId: r.id }, draw));
  redraw = draw;
  draw();
}

// ---------- ตารางให้ยา ----------
function initMedication() {
  const dateInput = $('#mar-date');
  const params = new URLSearchParams(location.search);
  dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : todayISO();
  dateInput.max = todayISO();
  $('#add-med').hidden = !can('create', 'medications');
  const date = () => dateInput.value || todayISO();

  const draw = () => {
    const d = date(), today = todayISO();
    const isToday = d === today, future = d > today;
    $('#today').textContent = thaiDate(d);
    $('#mar-help').textContent = future ? 'ยังไม่ถึงวันนี้ บันทึกล่วงหน้าไม่ได้'
      : isToday ? 'กด 1 ครั้ง = ให้ยาแล้ว, กดอีกครั้ง = ไม่ได้ให้ (ใส่เหตุผล), กดอีกครั้ง = ล้าง'
        : 'วันที่ผ่านมาแล้ว: กดช่องเพื่อบันทึกย้อนหลัง พร้อมระบุเวลาที่ให้จริง';
    $('#mar-next').disabled = d >= today;
    $('#mar-today').hidden = isToday;
    history.replaceState(null, '', isToday ? location.pathname : `?date=${d}`);

    const canMed = can('update', 'medications');
    const rows = medications.filter((m) => getResident(m.residentId))
      .sort((a, b) => String(getResident(a.residentId).room).localeCompare(String(getResident(b.residentId).room), 'th', { numeric: true }));
    $('#mar-rows').innerHTML = rows.map((m) => {
      const r = getResident(m.residentId);
      let cells;
      if (isPRN(m)) {
        const given = prnEntries(m, d, d);
        cells = `<td colspan="4" class="prn-cell">
          <span class="prn-label">ให้เมื่อมีอาการ${m.prnNote ? `: ${esc(m.prnNote)}` : ''}</span>
          <div class="row" style="gap: 6px">
            ${given.map((x) => `<button type="button" class="prn-chip" data-prn="${esc(x.id)}" title="${esc(`${x.reason || ''} โดย ${x.by}`)}">✓ ${esc(x.time)} ${esc(x.reason || '')}</button>`).join('')}
            ${future ? '' : `<button type="button" class="btn btn-sm" data-prn-add="${m.id}">+ บันทึกการให้</button>`}
          </div></td>`;
      } else {
        cells = ROUNDS.map((round) => {
          if (!m.rounds.includes(round.key)) return '<td class="center" style="color: var(--line)">—</td>';
          const s = marGet(d, m, round.key);
          const cls = s ? (s.status === 'miss' ? 'miss' : 'done') : 'wait';
          const label = s ? (s.status === 'miss' ? 'ไม่ได้ให้' : `✓ ${s.time}`) : future ? '—' : isToday ? 'รอให้ยา' : 'ไม่มีบันทึก';
          const title = s ? `${s.status === 'miss' ? 'ไม่ได้ให้' : 'ให้แล้ว'} ${s.time} โดย ${s.by}${s.reason ? ` (${s.reason})` : ''}` : 'กดเมื่อให้ยาแล้ว';
          return `<td class="center" style="padding: 8px"><button type="button" class="mar-btn ${cls}" data-med="${m.id}" data-round="${round.key}" title="${esc(title)}"${future ? ' disabled' : ''}>${label}</button></td>`;
        }).join('');
      }
      return `<tr><td><a href="profile.html?id=${r.id}"><strong>${esc(r.name.split(' ')[0])}</strong></a> (${esc(r.room)})</td>
        <td><strong>${esc(m.name)}</strong> ${canMed ? `<button type="button" class="link-btn" data-edit="med:${m.id}">แก้ไข</button>` : ''}<br>
          <small style="color: var(--muted)">${esc(m.dose)} ${esc(m.how)}</small></td>${cells}</tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีรายการยา กด "+ เพิ่มยา" เพื่อเริ่ม</td></tr>';
  };

  $('#mar-rows').addEventListener('click', (e) => {
    const findMed = (id) => medications.find((m) => sameId(m.id, id));
    const add = e.target.closest('[data-prn-add]');
    if (add) return prnForm(findMed(add.dataset.prnAdd), date(), null, draw);
    const chip = e.target.closest('[data-prn]');
    if (chip) {
      const entry = marRows.find((x) => x.id === chip.dataset.prn);
      return prnForm(findMed(entry.medId), entry.date, entry, draw);
    }
    const btn = e.target.closest('.mar-btn');
    if (!btn || btn.disabled) return;
    const m = findMed(btn.dataset.med), key = btn.dataset.round, d = date();
    const s = marGet(d, m, key);
    // วันที่ผ่านมาแล้ว: เปิดฟอร์มเพื่อใส่เวลาที่ให้จริง
    if (d !== todayISO()) return marEntryForm(m, key, d, s, null, draw);
    // วันนี้: กด 1 = ให้แล้ว, กด 2 = ไม่ได้ให้ (ต้องใส่เหตุผล), กด 3 = ล้าง
    if (!s) {
      const row = { id: marRowId(d, m, key), date: d, medId: m.id, round: key, status: 'done', time: nowTime(), by: settings.user, reason: '' };
      marRows.push(row);
      put('mar', row);
    } else if (!can('update', 'mar', s)) {
      return toast('แก้ไขได้เฉพาะรายการที่คุณบันทึกเอง ถ้าต้องแก้ ให้พยาบาลหรือหัวหน้าแก้ให้', 4000);
    } else if (s.status === 'done') {
      return marEntryForm(m, key, d, s, 'miss', draw);
    } else {
      del('mar', s);
    }
    draw();
    $(`.mar-btn[data-med="${m.id}"][data-round="${key}"]`)?.focus();
  });

  const go = (n) => { dateInput.value = addDays(date(), n); draw(); };
  $('#mar-prev').addEventListener('click', () => go(-1));
  $('#mar-next').addEventListener('click', () => go(1));
  $('#mar-today').addEventListener('click', () => { dateInput.value = todayISO(); draw(); });
  dateInput.addEventListener('change', draw);
  $('#add-med').addEventListener('click', () => medForm(null, {}, draw));
  redraw = draw;
  draw();
}

// ---------- บันทึกการตรวจ + บันทึกพยาบาล ----------
function initRecord() {
  const select = $('#pt');
  if (!residents.length) {
    $('.content').innerHTML = '<p>ยังไม่มีผู้สูงอายุในระบบ <a href="index.html">ไปเพิ่มที่หน้าหลัก</a></p>';
    return;
  }
  select.innerHTML = sortedResidents().map((r) => `<option value="${r.id}">${esc(r.name)} — ห้อง ${esc(r.room)}</option>`).join('');
  select.value = residentIdFromURL();
  $('#v-time').value = nowTime();
  $('#n-time').value = nowTime();
  $('#add-order').hidden = !can('create', 'doctorOrders');
  const current = () => getResident(select.value);
  const dayInput = $('#vital-day');
  dayInput.max = todayISO();

  // วันเริ่มต้น: วันนี้ ถ้าวันนี้ยังไม่มีบันทึก ใช้วันล่าสุดที่มีบันทึก
  const defaultDay = (r) => {
    const today = todayISO();
    const dates = [...vitals, ...nurseNotes].filter((x) => sameId(x.residentId, r.id) && x.date <= today).map((x) => x.date).sort();
    return dates.includes(today) || !dates.length ? today : dates.pop();
  };
  const params = new URLSearchParams(location.search);
  dayInput.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : defaultDay(current());
  const day = () => dayInput.value || todayISO();

  const draw = () => {
    const r = current();
    if (!r) { location.href = 'record.html'; return; }
    const d = day(), today = todayISO();
    history.replaceState(null, '', `?id=${r.id}${d !== today ? `&date=${d}` : ''}`);
    $('#transfer-link').href = `report.html?type=transfer&id=${r.id}`;
    $('#pt-info').innerHTML = `
      <div><small>อายุ</small><strong>${esc(r.age)} ปี</strong></div>
      <div><small>อาหาร</small><strong>${esc(r.food || '—')}</strong></div>
      <div><small>แพ้ยา</small><strong class="${r.allergy ? 'abnormal' : ''}">${esc(r.allergy || 'ไม่มี')}</strong></div>`;

    const orders = doctorOrders.filter((o) => sameId(o.residentId, r.id));
    const canOrder = can('update', 'doctorOrders');
    $('#orders').innerHTML = orders.length
      ? orders.map((o) => canOrder
        ? `<button type="button" class="tag tag-btn" data-edit="order:${o.id}" title="กดเพื่อแก้ไขหรือยกเลิกคำสั่ง">${esc(o.text)}</button>`
        : `<span class="tag">${esc(o.text)}</span>`).join('')
      : '<span class="empty">ยังไม่มีคำสั่งแพทย์</span>';

    // วันที่เลือก
    $('#vital-date').textContent = thaiDate(d);
    $('#notes-date').textContent = thaiDate(d);
    $('#vd-next').disabled = d >= today;
    $('#vd-today').hidden = d === today;
    const future = d > today;
    $$('#vital-form input, #vital-form button, #note-form textarea, #note-form input, #note-form button').forEach((el) => (el.disabled = future));

    const custom = LIMIT_DEFS.filter((x) => isCustomLimit(r, x[2]) || (x[3] && isCustomLimit(r, x[3])));
    $('#limit-note').innerHTML = custom.length
      ? `เกณฑ์เฉพาะคนนี้: ${custom.map((x) => esc(limitText(r, x))).join(', ')}`
      : 'ใช้เกณฑ์ค่าผิดปกติมาตรฐาน';

    // วันที่มีบันทึกล่าสุด 7 วัน ให้กดไปดูได้เร็ว
    const days = [...new Set([...vitals, ...nurseNotes].filter((x) => sameId(x.residentId, r.id)).map((x) => x.date))].sort().reverse().slice(0, 7);
    $('#vital-days').innerHTML = days.length
      ? `<span class="page-sub" style="font-size: 14px">วันที่มีบันทึก:</span> ${days.map((x) => `<button type="button" class="chip chip-sm${x === d ? ' active' : ''}" data-day="${x}" aria-pressed="${x === d}">${relDate(x)}</button>`).join('')}`
      : '';

    const vs = vitals.filter((v) => sameId(v.residentId, r.id) && v.date === d).sort(byDateTime);
    $('#vital-rows').innerHTML = vs.map((v) => `<tr>
      <td><strong>${esc(v.time)}</strong></td>
      ${FIELDS.map((f) => `<td class="center ${isAbnormalV(v, f) ? 'abnormal' : ''}">${esc(v[f] || '—')}</td>`).join('')}
      <td>${esc(v.note)}</td>
      <td style="color: var(--muted); font-size: 14px">${esc(v.by)}${editedMark('vitals', v)}<br>
        ${can('update', 'vitals', v) ? `<button type="button" class="link-btn" data-edit="vital:${v.id}">แก้ไข</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="10" class="empty">ยังไม่มีบันทึกการตรวจในวันนี้</td></tr>`;

    const notes = allNotes().filter((n) => sameId(n.residentId, r.id));
    const dayNotes = notes.filter((n) => n.date === d);
    $('#notes').innerHTML = dayNotes.map(noteHTML).join('') || '<p class="empty">ยังไม่มีบันทึกในวันนี้</p>';

    // พลิกตัวครั้งถัดไป = บันทึก "พลิกตัว" ล่าสุด + 2 ชม.
    const lastTurn = notes.find((n) => n.type === 'พลิกตัว');
    if (lastTurn) {
      const next = new Date(`${lastTurn.date}T${lastTurn.time}`);
      next.setHours(next.getHours() + 2);
      const overdue = next < new Date();
      const nextIso = isoOf(next);
      $('#turn-next').textContent = (nextIso === todayISO() ? '' : relDate(nextIso) + ' ') + next.toTimeString().slice(0, 5);
      $('#turn-next').classList.toggle('abnormal', overdue);
      $('#turn-note').textContent = overdue
        ? `เลยเวลาแล้ว (พลิกล่าสุด ${relDate(lastTurn.date)} ${lastTurn.time}) พลิกตัวแล้วกด "พลิกตะแคงตัว" เพื่อบันทึก`
        : `จากบันทึกพลิกตัวล่าสุด ${lastTurn.time} น. + 2 ชม.`;
    } else {
      $('#turn-next').textContent = '—';
      $('#turn-next').classList.remove('abnormal');
      $('#turn-note').textContent = 'ยังไม่มีบันทึกพลิกตัว เมื่อบันทึก "พลิกตะแคงตัว" ระบบจะคำนวณให้';
    }

    $('#io-label').textContent = `สรุปขับถ่าย${d === today ? 'วันนี้' : ' ' + shortDate(d)}`;
    $('#io-urine').textContent = dayNotes.reduce((s, n) => s + (Number(n.urine) || 0), 0) + ' cc';
    $('#io-stool').textContent = dayNotes.reduce((s, n) => s + (Number(n.stool) || 0), 0) + ' ครั้ง';
  };

  select.addEventListener('change', () => { dayInput.value = defaultDay(current()); draw(); });
  const go = (n) => { dayInput.value = addDays(day(), n); draw(); };
  $('#vd-prev').addEventListener('click', () => go(-1));
  $('#vd-next').addEventListener('click', () => go(1));
  $('#vd-today').addEventListener('click', () => { dayInput.value = todayISO(); draw(); });
  dayInput.addEventListener('change', draw);
  $('#vital-days').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (b) { dayInput.value = b.dataset.day; draw(); }
  });

  $('#vital-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (![...FIELDS, 'note'].some((f) => String(fd.get(f) ?? '').trim())) {
      toast('กรอกค่าอย่างน้อย 1 ช่องก่อนกดเพิ่ม');
      return;
    }
    const row = { id: newId(), residentId: current().id, date: day(), time: fd.get('time'), by: settings.user, note: String(fd.get('note')).trim() };
    FIELDS.forEach((f) => (row[f] = String(fd.get(f) ?? '').trim()));
    vitals.unshift(row);
    put('vitals', row);
    e.target.reset();
    $('#v-time').value = nowTime();
    toast(abnormalFields(row).length ? `เพิ่มแล้ว — มีค่าผิดปกติ: ${abnormalText(row)}` : 'เพิ่มบันทึกการตรวจแล้ว', abnormalFields(row).length ? 5000 : 2500);
    draw();
  });

  let noteType = 'อาหาร NG';
  $$('[data-quick]').forEach((btn) => btn.addEventListener('click', () => {
    noteType = btn.dataset.quick;
    $$('[data-quick]').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn);
    });
    $('#n-text').value = QUICK_NOTES[noteType] || '';
    $('#n-text').focus();
  }));

  $('#note-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('text').trim()) { toast('พิมพ์ข้อความบันทึกก่อนกดบันทึก'); $('#n-text').focus(); return; }
    const note = {
      id: newId(), residentId: current().id, date: day(), time: fd.get('time') || nowTime(), type: noteType,
      text: fd.get('text').trim(), urine: fd.get('urine') || null, stool: fd.get('stool') || null, by: settings.user
    };
    nurseNotes.unshift(note);
    put('nurseNotes', note);
    e.target.reset();
    $('#n-text').value = '';
    $('#n-time').value = nowTime();
    toast('บันทึกแล้ว');
    draw();
  });

  $('#add-order').addEventListener('click', () => orderForm(null, current().id, draw));
  redraw = draw;
  draw();
}

// ---------- ประวัติการแก้ไข ----------
const TABLE_LABELS = {
  residents: 'ข้อมูลผู้สูงอายุ', medications: 'รายการยา', vitals: 'บันทึกการตรวจ', nurseNotes: 'บันทึกพยาบาล',
  doctorOrders: 'คำสั่งแพทย์', mar: 'การให้ยา', users: 'บัญชีผู้ใช้', settings: 'ตั้งค่าศูนย์', system: 'ระบบ'
};
const ACTION_LABELS = { create: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', import: 'นำเข้าข้อมูล' };
const FIELD_NAMES = {
  name: 'ชื่อ', age: 'อายุ', room: 'ห้อง', status: 'สถานะ', allergy: 'แพ้ยา', conditions: 'โรคประจำตัว', food: 'อาหาร', caution: 'ข้อควรระวัง',
  contact: 'ญาติ', phone: 'เบอร์โทร', apptDate: 'วันนัด', apptPlace: 'สถานที่นัด', idCard: 'เลขบัตรประชาชน', bloodType: 'หมู่เลือด',
  rights: 'สิทธิการรักษา', hospital: 'โรงพยาบาลประจำ', hn: 'HN', limits: 'เกณฑ์ค่าผิดปกติ', residentId: 'ผู้สูงอายุ',
  dose: 'ขนาด', how: 'วิธีใช้', rounds: 'รอบที่ให้', prn: 'ให้เมื่อมีอาการ', prnNote: 'ให้เมื่อ', date: 'วันที่', time: 'เวลา',
  note: 'อาการที่ตรวจพบ', by: 'ผู้บันทึก', type: 'ประเภท', text: 'ข้อความ', urine: 'ปัสสาวะ', stool: 'อุจจาระ', medId: 'ยา',
  round: 'รอบ', reason: 'เหตุผล', center: 'ชื่อศูนย์', address: 'ที่อยู่', role: 'บทบาท', active: 'ใช้งาน', username: 'ชื่อผู้ใช้',
  passwordReset: 'ตั้งรหัสผ่านใหม่', ...FIELD_LABELS
};

function showValue(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'residentId') return getResident(v)?.name || `#${v}`;
  if (k === 'medId') return medications.find((m) => sameId(m.id, v))?.name || `#${v}`;
  if (k === 'status' && STATUS[v]) return STATUS[v].label;
  if (k === 'status') return v === 'done' ? 'ให้แล้ว' : v === 'miss' ? 'ไม่ได้ให้' : v;
  if (k === 'role') return ROLE_LABELS[v] || v;
  if (k === 'round') return roundName(v);
  if (k === 'rounds' && Array.isArray(v)) return v.map(roundName).join(', ') || '—';
  if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return Object.entries(v).map(([a, b]) => `${a}: ${b}`).join(', ') || '—';
  return String(v);
}

function describeRecord(tbl, row) {
  if (!row) return '';
  const who = row.residentId != null ? (getResident(row.residentId)?.name || 'ผู้สูงอายุที่ถูกลบ') : '';
  if (tbl === 'residents') return row.name;
  if (tbl === 'medications') return `${row.name} — ${who}`;
  if (tbl === 'vitals') return `${who} ${shortDate(row.date)} ${row.time}`;
  if (tbl === 'nurseNotes') return `${who} ${shortDate(row.date)} ${row.time} ${row.type}`;
  if (tbl === 'doctorOrders') return `${who}: ${row.text}`;
  if (tbl === 'mar') {
    const m = medications.find((x) => sameId(x.id, row.medId));
    return `${m ? `${m.name} — ${getResident(m.residentId)?.name || ''}` : 'ยาที่ถูกลบ'} ${shortDate(row.date)} ${roundName(row.round)}`;
  }
  if (tbl === 'users') return `${row.name} (${row.username})`;
  if (tbl === 'system') return `${row.rows} รายการ`;
  return '';
}

function changeList(item) {
  const { before, after, action } = item;
  if (action === 'import') return '';
  if (action === 'create' || action === 'delete') {
    const row = after || before || {};
    const keys = Object.keys(row).filter((k) => !['id', 'residentId', 'by', 'medId', 'round'].includes(k) && row[k] !== '' && row[k] != null).slice(0, 8);
    return `<dl class="changes">${keys.map((k) => `<dt>${esc(FIELD_NAMES[k] || k)}</dt><dd>${esc(showValue(k, row[k]))}</dd>`).join('')}</dl>`;
  }
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((k) => JSON.stringify(before?.[k] ?? '') !== JSON.stringify(after?.[k] ?? ''));
  if (!keys.length) return '<span class="empty">ไม่มีการเปลี่ยนแปลง</span>';
  return `<dl class="changes">${keys.map((k) => `<dt>${esc(FIELD_NAMES[k] || k)}</dt>
    <dd><del>${esc(showValue(k, before?.[k]))}</del> → <ins>${esc(showValue(k, after?.[k]))}</ins></dd>`).join('')}</dl>`;
}

function initHistory() {
  const params = new URLSearchParams(location.search);
  const one = params.get('tbl') && params.get('id') ? { tbl: params.get('tbl'), id: params.get('id') } : null;
  const tblSel = $('#h-tbl'), userSel = $('#h-user'), fromIn = $('#h-from'), toIn = $('#h-to');
  tblSel.innerHTML = '<option value="">ทุกประเภท</option>' + Object.entries(TABLE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  if (one) {
    tblSel.value = one.tbl;
    $('#h-filters').hidden = true;
    $('#h-one').hidden = false;
    $('#h-one-text').textContent = TABLE_LABELS[one.tbl] || one.tbl;
  }
  let items = [], loadedPeople = false, done = false;

  const row = (x) => `<tr>
    <td style="white-space: nowrap">${esc(fmtStamp(x.at))}</td>
    <td>${esc(x.name)}</td>
    <td><span class="act act-${x.action}">${ACTION_LABELS[x.action] || x.action}</span></td>
    <td>${esc(TABLE_LABELS[x.tbl] || x.tbl)}<br><small style="color: var(--muted)">${esc(describeRecord(x.tbl, x.after || x.before))}</small>
      ${!one && TABLES[x.tbl] ? `<br><a class="link-btn" href="history.html?tbl=${x.tbl}&id=${encodeURIComponent(x.id)}">ประวัติทั้งหมดของรายการนี้</a>` : ''}</td>
    <td>${changeList(x)}</td></tr>`;

  const load = async (more) => {
    const q = new URLSearchParams({ limit: 100 });
    if (one) { q.set('tbl', one.tbl); q.set('id', one.id); }
    else {
      if (tblSel.value) q.set('tbl', tblSel.value);
      if (userSel.value) q.set('username', userSel.value);
      if (fromIn.value) q.set('from', new Date(fromIn.value + 'T00:00:00').getTime());
      if (toIn.value) q.set('to', new Date(addDays(toIn.value, 1) + 'T00:00:00').getTime());
    }
    if (more && items.length) q.set('before', items[items.length - 1].seq);
    try {
      const res = await api('GET', '/api/history?' + q);
      items = more ? [...items, ...res.items] : res.items;
      done = res.items.length < 100;
      if (!loadedPeople) {
        userSel.innerHTML = '<option value="">ทุกคน</option>' + res.people.map((p) => `<option value="${esc(p.username)}">${esc(p.name)}</option>`).join('');
        loadedPeople = true;
      }
      draw();
    } catch (e) {
      $('#h-rows').innerHTML = `<tr><td colspan="5" class="empty">โหลดประวัติไม่ได้: ${esc(e.message)}</td></tr>`;
    }
  };
  const draw = () => {
    $('#h-rows').innerHTML = items.map(row).join('') || '<tr><td colspan="5" class="empty">ไม่มีประวัติตามที่เลือก</td></tr>';
    $('#h-more').hidden = done;
  };
  [tblSel, userSel, fromIn, toIn].forEach((el) => el.addEventListener('change', () => load(false)));
  $('#h-more').addEventListener('click', () => load(true));
  redraw = draw;
  load(false);
}

// ---------- จัดการผู้ใช้ (หัวหน้า / ผู้ดูแลระบบ) ----------
function initUsers() {
  if (currentUser.role !== 'admin') {
    $('.content').innerHTML = '<p>หน้านี้สำหรับหัวหน้า / ผู้ดูแลระบบเท่านั้น <a href="index.html">กลับหน้าหลัก</a></p>';
    return;
  }
  let users = [];
  const roleOptions = Object.entries(ROLE_LABELS);
  const load = async () => {
    users = (await api('GET', '/api/users')).users;
    draw();
  };
  const draw = () => {
    $('#u-rows').innerHTML = users.map((u) => `<tr class="${u.active ? '' : 'inactive'}">
      <td><strong>${esc(u.name)}</strong>${u.username === currentUser.username ? ' <small>(คุณ)</small>' : ''}</td>
      <td>${esc(u.username)}</td><td>${ROLE_LABELS[u.role]}</td>
      <td>${u.active ? 'ใช้งานได้' : '<span class="abnormal">ระงับแล้ว</span>'}</td>
      <td class="center"><button type="button" class="link-btn" data-user="${esc(u.username)}">แก้ไข</button></td></tr>`).join('');
  };
  const userForm = (u) => openForm({
    title: u ? `แก้ไขผู้ใช้ — ${u.name}` : 'เพิ่มผู้ใช้',
    intro: u ? 'ถ้าไม่ต้องการเปลี่ยนรหัสผ่าน ให้เว้นช่องรหัสผ่านไว้' : 'ส่งชื่อผู้ใช้และรหัสผ่านให้เจ้าของบัญชี แล้วให้เปลี่ยนรหัสผ่านเองหลังเข้าสู่ระบบ',
    fields: [
      { name: 'name', label: 'ชื่อที่แสดงในบันทึก', required: true, placeholder: 'เช่น พยาบาลสมใจ', wide: true },
      { name: 'username', label: 'ชื่อผู้ใช้ (ภาษาอังกฤษ)', required: !u, readonly: !!u, placeholder: 'เช่น somjai', autocomplete: 'off' },
      { name: 'role', label: 'บทบาท', type: 'select', options: roleOptions },
      { name: 'password', label: u ? 'ตั้งรหัสผ่านใหม่' : 'รหัสผ่าน (อย่างน้อย 8 ตัว)', type: 'password', required: !u, autocomplete: 'new-password' },
      ...(u ? [{ name: 'active', label: 'สถานะบัญชี', type: 'select', options: [['1', 'ใช้งานได้'], ['0', 'ระงับ (เข้าสู่ระบบไม่ได้)']] }] : [])
    ],
    values: u ? { ...u, active: u.active ? '1' : '0' } : { role: 'nurse' },
    submitLabel: u ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ใช้',
    async onSave(d) {
      if (d.password && d.password.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
      if (u) await api('PUT', `/api/users/${encodeURIComponent(u.username)}`, { name: d.name, role: d.role, active: d.active === '1', password: d.password || undefined });
      else await api('POST', '/api/users', d);
      await load();
    }
  });
  $('#u-add').addEventListener('click', () => userForm(null));
  $('#u-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-user]');
    if (b) userForm(users.find((u) => u.username === b.dataset.user));
  });
  $('#role-help').innerHTML = `
    <li><strong>${ROLE_LABELS.admin}</strong> ทำได้ทุกอย่าง รวมถึงลบผู้สูงอายุ จัดการผู้ใช้ ตั้งค่าศูนย์ และดาวน์โหลดสำรองข้อมูล</li>
    <li><strong>${ROLE_LABELS.nurse}</strong> เพิ่ม/แก้ข้อมูลผู้สูงอายุ ยา คำสั่งแพทย์ และแก้บันทึกของทุกคนได้</li>
    <li><strong>${ROLE_LABELS.aide}</strong> บันทึกสัญญาณชีพ บันทึกพยาบาล และการให้ยาได้ แก้/ลบได้เฉพาะที่ตัวเองบันทึก</li>`;
  redraw = draw;
  load().catch((e) => toast(e.message, 5000));
}

// ---------- หน้าเข้าสู่ระบบ ----------
async function initLogin() {
  const next = new URLSearchParams(location.search).get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : 'index.html';
  const error = $('#login-error');
  const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };
  let status;
  try {
    status = await api('GET', '/api/status');
  } catch {
    $('#login-card').innerHTML = `<h1 class="card-title">เปิดระบบไม่ได้</h1>${serverHelp()}`;
    return;
  }
  if (status.center) $('#login-center').textContent = status.center;
  try { await api('GET', '/api/me'); location.replace(target); return; } catch { /* ยังไม่ได้เข้าสู่ระบบ */ }

  const setup = status.setup;
  $('#setup-fields').hidden = !setup;
  $('#confirm-wrap').hidden = !setup;
  $('#login-title').textContent = setup ? 'ตั้งค่าครั้งแรก: สร้างบัญชีหัวหน้า / ผู้ดูแลระบบ' : 'เข้าสู่ระบบ';
  $('#login-submit').textContent = setup ? 'สร้างบัญชีและเข้าสู่ระบบ' : 'เข้าสู่ระบบ';
  $('#password').autocomplete = setup ? 'new-password' : 'current-password';
  $('#l-name').required = setup;
  $('#l-confirm').required = setup;

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    showError('');
    if (setup) {
      if (f.password.value.length < 8) return showError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
      if (f.password.value !== f.confirm.value) return showError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    }
    const btn = $('#login-submit');
    btn.disabled = true;
    try {
      await api('POST', setup ? '/api/setup' : '/api/login', { username: f.username.value, password: f.password.value, name: f.name.value });
      location.replace(target);
    } catch (ex) {
      showError(ex.message);
      btn.disabled = false;
    }
  });
  $('#username').focus();
}

const serverHelp = () => `<p>หน้าเว็บต้องเปิดผ่านเซิร์ฟเวอร์ของระบบ</p>
  <ol class="event-list">
    <li>เปิด Terminal ในโฟลเดอร์ของระบบ แล้วพิมพ์ <code>python3 server.py</code></li>
    <li>เปิดเบราว์เซอร์ที่ <a href="http://localhost:8000">http://localhost:8000</a></li>
  </ol>
  <p class="page-sub">ถ้าเปิดเซิร์ฟเวอร์อยู่แล้ว ให้ตรวจว่าเครื่องนี้ต่อ Wi-Fi เดียวกับเครื่องที่รันเซิร์ฟเวอร์</p>`;

// ---------- เริ่มใช้งานครั้งแรก: ย้ายข้อมูลเข้าเซิร์ฟเวอร์ ----------
// อ่านข้อมูลที่เคยกรอกไว้ในเบราว์เซอร์นี้ (เวอร์ชันก่อนที่ยังไม่มีเซิร์ฟเวอร์)
function oldBrowserData() {
  const tables = {};
  ['residents', 'medications', 'vitals', 'nurseNotes', 'doctorOrders'].forEach((t) => {
    const rows = store.get('db-' + t);
    if (Array.isArray(rows)) tables[t] = rows;
  });
  if (!tables.residents) return null;
  const mar = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const m = /^mar-(\d{4}-\d{2}-\d{2})$/.exec(key || '');
    if (!m) continue;
    Object.entries(store.get(key, {})).forEach(([cell, e]) => {
      const cut = cell.lastIndexOf('-');
      const medId = Number(cell.slice(0, cut)), round = cell.slice(cut + 1);
      mar.push({ id: `${m[1]}|${medId}|${round}`, date: m[1], medId, round, status: e.status, time: e.time, by: e.by || '', reason: '' });
    });
  }
  tables.mar = mar;
  const kvOut = {};
  const s = store.get('settings', null);
  if (s) kvOut.settings = { center: s.center, address: s.address };
  Object.entries(store.get('report-comments', {})).forEach(([k, v]) => (kvOut['comment:' + k] = v));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('transfer-draft-')) kvOut[key] = store.get(key);
  }
  return { tables, kv: kvOut };
}

function sampleData() {
  const tables = JSON.parse(JSON.stringify(SEED));
  Object.values(tables).forEach((rows) => rows.forEach((row, i) => { if (row.id == null) row.id = i + 1; }));
  return { tables: { ...tables, mar: [] }, kv: {} };
}

function setupDataForm() {
  const old = oldBrowserData();
  openForm({
    title: 'เริ่มใช้งานระบบ',
    intro: 'ระบบยังไม่มีข้อมูล เลือกว่าจะเริ่มอย่างไร (เลือกได้ครั้งเดียว)',
    fields: [{
      name: 'source', label: 'เริ่มจาก', type: 'select', wide: true,
      options: [
        ...(old ? [['browser', `ข้อมูลที่เคยกรอกในเบราว์เซอร์นี้ (${old.tables.residents.length} คน)`]] : []),
        ['empty', 'เริ่มว่าง (ใช้งานจริง)'],
        ['sample', 'ข้อมูลตัวอย่าง (ชื่อสมมติ สำหรับทดลอง)']
      ]
    }],
    submitLabel: 'เริ่มใช้งาน',
    savedMsg: 'พร้อมใช้งานแล้ว',
    async onSave(d) {
      const payload = d.source === 'browser' ? old : d.source === 'sample' ? sampleData() : { tables: {}, kv: {} };
      await api('POST', '/api/import', { ...payload, source: d.source });
      if (d.source === 'browser') store.set('moved-to-server', true);
      location.reload();
    }
  });
  $('[data-act="cancel"]').hidden = true;
}

// ---------- เริ่มทำงาน ----------
async function boot() {
  const page = document.body.dataset.page;
  if (page === 'login') return initLogin();

  let all;
  try {
    all = await api('GET', '/api/all');
  } catch (e) {
    if (e.status === 401) return; // กำลังพาไปหน้าเข้าสู่ระบบ
    fatal(e.status === 0 ? serverHelp() : `<p>${esc(e.message)}</p>`);
    return;
  }
  applyAll(all);
  renderSidebar(page);
  updateBanner();

  if (!all.initialized) {
    if (currentUser.role === 'admin') setupDataForm();
    else fatal('<p>ระบบยังไม่ได้เริ่มใช้งาน ให้หัวหน้า / ผู้ดูแลระบบเข้าสู่ระบบก่อน</p>');
    return;
  }

  const init = { home: initHome, profile: initProfile, medication: initMedication, record: initRecord, report: initReport, history: initHistory, users: initUsers }[page];
  if (init) init();
  flush();
  setInterval(poll, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}

document.addEventListener('DOMContentLoaded', boot);
