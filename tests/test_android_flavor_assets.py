"""Run the production Gradle asset task against isolated fake frontend outputs.

Usage: JAVA_HOME=<JDK 21> python3 tests/test_android_flavor_assets.py
Uses the repo's installed Gradle wrapper in offline mode; never builds Android or
the frontend. Gradle, Android SDK, dependencies and Node must already be installed
for the native CI job.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AndroidFlavorAssetsTest(unittest.TestCase):
    def test_android_configuration_has_no_shared_assets_and_requires_generators(self):
        with tempfile.TemporaryDirectory(prefix="ott-android-config-") as folder:
            init_script = Path(folder) / "verify.init.gradle"
            init_script.write_text(
                """
gradle.beforeProject { project ->
    if (project.path == ':app') {
        project.afterEvaluate {
            project.tasks.register('verifyOttplayFlavorConfiguration') {
                doLast {
                    def android = project.extensions.getByName('android')
                    assert android.namespace == 'play.ott.foss'
                    assert android.defaultConfig.applicationId == 'play.ott.foss'
                    assert android.productFlavors.full.applicationIdSuffix == null
                    assert android.productFlavors.play.applicationIdSuffix == '.play'
                    assert android.productFlavors.full.buildConfigFields.BUNDLED_EPG_DEFAULTS.value == 'true'
                    assert android.productFlavors.play.buildConfigFields.BUNDLED_EPG_DEFAULTS.value == 'false'
                    android.sourceSets.each { sourceSet ->
                        assert sourceSet.assets.srcDirs.empty: "Unexpected manual assets for ${sourceSet.name}"
                    }
                    ['FullDebug', 'FullRelease', 'PlayDebug', 'PlayRelease'].each { variant ->
                        def merger = project.tasks.named("merge${variant}Assets").get()
                        def generatorName = "prepare${variant.startsWith('Full') ? 'Full' : 'Play'}OttplayAssets"
                        assert merger.taskDependencies.getDependencies(merger).any { it.name == generatorName }:
                            "${merger.name} does not depend on ${generatorName}"
                    }
                    def full = project.tasks.named('prepareFullOttplayAssets').get()
                    def play = project.tasks.named('preparePlayOttplayAssets').get()
                    assert full.assetsDirectory.get().asFile != play.assetsDirectory.get().asFile
                    def variants = android.applicationVariants.collectEntries { [(it.name): it] }
                    assert variants.keySet() == ['fullDebug', 'fullRelease', 'playDebug', 'playRelease'] as Set
                    assert variants.fullDebug.signingConfig.name == 'debug'
                    assert variants.playDebug.signingConfig.name == 'debug'
                    assert variants.playRelease.signingConfig == null: 'Play must not inherit the Full signing key'
                    def fullKeystore = System.getenv('KEYSTORE_FILE')
                    if (fullKeystore) {
                        assert variants.fullRelease.signingConfig.name == 'release'
                        assert variants.fullRelease.signingConfig.storeFile == new File(fullKeystore)
                    } else {
                        assert variants.fullRelease.signingConfig == null
                    }
                    println('FULL_PLAY_CONFIGURATION_VERIFIED')
                }
            }
        }
    }
}
"""
            )
            dummy_keystore = Path(folder) / "dummy-full.keystore"
            dummy_keystore.write_text("Not a key: configuration-only regression fixture.\n")
            for configured in (False, True):
                with self.subTest(full_keystore_configured=configured):
                    env = os.environ.copy()
                    for name in ("KEYSTORE_FILE", "KEYSTORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"):
                        env.pop(name, None)
                    if configured:
                        env.update(
                            KEYSTORE_FILE=str(dummy_keystore),
                            KEYSTORE_PASSWORD="fixture",
                            KEY_ALIAS="fixture",
                            KEY_PASSWORD="fixture",
                        )
                    result = subprocess.run(
                        [
                            str(ROOT / "android/gradlew"),
                            "--offline",
                            "--console=plain",
                            "--init-script",
                            str(init_script),
                            ":app:verifyOttplayFlavorConfiguration",
                        ],
                        cwd=ROOT / "android",
                        env=env,
                        text=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        timeout=180,
                        check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stdout)
                    self.assertIn("FULL_PLAY_CONFIGURATION_VERIFIED", result.stdout)

    def test_real_task_rejects_incomplete_foreign_and_stale_assets(self):
        source = (ROOT / "android/app/build.gradle").read_text()
        imports = source.split("apply plugin:", 1)[0]
        task_class = source[
            source.index("@DisableCachingByDefault") : source.index("\nkotlin {")
        ]
        cases = {
            "goodFull": "full",
            "goodPlay": "play",
            "missingConfig": "play",
            "wrongConfig": "play",
            "missingPlugin": "play",
            "invalidPlugins": "play",
            "emptySuccess": "play",
            "preparerFailure": "play",
        }
        with tempfile.TemporaryDirectory(prefix="ott-android-assets-") as folder:
            temp = Path(folder)
            (temp / "settings.gradle").write_text("rootProject.name = 'asset-task-test'\n")
            script = temp / "scripts/prepare-android-assets.cjs"
            script.parent.mkdir()
            script.write_text(
                """
const fs = require('node:fs');
const path = require('node:path');
const [flavor, output] = process.argv.slice(2);
const scenario = path.basename(path.dirname(output));
fs.appendFileSync('invocations.jsonl', JSON.stringify({flavor, output, scenario}) + '\\n');
if (scenario === 'preparerFailure') process.exit(9);
if (scenario === 'emptySuccess') process.exit(0);
fs.mkdirSync(path.join(output, 'public'), {recursive: true});
fs.writeFileSync(path.join(output, 'public/index.html'), '<p>' + flavor + '</p>');
if (scenario !== 'missingConfig') {
  fs.writeFileSync(path.join(output, 'capacitor.config.json'), JSON.stringify({
    appId: flavor === 'full' || scenario === 'wrongConfig' ? 'play.ott.foss' : 'play.ott.foss.play'
  }));
}
if (scenario !== 'missingPlugin') {
  fs.writeFileSync(path.join(output, 'capacitor.plugins.json'), JSON.stringify(
    scenario === 'invalidPlugins' ? [] : [{pkg: '@capacitor/app', classpath: 'com.capacitorjs.plugins.app.AppPlugin'}]
  ));
}
"""
            )
            registrations = []
            for name, flavor in cases.items():
                app_id = "play.ott.foss" + (".play" if flavor == "play" else "")
                registrations.append(
                    f"""
tasks.register('{name}', PrepareOttplayAssets) {{
    distribution.set('{flavor}')
    expectedApplicationId.set('{app_id}')
    nodeExecutable.set(providers.environmentVariable('NODE_BINARY').orElse('node'))
    repositoryDirectory.set(layout.projectDirectory)
    assetsDirectory.set(layout.buildDirectory.dir('cases/{name}/assets'))
    outputs.upToDateWhen {{ false }}
}}
"""
                )
            (temp / "build.gradle").write_text(imports + task_class + "".join(registrations))
            # A successful no-op preparer must never package the preceding build.
            stale = temp / "build/cases/emptySuccess/assets"
            (stale / "public").mkdir(parents=True)
            (stale / "public/index.html").write_text("stale Full providers")
            (stale / "capacitor.config.json").write_text('{"appId":"play.ott.foss.play"}')
            (stale / "capacitor.plugins.json").write_text(
                '[{"pkg":"@capacitor/app","classpath":"com.capacitorjs.plugins.app.AppPlugin"}]'
            )
            result = subprocess.run(
                [
                    str(ROOT / "android/gradlew"),
                    "--offline",
                    "--console=plain",
                    "--continue",
                    *cases,
                ],
                cwd=temp,
                env=os.environ.copy(),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=180,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0, result.stdout)
            for name in cases:
                task_line = f"> Task :{name}"
                self.assertIn(task_line, result.stdout, result.stdout)
                if name.startswith("good"):
                    self.assertNotIn(task_line + " FAILED", result.stdout, result.stdout)
                else:
                    self.assertIn(task_line + " FAILED", result.stdout, result.stdout)
            self.assertIn("Capacitor appId does not match play", result.stdout)
            self.assertIn("Missing or invalid play Capacitor plugin metadata", result.stdout)
            self.assertIn("Missing play asset: public/index.html", result.stdout)
            self.assertIn("Missing play asset: capacitor.config.json", result.stdout)
            self.assertIn("Missing play asset: capacitor.plugins.json", result.stdout)
            self.assertFalse((stale / "public/index.html").exists())
            invocations = [json.loads(line) for line in (temp / "invocations.jsonl").read_text().splitlines()]
            self.assertEqual({item["scenario"] for item in invocations}, set(cases))
            self.assertEqual(len({item["output"] for item in invocations}), len(cases))
            for name in ("goodFull", "goodPlay"):
                output = temp / f"build/cases/{name}/assets/public/index.html"
                self.assertEqual(output.read_text(), f"<p>{cases[name]}</p>")


if __name__ == "__main__":
    unittest.main()
