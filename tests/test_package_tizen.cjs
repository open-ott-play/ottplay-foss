const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const packager = require("../scripts/package-tizen.cjs");
const {
    CLASSIC_PROVIDER_BUNDLES,
    CLASSIC_OPTIONAL_BUNDLES,
} = require("../scripts/classic-bundle.cjs");

const root = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "ottplay tizen package ")
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function python(code, ...args) {
    return execFileSync("python3", ["-I", "-B", "-c", code, ...args], {
        cwd: fixture,
        encoding: "utf8",
        timeout: 30000,
    });
}
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
        { cwd: fixture, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
}
function cli(args, success = true) {
    const result = spawnSync(
        process.execPath,
        [path.join(fixture, "scripts/package-tizen.cjs"), ...args],
        {
            cwd: fixture,
            encoding: "utf8",
            timeout: 60000,
        }
    );
    assert.equal(result.status === 0, success, result.stderr || result.stdout);
    return result;
}

try {
    fs.mkdirSync(path.join(fixture, "scripts"));
    for (const name of [
        "package-tizen.cjs",
        "package-webos.cjs",
        "tizen-install.py",
        "classic-bundle.cjs",
        "prepare_browser_candidate.py",
        "verify-player-build-source.py",
        "version_plan.py",
        "release_control.py",
    ])
        fs.copyFileSync(
            path.join(root, "scripts", name),
            path.join(fixture, "scripts", name)
        );
    fs.cpSync(path.join(root, "tizen"), path.join(fixture, "tizen"), {
        recursive: true,
    });
    fs.copyFileSync(path.join(root, "LICENSE"), path.join(fixture, "LICENSE"));
    for (const name of packager.NOTICE_FILES) {
        fs.mkdirSync(path.dirname(path.join(fixture, name)), {
            recursive: true,
        });
        fs.copyFileSync(path.join(root, name), path.join(fixture, name));
    }
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
    const directory = path.join(fixture, "build/packages");
    fs.mkdirSync(directory, { recursive: true });
    const wgt = path.join(directory, packager.NAMES.wgt);
    const metadata = path.join(directory, packager.NAMES.metadata);
    function makeModeA(version = "1.2.3", revision = source) {
        const files = {
            "dist/player.js": "/* classic player */",
            "index.html":
                '<!doctype html><script src="/js/runtime-polyfills.js?v=1"></script><script>window.original=true;</script>',
            "js/licenses/@fixture-LICENSE.txt": "Fixture license",
            "js/runtime-polyfills.js": "/* runtime */",
        };
        const info = {
            bundleSha256: sha(files["dist/player.js"]),
            optionalBundles: {},
            providerBundles: {},
            revision,
            version,
        };
        for (const [field, inventory, prefix] of [
            ["providerBundles", CLASSIC_PROVIDER_BUNDLES, "provider-"],
            ["optionalBundles", CLASSIC_OPTIONAL_BUNDLES, ""],
        ]) {
            for (const name of Object.keys(inventory)) {
                const file = "dist/" + prefix + name + ".js";
                files[file] = "/* " + name + " */";
                info[field][name] = {
                    bytes: Buffer.byteLength(files[file]),
                    file,
                    sha256: sha(files[file]),
                };
            }
        }
        files["build-info.json"] = JSON.stringify(info) + "\n";
        python(
            `
import hashlib, io, json, pathlib, sys, tarfile
directory=pathlib.Path(sys.argv[1]); files=json.loads(sys.argv[2])
archive=directory/'ottplay-foss-modea.tar.gz'
with tarfile.open(archive,'w:gz') as out:
    for name,value in sorted(files.items()):
        data=value.encode(); item=tarfile.TarInfo(name); item.size=len(data); item.mode=0o644
        out.addfile(item,io.BytesIO(data))
(directory/'ottplay-foss-modea.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\\n')
`,
            directory,
            JSON.stringify(files)
        );
    }

    makeModeA();
    cli([], false);
    cli(["--local", "--plan", ".release-plan.json"], false);
    cli(["--local", "--unknown"], false);
    cli(["--local"]);
    cli(["--local", "--verify"]);
    const first = fs.readFileSync(wgt);
    cli(["--local"]);
    assert(
        first.equals(fs.readFileSync(wgt)),
        "Unsigned WGT must be reproducible"
    );
    const inspected = JSON.parse(
        python(
            `
import hashlib,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    assert all(item.date_time==(1980,1,1,0,0,0) for item in archive.infolist())
    assert all(item.create_system==3 for item in archive.infolist())
    print(json.dumps({'index':archive.read('index.html').decode(),'config':archive.read('config.xml').decode(),
        'identity':json.loads(archive.read('tizen-build-info.json')), 'paths':archive.namelist(),
        'hashes':{name:hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist()}}))
`,
            wgt
        )
    );
    assert(inspected.index.startsWith("<!doctype html>" + packager.MARKER));
    assert(inspected.index.includes('src="js/runtime-polyfills.js?v=1"'));
    assert(!inspected.index.includes('src="/js/'));
    assert(inspected.config.includes('profile name="tv-samsung"'));
    assert.equal(inspected.identity.tizenVersion, "1.0.0");
    assert(!inspected.paths.some((name) => /signature\d?\.xml/.test(name)));
    for (const name of packager.NOTICE_FILES) {
        assert.equal(
            inspected.hashes[name],
            sha(fs.readFileSync(path.join(root, name))),
            "Required notice must be copied unchanged: " + name
        );
    }
    assert.deepEqual(
        inspected.paths.filter((name) => name.startsWith("licenses/android/")),
        packager.NOTICE_FILES.filter((name) =>
            name.startsWith("licenses/android/")
        )
    );
    const requiredNotice = path.join(fixture, packager.NOTICE_FILES[0]);
    const noticeBytes = fs.readFileSync(requiredNotice);
    fs.unlinkSync(requiredNotice);
    cli(["--local"], false);
    fs.writeFileSync(requiredNotice, noticeBytes);
    fs.appendFileSync(requiredNotice, "\nChanged notice\n");
    cli(["--local", "--verify"], false);
    fs.writeFileSync(requiredNotice, noticeBytes);
    cli(["--local", "--verify"]);

    const policyHash = python(
        "import hashlib,json,sys;print(hashlib.sha256(json.dumps(json.loads(sys.argv[1]),sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest())",
        JSON.stringify(policy)
    ).trim();
    const plan = {
        base_version: "1.2.3",
        build_number: 10531,
        channel: "beta",
        policy_sha256: policyHash,
        promotion: "promote-bytes",
        schema_version: 1,
        sequence: 6,
        source_sha: source,
        tag: "v1.2.3-beta.6",
        version: "1.2.3-beta.6",
    };
    const planPath = path.join(fixture, ".release-plan.json");
    function setPlan(value) {
        fs.writeFileSync(planPath, JSON.stringify(value) + "\n");
        const version =
            value.channel === "rc" ? value.base_version : value.version;
        fs.writeFileSync(
            path.join(fixture, "package.json"),
            JSON.stringify({ name: "fixture", version }) + "\n"
        );
        makeModeA(version);
    }
    setPlan(plan);
    cli(["--verify", "--plan", planPath], false);
    cli(["--plan", planPath]);
    cli(["--verify", "--plan", planPath]);
    let info = JSON.parse(fs.readFileSync(metadata));
    assert.equal(info.tizenVersion, "1.0.10531");
    assert.equal(info.packageVersion, plan.version);
    assert.equal(info.releaseTag, plan.tag);
    assert.equal(info.source, source);
    assert.equal(info.unsigned, true);
    assert.equal(
        info.installerSha256,
        sha(fs.readFileSync(path.join(root, "scripts/tizen-install.py")))
    );

    makeModeA("1.2.3");
    cli(["--plan", planPath], false);
    makeModeA(plan.version, "a".repeat(40));
    cli(["--plan", planPath], false);
    setPlan({ ...plan, policy_sha256: "c".repeat(64) });
    cli(["--plan", planPath], false);
    setPlan({ ...plan, source_sha: "c".repeat(40) });
    cli(["--plan", planPath], false);
    setPlan(plan);
    fs.appendFileSync(path.join(fixture, "tizen/config.xml"), "\n");
    cli(["--plan", planPath], false);
    git("checkout", "--", "tizen/config.xml");

    const rc = {
        ...plan,
        build_number: 65536,
        channel: "rc",
        sequence: 1,
        tag: "v1.2.3-rc.1",
        version: "1.2.3-rc.1",
    };
    setPlan(rc);
    cli(["--plan", planPath]);
    info = JSON.parse(fs.readFileSync(metadata));
    assert.equal(info.tizenVersion, "1.1.0");
    assert.equal(info.packageVersion, "1.2.3");
    assert.equal(info.releaseTag, rc.tag);
    python(
        `
import hashlib,json,pathlib,runpy,sys
d=pathlib.Path(sys.argv[1]); m=runpy.run_path(sys.argv[2]); p=d/m['UNSIGNED_NAME']; side=d/m['METADATA_NAME']
files=m['zip_files'](p.read_bytes()); files['dist/player.js']=b'changed player'
classic=json.loads(files['build-info.json']); classic['bundleSha256']=m['digest'](files['dist/player.js'])
files['build-info.json']=json.dumps(classic).encode(); raw=m['write_zip'](files);p.write_bytes(raw)
meta=json.loads(side.read_bytes());meta['bytes']=len(raw);meta['sha256']=m['digest'](raw)
meta['entries']=[{'path':name,'bytes':len(data),'sha256':m['digest'](data)} for name,data in sorted(files.items())]
side.write_text(json.dumps(meta));(d/m['CHECKSUM_NAME']).write_text(meta['sha256']+'  '+m['UNSIGNED_NAME']+'\\n')
`,
        directory,
        path.join(fixture, "scripts/tizen-install.py")
    );
    cli(["--verify", "--plan", planPath], false);
    cli(["--plan", planPath]);

    const helper = path.join(directory, packager.NAMES.installer);
    const sentinel = path.join(fixture, "build", "sentinel");
    fs.writeFileSync(sentinel, "preserve");
    fs.unlinkSync(helper);
    fs.symlinkSync(sentinel, helper);
    cli(["--plan", planPath], false);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");
    assert.equal(packager.versionForBuild(16777216), "2.0.0");
    assert.throws(() => packager.versionForBuild(1000000000));
    assert.throws(() => packager.adaptIndex(Buffer.from("<script></script>")));
    assert.throws(() => packager.adaptIndex(Buffer.from(inspected.index)));
    console.log("Tizen package contracts passed");
} finally {
    fs.rmSync(fixture, { force: true, recursive: true });
}
