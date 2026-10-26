import contextlib
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('clone', Path(__file__).resolve().parents[1]/'scripts/clone-native-m3u-profile.py')
clone = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clone)


class NativeProfileCloneTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root/'localstorage.sqlite3'
        self.app = self.root/'Player.app'
        (self.app/'Contents').mkdir(parents=True)
        (self.app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'com.ottplay.foss.inst4'}))
        slots = [{'www':'','name':'','rechours':0} for _ in range(15)]
        slots[0] = {'www':'https://private.invalid/SECRET','name':'Local 1','rechours':144,'medUrl':'portal::PRIVATE','medSourceId':'original-identity'}
        self.config = {'active':0,'M3Us':slots,'extra':'preserve'}
        self.db.touch()
        with clone.connect(self.db) as connection:
            connection.execute('CREATE TABLE ItemTable(key TEXT UNIQUE,value BLOB NOT NULL)')
            connection.executemany('INSERT INTO ItemTable VALUES(?,?)',[(clone.KEY,json.dumps(self.config).encode('utf-16-le')),('unrelated',b'untouched')]+[(k,'dev_test'.encode('utf-16-le')) for k in clone.IDS])
        self.url = self.root/'url.private'
        self.url.write_text('http://127.0.0.1:18790/normalize/profile/t4/'+'p'*40+'/index.m3u')
        self.url.chmod(0o600)
        self.args = SimpleNamespace(database=self.db,app=self.app,work=self.root/'plan',bundle='com.ottplay.foss.inst4',uuid='dev_test',source=1,target=3,name='Local 3',url_file=self.url)

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            clone.prepare(self.args)
        self.assertNotIn('SECRET',output.getvalue())
        return self.args.work/'plan.json'

    def test_roundtrip_preserves_original_active_other_rows_and_media(self):
        before=clone.rows(self.db)
        plan=self.prepare()
        self.assertEqual(clone.rows(self.db),before)
        with patch.object(clone,'closed') as guard, contextlib.redirect_stdout(io.StringIO()):
            clone.apply(SimpleNamespace(plan=plan))
        self.assertEqual(guard.call_count,2)
        after=clone.rows(self.db)
        config=json.loads(clone.decode(after[clone.KEY]))
        self.assertEqual(config['active'],0)
        self.assertEqual(config['M3Us'][0],self.config['M3Us'][0])
        self.assertEqual(config['M3Us'][2]['medUrl'],'portal::PRIVATE')
        self.assertEqual(config['M3Us'][2]['medSourceId'],'original-identity')
        self.assertEqual(after['unrelated'],before['unrelated'])
        for file in self.args.work.iterdir():
            self.assertEqual(file.stat().st_mode & 0o077,0)

    def test_changed_storage_refuses_apply(self):
        plan=self.prepare()
        with clone.connect(self.db) as connection:
            connection.execute('UPDATE ItemTable SET value=? WHERE key=?',(b'new','unrelated'))
        with patch.object(clone,'closed'), self.assertRaisesRegex(RuntimeError,'Database changed'):
            clone.apply(SimpleNamespace(plan=plan))
        self.assertEqual(json.loads(clone.decode(clone.rows(self.db)[clone.KEY])),self.config)

    def test_candidate_tamper_refuses_apply(self):
        plan=self.prepare()
        with clone.connect(self.args.work/'candidate.sqlite3') as connection:
            connection.execute('UPDATE ItemTable SET value=? WHERE key=?',(b'bad','unrelated'))
        with patch.object(clone,'closed'), self.assertRaisesRegex(RuntimeError,'artifacts changed'):
            clone.apply(SimpleNamespace(plan=plan))

    def test_occupied_slot_refused(self):
        self.config['M3Us'][2]['www']='occupied'
        with clone.connect(self.db) as connection:
            connection.execute('UPDATE ItemTable SET value=? WHERE key=?',(json.dumps(self.config).encode('utf-16-le'),clone.KEY))
        with self.assertRaisesRegex(RuntimeError,'not empty'):
            self.prepare()

    def test_live_app_guard(self):
        with patch.object(clone.subprocess,'run',return_value=SimpleNamespace(stdout=str(self.app)+'/Contents/MacOS/player\n',returncode=0)):
            with self.assertRaisesRegex(RuntimeError,'Close'):
                clone.closed(self.app,self.db)

    def test_live_database_guard(self):
        results=[SimpleNamespace(stdout='',returncode=0),SimpleNamespace(stdout='123\n',returncode=0)]
        with patch.object(clone.subprocess,'run',side_effect=results):
            with self.assertRaisesRegex(RuntimeError,'still holds'):
                clone.closed(self.app,self.db)


if __name__ == '__main__':
    unittest.main()
