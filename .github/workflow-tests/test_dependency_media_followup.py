import base64
import contextlib
import copy
import http.server
import importlib.util
import io
import os
import stat
import sys
import tarfile
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import warnings
import zipfile
from pathlib import Path
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "dependency_media_followup", ROOT / "scripts/dependency-media-followup.py"
)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
BASE, HEAD, NEW = "a" * 40, "b" * 40, "e" * 40


def fixture():
    package = {
        "name": "fixture",
        "version": "1.0.0",
        "scripts": {"build:media": "node scripts/media-runtime.cjs build"},
        "dependencies": {"rollup": "1.0.0"},
    }
    names = set(m.PACKAGES) | {
        "jquery",
        "shaka-player",
        "@capacitor/core",
        "@capacitor/android",
        "@capacitor/ios",
        "@capacitor/cli",
        "@capacitor/app",
        "@tauri-apps/plugin-updater",
    }
    packages = {"": {"version": "1.0.0"}}
    packages.update(
        {
            "node_modules/" + name: {
                "version": "1.0.0",
                "resolved": "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
                "integrity": "sha512-" + base64.b64encode(bytes(64)).decode(),
            }
            for name in sorted(names)
        }
    )
    lock = {"name": "fixture", "version": "1.0.0", "lockfileVersion": 3, "packages": packages}
    data = {name: ("fixture " + name).encode() for name in m.INPUTS}
    data["package.json"] = m.json_bytes(package)
    data["package-lock.json"] = m.json_bytes(lock)
    for name in m.HTML:
        data[name] = b'<html><script src="/js/runtime-polyfills.js?v=0123456789abcdef"></script></html>'
    data["THIRD-PARTY-NOTICES.md"] = b"""# Notices
## Native runtime: Tauri and Capacitor
**jQuery 1.0.0** **hls.js 1.0.0** **Shaka Player 1.0.0**
**jQuery 1.0.0:** https://github.com/jquery/jquery/blob/1.0.0/LICENSE.txt
**hls.js 1.0.0:** https://github.com/video-dev/hls.js/blob/v1.0.0/LICENSE
**Shaka Player 1.0.0:** https://github.com/shaka-project/shaka-player/blob/v1.0.0/LICENSE
**Capacitor core, Android, iOS and CLI/template 1.0.0:**
https://github.com/ionic-team/capacitor/blob/1.0.0/LICENSE
**Tauri JavaScript updater plugin 1.0.0:**
## Shared ES5 media runtime
**hls.js 1.0.0** **core-js 1.0.0**
## Web and legacy player libraries
**hls.js 1.0.0** **Shaka Player 3.3.19** retained artwork 8.5.1
## Optional PC2 streaming engine
**Video.js 1.0.0** **VHS 1.0.0**
"""
    return data


def generated(data):
    output = {name: ("generated " + name).encode() for name in m.OUTPUTS}
    expected, version = m.expected_manifest(data)
    manifest = {
        "schema": 2,
        **expected,
        "runtimeVersion": version,
        "assets": {name: m.sha(output["js/" + name]) for name in m.ASSETS},
    }
    output["js/media-runtime.json"] = m.json_bytes(manifest)
    for name in m.HTML:
        output[name] = m.BOOTSTRAP.sub(lambda match: match[1] + b"?v=" + version.encode() + match[2], data[name])
    output["js/licenses/project-LICENSE.txt"] = data["LICENSE"]
    output["js/licenses/Apache-2.0.txt"] = data["licenses/android/Apache-2.0.txt"]
    return output


def zip_bytes(output, context, extra=None, omit=None):
    receipt = {
        "schema": 1,
        "context": context,
        "files": {name: {"bytes": len(value), "sha256": m.sha(value)} for name, value in output.items()},
    }
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("receipt.json", m.json_bytes(receipt))
        for name, value in output.items():
            if name != omit:
                archive.writestr("files/" + name, value)
        if extra:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(*extra)
    return result.getvalue()


def tar_bytes(output, group, extra=None):
    names = {name for name in output if name == group or name.startswith(group + "/")}
    dirs = {str(parent) for name in names for parent in Path(name).parents if str(parent) != "."}
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w:") as archive:
        for name in sorted(dirs):
            info = tarfile.TarInfo(name)
            info.type = tarfile.DIRTYPE
            archive.addfile(info)
        for name in sorted(names):
            info = tarfile.TarInfo(name)
            info.size = len(output[name])
            archive.addfile(info, io.BytesIO(output[name]))
        if extra:
            archive.addfile(extra)
    return result.getvalue()


class FakeApi:
    def __init__(self):
        self.base = fixture()
        self.data = copy.deepcopy(self.base)
        lock = m.parse(self.data["package-lock.json"])
        lock["packages"]["node_modules/rollup"]["version"] = "1.0.1"
        self.data["package-lock.json"] = m.json_bytes(lock)
        self.tree_ids = {BASE: "c" * 40, HEAD: "d" * 40, NEW: "f" * 40}
        self.sources = {BASE: self.base, HEAD: self.data}
        self.pr = {
            "state": "open",
            "draft": False,
            "user": {"id": m.BOT_ID, "login": m.BOT_LOGIN},
            "head": {"repo": {"full_name": m.REPOSITORY}, "ref": m.BRANCH, "sha": HEAD},
            "base": {"repo": {"full_name": m.REPOSITORY}, "ref": "main", "sha": BASE},
        }
        self.compare = {
            "status": "ahead",
            "merge_base_commit": {"sha": BASE},
            "total_commits": 1,
            "files": [{"filename": "package-lock.json", "status": "modified"}],
        }
        self.run = {
            "id": 123,
            "run_attempt": 2,
            "event": "pull_request",
            "status": "completed",
            "conclusion": "success",
            "path": m.WORKFLOW,
            "head_branch": m.BRANCH,
            "head_sha": HEAD,
            "workflow_id": 456,
            "repository": {"full_name": m.REPOSITORY},
            "head_repository": {"full_name": m.REPOSITORY},
            "pull_requests": [{"number": 10}],
        }
        self.event = {"workflow_run": {"id": 123, "run_attempt": 2}}
        self.artifacts = {"total_count": 0, "artifacts": []}
        self.jobs = {
            "total_count": 1,
            "jobs": [
                {
                    "id": 987,
                    "name": m.GENERATOR_JOB,
                    "run_id": 123,
                    "run_attempt": 2,
                    "head_sha": HEAD,
                    "status": "completed",
                    "conclusion": "success",
                }
            ],
        }
        self.posts = []

    def entries(self, data):
        return [
            {"path": name, "mode": "100644", "type": "blob", "size": len(value), "sha": m.git_blob(value)}
            for name, value in data.items()
        ]

    def repo(self, path):
        if path == "/git/ref/heads/main":
            return {"object": {"sha": BASE}}
        if path == "/pulls/10":
            return copy.deepcopy(self.pr)
        if path == "/compare/" + BASE + "..." + HEAD:
            return copy.deepcopy(self.compare)
        if path.startswith("/git/commits/"):
            commit = path.rsplit("/", 1)[1]
            return {"sha": commit, "tree": {"sha": self.tree_ids[commit]}}
        if path.startswith("/git/trees/"):
            tree = path.split("/")[-1].split("?")[0]
            data = self.sources[next(key for key, value in self.tree_ids.items() if value == tree)]
            return {"sha": tree, "truncated": False, "tree": self.entries(data)}
        if path.startswith("/git/blobs/"):
            oid = path.rsplit("/", 1)[1]
            value = next(
                value for source in self.sources.values() for value in source.values() if m.git_blob(value) == oid
            )
            return {"sha": oid, "encoding": "base64", "size": len(value), "content": base64.b64encode(value).decode()}
        if path == "/actions/runs/123":
            return copy.deepcopy(self.run)
        if path == "/actions/workflows/456":
            return {"path": m.WORKFLOW, "state": "active"}
        if path == "/actions/runs/123/artifacts?per_page=100":
            return copy.deepcopy(self.artifacts)
        if path == "/actions/runs/123/attempts/2/jobs?per_page=100":
            return copy.deepcopy(self.jobs)
        if path == "/commits/" + NEW:
            return {"commit": {"verification": {"verified": True}}}
        raise AssertionError("Unexpected API request: " + path)

    def request(self, path, payload=None):
        if path == "/user":
            return {"id": m.BOT_ID, "login": m.BOT_LOGIN}
        self.posts.append((path, payload))
        assert path == "/graphql"
        request = payload["variables"]["input"]
        assert request["expectedHeadOid"] == HEAD
        self.sources[NEW] = dict(self.data)
        for change in request["fileChanges"]["additions"]:
            self.sources[NEW][change["path"]] = base64.b64decode(change["contents"], validate=True)
        return {
            "data": {
                "createCommitOnBranch": {
                    "commit": {
                        "oid": NEW,
                        "url": "https://github.com/" + m.REPOSITORY + "/commit/" + NEW,
                        "parents": {"nodes": [{"oid": HEAD}]},
                    }
                }
            }
        }

    def qualify(self):
        context, _, _ = m.admission(self, 10, HEAD)
        context.update(run=123, attempt=2, workflow=m.WORKFLOW)
        archive = zip_bytes(generated(self.data), context)
        self.artifacts = {
            "total_count": 1,
            "artifacts": [
                {
                    "id": 789,
                    "name": "dependency-media-123-2",
                    "expired": False,
                    "size_in_bytes": len(archive),
                    "digest": "sha256:" + m.sha(archive),
                    "workflow_run": {"id": 123, "head_sha": HEAD},
                }
            ],
        }
        plan, _, _ = m.publisher_context(self, self.event)
        return plan, archive


class DependencyMediaFollowupTests(unittest.TestCase):
    def test_actual_child_failure_has_safe_bounded_operation_exit_and_stderr(self):
        stderr = (
            "x" * 6000 + "\n::error::not a workflow command\x1b[31m\r\x00\u2028"
            " https://fixture-user:fixture-password@registry.npmjs.org/pkg?token=fixture-query#fixture-fragment"
            "\nAuthorization: Bearer fixture-header\nBOT_TOKEN=fixture-token "
            'ghp_fakecredential password="fixture-quoted" \ninstall failure'
        )
        code = "import sys; sys.stderr.write(" + repr(stderr) + "); sys.exit(7)"
        with contextlib.redirect_stderr(io.StringIO()) as markers, self.assertRaises(ValueError) as error:
            m.bounded_command([sys.executable, "-c", code], 5, operation="install")
        message = str(error.exception)
        detail = m.parse(message.split(": ", 1)[1].encode())
        self.assertEqual(detail["operation"], "install")
        self.assertEqual(detail["exitCode"], 7)
        self.assertLessEqual(len(detail["stderrTail"]), 2048)
        self.assertIn("install failure", detail["stderrTail"])
        self.assertIn("https://registry.npmjs.org/pkg", detail["stderrTail"])
        for secret in (
            "fixture-user",
            "fixture-password",
            "fixture-query",
            "fixture-fragment",
            "fixture-header",
            "fixture-token",
            "ghp_fakecredential",
            "fixture-quoted",
        ):
            self.assertNotIn(secret, message)
        self.assertTrue(message.isascii())
        self.assertFalse(any(ord(char) < 32 for char in message))
        self.assertEqual(len(message.splitlines()), 1)
        self.assertEqual(
            markers.getvalue().splitlines(), ['Container operation {"operation": "install", "status": "started"}']
        )

    def test_actual_child_does_not_inherit_host_secrets_or_docker_settings(self):
        host = {
            key: "host-only-fake-secret"
            for key in ("BOT_TOKEN", "GH_TOKEN", "AWS_SECRET_ACCESS_KEY", "DOCKER_HOST", "HTTP_PROXY")
        }
        with (
            mock.patch.dict(os.environ, host),
            contextlib.redirect_stderr(io.StringIO()),
            mock.patch.object(m.subprocess, "Popen", wraps=m.subprocess.Popen) as popen,
        ):
            output = m.bounded_command(
                [sys.executable, "-c", "import json,os; print(json.dumps(dict(os.environ)))"],
                5,
                operation="build",
            )
        environment = m.parse(output)
        self.assertEqual(popen.call_args.kwargs["env"], {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"})
        self.assertTrue(set(environment).isdisjoint(host))
        self.assertEqual(environment["PATH"], "/usr/local/bin:/usr/bin:/bin")
        self.assertEqual(environment["LANG"], "C.UTF-8")
        self.assertNotIn(b"host-only-fake-secret", output)

    def test_actual_child_output_bound_and_deadline_still_kill_and_reap(self):
        for code, timeout, reason in (
            ("import os,time; os.write(2,b'x'*4096); time.sleep(30)", 5, "Container output bound"),
            ("import time; time.sleep(30)", 0.1, "Container operation deadline"),
        ):
            children = []
            popen = m.subprocess.Popen

            def record(*args, popen=popen, children=children, **kwargs):
                child = popen(*args, **kwargs)
                children.append(child)
                return child

            with (
                self.subTest(reason=reason),
                mock.patch.object(m.subprocess, "Popen", side_effect=record),
                contextlib.redirect_stderr(io.StringIO()),
                self.assertRaises(ValueError) as error,
            ):
                m.bounded_command([sys.executable, "-c", code], timeout, 1024, operation="export-js")
            detail = m.parse(str(error.exception).split(": ", 1)[1].encode())
            self.assertEqual(detail["reason"], reason)
            self.assertEqual(detail["operation"], "export-js")
            self.assertEqual(detail["exitCode"], -m.signal.SIGKILL)
            self.assertEqual(len(children), 1)
            self.assertEqual(children[0].poll(), -m.signal.SIGKILL)
            self.assertTrue(children[0].stdout.closed and children[0].stderr.closed)

    def test_unknown_operation_never_launches_child(self):
        with mock.patch.object(m.subprocess, "Popen") as popen, self.assertRaises(ValueError):
            m.bounded_command([sys.executable], 5, operation="\n::error::unknown")
        popen.assert_not_called()

    def test_install_failure_preserves_diagnostics_and_owned_container_cleanup(self):
        data = fixture()
        calls, run = self.docker(data)
        operations = []

        def fail_install(args, timeout, limit=None, *, operation):
            operations.append(operation)
            if operation == "install":
                return m.bounded_command(
                    [sys.executable, "-c", "import sys; sys.stderr.write('install fixture'); sys.exit(9)"],
                    5,
                    operation=operation,
                )
            return run(args, timeout, limit, operation=operation)

        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.object(m.shutil, "disk_usage", return_value=type("Disk", (), {"free": 8 * 1024**3})()),
            mock.patch.object(m, "container_tree") as parse_tree,
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(ValueError) as error,
        ):
            m.generate_container(data, directory, fail_install)
        detail = m.parse(str(error.exception).split(": ", 1)[1].encode())
        self.assertEqual(
            (detail["operation"], detail["exitCode"], detail["stderrTail"]), ("install", 9, "install fixture")
        )
        self.assertEqual(operations, ["pull", "create", "install", "cleanup-inspect", "cleanup"])
        self.assertEqual(calls[-1][1], "rm")
        parse_tree.assert_not_called()

    def test_exact_source_and_thirteen_outputs(self):
        api = FakeApi()
        context, data, _ = m.admission(api, 10, HEAD)
        self.assertEqual(context["lockSha256"], m.sha(api.data["package-lock.json"]))
        self.assertIn("THIRD-PARTY-NOTICES.md", context["inputs"])
        self.assertEqual(len(m.OUTPUTS), 13)
        m.validate_outputs(data, generated(data))

    def test_source_changes_cannot_enter_privileged_publish(self):
        mutations = (
            lambda api: api.pr["head"]["repo"].update(full_name="foreign/repo"),
            lambda api: api.pr["user"].update(id=1),
            lambda api: api.pr["head"].update(sha=NEW),
            lambda api: api.compare.update(status="diverged"),
            lambda api: api.compare["files"].append({"filename": m.WORKFLOW, "status": "modified"}),
            lambda api: api.compare["files"][0].update(status="renamed", previous_filename="old"),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                api = FakeApi()
                mutate(api)
                with self.assertRaises(ValueError):
                    m.admission(api, 10, HEAD)
                self.assertEqual(api.posts, [])

    def test_package_script_and_remote_tarball_changes_rejected(self):
        data = fixture()
        base = m.parse(data["package.json"])
        package = copy.deepcopy(base)
        package["scripts"]["build:media"] = "evil"
        lock = m.parse(data["package-lock.json"])
        with self.assertRaisesRegex(ValueError, "metadata/scripts"):
            m.package_policy(base, package, lock)
        lock["packages"]["node_modules/rollup"]["resolved"] = "https://example.org/evil.tgz"
        with self.assertRaisesRegex(ValueError, "registry tarballs"):
            m.package_policy(base, base, lock)

    def test_manifest_and_html_custody(self):
        for mutation in ("manifest", "asset", "html", "extra", "raw-lock"):
            with self.subTest(mutation=mutation):
                data = fixture()
                output = generated(data)
                if mutation == "manifest":
                    value = m.parse(output["js/media-runtime.json"])
                    value["builderSha256"] = "0" * 64
                    output["js/media-runtime.json"] = m.json_bytes(value)
                elif mutation == "raw-lock":
                    lock = m.parse(data["package-lock.json"])
                    lock["name"] += "changed"
                    data["package-lock.json"] = m.json_bytes(lock)
                elif mutation == "extra":
                    output["other.js"] = b"evil"
                elif mutation == "html":
                    output["index.html"] += b"<script>evil()</script>"
                else:
                    output["js/hls.min.js"] += b"changed"
                with self.assertRaises(ValueError):
                    m.validate_outputs(data, output)

    def test_raw_zip_strict_before_extraction(self):
        output = generated(fixture())
        context = {"run": 1, "head": HEAD}
        self.assertEqual(m.read_artifact(zip_bytes(output, context), context), output)
        link = zipfile.ZipInfo("files/evil")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for extra in (("receipt.json", b"{}"), ("../escape", b"x"), ("files/extra", b"x"), (link, "../receipt.json")):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                m.read_artifact(zip_bytes(output, context, extra=extra), context)
        with self.assertRaises(ValueError):
            m.read_artifact(zip_bytes(output, context, omit="index.html"), context)
        with self.assertRaises(ValueError):
            m.read_artifact(zip_bytes(output, context), {"run": 2, "head": HEAD})

    def test_private_archive_rejects_links(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "archive.zip"
            path.write_bytes(b"zip fixture")
            link = Path(directory) / "link.zip"
            link.symlink_to(path)
            self.assertEqual(m.read_private_archive(path), b"zip fixture")
            with self.assertRaises(OSError):
                m.read_private_archive(link)

    def test_container_plan_has_no_secret_host_or_socket_mount(self):
        command = m.container_command("ottplay-media-" + "1" * 32, Path("/dedicated/source"))
        self.assertEqual(command.count("--mount"), 1)
        self.assertIn("type=bind,src=/dedicated/source,dst=/source,readonly", command)
        for option in (
            "--read-only",
            "--cap-drop=ALL",
            "no-new-privileges",
            "65532:65532",
            "--pids-limit",
            "--memory",
            m.IMAGE,
        ):
            self.assertIn(option, command)
        self.assertEqual(command[command.index("--env") + 1], "HOME=/tmp")
        self.assertNotIn("--privileged", command)
        self.assertNotIn("docker.sock", " ".join(command))
        self.assertEqual(
            [command[index + 1] for index, argument in enumerate(command) if argument == "--tmpfs"],
            [
                "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777",
                "/work:rw,exec,nosuid,nodev,size=1536m,mode=1777",
            ],
            "Only the private work tmpfs may execute Rollup's native shared library",
        )

    def test_tmpfs_contract_rejects_missing_conflicting_or_wider_exec(self):
        command = m.container_command("ottplay-media-" + "1" * 32, Path("/dedicated/source"))
        work = "/work:rw,exec,nosuid,nodev,size=1536m,mode=1777"
        temporary = "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777"
        for old, new in (
            (work, work.replace(",exec", "")),
            (work, work.replace(",exec", ",exec,noexec")),
            (temporary, temporary.replace(",noexec", ",exec")),
            (temporary, temporary.replace(",noexec", ",noexec,exec")),
            (work, work.replace("/work:", "/source:")),
            (work, work.replace(",nosuid,nodev", "")),
        ):
            changed = [new if argument == old else argument for argument in command]
            with (
                self.subTest(mount=new),
                mock.patch.object(m, "container_command", return_value=changed),
                self.assertRaises(AssertionError),
            ):
                self.test_container_plan_has_no_secret_host_or_socket_mount()

    def docker(self, data, fail_creation=False, wrong_owner=False):
        calls = []
        owner = None
        output = generated(data)

        def run(args, _timeout, _limit=None, *, operation):
            assert operation in m.CONTAINER_OPERATIONS
            nonlocal owner
            calls.append(args)
            if args[:2] == ["docker", "run"]:
                owner = args[args.index("--name") + 1]
                if fail_creation:
                    raise ValueError("Lost creation ACK")
            if args[:2] == ["docker", "inspect"]:
                if args[3] == "{{json .NetworkSettings.Networks}}":
                    return b"{}"
                return m.json_bytes(
                    {
                        "Name": "/" + owner,
                        "Config": {
                            "Image": m.IMAGE,
                            "Labels": {"ottplay.media-followup-owner": "foreign" if wrong_owner else owner},
                        },
                    }
                )
            if args[:2] == ["docker", "exec"] and args[3] == "/bin/tar":
                assert args[3:8] == ["/bin/tar", "-C", "/work", "-cf", "-"]
                return tar_bytes(output, args[8])
            return b""

        return calls, run

    def test_exec_tar_streams_then_cleanup_before_any_validation(self):
        data = fixture()
        calls, run = self.docker(data)
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.object(m.shutil, "disk_usage", return_value=type("Disk", (), {"free": 8 * 1024**3})()),
        ):
            parse_tree = m.container_tree

            def after_cleanup(archive, group):
                self.assertEqual(calls[-1][1], "rm", "Do not inspect outputs before removal")
                return parse_tree(archive, group)

            with mock.patch.object(m, "container_tree", side_effect=after_cleanup):
                self.assertEqual(m.generate_container(data, directory, run), generated(data))
        operations = [call[1] for call in calls]
        self.assertEqual(operations[-1], "rm")
        self.assertNotIn("pause", operations)
        self.assertNotIn("cp", operations)
        exports = [call for call in calls if call[1] == "exec" and call[3] == "/bin/tar"]
        self.assertEqual([call[8] for call in exports], ["js", "index.html", "src-tauri"])
        install = next(i for i, call in enumerate(calls) if call[1] == "exec" and "npm ci" in call[-1])
        disconnect = next(i for i, call in enumerate(calls) if call[1:3] == ["network", "disconnect"])
        build = next(i for i, call in enumerate(calls) if call[1] == "exec" and "media-runtime.cjs build" in call[-1])
        self.assertLess(install, disconnect)
        self.assertLess(disconnect, build)

    def test_lost_creation_ack_still_reconciles_and_removes_only_owner(self):
        for wrong_owner in (False, True):
            with self.subTest(wrong_owner=wrong_owner):
                data = fixture()
                calls, run = self.docker(data, fail_creation=True, wrong_owner=wrong_owner)
                with (
                    tempfile.TemporaryDirectory() as directory,
                    mock.patch.object(m.shutil, "disk_usage", return_value=type("Disk", (), {"free": 8 * 1024**3})()),
                    self.assertRaisesRegex(ValueError, "Lost creation ACK"),
                ):
                    m.generate_container(data, directory, run)
                self.assertEqual(any(call[1] == "rm" for call in calls), not wrong_owner)

    def test_export_or_cleanup_failure_never_parses_or_returns_artifacts(self):
        for failure in ("tar", "cleanup"):
            with self.subTest(failure=failure):
                data = fixture()
                calls, run = self.docker(data)

                def fail(args, timeout, limit=None, *, operation, run=run, failure=failure):
                    result = run(args, timeout, limit, operation=operation)
                    if (failure == "tar" and args[1] == "exec" and args[3] == "/bin/tar") or (
                        failure == "cleanup" and args[1] == "rm"
                    ):
                        raise ValueError(failure + " failed")
                    return result

                with (
                    tempfile.TemporaryDirectory() as directory,
                    mock.patch.object(m.shutil, "disk_usage", return_value=type("Disk", (), {"free": 8 * 1024**3})()),
                    mock.patch.object(m, "container_tree") as parse_tree,
                    mock.patch.object(m, "validate_outputs") as validate,
                    self.assertRaisesRegex(ValueError, failure + " failed"),
                ):
                    m.generate_container(data, directory, fail)
                self.assertEqual(calls[-1][1], "rm")
                parse_tree.assert_not_called()
                validate.assert_not_called()

    def test_aggregate_export_bound_cleans_up_before_parsing(self):
        data = fixture()
        calls, run = self.docker(data)

        def oversized(args, timeout, limit=None, *, operation):
            result = run(args, timeout, limit, operation=operation)
            return b"x" * 66000 if args[1] == "exec" and args[3] == "/bin/tar" else result

        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.object(m.shutil, "disk_usage", return_value=type("Disk", (), {"free": 8 * 1024**3})()),
            mock.patch.object(m, "TOTAL_LIMIT", 1024),
            mock.patch.object(m, "container_tree") as parse_tree,
            self.assertRaisesRegex(ValueError, "Aggregate container TAR"),
        ):
            m.generate_container(data, directory, oversized)
        self.assertEqual(calls[-1][1], "rm")
        parse_tree.assert_not_called()

    def test_group_tar_rejects_linked_parent_and_extra_member(self):
        output = generated(fixture())
        for group in ("js", "src-tauri"):
            link = tarfile.TarInfo(group)
            link.type = tarfile.SYMTYPE
            link.linkname = "/source/" + group
            with self.assertRaises(ValueError):
                m.container_tree(tar_bytes(output, group, extra=link), group)
        extra = tarfile.TarInfo("js/unknown")
        extra.type = tarfile.DIRTYPE
        with self.assertRaises(ValueError):
            m.container_tree(tar_bytes(output, "js", extra=extra), "js")

    def test_real_urllib_no_follow_302_does_not_visit_target(self):
        requests = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(302)
                self.send_header("Location", "/target")
                self.end_headers()

            def log_message(self, *_):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            opener = urllib.request.build_opener(m.NoRedirect)
            with self.assertRaises(urllib.error.HTTPError) as error:
                opener.open("http://127.0.0.1:" + str(server.server_port) + "/start", timeout=2)
            self.assertEqual(error.exception.code, 302)
            error.exception.close()
            self.assertEqual(requests, ["/start"])
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)
            self.assertFalse(worker.is_alive())

    def test_download_redirect_strips_auth_and_validates_digest(self):
        payload = b"ZIP fixture"
        requests = []
        location = "https://productionresultssa1.blob.core.windows.net/artifact?sig=fixture"

        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                if len(requests) == 1:
                    raise urllib.error.HTTPError(request.full_url, 302, "Found", {"Location": location}, io.BytesIO())
                return io.BytesIO(payload)

        with mock.patch.object(m.urllib.request, "build_opener", return_value=Opener()):
            result = m.Api("fixture-read-token").artifact(
                {"artifactId": 1, "artifactDigest": "sha256:" + m.sha(payload)}
            )
        self.assertEqual(result, payload)
        self.assertIn("Authorization", requests[0].headers)
        self.assertNotIn("Authorization", requests[1].headers)
        self.assertEqual(requests[1].full_url, location)

    def test_success_is_one_cas_commit_and_exact_tree(self):
        api = FakeApi()
        plan, archive = api.qualify()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "admitted.zip"
            path.write_bytes(archive)
            result = m.publish(api, lambda api=api: api, api.event, plan, path, Path(directory) / "intent.json")
            self.assertTrue((Path(directory) / "intent.json").exists())
        self.assertEqual(result["status"], "published")
        self.assertEqual(len(api.posts), 1)
        request = api.posts[0][1]["variables"]["input"]
        self.assertEqual(request["expectedHeadOid"], HEAD)
        self.assertEqual(request["branch"], {"repositoryNameWithOwner": m.REPOSITORY, "branchName": m.BRANCH})
        self.assertLessEqual(set(result["paths"]), set(m.OUTPUTS) | {"THIRD-PARTY-NOTICES.md"})

    def test_stale_attempt_artifact_head_or_archive_never_publishes(self):
        for mutation in ("attempt", "artifact-source", "extra-artifact", "head", "zip"):
            with self.subTest(mutation=mutation):
                api = FakeApi()
                plan, archive = api.qualify()
                if mutation == "attempt":
                    api.run["run_attempt"] = 3
                elif mutation == "artifact-source":
                    api.artifacts["artifacts"][0]["workflow_run"]["head_sha"] = NEW
                elif mutation == "extra-artifact":
                    api.artifacts["total_count"] = 2
                elif mutation == "head":
                    api.pr["head"]["sha"] = NEW
                else:
                    archive += b"changed"
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "admitted.zip"
                    path.write_bytes(archive)
                    with self.assertRaises(ValueError):
                        m.publish(api, lambda api=api: api, api.event, plan, path, Path(directory) / "intent.json")
                    self.assertFalse((Path(directory) / "intent.json").exists())
                self.assertEqual(api.posts, [])

    def test_no_artifact_no_publication_and_generated_followup_is_ineligible(self):
        api = FakeApi()
        self.assertEqual(m.publisher_context(api, api.event), (None, None, None))
        api.compare["files"].append({"filename": "js/hls.worker.js", "status": "modified"})
        with self.assertRaises(m.Ineligible):
            m.admission(api, 10, HEAD)

    def test_failed_approval_and_unrelated_receipt_do_not_replace_producer_evidence(self):
        api = FakeApi()
        plan, _ = api.qualify()
        api.run["conclusion"] = "failure"
        api.jobs["jobs"].append(
            {
                "id": 988,
                "name": "Auto approve",
                "run_id": 123,
                "head_sha": HEAD,
                "status": "completed",
                "conclusion": "failure",
            }
        )
        api.jobs["total_count"] = 2
        api.artifacts["artifacts"].append({"name": "approval-receipt-123", "id": 790})
        api.artifacts["total_count"] = 2
        selected, _, _ = m.publisher_context(api, api.event)
        self.assertEqual(selected, plan)
        self.assertEqual(selected["producerJobId"], 987)

    def test_artifact_without_exact_current_attempt_successful_job_is_rejected(self):
        for mutation in ("name", "duplicate", "head", "run", "attempt", "failure", "skipped", "running", "incomplete"):
            with self.subTest(mutation=mutation):
                api = FakeApi()
                api.qualify()
                job = api.jobs["jobs"][0]
                if mutation == "name":
                    job["name"] = "Auto approve"
                elif mutation == "duplicate":
                    api.jobs["jobs"].append(dict(job, id=988))
                    api.jobs["total_count"] = 2
                elif mutation == "head":
                    job["head_sha"] = NEW
                elif mutation == "run":
                    job["run_id"] = 124
                elif mutation == "attempt":
                    job["run_attempt"] = 1
                elif mutation in ("failure", "skipped"):
                    job["conclusion"] = mutation
                elif mutation == "running":
                    job["status"] = "in_progress"
                else:
                    api.jobs["total_count"] = 101
                with self.assertRaises(ValueError):
                    m.publisher_context(api, api.event)
                self.assertEqual(api.posts, [])

    def test_approval_only_artifacts_noop_cancelled_run_stale_and_target_event_rejected(self):
        api = FakeApi()
        api.artifacts = {"total_count": 1, "artifacts": [{"name": "approval-receipt-123", "id": 790}]}
        self.assertEqual(m.publisher_context(api, api.event), (None, None, None))
        api.qualify()
        api.run["conclusion"] = "cancelled"
        with self.assertRaises(m.StaleContext):
            m.publisher_context(api, api.event)
        api.run["conclusion"] = "success"
        api.run["event"] = "pull_request_target"
        with self.assertRaises(ValueError):
            m.publisher_context(api, api.event)
        self.assertEqual(api.posts, [])

    def test_duplicate_current_media_artifacts_fail_closed(self):
        api = FakeApi()
        api.qualify()
        api.artifacts["artifacts"].append(dict(api.artifacts["artifacts"][0], id=790))
        api.artifacts["total_count"] = 2
        with self.assertRaisesRegex(ValueError, "Duplicate generator artifact"):
            m.publisher_context(api, api.event)

    def test_already_current_outputs_are_a_noop_without_intent_or_api_write(self):
        api = FakeApi()
        api.data.update(generated(api.data))
        plan, archive = api.qualify()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "admitted.zip"
            path.write_bytes(archive)
            bot_factory = mock.Mock(side_effect=AssertionError("A no-op does not need BOT_TOKEN"))
            result = m.publish(api, bot_factory, api.event, plan, path, Path(directory) / "intent.json")
            bot_factory.assert_not_called()
            self.assertFalse((Path(directory) / "intent.json").exists())
        self.assertEqual(result["status"], "already-current")
        self.assertEqual(api.posts, [])

    def test_live_source_move_is_distinct_from_invalid_artifact(self):
        for kind in ("head", "closed", "trusted-main", "attempt"):
            with self.subTest(kind=kind):
                api = FakeApi()
                plan, archive = api.qualify()
                if kind == "head":
                    api.pr["head"]["sha"] = NEW
                elif kind == "closed":
                    api.pr["state"] = "closed"
                elif kind == "trusted-main":
                    api.trusted_base = NEW
                else:
                    api.run["run_attempt"] = 3
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "admitted.zip"
                    path.write_bytes(archive)
                    with self.assertRaises(m.StaleContext):
                        m.publish(api, lambda api=api: api, api.event, plan, path, Path(directory) / "intent.json")
                    self.assertFalse((Path(directory) / "intent.json").exists())
                self.assertEqual(api.posts, [])

    def test_notice_context_is_bounded_to_referenced_packages(self):
        api = FakeApi()
        context, _, _ = m.admission(api, 10, HEAD)
        self.assertEqual(set(context["baseVersions"]), set(m.NOTICE_PACKAGES))
        self.assertLess(len(m.json_bytes(context)), 65536)

    def test_notice_updates_are_derived_and_keep_historical_versions(self):
        data = fixture()
        lock = m.parse(data["package-lock.json"])
        base = {
            name.removeprefix("node_modules/"): item.get("version") for name, item in lock["packages"].items() if name
        }
        self.assertEqual(m.update_notices(data, base), data["THIRD-PARTY-NOTICES.md"])
        for name in (
            "shaka-player",
            "hls.js",
            "core-js",
            "jquery",
            "@capacitor/core",
            "@capacitor/android",
            "@capacitor/ios",
            "@capacitor/cli",
        ):
            lock["packages"]["node_modules/" + name]["version"] = "1.0.1"
        data["package-lock.json"] = m.json_bytes(lock)
        result = m.update_notices(data, base)
        self.assertIn(b"**Shaka Player 1.0.1**", result)
        self.assertIn(b"blob/v1.0.1/LICENSE", result)
        self.assertIn(b"**Shaka Player 3.3.19** retained artwork 8.5.1", result)
        self.assertIn(b"**Capacitor core, Android, iOS and CLI/template 1.0.1:**", result)
        lock["packages"]["node_modules/@capacitor/app"]["version"] = "1.0.1"
        data["package-lock.json"] = m.json_bytes(lock)
        with self.assertRaisesRegex(ValueError, "versioned license"):
            m.update_notices(data, base)

    def test_json_rejects_duplicate_and_nonfinite_values(self):
        for value in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":1e999}'):
            with self.assertRaises(ValueError):
                m.parse(value)

    def test_renovate_ignores_only_the_designated_followup_commit_author(self):
        config = m.parse((ROOT / "renovate.json").read_bytes())
        self.assertEqual(
            config.get("gitIgnoredAuthors"),
            ["319626568+californiantiramisu@users.noreply.github.com"],
        )
        self.assertEqual(config["gitIgnoredAuthors"][0], f"{m.BOT_ID}+{m.BOT_LOGIN}@users.noreply.github.com")
        self.assertNotIn("gitAuthor", config, "Do not replace the central signed Renovate identity")

    def test_workflows_keep_secret_boundary_and_required_sandbox_reachability(self):
        def workflow(name):
            return yaml.load((ROOT / ".github/workflows" / name).read_text(), Loader=yaml.BaseLoader)

        maintenance = workflow("auto-approve.yml")
        producer = maintenance["jobs"]["generate-dependency-media"]
        self.assertEqual(producer["permissions"], {"contents": "read", "pull-requests": "read"})
        self.assertEqual(set(producer), {"name", "permissions", "if", "runs-on", "timeout-minutes", "steps"})
        self.assertEqual(producer["name"], m.GENERATOR_JOB)
        self.assertEqual(producer["runs-on"], "ubuntu-24.04")
        self.assertEqual(producer["timeout-minutes"], "20")
        self.assertIn("github.event_name == 'pull_request'", producer["if"])
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", producer["if"])
        self.assertIn("github.event.pull_request.user.id == 319626568", producer["if"])
        self.assertIn("github.event.pull_request.head.ref == 'renovate/npm-lockfile'", producer["if"])
        self.assertNotIn("github.event.action", producer["if"])
        self.assertNotIn("secrets.", str(producer))
        self.assertEqual(
            producer["steps"][0]["with"],
            {"ref": "${{ github.event.pull_request.base.sha }}", "persist-credentials": "false", "path": "trusted"},
        )
        self.assertEqual(
            producer["steps"][1]["env"],
            {"READ_TOKEN": "${{ github.token }}", "TRUSTED_SOURCE": "${{ github.event.pull_request.base.sha }}"},
        )
        self.assertIn("python3 trusted/scripts/dependency-media-followup.py generate", producer["steps"][1]["run"])
        sandbox = workflow("dependency-media-sandbox.yml")
        self.assertEqual(sandbox["on"], {"workflow_call": {}})
        self.assertEqual(sandbox["permissions"], {"contents": "read"})
        self.assertEqual(
            workflow("windows-validation.yml")["jobs"]["dependency-media-sandbox"],
            {"uses": "./.github/workflows/dependency-media-sandbox.yml"},
        )
        sandbox_job = sandbox["jobs"]["sandbox-test"]
        self.assertEqual(sandbox_job["if"], "github.event_name == 'pull_request'")
        self.assertEqual(sandbox_job["steps"][0]["with"]["fetch-depth"], "2")
        scope = sandbox_job["steps"][1]["run"]
        self.assertIn("git --no-pager diff --no-ext-diff --quiet HEAD^ HEAD", scope)
        self.assertIn('if [ "$status" -ne 1 ]; then exit "$status"; fi', scope)
        for name in ("auto-approve.yml", "dependency-media-publish.yml", "dependency-media-sandbox.yml"):
            self.assertIn(".github/workflows/" + name, scope)
        self.assertEqual(sandbox_job["steps"][2]["run"], "python3 scripts/dependency-media-followup.py sandbox-test")
        self.assertNotIn("continue-on-error", str(sandbox_job))
        publisher = workflow("dependency-media-publish.yml")
        self.assertEqual(publisher["on"], {"workflow_run": {"workflows": ["Auto Approve PRs"], "types": ["completed"]}})
        self.assertIn("github.event.workflow_run.event == 'pull_request'", publisher["jobs"]["publish"]["if"])
        self.assertNotIn("conclusion == 'success'", publisher["jobs"]["publish"]["if"])
        publish = (ROOT / ".github/workflows/dependency-media-publish.yml").read_text()
        self.assertEqual(publish.count("BOT_TOKEN: ${{ secrets.BOT_PAT }}"), 1)
        self.assertNotIn("actions/download-artifact", publish)
        self.assertEqual(publish.count("TRUSTED_SOURCE: ${{ github.sha }}"), 3)
        self.assertFalse((ROOT / ".github/workflows/dependency-media-generate.yml").exists())


if __name__ == "__main__":
    unittest.main()
