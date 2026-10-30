const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const { inlineScripts } = require("../scripts/html-scripts.cjs");
const packager = require("../scripts/package-webos.cjs");

const project = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "ottplay webos package ")
);
const digest = (value) => createHash("sha256").update(value).digest("hex");

function git(...args) {
    return execFileSync(
        "git",
        [
            "-c",
            "core.hooksPath=" + path.join(fixture, "empty-hooks"),
            "-c",
            "commit.gpgSign=false",
            ...args,
        ],
        {
            cwd: fixture,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }
    ).trim();
}

function cli(args, succeeds = true) {
    const result = spawnSync(
        process.execPath,
        [path.join(fixture, "scripts/package-webos.cjs"), ...args],
        {
            cwd: fixture,
            encoding: "utf8",
            timeout: 40000,
        }
    );
    assert.equal(result.status === 0, succeeds, result.stderr || result.stdout);
    return result;
}

function python(source, ...args) {
    return execFileSync("python3", ["-I", "-B", "-c", source, ...args], {
        cwd: fixture,
        encoding: "utf8",
        timeout: 30000,
    });
}

const independentReader = `
import io, json, pathlib, tarfile
p = pathlib.Path(__import__('sys').argv[1]).read_bytes()
assert p[:8] == b'!<arch>\\n'
at, members = 8, {}
while at < len(p):
    header=p[at:at+60]
    assert len(header)==60 and header[-2:]==b'\x60\\n'
    name=header[:16].decode().strip()
    size=int(header[48:58])
    assert name not in members
    members[name]=p[at+60:at+60+size]
    at+=60+size+(size%2)
assert at==len(p)
assert list(members)==['debian-binary','control.tar.gz','data.tar.gz']
assert members['debian-binary']==b'2.0\\n'
result={}
for key in ['control.tar.gz','data.tar.gz']:
    with tarfile.open(fileobj=io.BytesIO(members[key]), mode='r:gz') as archive:
        rows=archive.getmembers()
        assert all(r.isfile() or r.isdir() for r in rows)
        assert all(r.uid==0 and r.gid==0 and r.mtime==0 for r in rows)
        assert all(not r.name.startswith('/') and '..' not in r.name.split('/') for r in rows)
        files={r.name:archive.extractfile(r).read() for r in rows if r.isfile()}
        if key=='control.tar.gz':
            assert set(files)=={'control'}
            result['control']=files['control'].decode()
        else:
            result['paths']=sorted(files)
            result['installedSize']=sum(map(len,files.values()))
            result['appinfo']=json.loads(files['usr/palm/applications/com.openottplay.player/appinfo.json'])
            result['build']=json.loads(files['usr/palm/applications/com.openottplay.player/build-info.json'])
            result['packageinfo']=json.loads(files['usr/palm/packages/com.openottplay.player/packageinfo.json'])
print(json.dumps(result))
`;

try {
    fs.mkdirSync(path.join(fixture, "scripts"));
    for (const file of [
        "package-webos.cjs",
        "webos-homebrew.cjs",
        "verify-player-build-source.py",
        "version_plan.py",
        "release_control.py",
    ])
        fs.copyFileSync(
            path.join(project, "scripts", file),
            path.join(fixture, "scripts", file)
        );
    fs.cpSync(path.join(project, "webos"), path.join(fixture, "webos"), {
        recursive: true,
    });
    fs.copyFileSync(
        path.join(project, "LICENSE"),
        path.join(fixture, "LICENSE")
    );
    fs.writeFileSync(
        path.join(fixture, "package.json"),
        JSON.stringify({ name: "fixture", version: "1.2.3" }) + "\n"
    );
    fs.writeFileSync(
        path.join(fixture, ".gitignore"),
        "build/\n.release-plan.json\n.release-inputs.json\n"
    );
    const policy = {
        versioning: {
            files: [
                {
                    field: "version",
                    format: "json",
                    path: "package.json",
                    value: "package",
                },
            ],
            promotion: "promote-bytes",
            schema: 1,
        },
    };
    fs.writeFileSync(
        path.join(fixture, ".release-policy.json"),
        JSON.stringify(policy) + "\n"
    );
    git("init", "--quiet");
    git("add", ".");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Package fixture"
    );
    const source = git("rev-parse", "HEAD");
    const output = path.join(fixture, "build/packages");
    const ipk = path.join(output, packager.NAMES.ipk);
    const metadataPath = path.join(output, packager.NAMES.metadata);

    cli([], false);
    cli(["--local", "--plan", ".release-plan.json"], false);
    cli(["--local", "--unknown"], false);
    cli(["--local"]);
    cli(["--verify", "--local"]);
    let metadata = JSON.parse(fs.readFileSync(metadataPath));
    assert.equal(metadata.webosVersion, "1.0.0");
    assert.equal(metadata.local, true);
    const first = fs.readFileSync(ipk);
    cli(["--local"]);
    assert(
        first.equals(fs.readFileSync(ipk)),
        "Repeated packages must be byte-identical"
    );
    let inspected = JSON.parse(python(independentReader, ipk));
    assert.equal(inspected.appinfo.version, "1.0.0");
    assert.equal(inspected.packageinfo.app, packager.APP_ID);
    assert.equal(inspected.packageinfo.id, packager.APP_ID);
    assert.equal(inspected.packageinfo.package_format_version, 2);
    assert.equal(inspected.appinfo.disableBackHistoryAPI, true);
    assert.equal(inspected.build.target, packager.TARGET);
    assert.equal(inspected.installedSize, metadata.installedSize);
    assert(
        inspected.control.includes(
            "Installed-Size: " + Math.ceil(metadata.installedSize / 1024) + "\n"
        )
    );
    assert.equal(
        inspected.paths.length,
        7,
        "Only launcher, metadata and icons belong in the payload"
    );
    assert.equal(
        fs.readFileSync(path.join(output, packager.NAMES.checksum), "utf8"),
        digest(first) + "  " + packager.NAMES.ipk + "\n"
    );

    const planPath = path.join(fixture, ".release-plan.json");
    const policyHash = python(
        "import json,hashlib,sys; print(hashlib.sha256(json.dumps(json.loads(sys.argv[1]),sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest())",
        JSON.stringify(policy)
    ).trim();
    const plan = {
        base_version: "1.2.3",
        build_number: 10527,
        channel: "beta",
        policy_sha256: policyHash,
        promotion: "promote-bytes",
        schema_version: 1,
        sequence: 4,
        source_sha: source,
        tag: "v1.2.3-beta.4",
        version: "1.2.3-beta.4",
    };
    function setPlan(value) {
        fs.writeFileSync(planPath, JSON.stringify(value) + "\n");
        const version =
            value.channel === "rc" ? value.base_version : value.version;
        fs.writeFileSync(
            path.join(fixture, "package.json"),
            JSON.stringify({ name: "fixture", version }) + "\n"
        );
    }
    setPlan(plan);
    cli(["--verify", "--plan", planPath], false); // A local artifact is not releasable.
    cli(["--plan", planPath]);
    cli(["--verify", "--plan", planPath]);
    metadata = JSON.parse(fs.readFileSync(metadataPath));
    assert.equal(metadata.packageVersion, plan.version);
    assert.equal(metadata.webosVersion, "1.0.10527");
    assert.equal(metadata.buildNumber, 10527);
    assert.equal(metadata.local, false);
    assert.equal(metadata.source, source);
    assert.equal(metadata.releaseTag, plan.tag);
    inspected = JSON.parse(python(independentReader, ipk));
    assert.equal(inspected.appinfo.version, metadata.webosVersion);
    assert.equal(inspected.build.packageVersion, plan.version);
    assert.equal(inspected.packageinfo.version, metadata.webosVersion);
    const betaBytes = fs.readFileSync(ipk);
    cli(["--plan", planPath]);
    assert(
        betaBytes.equals(fs.readFileSync(ipk)),
        "Frozen release output must be deterministic"
    );

    function checkFeed(identity) {
        execFileSync(
            process.execPath,
            [
                path.join(fixture, "scripts/webos-homebrew.cjs"),
                "--plan",
                planPath,
            ],
            {
                cwd: fixture,
                encoding: "utf8",
                timeout: 40000,
            }
        );
        const manifest = JSON.parse(
            fs.readFileSync(
                path.join(output, "ottplay-foss-webos-manifest.json")
            )
        );
        const repository = JSON.parse(
            fs.readFileSync(
                path.join(output, "ottplay-foss-webos-repository.json")
            )
        );
        const description = fs.readFileSync(
            path.join(output, "ottplay-foss-webos-description.html"),
            "utf8"
        );
        const icon = fs.readFileSync(
            path.join(output, "ottplay-foss-webos-icon.png")
        );
        assert.equal(manifest.ipkHash.sha256, identity.sha256);
        assert.equal(manifest.version, identity.webosVersion);
        assert.equal(manifest.ipkSize, identity.bytes);
        assert.equal(manifest.installedSize, identity.installedSize);
        assert.equal(manifest.rootRequired, false);
        assert.equal(
            manifest.ipkUrl,
            "https://github.com/open-ott-play/ottplay-foss/releases/download/" +
                identity.releaseTag +
                "/" +
                packager.NAMES.ipk
        );
        assert.equal(digest(icon), identity.largeIconSha256);
        assert(
            repository.packages[0].manifestUrl.includes(
                "/" + identity.releaseTag + "/"
            )
        );
        assert(description.includes(identity.releaseTag));
    }
    checkFeed(metadata);

    const rc = {
        ...plan,
        build_number: 10528,
        channel: "rc",
        sequence: 1,
        tag: "v1.2.3-rc.1",
        version: "1.2.3-rc.1",
    };
    setPlan(rc);
    cli(["--plan", planPath]);
    metadata = JSON.parse(fs.readFileSync(metadataPath));
    assert.equal(
        metadata.packageVersion,
        "1.2.3",
        "Promote-bytes RC must retain base package version"
    );
    assert.equal(metadata.releaseTag, rc.tag);
    assert.equal(metadata.webosVersion, "1.0.10528");
    checkFeed(metadata);
    const cleanMetadata = JSON.stringify(metadata);
    metadata.webosVersion = "1.0.999";
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    cli(["--verify", "--plan", planPath], false);
    fs.writeFileSync(metadataPath, cleanMetadata);
    fs.writeFileSync(
        ipk,
        Buffer.concat([fs.readFileSync(ipk), Buffer.from("unexpected")])
    );
    cli(["--verify", "--plan", planPath], false);
    cli(["--plan", planPath]);

    // Recompute the outer checksum after modifying a payload. The verifier must
    // still reject the content instead of trusting a matching sidecar digest.
    const corruptPayload = `
import gzip,hashlib,io,json,pathlib,sys,tarfile
p=pathlib.Path(sys.argv[1]); side=pathlib.Path(sys.argv[2]); kind=sys.argv[3]
raw=p.read_bytes(); at=8; members={}
while at<len(raw):
    h=raw[at:at+60]; n=h[:16].decode().strip(); size=int(h[48:58]); members[n]=raw[at+60:at+60+size]; at+=60+size+(size%2)
out=io.BytesIO()
with tarfile.open(fileobj=io.BytesIO(members['data.tar.gz']),mode='r:gz') as before, tarfile.open(fileobj=out,mode='w',format=tarfile.USTAR_FORMAT) as after:
    for entry in before.getmembers():
        data=before.extractfile(entry).read() if entry.isfile() else None
        if kind=='redirect' and entry.name.endswith('/index.html'):
            data=data.replace(b'https://player.ottplay.here.now/',b'https://unrelated.example.test/')
            entry.size=len(data)
        after.addfile(entry,io.BytesIO(data) if data is not None else None)
    if kind in ('path','link','extra','directory'):
        entry=tarfile.TarInfo('../outside' if kind=='path' else 'unexpected' + ('/' if kind=='directory' else ''))
        entry.mode=0o755 if kind=='directory' else 0o644
        if kind=='link': entry.type=tarfile.SYMTYPE; entry.linkname='/outside'
        if kind=='directory': entry.type=tarfile.DIRTYPE
        after.addfile(entry)
members['data.tar.gz']=gzip.compress(out.getvalue(),mtime=0)
if kind=='size': members['data.tar.gz']=gzip.compress(b'x'*(4*1024*1024+1),mtime=0)
result=b'!<arch>\\n'
for name,data in members.items():
    result+=(name.ljust(16)+'0'.ljust(12)+'0'.ljust(6)+'0'.ljust(6)+'100644'.ljust(8)+str(len(data)).ljust(10)+'\x60\\n').encode()+data
    if len(data)%2: result+=b'\\n'
p.write_bytes(result)
meta=json.loads(side.read_bytes()); meta['bytes']=len(result); meta['sha256']=hashlib.sha256(result).hexdigest(); side.write_text(json.dumps(meta))
`;
    const validIpk = fs.readFileSync(ipk);
    const validSidecar = fs.readFileSync(metadataPath);
    for (const variant of [
        "redirect",
        "path",
        "link",
        "extra",
        "directory",
        "size",
    ]) {
        python(corruptPayload, ipk, metadataPath, variant);
        cli(["--verify", "--plan", planPath], false);
        fs.writeFileSync(ipk, validIpk);
        fs.writeFileSync(metadataPath, validSidecar);
    }

    setPlan({ ...plan, source_sha: "a".repeat(40) });
    cli(["--plan", planPath], false);
    setPlan({ ...plan, policy_sha256: "b".repeat(64) });
    cli(["--plan", planPath], false);
    setPlan({ ...plan, build_number: 1000000000 });
    cli(["--plan", planPath], false);
    setPlan(plan);
    const launcher = path.join(fixture, "webos/index.html");
    const originalLauncher = fs.readFileSync(launcher);
    fs.appendFileSync(launcher, "\n<!-- modified -->\n");
    cli(["--plan", planPath], false);
    fs.writeFileSync(launcher, originalLauncher);
    git("update-index", "--assume-unchanged", "webos/index.html");
    cli(["--plan", planPath], false);
    git("update-index", "--no-assume-unchanged", "webos/index.html");
    cli(["--plan", planPath]);

    // The pre-navigation page must use ES5 and permit Back without loading the site.
    const scripts = inlineScripts(originalLauncher.toString());
    assert.equal(scripts.length, 1);
    acorn.parse(scripts[0], { ecmaVersion: 5 });
    let listener,
        target,
        focused = 0,
        closes = 0,
        prevented = 0;
    vm.runInNewContext(scripts[0], {
        document: {
            addEventListener: (type, handler) => {
                assert.equal(type, "keydown");
                listener = handler;
            },
            getElementById: () => ({ focus: () => focused++ }),
        },
        window: {
            close: () => closes++,
            location: { replace: (url) => (target = url) },
        },
    });
    assert.equal(target, packager.TARGET);
    assert.equal(focused, 1);
    listener({ keyCode: 461, preventDefault: () => prevented++ });
    assert.equal(closes, 1);
    assert.equal(prevented, 1);
    listener({ keyCode: 40 });
    assert.equal(closes, 1);

    // A pre-existing output link may not redirect package writes elsewhere.
    if (process.platform !== "win32") {
        const sentinel = path.join(fixture, "build/sentinel");
        fs.writeFileSync(sentinel, "retained");
        fs.unlinkSync(ipk);
        fs.symlinkSync(sentinel, ipk);
        cli(["--local"], false);
        assert.equal(fs.readFileSync(sentinel, "utf8"), "retained");
        fs.unlinkSync(ipk);
        const missing = path.join(fixture, "build/not-created");
        fs.symlinkSync(missing, ipk);
        cli(["--local"], false);
        assert.equal(fs.existsSync(missing), false);
    }
    console.log(
        "webOS package tests passed: deterministic IPK, independent extraction, release binding, local rejection, Back, safe outputs"
    );
} finally {
    fs.rmSync(fixture, { force: true, recursive: true });
}
