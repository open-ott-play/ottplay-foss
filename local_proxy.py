#!/usr/bin/env python3
"""Opt-in authenticated command queue for one OTT-play device.

Enable Local HTTP remote in the player's settings, then copy its device code:
    OTTPLAY_QUEUE_HTTP_ENABLED=1 OTTPLAY_QUEUE_HTTP_TOKEN=<device-code> \
        python3 local_proxy.py [port]

Default port: 8081; default host: 127.0.0.1. For a LAN listener explicitly set
OTTPLAY_QUEUE_HTTP_HOST. Set OTTPLAY_QUEUE_HTTP_ORIGINS to comma-separated exact
player origins for browser polling. Every GET/POST needs Authorization: Bearer.
There is no broadcast queue, registration endpoint, or URL-based authentication.
"""
import hmac
import http.server
import json
import os
import re
import sys
import time
import urllib.parse


def valid_token(token):
    return isinstance(token, str) and re.fullmatch(r'[A-Za-z0-9_-]{32,256}', token) is not None


class CommandProxyServer(http.server.HTTPServer):
    def __init__(self, address, *, enabled=False, token='', origins=()):
        self.http_enabled = enabled and valid_token(token)
        self.token = token if self.http_enabled else ''
        self.allowed_origins = frozenset(origins) - {'*', 'null', ''}
        self.commands = []
        super().__init__(address, CommandProxyHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        return connection, address


class CommandProxyHandler(http.server.BaseHTTPRequestHandler):
    """The configured secret identifies the queue; device_id grants no access."""

    MAX_BODY = 65536
    COMMAND_PATHS = ('/api/webhook/commands', '/webhook/notify', '/webhook/poll')

    def end_headers(self):
        origin = self.headers.get('Origin')
        if origin in self.server.allowed_origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _path(self):
        return urllib.parse.urlsplit(self.path).path.rstrip('/')

    def _enabled_and_origin_allowed(self):
        if not self.server.http_enabled:
            self._send_json({'error': 'HTTP remote disabled'}, 403)
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin not in self.server.allowed_origins:
            self._send_json({'error': 'Origin not allowed'}, 403)
            return False
        return True

    def _authorize(self):
        if not self._enabled_and_origin_allowed():
            return False
        authorization = self.headers.get_all('Authorization', [])
        if len(authorization) != 1 or not authorization[0].startswith('Bearer '):
            self._send_json({'error': 'Unauthorized'}, 401)
            return False
        supplied = authorization[0][7:]
        if not valid_token(supplied) or not hmac.compare_digest(supplied, self.server.token):
            self._send_json({'error': 'Unauthorized'}, 401)
            return False
        return True

    def do_OPTIONS(self):
        if self._path() not in self.COMMAND_PATHS:
            self._send_json({'error': 'Not found'}, 404)
            return
        if not self._enabled_and_origin_allowed():
            return
        # Browsers never send the Bearer token on a CORS preflight.
        if self.headers.get('Origin') not in self.server.allowed_origins:
            self._send_json({'error': 'Origin not allowed'}, 403)
            return
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if self._path() not in ('/api/webhook/commands', '/webhook/notify'):
            self._send_json({'error': 'Not found'}, 404)
            return
        if not self._authorize():
            return
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
            self._send_json({'error': 'Content-Length required'}, 400)
            return
        try:
            length = int(self.headers['Content-Length'])
        except (TypeError, ValueError):
            self._send_json({'error': 'Invalid Content-Length'}, 400)
            return
        if length < 1 or length > self.MAX_BODY:
            self._send_json({'error': 'Invalid body size'}, 413)
            return
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                self._send_json({'error': 'Incomplete request body'}, 400)
                return
            data = json.loads(body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError, OSError):
            self._send_json({'error': 'Invalid JSON'}, 400)
            return
        if not isinstance(data, dict) or not isinstance(data.get('command'), str) or not data['command'].strip():
            self._send_json({'error': 'A command object is required'}, 400)
            return
        data['ts'] = time.time()
        self.server.commands.append(data)
        self.server.commands = self.server.commands[-50:]
        self._send_json({'status': 'ok', 'queued': len(self.server.commands)})

    def do_GET(self):
        if self._path() not in ('/api/webhook/commands', '/webhook/poll'):
            self._send_json({'error': 'Not found'}, 404)
            return
        if not self._authorize():
            return
        cutoff = time.time() - 60
        recent = [command for command in self.server.commands if command.get('ts', 0) > cutoff]
        self.server.commands = []
        self._send_json(recent)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if status == 401:
            self.send_header('WWW-Authenticate', 'Bearer')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Never log credentials accidentally supplied in a query string.
        sys.stderr.write('[%s] %s %s\n' % (self.log_date_time_string(), self.client_address[0], self.command))


def main(argv=None, environ=None):
    argv = sys.argv[1:] if argv is None else argv
    environ = os.environ if environ is None else environ
    if environ.get('OTTPLAY_QUEUE_HTTP_ENABLED') != '1':
        print('Local HTTP remote disabled. Enable it in player settings before configuring this proxy.')
        return 0
    token = environ.get('OTTPLAY_QUEUE_HTTP_TOKEN', '')
    if not valid_token(token):
        print('OTTPLAY_QUEUE_HTTP_TOKEN must contain the device code from player settings.', file=sys.stderr)
        return 2
    port = int(argv[0]) if argv else 8081
    host = environ.get('OTTPLAY_QUEUE_HTTP_HOST', '127.0.0.1')
    origins = [origin.strip() for origin in environ.get('OTTPLAY_QUEUE_HTTP_ORIGINS', '').split(',')]
    with CommandProxyServer((host, port), enabled=True, token=token, origins=origins) as httpd:
        print(f'OTT-play authenticated command proxy: http://{host}:{port}')
        print('GET/POST /api/webhook/commands require Authorization: Bearer <device-code>.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
