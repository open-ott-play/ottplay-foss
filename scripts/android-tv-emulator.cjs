#!/usr/bin/env node
// SDK orchestration only: no server, firmware download mirror or license acceptance.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

function fail(message) {
    throw new Error(message);
}
function quote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function print(command, args) {
    console.log([command, ...args].map(quote).join(" "));
}
function invoke(command, args, options = {}) {
    const { includeStderr = false, ...spawnOptions } = options;
    const result = spawnSync(command, args, {
        encoding: "utf8",
        timeout: 15000,
        ...spawnOptions,
    });
    if (result.error || result.status !== 0) {
        fail(
            result.error?.message ||
                `${path.basename(command)} failed: ${(result.stderr || result.stdout || "").trim()}`
        );
    }
    return (
        (result.stdout || "") + (includeStderr ? result.stderr || "" : "")
    ).trim();
}
function tool(sdk, relative, fallback) {
    const candidate = path.join(sdk, relative);
    if (fs.existsSync(candidate)) return candidate;
    return fallback;
}
function readIni(file) {
    return Object.fromEntries(
        fs
            .readFileSync(file, "utf8")
            .split(/\r?\n/)
            .filter((line) => line.includes("="))
            .map((line) => {
                const split = line.indexOf("=");
                return [
                    line.slice(0, split).trim(),
                    line.slice(split + 1).trim(),
                ];
            })
    );
}
function help(mode) {
    console.log(`Usage: scripts/${mode === "setup" ? "setup" : "run"}-android-tv-emulator.sh [options]

  --sdk DIRECTORY   Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT)
  --google-tv       Use Google TV instead of Android TV
  --avd NAME        AVD name (OttplayAndroidTV or OttplayGoogleTV)
  --dry-run         Print commands; do not install, create, boot or connect
  --help            Show this help

Setup options:
  --image PACKAGE   Default: system-images;android-36;android-tv;arm64-v8a
                    (x86_64 on Intel; google-tv with --google-tv)
  --device ID       Default: tv_1080p
  --data-size MB    New AVD data partition (default: 2048; existing AVD unchanged)

Run options:
  --port NUMBER     Console port for a new instance (default: 5570)
  --timeout SECONDS Boot timeout (default: 180)
  --headless        Start without a window
  --apk FILE        Install an APK on this TV AVD; requires --component
  --component NAME  Launch an installed activity, e.g. package/.MainActivity
  --stop            Stop only this named TV AVD

Requires separately installed Android command-line tools and Java.
Setup leaves license prompts interactive and never overwrites an existing AVD.
Run boots the TV home screen, or the explicit APK/activity. It reverses ports
8095 (existing player/companion) and 8090 (playlist proxy) through ADB so guest
127.0.0.1 reaches the host stack. No browser or player app is assumed installed.
No server is started and no APK is built or downloaded by this script.`);
}

async function main() {
    const [mode, ...argv] = process.argv.slice(2);
    if (!["setup", "run"].includes(mode)) fail("Expected setup or run");
    const options = {};
    const valueOptions = [
        "sdk",
        "avd",
        "image",
        "device",
        "data-size",
        "port",
        "timeout",
        "apk",
        "component",
    ];
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, "");
        if (argv[i] === "--help" || argv[i] === "-h") {
            help(mode);
            return;
        }
        if (argv[i] === `--${key}` && valueOptions.includes(key)) {
            if (!argv[i + 1] || argv[i + 1].startsWith("--"))
                fail(`${argv[i]} requires a value`);
            options[key] = argv[++i];
        } else if (
            ["--dry-run", "--google-tv", "--headless", "--stop"].includes(
                argv[i]
            )
        )
            options[key] = true;
        else fail(`Unknown option: ${argv[i]}`);
    }
    for (const key of mode === "setup"
        ? ["port", "timeout", "apk", "component", "headless", "stop"]
        : ["image", "device", "data-size"]) {
        if (options[key] !== undefined)
            fail(`--${key} is not a ${mode} option`);
    }
    const tag = options["google-tv"] ? "google-tv" : "android-tv";
    const avd =
        options.avd ||
        (options["google-tv"] ? "OttplayGoogleTV" : "OttplayAndroidTV");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(avd)) fail("Invalid AVD name");
    const defaultSdk =
        process.platform === "darwin"
            ? path.join(os.homedir(), "Library/Android/sdk")
            : path.join(os.homedir(), "Android/Sdk");
    const brewSdk = "/opt/homebrew/share/android-commandlinetools";
    const sdk = path.resolve(
        options.sdk ||
            process.env.ANDROID_HOME ||
            process.env.ANDROID_SDK_ROOT ||
            (fs.existsSync(defaultSdk)
                ? defaultSdk
                : fs.existsSync(brewSdk)
                  ? brewSdk
                  : defaultSdk)
    );
    const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
    const avdHome =
        process.env.ANDROID_AVD_HOME ||
        path.join(
            process.env.ANDROID_USER_HOME ||
                path.join(os.homedir(), ".android"),
            "avd"
        );
    const avdIni = path.join(avdHome, `${avd}.ini`);
    const sdkmanager = tool(
        sdk,
        "cmdline-tools/latest/bin/sdkmanager",
        "sdkmanager"
    );
    const avdmanager = tool(
        sdk,
        "cmdline-tools/latest/bin/avdmanager",
        "avdmanager"
    );
    const emulator = path.join(sdk, "emulator/emulator");
    const adb = path.join(sdk, "platform-tools/adb");
    const dry = options["dry-run"];
    if (mode === "setup") {
        const dataSize = Number(options["data-size"] || 2048);
        if (!Number.isInteger(dataSize) || dataSize < 512 || dataSize > 65536)
            fail("--data-size must be an integer between 512 and 65536 MB");
        const image =
            options.image ||
            `system-images;android-36;${tag};${process.arch === "arm64" ? "arm64-v8a" : "x86_64"}`;
        if (
            !/^system-images;android-\d+;(android-tv|google-tv);(arm64-v8a|x86_64)$/.test(
                image
            )
        )
            fail("Expected an Android TV or Google TV system image package");
        if (
            process.platform === "darwin" &&
            process.arch === "arm64" &&
            !image.endsWith(";arm64-v8a")
        )
            fail(
                "The Android Emulator on Apple Silicon requires an ARM64 image; Rosetta does not provide x86 VM acceleration"
            );
        const imagePath = path.join(sdk, ...image.split(";"));
        const existingAvd = fs.existsSync(avdIni);
        if (existingAvd) {
            const config = readIni(
                path.join(
                    readIni(avdIni).path || path.join(avdHome, `${avd}.avd`),
                    "config.ini"
                )
            );
            if (
                path.resolve(sdk, config["image.sysdir.1"] || "") !==
                path.resolve(imagePath)
            )
                fail(
                    `Existing ${avd} uses a different image; choose another --avd name`
                );
        }
        const packages = fs.existsSync(path.join(imagePath, "package.xml"))
            ? []
            : [image];
        if (!fs.existsSync(emulator)) packages.push("emulator");
        if (!fs.existsSync(adb)) packages.push("platform-tools");
        const installArgs = [`--sdk_root=${sdk}`, "--install", ...packages];
        const createArgs = [
            "create",
            "avd",
            "--name",
            avd,
            "--package",
            image,
            "--device",
            options.device || "tv_1080p",
        ];
        if (packages.length) print(sdkmanager, installArgs);
        if (!dry && packages.length) {
            invoke(sdkmanager, installArgs, {
                env,
                stdio: "inherit",
                timeout: 0,
            });
            if (!fs.existsSync(path.join(imagePath, "package.xml")))
                fail(
                    "System image was not installed; review any SDK license prompt manually"
                );
        }
        if (existingAvd) {
            console.log(`Keeping existing AVD: ${avd}`);
            return;
        }
        print(avdmanager, createArgs);
        console.log(`New AVD data partition: ${dataSize} MB`);
        if (!dry) {
            // 'no' answers the custom hardware-profile question, not a license.
            invoke(avdmanager, createArgs, {
                env,
                input: "no\n",
                timeout: 60000,
            });
            if (!fs.existsSync(avdIni))
                fail("AVD creation did not produce its configuration");
            const configFile = path.join(
                readIni(avdIni).path || path.join(avdHome, `${avd}.avd`),
                "config.ini"
            );
            const configText = fs.readFileSync(configFile, "utf8");
            const dataSetting = `disk.dataPartition.size=${dataSize}M`;
            fs.writeFileSync(
                configFile,
                /^[ \t]*disk\.dataPartition\.size[ \t]*=/m.test(configText)
                    ? configText.replace(
                          /^[ \t]*disk\.dataPartition\.size[ \t]*=.*$/m,
                          dataSetting
                      )
                    : configText.replace(/\n?$/, "\n") + dataSetting + "\n"
            );
            console.log(
                `Ready: ${avd}. Run ./scripts/run-android-tv-emulator.sh --avd ${avd}`
            );
        }
        return;
    }
    const port = Number(options.port || 5570);
    const timeout = Number(options.timeout || 180);
    if (!Number.isInteger(port) || port < 5554 || port > 5682 || port % 2)
        fail("--port must be an even number from 5554 to 5682");
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 1800)
        fail("--timeout must be between 1 and 1800 seconds");
    if (options.apk && !options.component)
        fail("--apk requires --component (the activity to launch)");
    if (
        options.component &&
        !/^[A-Za-z][\w.]*\/[A-Za-z.][\w.$]*$/.test(options.component)
    )
        fail("Invalid Android activity component");
    if (options.stop && (options.apk || options.component))
        fail("--stop cannot install or launch an APK");
    if (
        options.apk &&
        (!/\.apk$/i.test(options.apk) ||
            !fs.existsSync(options.apk) ||
            !fs.statSync(options.apk).isFile())
    )
        fail(`Expected a local APK file: ${options.apk}`);
    const bootArgs = [
        "-avd",
        avd,
        "-port",
        String(port),
        "-no-boot-anim",
        "-no-snapshot-save",
        "-gpu",
        "auto",
    ];
    if (options.headless) bootArgs.push("-no-window");
    let serial = `emulator-${port}`;
    if (dry) {
        if (options.stop) print(adb, ["-s", serial, "emu", "kill"]);
        else {
            print(emulator, bootArgs);
            for (const reverse of [8095, 8090])
                print(adb, [
                    "-s",
                    serial,
                    "reverse",
                    `tcp:${reverse}`,
                    `tcp:${reverse}`,
                ]);
            if (options.apk)
                print(adb, [
                    "-s",
                    serial,
                    "install",
                    "-r",
                    path.resolve(options.apk),
                ]);
            if (options.component)
                print(adb, [
                    "-s",
                    serial,
                    "shell",
                    "am",
                    "start",
                    "-W",
                    "-n",
                    quote(options.component),
                ]);
        }
        return;
    }
    if (!fs.existsSync(avdIni))
        fail(
            `AVD ${avd} is not installed; run setup-android-tv-emulator.sh first`
        );
    const avdConfig = readIni(
        path.join(
            readIni(avdIni).path || path.join(avdHome, `${avd}.avd`),
            "config.ini"
        )
    );
    if (!["android-tv", "google-tv"].includes(avdConfig["tag.id"]))
        fail(`AVD ${avd} is not an Android TV / Google TV profile`);
    const devices = invoke(adb, ["devices"], { env })
        .split(/\r?\n/)
        .map((line) => line.split(/\s+/))
        .filter((fields) => /^emulator-\d+$/.test(fields[0]));
    const matching = devices.filter(
        ([id, state]) =>
            state === "device" &&
            invoke(adb, ["-s", id, "emu", "avd", "name"], { env }).split(
                /\r?\n/
            )[0] === avd
    );
    if (matching.length > 1)
        fail(
            `Multiple running instances of ${avd}; close the extra instance first`
        );
    if (matching.length) serial = matching[0][0];
    if (options.stop) {
        if (matching.length) {
            invoke(adb, ["-s", serial, "emu", "kill"], { env });
            console.log(`Stopped ${avd} (${serial})`);
        } else console.log(`${avd} is not running`);
        return;
    }
    let child;
    if (!matching.length) {
        if (devices.some(([id]) => id === serial))
            fail(`${serial} is occupied by another AVD; select another --port`);
        invoke(emulator, ["-accel-check"], { env });
        const logDir = path.resolve(__dirname, "../build/emulator-logs");
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, `${avd}.log`);
        const fd = fs.openSync(logFile, "a");
        child = spawn(emulator, bootArgs, {
            detached: true,
            env,
            stdio: ["ignore", fd, fd],
        });
        fs.closeSync(fd);
        child.on("error", (error) => {
            console.error(error.message);
        });
        child.unref();
        console.log(`Starting ${avd} (${serial}); log: ${logFile}`);
    } else console.log(`Reusing ${avd} (${serial})`);
    const deadline = Date.now() + timeout * 1000;
    let booted = false;
    while (Date.now() < deadline) {
        const result = spawnSync(
            adb,
            ["-s", serial, "shell", "getprop", "sys.boot_completed"],
            { encoding: "utf8", env, timeout: 5000 }
        );
        if (result.status === 0 && result.stdout.trim() === "1") {
            // ADB may reconnect after Android reports boot completion. Require
            // the expected identity in this poll before touching ports or apps.
            const identity = spawnSync(
                adb,
                ["-s", serial, "emu", "avd", "name"],
                { encoding: "utf8", env, timeout: 5000 }
            );
            if (identity.status === 0) {
                if (identity.stdout.trim().split(/\r?\n/)[0] !== avd)
                    fail("Emulator identity changed during boot");
                booted = true;
                break;
            }
            const transportError = (
                identity.stderr ||
                identity.stdout ||
                ""
            ).trim();
            if (
                identity.error?.code !== "ETIMEDOUT" &&
                !/device.*not found|device offline|no devices\/emulators found|transport.*(?:not found|closed)/i.test(
                    transportError
                )
            )
                fail(
                    identity.error?.message ||
                        `ADB identity query failed: ${transportError}`
                );
        }
        if (child && (child.exitCode !== null || child.signalCode !== null))
            fail("Emulator exited during boot; inspect its log");
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!booted)
        fail(
            `Boot timed out for ${serial}; inspect build/emulator-logs before retrying. No other emulator was stopped`
        );
    for (const reverse of [8095, 8090])
        invoke(
            adb,
            ["-s", serial, "reverse", `tcp:${reverse}`, `tcp:${reverse}`],
            { env }
        );
    if (options.apk)
        console.log(
            invoke(
                adb,
                ["-s", serial, "install", "-r", path.resolve(options.apk)],
                { env, timeout: 120000 }
            )
        );
    if (options.component) {
        const output = invoke(
            adb,
            [
                "-s",
                serial,
                "shell",
                "am",
                "start",
                "-W",
                "-n",
                quote(options.component),
            ],
            { env, includeStderr: true, timeout: 60000 }
        );
        if (/Error:|Exception|Status:\s*(?!ok\b)\w+/i.test(output))
            fail(output);
        console.log(output);
    }
    console.log(
        `Ready: ${avd} (${serial}). Host player: http://127.0.0.1:8095/; playlist proxy: http://127.0.0.1:8090/`
    );
}
main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
});
