"""เชื่อมต่อฐานข้อมูล Turso (SQLite บนคลาวด์) ผ่าน HTTP

ใช้ Python อย่างเดียว ไม่ต้องติดตั้งอะไรเพิ่ม
ทำงานหน้าตาเหมือน sqlite3: con.execute(), row['ชื่อคอลัมน์'], with con: (transaction)
โปรโตคอล: https://docs.turso.tech/sdk/http/reference
"""
import base64
import json
import urllib.error
import urllib.request


class TursoError(Exception):
    pass


class Row:
    """แถวผลลัพธ์ อ่านได้ทั้ง row['ชื่อคอลัมน์'] และ row[0] เหมือน sqlite3.Row"""
    __slots__ = ('_cols', '_vals')

    def __init__(self, cols, vals):
        self._cols = cols
        self._vals = vals

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._vals[key]
        try:
            return self._vals[self._cols.index(key)]
        except ValueError:
            raise IndexError(f'ไม่มีคอลัมน์ {key}')

    def keys(self):
        return list(self._cols)


class Cursor:
    def __init__(self, rows, rowcount=0):
        self._rows = rows
        self.rowcount = rowcount

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)


def _encode(v):
    if v is None:
        return {'type': 'null'}
    if isinstance(v, bool):
        return {'type': 'integer', 'value': str(int(v))}
    if isinstance(v, int):
        return {'type': 'integer', 'value': str(v)}
    if isinstance(v, float):
        return {'type': 'float', 'value': v}
    if isinstance(v, (bytes, bytearray)):
        return {'type': 'blob', 'base64': base64.b64encode(v).decode()}
    return {'type': 'text', 'value': str(v)}


def _decode(c):
    t = c.get('type')
    if t == 'null':
        return None
    if t == 'integer':
        return int(c['value'])
    if t == 'float':
        return float(c['value'])
    if t == 'blob':
        return base64.b64decode(c.get('base64', ''))
    return c.get('value')


class TursoConnection:
    def __init__(self, url, token, timeout=20):
        if url.startswith('libsql://'):
            url = 'https://' + url[len('libsql://'):]
        self.endpoint = url.rstrip('/') + '/v2/pipeline'
        self.token = token
        self.timeout = timeout
        self.baton = None  # ใช้ต่อ "สาย" เดิมกับ Turso เพื่อให้ transaction ข้ามหลายคำสั่งได้

    def _pipeline(self, requests):
        body = {'requests': requests}
        if self.baton:
            body['baton'] = self.baton
        req = urllib.request.Request(
            self.endpoint, data=json.dumps(body).encode(), method='POST',
            headers={'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                data = json.loads(res.read())
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode(errors='replace')
            if e.code in (401, 403):
                raise TursoError('Turso ไม่อนุญาต: ตรวจ TURSO_AUTH_TOKEN ว่าถูกต้องและยังไม่หมดอายุ')
            raise TursoError(f'Turso ตอบกลับผิดพลาด ({e.code}): {detail}')
        except urllib.error.URLError as e:
            raise TursoError(f'ติดต่อ Turso ไม่ได้: {e.reason} (ตรวจ TURSO_DATABASE_URL)')
        self.baton = data.get('baton')
        results = data.get('results') or []
        for r in results:
            if r.get('type') == 'error':
                raise TursoError(r.get('error', {}).get('message', 'ฐานข้อมูลผิดพลาด'))
        return results

    def execute(self, sql, args=()):
        res = self._pipeline([{'type': 'execute', 'stmt': {'sql': sql, 'args': [_encode(a) for a in args]}}])
        result = res[0]['response']['result']
        cols = [c.get('name') for c in result.get('cols', [])]
        rows = [Row(cols, [_decode(c) for c in row]) for row in result.get('rows', [])]
        return Cursor(rows, result.get('affected_row_count', 0))

    def executescript(self, script):
        stmts = [s.strip() for s in script.split(';') if s.strip()]
        self._pipeline([{'type': 'execute', 'stmt': {'sql': s}} for s in stmts])

    # with con: → ทำทุกคำสั่งข้างในเป็นชุดเดียว สำเร็จทั้งหมดหรือยกเลิกทั้งหมด
    def __enter__(self):
        self.execute('BEGIN')
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is None:
            self.execute('COMMIT')
        else:
            try:
                self.execute('ROLLBACK')
            except TursoError:
                pass
        return False

    def close(self):
        if self.baton:
            try:
                self._pipeline([{'type': 'close'}])
            except TursoError:
                pass
        self.baton = None
