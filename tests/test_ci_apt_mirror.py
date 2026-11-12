"""The CI transport repair preserves APT trust, suites and package policy."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("ci_apt_mirror", Path(__file__).resolve().parents[1] / "scripts/ci-apt-mirror.py")
mirror = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mirror)


class MirrorTests(unittest.TestCase):
    def test_only_official_archive_origins_change(self):
        original = """# http://azure.archive.ubuntu.com/ubuntu leave comment
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu.gpg] http://azure.archive.ubuntu.com/ubuntu noble main # keep https://azure.archive.ubuntu.com/ubuntu
deb https://azure.archive.ubuntu.com.evil/ubuntu noble main
deb https://user@azure.archive.ubuntu.com/ubuntu noble main
deb https://example.invalid/azure.archive.ubuntu.com/ubuntu noble main
deb http://ports.ubuntu.com/ubuntu-ports noble main
deb https://ppa.launchpadcontent.net/example/ppa/ubuntu noble main
"""
        expected = original.replace("http://azure.archive.ubuntu.com/ubuntu noble", "http://archive.ubuntu.com/ubuntu noble")
        expected = expected.replace("http://ports.ubuntu.com/ubuntu-ports noble", "https://ports.ubuntu.com/ubuntu-ports noble")
        self.assertEqual(mirror.rewrite(original), expected)
        self.assertEqual(mirror.rewrite(expected), expected)

    def test_ports_sources_preserve_everything_except_transport(self):
        original = """# http://ports.ubuntu.com/ubuntu-ports stays in this comment
deb [arch=arm64 signed-by=/usr/share/keyrings/ubuntu.gpg] http://ports.ubuntu.com/ubuntu-ports noble main # http://ports.ubuntu.com/ubuntu-ports
Types: deb deb-src
URIs: http://ports.ubuntu.com/ubuntu-ports/ https://example.invalid/ubuntu
 http://ports.ubuntu.com/ubuntu-ports
Suites: noble noble-updates noble-security
Components: main universe
Architectures: arm64
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
"""
        expected = original.replace(
            "] http://ports.ubuntu.com/ubuntu-ports noble", "] https://ports.ubuntu.com/ubuntu-ports noble"
        ).replace(
            "URIs: http://ports.ubuntu.com/ubuntu-ports/", "URIs: https://ports.ubuntu.com/ubuntu-ports/"
        ).replace("\n http://ports.ubuntu.com/ubuntu-ports\n", "\n https://ports.ubuntu.com/ubuntu-ports\n")
        self.assertEqual(mirror.rewrite(original), expected)
        self.assertEqual(mirror.rewrite(expected), expected)
        for suffix in ("", "/", "\r\n", "/\r\n"):
            source = "http://ports.ubuntu.com/ubuntu-ports" + suffix
            self.assertEqual(mirror.rewrite(source), "https://ports.ubuntu.com/ubuntu-ports" + suffix)

    def test_ports_does_not_rewrite_other_urls_or_comments(self):
        urls = [
            "https://ports.ubuntu.com/ubuntu-ports",
            "http://ports.ubuntu.com.evil/ubuntu-ports",
            "http://user@ports.ubuntu.com/ubuntu-ports",
            "http://ports.ubuntu.com:80/ubuntu-ports",
            "http://ports.ubuntu.com/ubuntu-ports-other",
            "http://ports.ubuntu.com/ubuntu-ports/nested",
            "http://ports.ubuntu.com/ubuntu-ports?query=1",
            "http://ports.ubuntu.com/ubuntu",
            "mirror+http://ports.ubuntu.com/ubuntu-ports",
            "https://example.invalid/?url=http://ports.ubuntu.com/ubuntu-ports",
            "# http://ports.ubuntu.com/ubuntu-ports",
        ]
        for url in urls:
            with self.subTest(url=url):
                original = "deb " + url + " noble main\n"
                self.assertEqual(mirror.rewrite(original), original)

    def test_deb822_lists_mirror_file_and_arm_preserve_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            apt = root / "etc/apt"
            (apt / "sources.list.d").mkdir(parents=True)
            sources = "Types: deb deb-src\nURIs: https://azure.archive.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main universe\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
            files = {
                "sources.list": "deb http://azure.archive.ubuntu.com/ubuntu noble main\n",
                "apt-mirrors.txt": "http://azure.archive.ubuntu.com/ubuntu\nhttps://security.ubuntu.com/ubuntu\n",
                "sources.list.d/ubuntu.sources": sources,
                "sources.list.d/arm.sources": "Types: deb\nURIs: http://ports.ubuntu.com/ubuntu-ports\nArchitectures: arm64\nSigned-By: /keyring.gpg\n",
                "sources.list.d/vendor.list": "deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
                "sources.list.d/ignored.save": sources,
            }
            for name, content in files.items():
                (apt / name).write_text(content)
            self.assertEqual(len(mirror.configure(root)), 4)
            for name, content in files.items():
                expected = content if name.endswith(".save") else content.replace("azure.archive.ubuntu.com", "archive.ubuntu.com")
                if not name.endswith(".save"):
                    expected = expected.replace("http://ports.ubuntu.com/ubuntu-ports", "https://ports.ubuntu.com/ubuntu-ports")
                self.assertEqual((apt / name).read_text(), expected)
            self.assertEqual(mirror.configure(root), [])

    def test_missing_sources_and_external_symlink_are_not_written(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            apt = root / "etc/apt"
            apt.mkdir(parents=True)
            external = Path(outside) / "sources.list"
            original = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n"
            external.write_text(original)
            (apt / "sources.list").symlink_to(external)
            self.assertEqual(mirror.configure(root), [])
            self.assertEqual(external.read_text(), original)

    def test_real_host_requires_linux_ci(self):
        with patch.object(mirror, "configure") as configure:
            with patch.dict(os.environ, {"CI": "false"}), patch.object(mirror.sys, "platform", "linux"):
                self.assertEqual(mirror.main([]), 0)
            with patch.dict(os.environ, {"CI": "true"}), patch.object(mirror.sys, "platform", "darwin"):
                self.assertEqual(mirror.main([]), 0)
            configure.assert_not_called()


@unittest.skipUnless(os.name == "posix", "Release dependency commands require POSIX Bash")
class ReleaseContainerPrerequisiteTests(unittest.TestCase):
    def run_install_step(self, failure=""):
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/release-build.yml").read_text()
        job = workflow.split("  container-platform:\n", 1)[1].split("  container:\n", 1)[0]
        step = job.split("      - name: Install OCI inspection tools\n", 1)[1].split(
            "      - name: Verify exact native image EPG performance\n", 1)[0]
        self.assertIn("        timeout-minutes: 12\n", step)
        script = textwrap.dedent(step.split("        run: |\n", 1)[1])
        # Execute the actual workflow shell with a logging sudo stand-in. It
        # performs no host mutation, APT invocation or network access.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log = root / "commands.jsonl"
            sudo = root / "sudo"
            sudo.write_text(f"#!{sys.executable}\n" + """import json, os, sys
args = sys.argv[1:]
with open(os.environ['COMMAND_LOG'], 'a') as stream:
    stream.write(json.dumps(args) + '\\n')
phase = 'mirror' if args[0] == 'env' else ('update' if args[-1] == 'update' else 'install')
sys.exit(42 if os.environ['FAIL_PHASE'] == phase else 0)
""")
            sudo.chmod(0o700)
            result = subprocess.run(
                ["/bin/bash", "-euo", "pipefail", "-c", script],
                cwd=root,
                env={"PATH": str(root) + os.pathsep + os.defpath,
                     "CI": "true", "COMMAND_LOG": str(log), "FAIL_PHASE": failure},
                capture_output=True, text=True, timeout=10, check=False,
            )
            commands = [json.loads(line) for line in log.read_text().splitlines()]
        return result, commands

    def test_actual_container_setup_is_bounded_and_precedes_package_install(self):
        result, commands = self.run_install_step()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(commands), 3)
        self.assertEqual(commands[0], ["env", "CI=true", "python3", "scripts/ci-apt-mirror.py"])
        for command in commands[1:]:
            self.assertEqual(command[:5], ["timeout", "--kill-after=15s", "300s", "apt-get", "-o"])
            for option in ("Acquire::Retries=2", "Acquire::http::Timeout=20",
                           "Acquire::https::Timeout=20"):
                self.assertIn(option, command)
        self.assertEqual(commands[1][-3:], ["-o", "APT::Update::Error-Mode=any", "update"])
        self.assertEqual(commands[2][-3:], ["install", "-y", "skopeo"])

    def test_every_prerequisite_failure_stops_the_actual_workflow_shell(self):
        for phase, expected_count in (("mirror", 1), ("update", 2), ("install", 3)):
            with self.subTest(phase=phase):
                result, commands = self.run_install_step(phase)
                self.assertEqual(result.returncode, 42)
                self.assertEqual(len(commands), expected_count)


if __name__ == "__main__":
    unittest.main()
