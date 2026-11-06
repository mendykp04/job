#!/usr/bin/env python3
"""เซิร์ฟเวอร์ระบบบันทึกผู้สูงอายุ

ใช้ Python อย่างเดียว ไม่ต้องติดตั้งอะไรเพิ่ม
วิธีรัน:   python3 server.py
แล้วเปิด   http://localhost:8000  (เครื่องอื่นใน Wi-Fi เดียวกันใช้ที่อยู่ที่แสดงตอนเปิดเซิร์ฟเวอร์)

ข้อมูลเก็บที่ data/care.db และสำรองอัตโนมัติวันละครั้งที่ data/backups/
"""
import hashlib
import json
import os
import secrets
import socket
import sqlite3
import sys
import threading
import time
from datetime import datetime
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.abspath(os.environ.get('CARE_DB', os.path.join(ROOT, 'data', 'care.db')))
DATA_DIR = os.path.dirname(DB_PATH)
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
PROTECTED_DIR = os.path.join(ROOT, 'data')  # ห้ามเปิดไฟล์ในโฟลเดอร์นี้ผ่านเว็บ
PORT = int(os.environ.get('PORT', '8000'))
SESSION_HOURS = 12
KEEP_BACKUPS = 30

TABLES = {'residents', 'medications', 'vitals', 'nurseNotes', 'doctorOrders', 'mar'}
ROLES = {'admin', 'nurse', 'aide'}
STATIC_TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}
write_lock = threading.Lock()
login_failures = {}  # ip -> [เวลาที่ล็อกอินผิด]

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
  salt TEXT NOT NULL, hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL,
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_name TEXT NOT NULL,
  PRIMARY KEY (tbl, id));
CREATE INDEX IF NOT EXISTS records_rev ON records(rev);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS kv_rev ON kv(rev);
CREATE TABLE IF NOT EXISTS history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, username TEXT NOT NULL, name TEXT NOT NULL,
  tbl TEXT NOT NULL, id TEXT NOT NULL, action TEXT NOT NULL, before TEXT, after TEXT);
CREATE INDEX IF NOT EXISTS history_rec ON history(tbl, id);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
"""


def now_ms():
    return int(time.time() * 1000)


def connect():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    return con


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)
        con.execute("INSERT OR IGNORE INTO meta (k, v) VALUES ('rev', 0)")


def next_rev(con):
    con.execute("UPDATE meta SET v = v + 1 WHERE k = 'rev'")
    return con.execute("SELECT v FROM meta WHERE k = 'rev'").fetchone()[0]


def current_rev(con):
    return con.execute("SELECT v FROM meta WHERE k = 'rev'").fetchone()[0]


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000).hex()
    return salt, digest


def check_password(password, salt, digest):
    return secrets.compare_digest(hash_password(password, salt)[1], digest)


def public_user(row):
    return {'username': row['username'], 'name': row['name'], 'role': row['role'], 'active': bool(row['active'])}


def record_out(row):
    data = json.loads(row['data'])
    data.update({
        '_createdAt': row['created_at'], '_createdBy': row['created_name'], '_createdUser': row['created_by'],
        '_updatedAt': row['updated_at'], '_updatedBy': row['updated_name'],
    })
    return data


def clean(row):
    """ตัดช่องข้อมูลระบบ (ขึ้นต้นด้วย _) ออก ไม่ให้ผู้ใช้ส่งมาเขียนทับ"""
    return {k: v for k, v in row.items() if not k.startswith('_')}


# ----- สิทธิ์การใช้งาน -----
# admin = หัวหน้า/ผู้ดูแลระบบ, nurse = พยาบาล, aide = ผู้ช่วยดูแล
def can_write(user, tbl, action, existing):
    role = user['role']
    if role == 'admin':
        return True
    if tbl == 'residents':
        return role == 'nurse' and action != 'delete'
    if tbl in ('medications', 'doctorOrders'):
        return role == 'nurse'
    # vitals, nurseNotes, mar: ทุกคนบันทึกได้ ผู้ช่วยแก้/ลบได้เฉพาะของตัวเอง
    if role == 'nurse' or existing is None:
        return True
    return existing['created_by'] == user['username']


def backup_now():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    target = os.path.join(BACKUP_DIR, f'care-{datetime.now():%Y-%m-%d}.db')
    if os.path.exists(target):
        return
    src = connect()
    dst = sqlite3.connect(target)
    with dst:
        src.backup(dst)
    dst.close()
    src.close()
    files = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith('care-') and f.endswith('.db'))
    for old in files[:-KEEP_BACKUPS]:
        os.remove(os.path.join(BACKUP_DIR, old))


def backup_loop():
    while True:
        try:
            backup_now()
        except Exception as e:  # สำรองไม่สำเร็จไม่ควรทำให้เซิร์ฟเวอร์หยุด
            print('สำรองข้อมูลไม่สำเร็จ:', e, file=sys.stderr)
        time.sleep(3600)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class Handler(BaseHTTPRequestHandler):
    server_version = 'CareServer/1.0'

    # ---------- พื้นฐาน ----------
    def log_message(self, fmt, *args):
        if '/api/changes' not in self.path:  # ไม่ต้องพิมพ์การเช็กข้อมูลใหม่ทุก 15 วินาที
            sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))

    def send_json(self, status, body, extra_headers=None):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.security_headers()
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def security_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > 20 * 1024 * 1024:
            raise ApiError(413, 'ข้อมูลใหญ่เกินไป')
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            raise ApiError(400, 'รูปแบบข้อมูลไม่ถูกต้อง')

    def session_token(self):
        jar = cookies.SimpleCookie(self.headers.get('Cookie', ''))
        return jar['sid'].value if 'sid' in jar else None

    def current_user(self, con):
        token = self.session_token()
        if not token:
            return None
        row = con.execute(
            'SELECT u.* FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND s.expires > ? AND u.active = 1',
            (token, now_ms())).fetchone()
        if row:  # ต่ออายุการเข้าสู่ระบบเมื่อมีการใช้งาน
            con.execute('UPDATE sessions SET expires = ? WHERE token = ?', (now_ms() + SESSION_HOURS * 3600_000, token))
        return row

    def require_user(self, con, admin=False):
        user = self.current_user(con)
        if not user:
            raise ApiError(401, 'กรุณาเข้าสู่ระบบ')
        if admin and user['role'] != 'admin':
            raise ApiError(403, 'เฉพาะหัวหน้า / ผู้ดูแลระบบเท่านั้น')
        return user

    def session_cookie(self, token, max_age):
        secure = '; Secure' if self.headers.get('X-Forwarded-Proto') == 'https' else ''
        return f'sid={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}'

    # ---------- เส้นทาง ----------
    def do_GET(self):
        if self.path.startswith('/api/'):
            return self.handle_api('GET')
        self.serve_static()

    def do_POST(self):
        self.handle_api('POST')

    def do_PUT(self):
        self.handle_api('PUT')

    def do_DELETE(self):
        self.handle_api('DELETE')

    def handle_api(self, method):
        url = urlparse(self.path)
        parts = [unquote(p) for p in url.path.split('/')[2:] if p]
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        # กันการส่งคำสั่งจากเว็บอื่น (CSRF): ทุกคำสั่งที่เขียนข้อมูลต้องมี header นี้
        if method != 'GET' and self.headers.get('X-Requested-With') != 'care':
            return self.send_json(403, {'error': 'คำขอไม่ถูกต้อง'})
        try:
            with write_lock if method != 'GET' else _nolock:
                con = connect()
                try:
                    with con:
                        result = self.route(con, method, parts, query)
                finally:
                    con.close()
            if isinstance(result, tuple):
                status, body, headers = result
                return self.send_json(status, body, headers)
            self.send_json(200, result)
        except ApiError as e:
            self.send_json(e.status, {'error': e.message})
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json(500, {'error': f'เซิร์ฟเวอร์ผิดพลาด: {e}'})

    def route(self, con, method, parts, query):
        head = parts[0] if parts else ''
        key = (method, head)

        if key == ('GET', 'status'):
            has_users = con.execute('SELECT 1 FROM users LIMIT 1').fetchone() is not None
            settings = con.execute("SELECT value FROM kv WHERE key = 'settings'").fetchone()
            center = json.loads(settings['value']).get('center') if settings else None
            return {'setup': not has_users, 'center': center}

        if key == ('POST', 'setup'):
            if con.execute('SELECT 1 FROM users LIMIT 1').fetchone():
                raise ApiError(400, 'ตั้งค่าครั้งแรกไปแล้ว')
            body = self.read_json()
            user = self.create_user(con, body, role='admin')
            return self.start_session(con, user)

        if key == ('POST', 'login'):
            return self.login(con)

        if key == ('POST', 'logout'):
            token = self.session_token()
            if token:
                con.execute('DELETE FROM sessions WHERE token = ?', (token,))
            return 200, {'ok': True}, {'Set-Cookie': self.session_cookie('', 0)}

        user = self.require_user(con)

        if key == ('GET', 'me'):
            return {'user': public_user(user)}

        if key == ('GET', 'all'):
            tables = {t: [] for t in TABLES}
            for row in con.execute('SELECT * FROM records WHERE deleted = 0'):
                if row['tbl'] in tables:
                    tables[row['tbl']].append(record_out(row))
            kv = {r['key']: json.loads(r['value']) for r in con.execute('SELECT key, value FROM kv')}
            return {'user': public_user(user), 'rev': current_rev(con), 'tables': tables, 'kv': kv,
                    'initialized': bool(kv.get('initialized'))}

        if key == ('GET', 'changes'):
            since = int(query.get('since') or 0)
            rows = [{'tbl': r['tbl'], 'id': r['id'], 'deleted': bool(r['deleted']), 'row': None if r['deleted'] else record_out(r)}
                    for r in con.execute('SELECT * FROM records WHERE rev > ? ORDER BY rev', (since,))]
            kv = {r['key']: json.loads(r['value']) for r in con.execute('SELECT key, value FROM kv WHERE rev > ?', (since,))}
            return {'rev': current_rev(con), 'rows': rows, 'kv': kv}

        if head == 'rows' and len(parts) >= 2:
            tbl = parts[1]
            if tbl not in TABLES:
                raise ApiError(404, 'ไม่พบประเภทข้อมูลนี้')
            if method == 'POST':
                return self.upsert(con, user, tbl, self.read_json().get('row') or {})
            if method == 'DELETE' and len(parts) == 3:
                return self.delete(con, user, tbl, parts[2])

        if head == 'kv' and len(parts) == 2 and method == 'PUT':
            k = parts[1]
            if k in ('settings', 'initialized') and user['role'] != 'admin':
                raise ApiError(403, 'เฉพาะหัวหน้า / ผู้ดูแลระบบเท่านั้น')
            value = self.read_json().get('value')
            old = con.execute('SELECT value FROM kv WHERE key = ?', (k,)).fetchone()
            con.execute('INSERT OR REPLACE INTO kv (key, value, rev, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)',
                        (k, json.dumps(value, ensure_ascii=False), next_rev(con), now_ms(), user['username']))
            if k == 'settings':
                self.log(con, user, 'settings', 'settings', 'update', json.loads(old['value']) if old else None, value)
            return {'ok': True}

        if key == ('POST', 'import'):
            self.require_user(con, admin=True)
            if con.execute("SELECT 1 FROM kv WHERE key = 'initialized'").fetchone():
                raise ApiError(400, 'มีข้อมูลในระบบแล้ว นำเข้าซ้ำไม่ได้')
            body = self.read_json()
            count = 0
            t = now_ms()
            for tbl, rows in (body.get('tables') or {}).items():
                if tbl not in TABLES:
                    continue
                for row in rows:
                    row = clean(row)
                    if row.get('id') in (None, ''):
                        continue
                    con.execute('INSERT OR REPLACE INTO records VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)',
                                (tbl, str(row['id']), json.dumps(row, ensure_ascii=False), next_rev(con),
                                 t, user['username'], user['name'], t, user['username'], user['name']))
                    count += 1
            for k, v in (body.get('kv') or {}).items():
                con.execute('INSERT OR REPLACE INTO kv VALUES (?, ?, ?, ?, ?)', (k, json.dumps(v, ensure_ascii=False), next_rev(con), t, user['username']))
            con.execute("INSERT OR REPLACE INTO kv VALUES ('initialized', 'true', ?, ?, ?)", (next_rev(con), t, user['username']))
            self.log(con, user, 'system', 'import', 'import', None, {'rows': count, 'source': body.get('source')})
            return {'ok': True, 'rows': count}

        if key == ('GET', 'history'):
            sql, args = 'SELECT * FROM history WHERE 1 = 1', []
            for field in ('tbl', 'id', 'username'):
                if query.get(field):
                    sql += f' AND {field} = ?'
                    args.append(query[field])
            if query.get('before'):
                sql += ' AND seq < ?'
                args.append(int(query['before']))
            if query.get('from'):
                sql += ' AND at >= ?'
                args.append(int(query['from']))
            if query.get('to'):
                sql += ' AND at < ?'
                args.append(int(query['to']))
            sql += ' ORDER BY seq DESC LIMIT ?'
            args.append(min(int(query.get('limit') or 100), 500))
            items = [{'seq': r['seq'], 'at': r['at'], 'username': r['username'], 'name': r['name'], 'tbl': r['tbl'], 'id': r['id'],
                      'action': r['action'], 'before': json.loads(r['before']) if r['before'] else None,
                      'after': json.loads(r['after']) if r['after'] else None} for r in con.execute(sql, args)]
            people = [{'username': r['username'], 'name': r['name']} for r in con.execute('SELECT DISTINCT username, name FROM history ORDER BY name')]
            return {'items': items, 'people': people}

        if key == ('POST', 'password'):
            body = self.read_json()
            if not check_password(body.get('old') or '', user['salt'], user['hash']):
                raise ApiError(400, 'รหัสผ่านเดิมไม่ถูกต้อง')
            self.set_password(con, user['username'], body.get('new') or '')
            return {'ok': True}

        if head == 'users':
            self.require_user(con, admin=True)
            if method == 'GET':
                return {'users': [public_user(r) for r in con.execute('SELECT * FROM users ORDER BY active DESC, name')]}
            if method == 'POST':
                body = self.read_json()
                created = self.create_user(con, body, role=body.get('role'))
                self.log(con, user, 'users', created['username'], 'create', None, public_user(created))
                return {'user': public_user(created)}
            if method == 'PUT' and len(parts) == 2:
                return self.update_user(con, user, parts[1], self.read_json())

        if key == ('GET', 'backup'):
            self.require_user(con, admin=True)
            tables = {t: [] for t in TABLES}
            for row in con.execute('SELECT * FROM records WHERE deleted = 0'):
                tables.setdefault(row['tbl'], []).append(json.loads(row['data']))
            kv = {r['key']: json.loads(r['value']) for r in con.execute('SELECT key, value FROM kv')}
            name = f'care-backup-{datetime.now():%Y-%m-%d-%H%M}.json'
            return 200, {'exportedAt': now_ms(), 'tables': tables, 'kv': kv}, {'Content-Disposition': f'attachment; filename="{name}"'}

        raise ApiError(404, 'ไม่พบคำสั่งนี้')

    # ---------- ผู้ใช้ ----------
    def login(self, con):
        ip = self.client_address[0]
        recent = [t for t in login_failures.get(ip, []) if t > time.time() - 600]
        login_failures[ip] = recent
        if len(recent) >= 5:
            raise ApiError(429, 'ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่')
        body = self.read_json()
        row = con.execute('SELECT * FROM users WHERE username = ?', ((body.get('username') or '').strip().lower(),)).fetchone()
        if not row or not row['active'] or not check_password(body.get('password') or '', row['salt'], row['hash']):
            recent.append(time.time())
            raise ApiError(400, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
        login_failures.pop(ip, None)
        return self.start_session(con, row)

    def start_session(self, con, user):
        token = secrets.token_urlsafe(32)
        con.execute('DELETE FROM sessions WHERE expires < ?', (now_ms(),))
        con.execute('INSERT INTO sessions VALUES (?, ?, ?)', (token, user['username'], now_ms() + SESSION_HOURS * 3600_000))
        return 200, {'user': public_user(user)}, {'Set-Cookie': self.session_cookie(token, SESSION_HOURS * 3600)}

    def create_user(self, con, body, role):
        username = (body.get('username') or '').strip().lower()
        name = (body.get('name') or '').strip()
        if not username or not username.replace('.', '').replace('_', '').replace('-', '').isalnum() or not username.isascii():
            raise ApiError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และ . _ -')
        if not name:
            raise ApiError(400, 'กรุณากรอกชื่อที่แสดง')
        if role not in ROLES:
            raise ApiError(400, 'บทบาทไม่ถูกต้อง')
        if con.execute('SELECT 1 FROM users WHERE username = ?', (username,)).fetchone():
            raise ApiError(400, 'มีชื่อผู้ใช้นี้แล้ว')
        salt, digest = hash_password(self.valid_password(body.get('password') or ''))
        con.execute('INSERT INTO users VALUES (?, ?, ?, ?, ?, 1, ?)', (username, name, role, salt, digest, now_ms()))
        return con.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()

    def valid_password(self, password):
        if len(password) < 8:
            raise ApiError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')
        return password

    def set_password(self, con, username, password):
        salt, digest = hash_password(self.valid_password(password))
        con.execute('UPDATE users SET salt = ?, hash = ? WHERE username = ?', (salt, digest, username))
        con.execute('DELETE FROM sessions WHERE username = ? AND token != ?', (username, self.session_token() or ''))

    def update_user(self, con, admin, username, body):
        row = con.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if not row:
            raise ApiError(404, 'ไม่พบผู้ใช้')
        before = public_user(row)
        name = (body.get('name') or row['name']).strip()
        role = body.get('role') or row['role']
        active = 1 if body.get('active', bool(row['active'])) else 0
        if role not in ROLES:
            raise ApiError(400, 'บทบาทไม่ถูกต้อง')
        if row['role'] == 'admin' and (role != 'admin' or not active):
            admins = con.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1").fetchone()[0]
            if admins <= 1:
                raise ApiError(400, 'ต้องมีหัวหน้า / ผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน')
        con.execute('UPDATE users SET name = ?, role = ?, active = ? WHERE username = ?', (name, role, active, username))
        if body.get('password'):
            salt, digest = hash_password(self.valid_password(body['password']))
            con.execute('UPDATE users SET salt = ?, hash = ? WHERE username = ?', (salt, digest, username))
        if not active or body.get('password'):
            con.execute('DELETE FROM sessions WHERE username = ?', (username,))
        after = public_user(con.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone())
        self.log(con, admin, 'users', username, 'update', before, {**after, 'passwordReset': bool(body.get('password'))})
        return {'user': after}

    # ---------- ข้อมูล ----------
    def log(self, con, user, tbl, rid, action, before, after):
        con.execute('INSERT INTO history (at, username, name, tbl, id, action, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (now_ms(), user['username'], user['name'], tbl, str(rid), action,
                     json.dumps(before, ensure_ascii=False) if before is not None else None,
                     json.dumps(after, ensure_ascii=False) if after is not None else None))

    def upsert(self, con, user, tbl, row):
        row = clean(row)
        rid = row.get('id')
        if rid in (None, ''):
            raise ApiError(400, 'ข้อมูลไม่มีรหัส')
        rid = str(rid)
        existing = con.execute('SELECT * FROM records WHERE tbl = ? AND id = ?', (tbl, rid)).fetchone()
        live = existing if existing and not existing['deleted'] else None
        action = 'update' if live else 'create'
        if not can_write(user, tbl, action, live):
            raise ApiError(403, 'บัญชีของคุณไม่มีสิทธิ์แก้ไขข้อมูลนี้')
        data = json.dumps(row, ensure_ascii=False)
        t = now_ms()
        if live:
            before = json.loads(live['data'])
            if before == row:
                return {'row': record_out(live)}
            con.execute('UPDATE records SET data = ?, rev = ?, updated_at = ?, updated_by = ?, updated_name = ? WHERE tbl = ? AND id = ?',
                        (data, next_rev(con), t, user['username'], user['name'], tbl, rid))
            self.log(con, user, tbl, rid, 'update', before, row)
        else:
            con.execute('INSERT OR REPLACE INTO records VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)',
                        (tbl, rid, data, next_rev(con), t, user['username'], user['name'], t, user['username'], user['name']))
            self.log(con, user, tbl, rid, 'create', None, row)
        return {'row': record_out(con.execute('SELECT * FROM records WHERE tbl = ? AND id = ?', (tbl, rid)).fetchone())}

    def delete(self, con, user, tbl, rid):
        existing = con.execute('SELECT * FROM records WHERE tbl = ? AND id = ? AND deleted = 0', (tbl, rid)).fetchone()
        if not existing:
            return {'ok': True}
        if not can_write(user, tbl, 'delete', existing):
            raise ApiError(403, 'บัญชีของคุณไม่มีสิทธิ์ลบข้อมูลนี้')
        self.soft_delete(con, user, existing)
        if tbl == 'residents':  # ลบผู้สูงอายุ → ลบยาและบันทึกของคนนี้ด้วย (ยังเก็บไว้ในประวัติ)
            for row in con.execute("SELECT * FROM records WHERE deleted = 0 AND tbl IN ('medications', 'vitals', 'nurseNotes', 'doctorOrders')").fetchall():
                if str(json.loads(row['data']).get('residentId')) == str(rid):
                    self.soft_delete(con, user, row)
        return {'ok': True}

    def soft_delete(self, con, user, row):
        con.execute('UPDATE records SET deleted = 1, rev = ?, updated_at = ?, updated_by = ?, updated_name = ? WHERE tbl = ? AND id = ?',
                    (next_rev(con), now_ms(), user['username'], user['name'], row['tbl'], row['id']))
        self.log(con, user, row['tbl'], row['id'], 'delete', json.loads(row['data']), None)

    # ---------- ไฟล์หน้าเว็บ ----------
    def serve_static(self):
        path = unquote(urlparse(self.path).path)
        if path in ('', '/'):
            path = '/index.html'
        full = os.path.realpath(os.path.join(ROOT, path.lstrip('/')))
        ext = os.path.splitext(full)[1].lower()
        allowed = (full.startswith(ROOT + os.sep) and not full.startswith(PROTECTED_DIR + os.sep)
                   and not full.startswith(DATA_DIR + os.sep) and ext in STATIC_TYPES)
        if not allowed or not os.path.isfile(full):
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write('ไม่พบหน้านี้'.encode())
            return
        with open(full, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', STATIC_TYPES[ext])
        self.send_header('Cache-Control', 'no-cache')
        self.security_headers()
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class _NoLock:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


_nolock = _NoLock()


def lan_addresses():
    addrs = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        addrs.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith('127.'))


def main():
    sys.stdout.reconfigure(line_buffering=True)  # ให้ข้อความแสดงทันทีแม้ไม่ได้รันใน Terminal
    init_db()
    threading.Thread(target=backup_loop, daemon=True).start()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('ระบบบันทึกผู้สูงอายุ เปิดแล้ว')
    print(f'  เครื่องนี้:          http://localhost:{PORT}')
    for a in lan_addresses():
        print(f'  เครื่องอื่นใน Wi-Fi:  http://{a}:{PORT}')
    print(f'  ข้อมูลเก็บที่:       {DB_PATH}')
    print('กด Ctrl+C เพื่อปิด')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nปิดเซิร์ฟเวอร์แล้ว')


if __name__ == '__main__':
    main()
