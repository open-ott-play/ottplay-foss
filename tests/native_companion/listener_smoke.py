"""Real server listener smoke. Build first: cargo build -p ottplay-server.

Run with python3 tests/native_companion/listener_smoke.py. Override the binary
with OTTPLAY_SERVER_BIN when testing a packaged server.
"""

from contextlib import contextmanager
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
BINARY = Path(os.environ.get("OTTPLAY_SERVER_BIN", ROOT / "target/debug/ottplay-server"))
TOKEN = "listener-smoke-" + "x" * 32
CAPABILITIES = f"/companion/{TOKEN}/v1/capabilities"


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def request(port, path, context=None):
    if context:
        connection = http.client.HTTPSConnection("127.0.0.1", port, context=context, timeout=2)
    else:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


@contextmanager
def server(directory, extra=None, ports=None):
    if ports is None:
        main_port, companion_port = free_port(), free_port()
        while companion_port == main_port:
            companion_port = free_port()
    else:
        main_port, companion_port = ports
    environment = {key: value for key, value in os.environ.items() if not key.startswith("OTT_")}
    environment.update({
        "OTT_COMPANION_DIR": str(directory / "media"),
        "OTT_COMPANION_TOKEN": TOKEN,
        "OTT_COMPANION_PORT": str(companion_port),
        "EPG_URLS": "http://127.0.0.1:9/unused.xml",
    })
    environment.update(extra or {})
    with tempfile.TemporaryFile(mode="w+") as log:
        process = subprocess.Popen(
            [str(BINARY), "--host", "0.0.0.0", "--port", str(main_port)],
            cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            yield process, main_port, companion_port, log
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def wait_ready(process, main_port, companion_port, log, context=None):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and process.poll() is None:
        try:
            if request(main_port, "/health")[0] == 200 and request(companion_port, CAPABILITIES, context)[0] == 200:
                return
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(0.05)
    log.seek(0)
    raise AssertionError("Server did not become ready: " + log.read())


class CompanionListenerSmoke(unittest.TestCase):
    def setUp(self):
        self.assertTrue(BINARY.is_file(), "Build the server before running this smoke")
        self.temporary = tempfile.TemporaryDirectory(prefix="ott-companion-listener-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def assert_separated(self, main_port, companion_port, context=None):
        self.assertEqual(request(main_port, CAPABILITIES)[0], 404)
        status, body = request(companion_port, CAPABILITIES, context)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["torrent"])
        self.assertEqual(request(companion_port, CAPABILITIES.replace(TOKEN, "wrong"), context)[0], 401)
        self.assertEqual(request(companion_port, "/health", context)[0], 401)
        self.assertEqual(request(main_port, "/health")[0], 200)

    def test_loopback_default_is_independent_of_public_main_host(self):
        with server(self.directory) as (process, main, companion, log):
            wait_ready(process, main, companion, log)
            self.assert_separated(main, companion)
            log.seek(0)
            output = log.read()
            self.assertIn(f"ottplay media service: http://127.0.0.1:{companion}", output)
            self.assertNotIn(TOKEN, output)

    @unittest.skipUnless(os.name == "posix", "SIGTERM shutdown requires POSIX signals")
    def test_sigterm_releases_ports_and_restarts_with_the_same_cache(self):
        # Stay idle: admitting a production torrent would enable public DHT traffic.
        # Active lease cancellation is covered by the isolated core torrent tests.
        ports = None
        for cycle in range(2):
            with self.subTest(cycle=cycle):
                with server(self.directory, ports=ports) as (process, main, companion, log):
                    wait_ready(process, main, companion, log)
                    self.assert_separated(main, companion)
                    ports = main, companion
                    self.assertTrue((self.directory / "media" / "torrent-cache").is_dir())
                    process.terminate()
                    try:
                        exit_code = process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self.fail("Server did not exit after SIGTERM within 10 seconds")
                    self.assertEqual(exit_code, 0, "SIGTERM must take the orderly shutdown path")
                for port in (main, companion):
                    with socket.socket() as rebound:
                        # Match the server's listener behavior around TCP TIME_WAIT.
                        rebound.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                        rebound.bind(("127.0.0.1", port))
                        rebound.listen(1)

    def test_explicit_remote_host_requires_opt_in(self):
        with server(self.directory, {"OTT_COMPANION_HOST": "0.0.0.0"}) as (process, main, _, log):
            self.assertNotEqual(process.wait(timeout=15), 0)
            log.seek(0)
            self.assertIn("OTT_COMPANION_ALLOW_REMOTE=1", log.read())
            self.assertFalse((self.directory / "media").exists())
            with socket.socket() as rebound:
                rebound.bind(("127.0.0.1", main))

    def test_explicit_remote_listener_stays_separate(self):
        with server(self.directory, {"OTT_COMPANION_HOST": "0.0.0.0", "OTT_COMPANION_ALLOW_REMOTE": "1"}) as (process, main, companion, log):
            wait_ready(process, main, companion, log)
            self.assert_separated(main, companion)

    def test_companion_tls_does_not_change_main_http(self):
        cert, key = self.directory / "cert.pem", self.directory / "key.pem"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1",
            "-keyout", str(key), "-out", str(cert),
        ], check=True, capture_output=True, timeout=15)
        context = ssl.create_default_context(cafile=str(cert))
        with server(self.directory, {"OTT_COMPANION_CERT": str(cert), "OTT_COMPANION_KEY": str(key)}) as (process, main, companion, log):
            wait_ready(process, main, companion, log, context)
            self.assert_separated(main, companion, context)
            with self.assertRaises((OSError, http.client.HTTPException)):
                request(companion, CAPABILITIES)


if __name__ == "__main__":
    unittest.main()
