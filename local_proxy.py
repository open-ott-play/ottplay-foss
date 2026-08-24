#!/usr/bin/env python3
"""Local command proxy server for OTT-play FOSS.

A minimal HTTP server that acts as a local command queue between
Home Assistant / Node-RED / curl and the OTT-play player.

The player polls this server's GET endpoint to receive commands,
and external systems POST commands to queue them.

Supports both broadcast (no device_id) and per-device routing.

Usage:
    python3 local_proxy.py [port]

Default port: 8081
"""
import http.server
import socketserver
import sys
import json
import time
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8081


class CommandProxyHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with CORS support for local command proxying."""

    # In-memory command queues
    _commands = {}        # device_id -> list of command dicts
    _broadcast = []       # legacy broadcast queue

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Max-Age', '86400')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path in ('/api/webhook/commands', '/webhook/notify'):
            self._handle_post_command()
        else:
            self.send_error(404, "Not Found")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path in ('/api/webhook/commands', '/webhook/poll'):
            self._handle_get_commands()
        else:
            self.send_error(404, "Not Found")

    def _read_body(self):
        clen = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(clen).decode('utf-8') if clen else ''

    def _send_json(self, obj, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode('utf-8'))

    def _handle_post_command(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        device_id = (params.get('device_id') or [''])[0].strip()

        body = self._read_body()
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON"}, 400)
            return

        # Attach timestamp
        data['ts'] = time.time()

        if device_id:
            if device_id not in self._commands:
                self._commands[device_id] = []
            self._commands[device_id].append(data)
            if len(self._commands[device_id]) > 50:
                self._commands[device_id] = self._commands[device_id][-25:]
            queued = len(self._commands[device_id])
            sys.stderr.write(f"[PROXY] device={device_id} cmd={data.get('command', '?')} queued={queued}\n")
        else:
            self._broadcast.append(data)
            if len(self._broadcast) > 100:
                self._broadcast = self._broadcast[-50:]
            queued = len(self._broadcast)
            sys.stderr.write(f"[PROXY] broadcast cmd={data.get('command', '?')} queued={queued}\n")

        self._send_json({"status": "ok", "queued": queued})

    def _handle_get_commands(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        device_id = (params.get('device_id') or [''])[0].strip()

        if device_id:
            queue = self._commands.pop(device_id, [])
            cutoff = time.time() - 60
            recent = [n for n in queue if n.get('ts', 0) > cutoff]
            self._send_json(recent)
        else:
            cutoff = time.time() - 60
            recent = [n for n in self._broadcast if n.get('ts', 0) > cutoff]
            self._broadcast = []
            self._send_json(recent)

    def log_message(self, format, *args):
        sys.stderr.write("[%s] %s - %s\n" % (self.log_date_time_string(), self.client_address[0], format % args))


if __name__ == '__main__':
    try:
        httpd = socketserver.TCPServer(("", PORT), CommandProxyHandler)
        print(f"OTT-play local command proxy: http://localhost:{PORT}")
        print(f"POST /api/webhook/commands  — send command")
        print(f"GET  /api/webhook/commands  — receive commands (player poll)")
        print(f"Add ?device_id=<id> for per-device routing")
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        httpd.shutdown()
        sys.exit(0)
