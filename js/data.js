// ข้อมูลตัวอย่าง (ชื่อสมมติทั้งหมด) และค่าคงที่ของระบบ
// ข้อมูลตัวอย่างใช้เฉพาะตอนเริ่มระบบครั้งแรก ถ้าเลือก "ข้อมูลตัวอย่าง" ข้อมูลจริงเก็บที่เซิร์ฟเวอร์

const residents = [
  { id: 1, name: 'นางสมศรี ใจดี', age: 82, room: '101', conditions: ['เบาหวานชนิดที่ 2', 'ความดันโลหิตสูง'], allergy: 'Penicillin', last: 'วันนี้ 07:30', status: 'warn',
    food: 'อาหารลดหวาน', caution: 'เสี่ยงหกล้มเวลาลุกจากเตียง ให้ลุกนั่งก่อน 1 นาที', contact: 'คุณวิไล ใจดี (ลูกสาว)', phone: '081-234-5678',
    apptDate: '2026-11-10', apptPlace: 'รพ.[ชื่อโรงพยาบาล] คลินิกเบาหวาน 09:00',
    idCard: '3-1001-00123-45-6', bloodType: 'B', rights: 'บัตรทอง (UC)', hospital: 'รพ.[ชื่อโรงพยาบาล]', hn: '65-001234' },
  { id: 2, name: 'นายบุญมี รักษ์ถิ่น', age: 78, room: '102', conditions: ['ความดันโลหิตสูง'], allergy: '', last: 'วันนี้ 07:45', status: 'ok' },
  { id: 3, name: 'นางมาลี ศรีสุข', age: 90, room: '103', conditions: ['อัลไซเมอร์'], allergy: 'Aspirin', last: 'วันนี้ 06:50', status: 'bed' },
  { id: 4, name: 'นายประยูร ทองดี', age: 75, room: '104', conditions: ['ไตเรื้อรัง'], allergy: '', last: 'เมื่อวาน 20:10', status: 'warn' },
  { id: 5, name: 'นางละเอียด มีสุข', age: 86, room: '105', conditions: ['ข้อเข่าเสื่อม'], allergy: 'Sulfa', last: 'วันนี้ 08:05', status: 'ok' },
  { id: 6, name: 'นายสมชาย ยิ้มแย้ม', age: 80, room: '106', conditions: ['หลอดเลือดสมอง', 'แผลกดทับ'], allergy: '', last: 'วันนี้ 09:00', status: 'bed', food: 'Gen DM ทาง NG',
    caution: 'พลิกตัวทุก 2 ชม. ระวังแผลกดทับก้นกบ', contact: 'คุณสมหญิง ยิ้มแย้ม (ภรรยา)', phone: '089-876-5432',
    idCard: '3-1002-00456-78-9', bloodType: 'O', rights: 'ข้าราชการ', hospital: 'รพ.[ชื่อโรงพยาบาล]', hn: '66-004567' }
];

const STATUS = {
  ok:   { label: 'ปกติ', cls: 'ok' },
  warn: { label: 'เฝ้าระวัง', cls: 'warn' },
  bed:  { label: 'ติดเตียง', cls: 'bed' }
};

// รายการยาประจำ (ใช้ในหน้าประวัติและตารางให้ยา)
const medications = [
  { residentId: 1, name: 'Metformin 500 mg', dose: '1 เม็ด', how: 'หลังอาหาร', rounds: ['morning', 'evening'] },
  { residentId: 1, name: 'Amlodipine 5 mg', dose: '1 เม็ด', how: 'หลังอาหาร', rounds: ['morning'] },
  { residentId: 1, name: 'Simvastatin 20 mg', dose: '1 เม็ด', how: 'ก่อนนอน', rounds: ['bedtime'] },
  { residentId: 2, name: 'Losartan 50 mg', dose: '1 เม็ด', how: 'หลังอาหาร', rounds: ['morning', 'evening'] },
  { residentId: 3, name: 'Donepezil 5 mg', dose: '1 เม็ด', how: 'ก่อนนอน', rounds: ['bedtime'] },
  { residentId: 4, name: 'Calcium carbonate', dose: '1 เม็ด', how: 'พร้อมอาหาร', rounds: ['morning', 'noon', 'evening'] },
  { residentId: 5, name: 'Paracetamol 500 mg', dose: '1 เม็ด', how: 'เมื่อปวด', rounds: [], prn: true, prnNote: 'ปวดเข่า ห่างกันอย่างน้อย 6 ชม. ไม่เกิน 4 ครั้ง/วัน' }
];

const ROUNDS = [
  { key: 'morning', label: 'เช้า 08:00' },
  { key: 'noon',    label: 'กลางวัน 12:00' },
  { key: 'evening', label: 'เย็น 17:00' },
  { key: 'bedtime', label: 'ก่อนนอน 20:00' }
];

// บันทึกการตรวจ (สัญญาณชีพ) — ตามกระดาษ "บันทึกการตรวจ"
const vitals = [
  { residentId: 6, date: '2026-11-06', time: '06:40', t: '', p: '52', r: '', bp: '', u: '', o2: '77', sugar: '', note: 'O₂ ต่ำ → On mask 5 L', by: 'พยาบาล A' },
  { residentId: 6, date: '2026-11-06', time: '06:50', t: '', p: '82', r: '', bp: '', u: '', o2: '90', sugar: '', note: '', by: 'พยาบาล A' },
  { residentId: 6, date: '2026-11-06', time: '07:15', t: '', p: '', r: '', bp: '', u: '', o2: '94-98', sugar: '', note: 'O₂ cannula 3 L', by: 'พยาบาล A' },
  { residentId: 6, date: '2026-11-06', time: '09:00', t: '36.6', p: '84', r: '20', bp: '97/59', u: '', o2: '95-96', sugar: '', note: 'Off O₂ 30 นาที O₂ ดี', by: 'พยาบาล B' }
];

// บันทึกทางการพยาบาล / เหตุการณ์ — ตามกระดาษใบที่ 2
const nurseNotes = [
  { residentId: 6, date: '2026-11-06', time: '09:00', type: 'ออกซิเจน', text: 'Off O₂ 3 L ประมาณ 30 นาที O₂ ดี เสมหะในลำคอน้อยลง', urine: null, stool: null, by: 'พยาบาล B' },
  { residentId: 6, date: '2026-11-06', time: '08:00', type: 'อาหาร NG', text: 'Feed Gen DM 300 cc น้ำตาม 50 cc\nปรับ O₂ cannula 5 L → 3 L', urine: null, stool: null, by: 'พยาบาล B' },
  { residentId: 6, date: '2026-11-06', time: '07:05', type: 'Suction', text: 'Suction เสมหะสีเหลือง หลัง suction O₂ ขึ้น 93–95%', urine: 100, stool: 1, by: 'พยาบาล A' },
  { residentId: 6, date: '2026-11-05', time: '16:00', type: 'อาหาร NG', text: 'Feed Gen DM 300 cc น้ำตาม 50 cc ไม่พบปัญหา', urine: 200, stool: null, by: 'พยาบาล C' },
  { residentId: 6, date: '2026-11-05', time: '11:00', type: 'แพทย์สั่ง', text: 'แรกรับ รู้สึกตัวดี มีแผลกดทับก้นกบ ~10 × 10 ซม.\nแพทย์สั่ง: D/S OD · Feed Gen DM 300 cc × 4 มื้อ · On O₂ 3–5 L เวลาเหนื่อย', urine: null, stool: null, by: 'พยาบาล C' }
];

const doctorOrders = [
  { residentId: 6, text: 'ทำแผลกดทับ วันละครั้ง (D/S OD)' },
  { residentId: 6, text: 'Feed Gen DM 300 cc × 4 มื้อ · น้ำตาม 50 cc' },
  { residentId: 6, text: 'On O₂ cannula 3–5 L เวลาเหนื่อย' },
  { residentId: 6, text: 'พลิกตะแคงตัวทุก 2 ชม.' }
];

const QUICK_NOTES = {
  'อาหาร NG': 'Feed Gen DM 300 cc น้ำตาม 50 cc ไม่พบปัญหาในการให้อาหารทาง NG',
  'Suction': 'Suction เสมหะสี... หลัง suction O₂ ...%',
  'ออกซิเจน': 'On O₂ cannula ... L',
  'พลิกตัว': 'พลิกตะแคงตัว ...',
  'ทำแผล': 'ทำแผลกดทับ แผลลักษณะ ...',
  'ขับถ่าย': 'ขับถ่าย ...',
  'แพทย์สั่ง': 'แพทย์สั่ง: ...',
  'เหตุการณ์ผิดปกติ': 'เหตุการณ์: ... อาการ ... แจ้ง ... แล้ว',
  'ส่งโรงพยาบาล': 'ส่งตัวไป รพ. ... ด้วยอาการ ... นำส่งโดย ...'
};
