const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay TV launch "));
const root = path.join(tmp, "project with spaces");
const sdk = path.join(tmp, "SDK with spaces");
const avdHome = path.join(tmp, "AVD with spaces");
const log = path.join(tmp, "calls.jsonl");
const state = path.join(tmp, "devices.json");
const bootState = path.join(tmp, "boot-state.json");
const image = `system-images;android-36;android-tv;${process.arch === "arm64" ? "arm64-v8a" : "x86_64"}`;
const imagePath = path.join(sdk, ...image.split(";"));
fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
fs.mkdirSync(avdHome, { recursive: true });
for (const name of [
    "android-tv-emulator.cjs",
    "setup-android-tv-emulator.sh",
    "run-android-tv-emulator.sh",
]) {
    fs.copyFileSync(
        path.join(__dirname, "../scripts", name),
        path.join(root, "scripts", name)
    );
}
const fake = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const name = path.basename(process.argv[1]);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({name, args})+'\\n');
let devices = JSON.parse(fs.readFileSync(process.env.STATE_FILE));
if (name === 'sdkmanager') {
  if (process.env.FAIL_INSTALL) process.exit(1);
  const image = args.find(arg => arg.startsWith('system-images;'));
  const dir = path.join(process.env.ANDROID_HOME, ...image.split(';'));
  fs.mkdirSync(dir, {recursive:true}); fs.writeFileSync(path.join(dir,'package.xml'),'<package/>');
} else if (name === 'avdmanager') {
  if (fs.readFileSync(0,'utf8') !== 'no\\n') throw new Error('Wrong custom-hardware answer');
  const avd = args[args.indexOf('--name')+1];
  const image = args[args.indexOf('--package')+1];
  const dir = path.join(process.env.ANDROID_AVD_HOME, avd+'.avd');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(process.env.ANDROID_AVD_HOME,avd+'.ini'),'path='+dir+'\\n');
  fs.writeFileSync(path.join(dir,'config.ini'),'image.sysdir.1='+image.replaceAll(';','/')+'\\ntag.id=android-tv\\ndisk.dataPartition.size=6G\\n');
} else if (name === 'emulator') {
  if (args[0] !== '-accel-check') {
    const serial = 'emulator-'+args[args.indexOf('-port')+1];
    devices[serial] = args[args.indexOf('-avd')+1];
    fs.writeFileSync(process.env.STATE_FILE,JSON.stringify(devices));
  }
} else if (name === 'adb') {
  if (args[0] === 'devices') console.log('List of devices attached\\n'+Object.keys(devices).map(id=>id+'\\tdevice').join('\\n'));
  else if(args[2] === 'emu' && args[3] === 'avd') {
    const boot = JSON.parse(fs.readFileSync(process.env.BOOT_STATE));
    if (boot.queried && process.env.IDENTITY_TRANSIENT && !boot.failedIdentity) {
      fs.writeFileSync(process.env.BOOT_STATE, JSON.stringify({...boot, failedIdentity:true}));
      console.error("error: device '"+args[1]+"' not found"); process.exit(1);
    }
    console.log((boot.queried && process.env.IDENTITY_MISMATCH ? 'OtherTV' : devices[args[1]])+'\\nOK');
  }
  else if(args[2] === 'shell' && args[3] === 'getprop') {
    const boot = JSON.parse(fs.readFileSync(process.env.BOOT_STATE));
    fs.writeFileSync(process.env.BOOT_STATE, JSON.stringify({...boot, queried:true}));
    console.log(process.env.NOT_BOOTED ? '0' : '1');
  }
  else if(args[2] === 'shell' && args[3] === 'am') {
    if (process.env.BAD_ACTIVITY_STDERR) console.error('Error: Activity class does not exist.');
    else console.log(process.env.BAD_ACTIVITY ? 'Error: Activity class does not exist.' : 'Status: ok');
  }
  else console.log('Success');
}
`;
for (const relative of [
    "cmdline-tools/latest/bin/sdkmanager",
    "cmdline-tools/latest/bin/avdmanager",
    "platform-tools/adb",
    "emulator/emulator",
]) {
    const file = path.join(sdk, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fake, { mode: 0o755 });
}
function devices(value) {
    fs.writeFileSync(state, JSON.stringify(value));
}
function calls() {
    return fs.existsSync(log)
        ? fs
              .readFileSync(log, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map(JSON.parse)
        : [];
}
function run(mode, args = [], extraEnv = {}, success = true) {
    fs.writeFileSync(log, "");
    fs.writeFileSync(bootState, "{}");
    const result = spawnSync(
        "bash",
        [
            path.join(root, "scripts", `${mode}-android-tv-emulator.sh`),
            "--sdk",
            sdk,
            ...args,
        ],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                ANDROID_AVD_HOME: avdHome,
                BAD_ACTIVITY: "",
                BAD_ACTIVITY_STDERR: "",
                BOOT_STATE: bootState,
                CALL_LOG: log,
                FAIL_INSTALL: "",
                IDENTITY_MISMATCH: "",
                IDENTITY_TRANSIENT: "",
                NOT_BOOTED: "",
                STATE_FILE: state,
                ...extraEnv,
            },
            timeout: 15000,
        }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, success ? 0 : 1, result.stdout + result.stderr);
    return result.stdout + result.stderr;
}
try {
    devices({});
    assert.match(run("setup", ["--dry-run"]), /tv_1080p/);
    assert.equal(calls().length, 0, "dry run must not invoke SDK");
    assert.equal(
        fs.existsSync(path.join(avdHome, "OttplayAndroidTV.ini")),
        false
    );
    assert.match(run("setup", ["--google-tv", "--dry-run"]), /OttplayGoogleTV/);
    assert.match(run("setup", ["--avd", ".."], {}, false), /Invalid AVD/);
    assert.match(run("setup", ["--sdk"], {}, false), /requires a value/);
    assert.match(run("setup", ["--headless"], {}, false), /not a setup option/);
    assert.match(run("setup", ["--data-size", "0"], {}, false), /--data-size/);
    assert.equal(
        calls().length,
        0,
        "invalid data size must not invoke the SDK"
    );
    assert.match(run("setup", [], { FAIL_INSTALL: "1" }, false), /failed/);
    assert.equal(
        calls().some((call) => call.name === "avdmanager"),
        false,
        "failed download must not create an AVD"
    );
    assert.match(run("setup"), /Ready: OttplayAndroidTV/);
    assert.ok(fs.existsSync(path.join(imagePath, "package.xml")));
    const configFile = path.join(avdHome, "OttplayAndroidTV.avd/config.ini");
    assert.match(
        fs.readFileSync(configFile, "utf8"),
        /^disk\.dataPartition\.size=2048M$/m
    );
    assert.deepEqual(calls().find((call) => call.name === "avdmanager").args, [
        "create",
        "avd",
        "--name",
        "OttplayAndroidTV",
        "--package",
        image,
        "--device",
        "tv_1080p",
    ]);
    const originalConfig = fs.readFileSync(configFile, "utf8");
    assert.match(run("setup", ["--data-size", "4096"]), /Keeping existing AVD/);
    assert.equal(
        fs.readFileSync(configFile, "utf8"),
        originalConfig,
        "existing data partition must remain unchanged"
    );
    assert.equal(calls().length, 0, "existing AVD must remain unchanged");
    assert.match(
        run("setup", ["--avd", "CustomTV", "--data-size", "3072"]),
        /Ready: CustomTV/
    );
    assert.match(
        fs.readFileSync(path.join(avdHome, "CustomTV.avd/config.ini"), "utf8"),
        /^disk\.dataPartition\.size=3072M$/m
    );
    assert.match(
        run(
            "setup",
            ["--image", image.replace("android-36", "android-35")],
            {},
            false
        ),
        /different image/
    );
    assert.match(run("run", ["--dry-run", "--headless"]), /-no-window/);
    assert.equal(calls().length, 0);
    assert.match(run("run", ["--port", "5555"], {}, false), /even number/);
    assert.match(run("run", ["--timeout", "0"], {}, false), /--timeout/);
    assert.match(
        run("run", ["--data-size", "2048"], {}, false),
        /not a run option/
    );
    assert.match(
        run("run", ["--component", "bad;command"], {}, false),
        /Invalid Android activity/
    );
    assert.match(run("run", ["--avd", "Absent"], {}, false), /not installed/);
    devices({ "emulator-5554": "ExistingPhone", "emulator-5570": "OtherTV" });
    assert.match(run("run", [], {}, false), /occupied/);
    assert.equal(
        calls().some(
            (call) =>
                call.args.includes("reverse") || call.args.includes("kill")
        ),
        false
    );
    const apk = path.join(tmp, "app with spaces.apk");
    fs.writeFileSync(apk, "fake");
    const apkDirectory = path.join(tmp, "directory.apk");
    fs.mkdirSync(apkDirectory);
    const nonApk = path.join(tmp, "page.html");
    fs.writeFileSync(nonApk, "<title>not an APK</title>");
    for (const invalidApk of [
        apkDirectory,
        nonApk,
        "http://127.0.0.1:8095/app.apk",
    ]) {
        assert.match(
            run(
                "run",
                ["--apk", invalidApk, "--component", "test.ott/.MainActivity"],
                {},
                false
            ),
            /Expected a local APK file/
        );
        assert.equal(
            calls().length,
            0,
            "bad APK input must fail before connecting or booting"
        );
    }
    devices({
        "emulator-5554": "ExistingPhone",
        "emulator-5572": "OttplayAndroidTV",
    });
    assert.match(
        run("run", ["--apk", apk, "--component", "test.ott/.MainActivity"]),
        /Reusing OttplayAndroidTV \(emulator-5572\)/
    );
    assert.equal(
        calls().some((call) => call.name === "emulator"),
        false
    );
    const changes = calls().filter(
        (call) =>
            call.args.includes("reverse") ||
            call.args.includes("install") ||
            call.args.includes("start")
    );
    assert.equal(changes.length, 4);
    assert.ok(changes.every((call) => call.args[1] === "emulator-5572"));
    assert.deepEqual(
        changes.find((call) => call.args.includes("install")).args,
        ["-s", "emulator-5572", "install", "-r", apk]
    );
    assert.match(
        run("run", [], { IDENTITY_TRANSIENT: "1" }),
        /Ready: OttplayAndroidTV/
    );
    const reconnectCalls = calls();
    const firstReverse = reconnectCalls.findIndex((call) =>
        call.args.includes("reverse")
    );
    assert.equal(
        reconnectCalls
            .slice(0, firstReverse)
            .filter((call) => call.args.includes("getprop")).length,
        2,
        "retry a missing ADB transport after boot completion before modifying ports"
    );
    assert.equal(
        reconnectCalls.some((call) => call.name === "emulator"),
        false,
        "ADB reconnect must not restart the emulator"
    );
    assert.match(
        run("run", [], { IDENTITY_MISMATCH: "1" }, false),
        /identity changed/
    );
    assert.equal(
        calls().some(
            (call) =>
                call.args.includes("reverse") ||
                call.args.includes("install") ||
                call.args.includes("kill")
        ),
        false,
        "a different AVD must never receive mutations"
    );
    assert.match(
        run(
            "run",
            ["--component", "test.ott/.Missing"],
            { BAD_ACTIVITY: "1" },
            false
        ),
        /Activity class does not exist/
    );
    assert.match(
        run(
            "run",
            ["--component", "test.ott/.Missing"],
            { BAD_ACTIVITY_STDERR: "1" },
            false
        ),
        /Activity class does not exist/
    );
    run("run", ["--component", "test.ott/.Main$Nested"]);
    assert.equal(
        calls()
            .find((call) => call.args.includes("start"))
            .args.at(-1),
        "'test.ott/.Main$Nested'",
        "protect component dollar signs from the Android shell"
    );
    assert.match(
        run("run", ["--timeout", "1"], { NOT_BOOTED: "1" }, false),
        /Boot timed out/
    );
    assert.match(run("run", ["--stop"]), /Stopped OttplayAndroidTV/);
    assert.deepEqual(calls().find((call) => call.args.includes("kill")).args, [
        "-s",
        "emulator-5572",
        "emu",
        "kill",
    ]);
    devices({ "emulator-5554": "ExistingPhone" });
    assert.match(run("run", ["--stop"]), /not running/);
    assert.equal(
        calls().some((call) => call.args.includes("kill")),
        false
    );
    assert.match(run("run"), /Starting OttplayAndroidTV/);
    assert.ok(
        calls().some(
            (call) =>
                call.name === "emulator" && call.args.includes("-accel-check")
        )
    );
    assert.ok(calls().some((call) => call.args.includes("tcp:8095")));
    assert.ok(calls().some((call) => call.args.includes("tcp:8090")));
    console.log("Android TV setup/launcher integration tests passed");
} finally {
    fs.rmSync(tmp, { force: true, recursive: true });
}
