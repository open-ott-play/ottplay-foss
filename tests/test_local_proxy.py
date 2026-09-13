"""Real HTTP regression tests for explicit consent and command authentication."""
import contextlib
import http.client
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_proxy', ROOT / 'local_proxy.py')
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)
TOKEN = 'a' * 64
OTHER_TOKEN = 'b' * 64
PATH = '/api/webhook/commands'
ORIGIN = 'http://player.example:8080'


@contextlib.contextmanager
def running_proxy(**options):
    server = proxy.CommandProxyServer(('127.0.0.1', 0), **options)
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def request(server, method='GET', path=PATH, token=None, body=None, origin=None, headers=None):
    headers = dict(headers or {})
    if token is not None:
        headers['Authorization'] = 'Bearer ' + token
    if origin is not None:
        headers['Origin'] = origin
    if isinstance(body, (dict, list)):
        body = json.dumps(body)
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read()
        return response.status, dict(response.getheaders()), json.loads(data) if data else None
    finally:
        connection.close()


class LocalProxyTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(proxy.CommandProxyHandler, 'log_message')
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_disabled_does_not_construct_or_bind_server(self):
        with mock.patch.object(proxy, 'CommandProxyServer') as server:
            self.assertEqual(proxy.main(['8081'], {}), 0)
            self.assertEqual(proxy.main(['8081'], {'OTTPLAY_QUEUE_HTTP_TOKEN': TOKEN}), 0)
            self.assertEqual(proxy.main(['8081'], {'OTTPLAY_QUEUE_HTTP_ENABLED': '1'}), 2)
            server.assert_not_called()
        result = subprocess.run([sys.executable, str(ROOT / 'local_proxy.py'), '0'],
                                env={}, capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0)
        self.assertIn('disabled', result.stdout)

    def test_disabled_or_invalid_token_cannot_use_embedded_listener(self):
        for options in ({}, {'token': TOKEN}, {'enabled': True}, {'enabled': True, 'token': 'short'}):
            with running_proxy(**options) as server:
                self.assertEqual(request(server, token=TOKEN)[0], 403)
                self.assertEqual(request(server, 'POST', token=TOKEN, body={'command': 'exit_player'})[0], 403)
                self.assertEqual(server.commands, [])

    def test_authorized_delivery_works_and_unauthorized_requests_cannot_enqueue_or_drain(self):
        with running_proxy(enabled=True, token=TOKEN) as server:
            for token in (None, OTHER_TOKEN):
                self.assertEqual(request(server, 'POST', token=token, body={'command': 'exit_player'})[0], 401)
            status, _, data = request(server, 'POST', token=TOKEN, body={'command': 'set_volume', 'volume': 15})
            self.assertEqual((status, data['queued']), (200, 1))
            for token in (None, OTHER_TOKEN):
                self.assertEqual(request(server, token=token)[0], 401)
            for query in ('?device_id=known', '?token=' + TOKEN, '?device_id=' + TOKEN):
                self.assertEqual(request(server, path=PATH + query)[0], 401)
            status, headers, data = request(server, token=TOKEN)
            self.assertEqual(status, 200)
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual([(row['command'], row['volume']) for row in data], [('set_volume', 15)])
            self.assertEqual(request(server, token=TOKEN)[2], [])

    def test_device_code_selects_queue_without_broadcast_or_uuid_auth(self):
        with running_proxy(enabled=True, token=TOKEN) as first, running_proxy(enabled=True, token=OTHER_TOKEN) as second:
            self.assertEqual(request(first, 'POST', path='/webhook/notify', token=TOKEN,
                                     body={'command': 'random_channel'})[0], 200)
            self.assertEqual(request(second, token=TOKEN)[0], 401)
            self.assertEqual(request(second, token=OTHER_TOKEN)[2], [])
            # Legacy UUID is optional metadata: code-authenticated polling still receives the command.
            self.assertEqual(request(first, path='/webhook/poll?device_id=existing_uuid', token=TOKEN)[2][0]['command'],
                             'random_channel')

    def test_cors_requires_explicit_origin_and_preflight_has_no_token(self):
        with running_proxy(enabled=True, token=TOKEN, origins=[ORIGIN, '*']) as server:
            status, headers, _ = request(server, 'OPTIONS', origin=ORIGIN,
                                         headers={'Access-Control-Request-Method': 'GET',
                                                  'Access-Control-Request-Headers': 'Authorization'})
            self.assertEqual(status, 204)
            self.assertEqual(headers['Access-Control-Allow-Origin'], ORIGIN)
            self.assertIn('Authorization', headers['Access-Control-Allow-Headers'])
            self.assertEqual(request(server, origin=ORIGIN)[0], 401)
            self.assertEqual(request(server, token=TOKEN, origin=ORIGIN)[0], 200)
            for origin in ('https://evil.example', 'null'):
                self.assertEqual(request(server, 'OPTIONS', origin=origin)[0], 403)
                status, headers, _ = request(server, 'POST', token=TOKEN, origin=origin,
                                             body={'command': 'exit_player'})
                self.assertEqual(status, 403)
                self.assertNotIn('Access-Control-Allow-Origin', headers)
            self.assertEqual(server.commands, [])

    def test_invalid_bodies_and_framing_do_not_enqueue(self):
        with running_proxy(enabled=True, token=TOKEN) as server:
            for body in ('[]', 'null', '42', '{}', '{broken', '{"command":2}', '{"command":" "}'):
                self.assertEqual(request(server, 'POST', token=TOKEN, body=body)[0], 400)
            self.assertEqual(request(server, 'POST', token=TOKEN, body='x' * 65537)[0], 413)
            self.assertEqual(request(server, 'POST', token=TOKEN, body='{}',
                                     headers={'Transfer-Encoding': 'chunked'})[0], 400)
            self.assertEqual(server.commands, [])

    def test_duplicate_authorization_is_rejected_before_drain(self):
        with running_proxy(enabled=True, token=TOKEN) as server:
            request(server, 'POST', token=TOKEN, body={'command': 'random_channel'})
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.putrequest('GET', PATH)
                connection.putheader('Authorization', 'Bearer ' + TOKEN)
                connection.putheader('Authorization', 'Bearer ' + OTHER_TOKEN)
                connection.endheaders()
                self.assertEqual(connection.getresponse().status, 401)
            finally:
                connection.close()
            self.assertEqual(len(request(server, token=TOKEN)[2]), 1)

    def test_queue_is_bounded_and_stale_commands_expire(self):
        with running_proxy(enabled=True, token=TOKEN) as server:
            for number in range(55):
                request(server, 'POST', token=TOKEN, body={'command': 'set_volume', 'volume': number, 'ts': 0})
            self.assertEqual(len(server.commands), 50)
            server.commands[0]['ts'] = time.time() - 61
            data = request(server, token=TOKEN)[2]
            self.assertEqual(len(data), 49)
            self.assertEqual(data[0]['volume'], 6)
            self.assertEqual(data[-1]['volume'], 54)

    def test_handler_never_serves_files(self):
        with running_proxy(enabled=True, token=TOKEN) as server:
            self.assertEqual(request(server, path='/local_proxy.py', token=TOKEN)[0], 404)
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.request('HEAD', '/local_proxy.py')
                self.assertEqual(connection.getresponse().status, 501)
            finally:
                connection.close()

    def test_real_smoke_script_delivers_and_drains_authenticated_commands(self):
        with running_proxy(enabled=True, token=TOKEN) as server:
            env = {key: value for key, value in os.environ.items() if key not in {
                'QUEUE_HTTP_TOKEN', 'OTTPLAY_QUEUE_HTTP_TOKEN', 'DEVICE_ID', 'COMMAND_JSON', 'BACKEND_FILTER',
            }}
            env.update(OTTPLAY_QUEUE_HTTP_TOKEN=TOKEN, BASE_URL=f'http://127.0.0.1:{server.server_port}')
            result = subprocess.run(['bash', str(ROOT / 'scripts/smoke-command-queue.sh'), '--aliases'],
                                    env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('PASS: command queue POST', result.stdout)
            self.assertNotIn(TOKEN, result.stdout + result.stderr)
            self.assertEqual(server.commands, [])


if __name__ == '__main__':
    unittest.main()
