// Execute the real MainActivity against small Android/Capacitor test doubles,
// then run its emitted scripts against the real TS controls and device maps.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ott-activity-"));
const javaHome =
    process.env.JAVA_HOME ||
    (process.platform === "darwin"
        ? cp
              .execFileSync("/usr/libexec/java_home", ["-v", "21"], {
                  encoding: "utf8",
              })
              .trim()
        : "");
const executable = (name) =>
    javaHome ? path.join(javaHome, "bin", name) : name;
const sources = [];
function write(name, source) {
    const file = path.join(temp, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    sources.push(file);
}
function functions(file, names) {
    const ast = ts.createSourceFile(
        file,
        read(file),
        ts.ScriptTarget.Latest,
        true
    );
    const nodes = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    );
    assert.equal(nodes.length, names.length);
    return ts.transpileModule(
        nodes
            .map((node) => node.getText(ast).replace(/^export /, ""))
            .join("\n"),
        {
            compilerOptions: { target: ts.ScriptTarget.ES2015 },
        }
    ).outputText;
}

try {
    const keys = [
        "DPAD_UP",
        "DPAD_DOWN",
        "DPAD_LEFT",
        "DPAD_RIGHT",
        "DPAD_CENTER",
        "ENTER",
        "BACK",
        "MEDIA_PLAY_PAUSE",
        "MEDIA_PLAY",
        "MEDIA_PAUSE",
        "MEDIA_STOP",
        "VOLUME_UP",
        "VOLUME_DOWN",
        "MEDIA_NEXT",
        "MEDIA_PREVIOUS",
        "BUTTON_A",
        "BUTTON_SELECT",
        "BUTTON_B",
    ];
    write(
        "android/os/Bundle.java",
        "package android.os; public class Bundle {}"
    );
    write(
        "android/view/KeyEvent.java",
        `package android.view; public class KeyEvent {
        public static final int ACTION_DOWN=0, ACTION_UP=1;
        ${keys.map((key, index) => `public static final int KEYCODE_${key}=${index + 10};`).join("\n")}
        private int action, code, repeat;
        public KeyEvent(int action,int code,int repeat){this.action=action;this.code=code;this.repeat=repeat;}
        public int getAction(){return action;} public int getKeyCode(){return code;} public int getRepeatCount(){return repeat;}
    }`
    );
    write(
        "android/webkit/WebView.java",
        `package android.webkit; public class WebView {
        public java.util.List<String> scripts=new java.util.ArrayList<>();
        public void evaluateJavascript(String script,Object callback){scripts.add(script);}
    }`
    );
    write(
        "com/getcapacitor/Bridge.java",
        "package com.getcapacitor; public class Bridge {public android.webkit.WebView view=new android.webkit.WebView(); public android.webkit.WebView getWebView(){return view;}}"
    );
    write(
        "com/getcapacitor/BridgeActivity.java",
        `package com.getcapacitor; public class BridgeActivity {
        public Bridge bridge; public int fallback; public java.util.List<String> plugins=new java.util.ArrayList<>();
        public void registerPlugin(Class<?> plugin){if(bridge!=null)throw new AssertionError("late plugin registration");plugins.add(plugin.getName());}
        protected void onCreate(android.os.Bundle state){bridge=new Bridge();}
        public Bridge getBridge(){return bridge;}
        public boolean dispatchKeyEvent(android.view.KeyEvent event){fallback++;return false;}
    }`
    );
    const pluginDir = "android/app/src/main/java/play/ott/foss";
    const plugins = [];
    for (const relative of fs.readdirSync(path.join(root, pluginDir), {
        recursive: true,
    })) {
        if (!relative.endsWith(".kt")) continue;
        const source = read(pluginDir + "/" + relative);
        if (!source.includes("@CapacitorPlugin")) continue;
        const packageName = /^package (.+)$/m.exec(source)[1];
        const className = /class (\w+)\s*:\s*Plugin/.exec(source)[1];
        plugins.push(packageName + "." + className);
        write(
            packageName.replace(/\./g, "/") + "/" + className + ".java",
            `package ${packageName}; public class ${className} {}`
        );
    }
    write(
        "play/ott/foss/MainActivity.java",
        read(pluginDir + "/MainActivity.java")
    );
    write(
        "play/ott/foss/ActivityTest.java",
        `package play.ott.foss;
        import android.view.KeyEvent; public class ActivityTest {
        static void check(boolean value){if(!value)throw new AssertionError();}
        public static void main(String[] args){
            MainActivity app=new MainActivity();
            check(!app.dispatchKeyEvent(new KeyEvent(0,KeyEvent.KEYCODE_DPAD_UP,0)));
            check(app.fallback==1);
            app.onCreate(new android.os.Bundle());
            check(new java.util.HashSet<>(app.plugins).size()==app.plugins.size());
            for(String plugin:app.plugins)System.out.println("PLUGIN "+plugin);
            int[] codes={${keys.map((key) => "KeyEvent.KEYCODE_" + key).join(",")}};
            String[] names={${keys.map((key) => '"' + key + '"').join(",")}};
            for(int i=0;i<codes.length;i++){
                int previous=app.bridge.view.scripts.size();
                check(app.dispatchKeyEvent(new KeyEvent(0,codes[i],0)));
                check(app.bridge.view.scripts.size()==previous+1);
                System.out.println(names[i]+" "+java.util.Base64.getEncoder().encodeToString(app.bridge.view.scripts.get(previous).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                check(app.dispatchKeyEvent(new KeyEvent(0,codes[i],1)));
                check(app.bridge.view.scripts.size()==previous+(names[i].startsWith("MEDIA_")?1:2));
            }
            check(!app.dispatchKeyEvent(new KeyEvent(0,999,0)));
            check(!app.dispatchKeyEvent(new KeyEvent(1,KeyEvent.KEYCODE_DPAD_UP,0)));
            app.bridge.view=null;
            check(!app.dispatchKeyEvent(new KeyEvent(0,KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,0)));
        }
    }`
    );
    cp.execFileSync(
        executable("javac"),
        ["-d", path.join(temp, "classes"), ...sources],
        { stdio: "pipe" }
    );
    const output = cp.execFileSync(
        executable("java"),
        ["-cp", path.join(temp, "classes"), "play.ott.foss.ActivityTest"],
        { encoding: "utf8" }
    );
    const registered = [],
        scripts = {};
    for (const line of output.trim().split("\n")) {
        const [name, value] = line.split(" ");
        if (name === "PLUGIN") registered.push(value);
        else scripts[name] = Buffer.from(value, "base64").toString();
    }
    assert.deepEqual(
        registered.sort(),
        plugins.sort(),
        "every shipped local plugin must reach bridge construction"
    );
    const mapping = {
        BACK: "EXIT",
        BUTTON_A: "ENTER",
        BUTTON_B: "EXIT",
        BUTTON_SELECT: "ENTER",
        DPAD_CENTER: "ENTER",
        DPAD_DOWN: "DOWN",
        DPAD_LEFT: "LEFT",
        DPAD_RIGHT: "RIGHT",
        DPAD_UP: "UP",
        ENTER: "ENTER",
        MEDIA_NEXT: "NEXT",
        MEDIA_PREVIOUS: "PREV",
        VOLUME_DOWN: "VOL_DOWN",
        VOLUME_UP: "VOL_UP",
    };
    for (const adapter of ["pc", "android"]) {
        const source = read(`src/stb/${adapter}/stb.ts`);
        const keyMap = vm.runInNewContext(
            "(" + /var \w*Keys = (\{[\s\S]*?\});/.exec(source)[1] + ")"
        );
        const received = [];
        const w = { _doKey: (key) => received.push(key), keys: keyMap };
        w.window = w;
        vm.createContext(w);
        for (const [nativeKey, appKey] of Object.entries(mapping)) {
            vm.runInContext(scripts[nativeKey], w);
            assert.equal(
                received.pop(),
                keyMap[appKey],
                adapter + " " + nativeKey
            );
        }
    }
    const controls = functions("src/core/index.ts", [
        "isCoreThenable",
        "playCoreMedia",
        "cancelCoreSeek",
        "destroyCoreShaka",
        "stbContinue",
        "stbPause",
        "stbIsPlaying",
        "stbStop",
    ]);
    const video = {
        pause() {
            this.paused = true;
        },
        paused: true,
        play() {
            this.paused = false;
            return Promise.resolve();
        },
        removeAttribute() {},
    };
    let destroyed = 0;
    const w = {
        _corePendingSeek: null,
        _coreShakaTeardown: null,
        _playSession: 0,
        cancelLiveRestart() {},
        clearPlayTimeInterval() {},
        console,
        hlsInstance: {
            destroy() {
                destroyed++;
            },
        },
        video,
    };
    w.window = w;
    vm.createContext(w);
    vm.runInContext(controls, w);
    for (let i = 0; i < 2; i++) {
        vm.runInContext(scripts.MEDIA_PLAY, w);
        assert.equal(video.paused, false);
    }
    for (let i = 0; i < 2; i++) {
        vm.runInContext(scripts.MEDIA_PAUSE, w);
        assert.equal(video.paused, true);
    }
    vm.runInContext(scripts.MEDIA_PLAY_PAUSE, w);
    assert.equal(video.paused, false);
    vm.runInContext(scripts.MEDIA_PLAY_PAUSE, w);
    assert.equal(video.paused, true);
    vm.runInContext(scripts.MEDIA_STOP, w);
    assert.equal(w._playSession, 1);
    assert.equal(destroyed, 1);
    assert.equal(video.paused, true);
    console.log(
        "PASS Android activity: plugin registration before bridge, boot fallback, media repeat suppression, actual PC/Android keymaps, idempotent Play/Pause and toggle lifecycle"
    );
} finally {
    fs.rmSync(temp, { force: true, recursive: true });
}
