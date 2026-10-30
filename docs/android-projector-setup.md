# Set up an Android projector with OTTPlay

This English guide takes a new projector from its factory launcher to a working
OTTPlay installation that opens automatically when the projector starts. It uses
the **Full Capacitor app**, package `play.ott.foss`.

Projectors with similar cases or product listings can have different boards,
Android versions and firmware. The first tested unit was an X1BQ running Android
11 and LuminaOS 1.0.73. Its successful setup does **not** certify another seller's
unit. Record and test each projector separately.

[Android package reference](android-distributions.md)
· [Detailed Home setup and rollback](android-distributions.md#optional-startup-as-the-android-home-app)
· [Russian Home instructions](android-autostart-RU.md)

## 1. Prepare the projector and network

Have the original remote, a computer on the same trusted LAN, and optionally a
USB mouse and USB flash drive available. Keep the manufacturer's launcher and
settings installed: they are the recovery route.

1. Open the projector's Settings / About screen. Record its model, firmware,
   Android version, Wi-Fi MAC address and current IP address. A generic Android
   model name such as `ADT-3` may not identify the actual projector hardware.
2. Connect Wi-Fi and verify real connectivity, for example by loading the Play
   Store catalog. A Wi-Fi icon alone does not prove internet access. Check the
   date and time if HTTPS connections fail.
3. For a second projector, use a **different DHCP reservation and player name**.
   Do not copy the first projector's IP address, device identity or access code.
   Reserve the address using the MAC actually used on this network, then renew
   the connection and verify the resulting address.
4. If Wi-Fi drops, check signal, guest/client isolation and router access rules.
   Compare available 2.4 GHz and 5 GHz networks instead of assuming either band
   is the cause. Avoid changing working network and power settings all at once.

A full-size USB-A socket on a projector is often a **host port** for storage or a
mouse. It does not establish that USB debugging through that socket is possible.
Do not connect two host ports with a passive USB-A-to-USB-A cable. Use a documented
device/OTG port or the network debugging method below.

## 2. Reach Android settings and enable debugging

ADB is useful for installation, selecting the Home app and checking a real boot.
It is not required for ordinary OTTPlay playback or command-server control.

### Standard settings

Open **Settings → About device → Build number**, press it seven times and enter
the device PIN if requested. Return to **System → Developer options** and enable
**USB debugging**. Names and locations vary; see
[Android's developer-options guide](https://developer.android.com/studio/debug/dev-options).

### A projector with a custom settings interface

If the standard pages are hidden, first inspect the manufacturer's own settings
for Developer options, USB debugging, ADB debugging or Network debugging. On the
tested X1BQ, USB debugging and ADB debugging were separate switches. This does
not mean every projector has those switches or uses the same network port.

An optional way to open available Android settings is
[Activity Launcher](https://github.com/ActivityLauncher/ActivityLauncher/releases):

1. Install it from its official Play Store listing if available. If Play marks
   the device incompatible, an official release APK can be tried only when that
   APK supports the device's Android version. Sideloading cannot fix an actual
   compatibility problem.
2. With no usable store or browser, download the official APK on the computer,
   copy it to a USB flash drive and open it with the projector's file manager.
   If a browser is available, it can download the APK directly. A USB mouse can
   help with touch-oriented dialogs.
3. When Android requests **Install unknown apps**, allow it for the specific
   browser or file manager used for this installation. Older firmware may call
   this **Unknown sources**. You can revoke that permission afterward.
4. Open Activity Launcher and search for `com.android.settings`. Start a listed
   **Settings**, **About phone/device**, or **Developer options** activity. The
   tested unit exposed `Settings$MyDeviceInfoActivity`; other firmware may not.
5. Enable debugging through the actual settings UI. If an activity is missing or
   permission-denied, return to the vendor settings. Activity Launcher cannot
   grant protected permissions or create debugging support removed by the vendor.

If neither APK installation nor an accessible debugging option is available,
check the vendor's supported installation procedure before changing firmware.
This guide requires neither root nor unlocking the bootloader.

## 3. Connect ADB to this projector

Install Google's [SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools)
on the computer and open a terminal. The examples use a POSIX shell, as on macOS
or Linux. On Windows, use the equivalent variable syntax in your shell.

Choose the connection method the projector actually offers:

- **Wireless debugging with a pairing code:** open that Android settings page.
  Run `adb pair IP:PAIRING_PORT` and enter the displayed code when prompted.
  Then run `adb connect IP:DEBUG_PORT`. Use the separately displayed debugging
  port; it can differ from the pairing port and need not be `5555`.
- **Vendor ADB/Network debugging switch:** enable it locally, then connect to
  the address/port documented or shown by that firmware. The tested X1BQ used
  TCP port `5555`. A USB debugging switch alone does not necessarily enable TCP.
- **Documented USB device port:** connect a suitable data cable, authorize the
  computer and use the USB serial shown by `adb devices -l`. To switch an already
  authorized USB connection to legacy TCP, Android documents
  `adb -s USB_SERIAL tcpip 5555`, followed by `adb connect IP:5555`. This is not a
  way to enable ADB on a device to which you have no authorized connection.

For the vendor TCP method, replace this example address with the **new** unit's
actual address:

```sh
OTT_ADB_SERIAL='192.168.1.50:5555'
adb connect "$OTT_ADB_SERIAL"
adb devices -l
```

For USB, set `OTT_ADB_SERIAL` to the exact USB serial from `adb devices -l`
instead. For paired wireless debugging, use its actual connection address and
debugging port in this variable.

Accept the debugging authorization prompt on the projector for your trusted
computer. `device` is the expected ADB state; `unauthorized` means authorization
is still needed, and `offline` is not a usable connection. If there is no prompt,
recheck the address, network and relevant debugging switch. A refused connection
usually means no listener at that address/port; a timeout can also mean the unit
is off, disconnected or filtered. Do not infer successful authorization from an
open TCP port.

Use `adb -s "$OTT_ADB_SERIAL"` for every device command so another Android unit
cannot be selected accidentally. If an existing installation uses a dedicated
ADB server, keep its `-P PORT` option on **all** commands, including `connect` and
`devices`, and keep the same authorized keys.

```sh
adb -s "$OTT_ADB_SERIAL" shell getprop ro.build.version.release
adb -s "$OTT_ADB_SERIAL" shell getprop ro.build.version.sdk
adb -s "$OTT_ADB_SERIAL" shell getprop ro.product.cpu.abilist
adb -s "$OTT_ADB_SERIAL" shell am get-current-user
```

The remaining examples use Android user **0**. If the last command reports a
different user, substitute that user in every `--user` command. Keep network ADB
on a trusted LAN; do not forward its port to the internet. See the
[official ADB connection guide](https://developer.android.com/tools/adb).

**UI-only alternative:** if installing apps works but ADB is unavailable, install
OTTPlay using the file manager, configure playback in its UI, and open
`HomeSetupActivity` with Activity Launcher as described in step 6. Record the
current manufacturer launcher name in Android's default-app settings before
changing it; use that same settings page for rollback. Skip the ADB commands and
observe reboot/power-on on screen. Without ADB, boot-ID and component-level checks
are unavailable; do not record them as passed. If the firmware provides neither
a Home chooser nor ADB, this guide cannot force a default-Home change.

## 4. Install and open the correct OTTPlay app

Download an official APK from [OTTPlay FOSS releases](https://github.com/open-ott-play/ottplay-foss/releases).
Prefer the current stable release; use a beta only when deliberately testing it.

- **Android 7 / API 24 or newer, including Android 11:**
  `ottplay-foss-android-full.apk`.
- **Android 5.1–6 / API 22–23:** `ottplay-foss-android-api22.apk`, with WebView 60
  or newer. See the [compatibility reference](android-distributions.md).

The separate Kotlin/Compose app in `ottplay-android` has a different identity.
The Home instructions here refer to `play.ott.foss`, not every app called OTTPlay.

Compare the downloaded file's SHA-256 with the entry for that same APK in the
same release's `release-manifest.json`. For example, on macOS:

```sh
shasum -a 256 /path/to/ottplay-foss-android-full.apk
adb -s "$OTT_ADB_SERIAL" install -r /path/to/ottplay-foss-android-full.apk
adb -s "$OTT_ADB_SERIAL" shell dumpsys package play.ott.foss
```

Check `versionName` and `versionCode` in the package output. `install -r` updates
an existing installation while retaining its data. If Android reports a signing
conflict or version downgrade, obtain the correct signed update; do not uninstall
or clear data as a workaround. The flash-drive/file-manager method from step 2
also works for the initial OTTPlay APK if ADB is unavailable.

Open **OTTPlay FOSS** from the projector's app list, or start it explicitly for
this initial setup:

```sh
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 -n play.ott.foss/.MainActivity
```

Opening the app manually is not an autostart test. If only a frozen splash screen
appears, verify connectivity, supported Android/WebView versions and the installed
APK before configuring Home. Update the system WebView through the device's
supported update channel where available.

## 5. Configure a playlist and remote control

1. Select the interface language and your intended provider in OTTPlay settings.
   For an M3U source, choose **M3U**, enter your authorized playlist URL and save it.
2. If transferring an existing setup, use **Manage settings → Export settings**
   on the source and **Import settings** on the new player for a JSON transfer.
   Keep the file private because it
   can contain provider credentials. Do not clone Android app data or device IDs.
   Cloud save/load requires its separately configured service and is not supplied
   merely by installing a generic APK.
3. Select the desired playlist/profile and test a channel with known video **and
   audio**. A profile called **Home** belongs to your setup; it is not a bundled
   public playlist. Obtain its URL/settings from the owner of the first player.
4. In **Settings → Remote control → Command server**, enter your controller
   address and a **new per-device access code**, or use **Find command server**
   when discovery is configured and approve this new installation on the server.
   A generic APK does not inherit the hosted website's discovery configuration.
5. Register a distinct name/alias with your controller, for example `projector2`.
   Keep the first projector's registration and code separate. Verify the new
   device by its identity, then test navigation on that projector.

Import settings **before** granting remote-control consent, or explicitly
reconnect afterward: imports cannot authorize a new installation and disconnect
command-server control. Use the device code, never the controller's administrator
token. Command-server control and **Local HTTP remote control** are separate
features; the command server does not require enabling the local listener.
Follow [connection, discovery and consent details](remote-command-server.md).

No overlay, accessibility, device-administrator or broad storage permission is
needed for Home startup. Grant folder access only if using local media, and permit
installation from OTTPlay only when using its APK updater. Do not enable every
Android permission as a general troubleshooting step.

Before proceeding, confirm the remote's arrows, OK and Back work and that the
playlist loads again after an ordinary app restart. If audio plays with a black
picture, compare a known supported H.264/AAC HLS stream and the available playback
engine settings. HLS worked on the first tested projector, but that does not
establish codec support on the new unit. Opening OTT and starting the intended
channel are separate requirements; Home mode does not change playback settings.

## 6. Make OTTPlay open when the projector starts

OTTPlay uses Android's **Home app** mechanism. It makes OTTPlay the destination
of the physical **Home button** as well as the launcher Android opens at startup.
If you want the vendor launcher to remain Home, use the vendor's own boot-to-app
setting when available and test it separately. A legacy OTT `autorun` setting
does not configure the Android Home role.

First record the current, working manufacturer Home component outside the player:

```sh
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
OTT_PREVIOUS_HOME='REPLACE_WITH_RECORDED_PACKAGE/ACTIVITY'
```

Do not use an Android resolver/chooser or `com.android.settings/.FallbackHome`
as the recovery launcher. `FallbackHome` may be displayed as “Settings”; it is a
temporary boot screen. Establish a working vendor Home first if no real launcher
is currently selected. **Keep that launcher installed and enabled.**

Open the built-in, explicit startup setup screen:

```sh
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 \
  -n play.ott.foss/.HomeSetupActivity
```

Without ADB, an installed Activity Launcher can open the exported
`play.ott.foss.HomeSetupActivity` entry. On the **OTTPlay startup** screen:

1. Select **Enable and choose OTTPlay** and confirm.
2. Select OTTPlay in Android's Home chooser and make it the default.
3. Read the setup status. Merely opening this screen does not enable Home mode.

The app enables its own `HomeActivity` alias. Do not substitute a shell
`pm enable` command: some production firmware refuses changes to another app's
components. No root, boot receiver or additional background service is needed
for this Home mechanism.

If the Home chooser is missing or ineffective, use the following fallback **after
enabling the entry inside OTTPlay**, then verify the effective result:

```sh
adb -s "$OTT_ADB_SERIAL" shell cmd package set-home-activity --user 0 \
  play.ott.foss/.HomeActivity
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

The selected component must be `play.ott.foss/.HomeActivity` (possibly shown with
the fully qualified class name). If the vendor rejects both methods, stop and
use its supported startup settings; do not disable its launcher to force a choice.

**Wait at least 30 seconds**, then resolve Home again before rebooting. The first
projector lost the effective selection when rebooted immediately; Android 11
defers writing some package preferences. A success message or held Home role
alone is not a boot test. See the
[persistence explanation](android-distributions.md#enable-and-verify-home-mode).

Press Home once now and verify OTT opens; check Back and access to settings too.
This is the final manual preflight, before the automatic-start test below.

## 7. Prove autostart after reboot and power-on

Before rebooting, record these values:

```sh
adb -s "$OTT_ADB_SERIAL" shell cat /proc/sys/kernel/random/boot_id
adb -s "$OTT_ADB_SERIAL" shell cat /proc/uptime
```

After the settling interval, reboot through the normal UI, or run:

```sh
adb -s "$OTT_ADB_SERIAL" reboot
```

Watch the projector without pressing Home/OK, clicking its icon, sending a remote
launch, or running `am start`. Wait for Android and Wi-Fi to return; reconnect
ADB if needed. Then use read-only observations:

```sh
adb -s "$OTT_ADB_SERIAL" shell getprop sys.boot_completed
adb -s "$OTT_ADB_SERIAL" shell cat /proc/sys/kernel/random/boot_id
adb -s "$OTT_ADB_SERIAL" shell cat /proc/uptime
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
adb -s "$OTT_ADB_SERIAL" shell dumpsys activity activities
```

Require `sys.boot_completed=1`, a changed boot ID, OTT as the effective Home and
the OTT activity in the foreground. Verify the actual screen and sound: a splash
screen or a command acknowledgement does not prove working playback. Confirm the
selected profile and new remote registration survived.

Next use the projector's **normal shutdown**, let it finish its cooling/shutdown
sequence, and turn it on with its original power control. Repeat the observation
without launching OTT manually. A successful software reboot does not establish
power-button startup; unchanged boot ID can indicate resume rather than a new
boot. Do not pull the power cable to simulate shutdown.

Also test startup with Wi-Fi temporarily unavailable and reconnection afterward.
Record model/firmware, APK version, effective Home, reboot result, power-on result,
profile, remote reconnect, picture and sound. The first X1BQ passed reboot and
normal power-on; delayed-Wi-Fi startup was not separately validated there.
See its [recorded hardware test](android-distributions.md#hardware-validation-x1bq-october-19-2026).

## 8. Troubleshooting and rollback

- **OTT is absent from the Home chooser:** verify the APK/package and open
  `HomeSetupActivity`; enable the Home entry there. Older packages may not have it.
- **The vendor launcher returns after reboot:** verify the effective Home, repeat
  selection, allow the settling interval and retest. A vendor startup policy may
  override Android's choice; identical-looking projectors need not behave alike.
- **A screen saver covers the player:** try Back. Use the vendor's screen-saver
  setting if possible. The optional Android setting and its exact rollback are
  documented under [Projector screen saver](android-distributions.md#projector-screen-saver).
  Do not change sleep settings merely to hide a network or playback failure.
- **Home is OTT but playback does not start:** check the profile, network, provider
  response, supported media and saved standby/playback state. Changing Home does
  not repair a playlist or select a channel for you.
- **ADB disappears after shutdown:** network debugging is not a power-on system.
  Full Android shutdown stops ADB. Sleep/resume may retain it, depending on the
  firmware and Wi-Fi. OTT standby is a separate state; a remote `go` requires a
  running connected player. Remote cold power-on is not promised by this setup.

To undo Home mode, first restore and verify the saved manufacturer launcher:

```sh
adb -s "$OTT_ADB_SERIAL" shell cmd package set-home-activity --user 0 \
  "$OTT_PREVIOUS_HOME"
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

Alternatively choose that launcher in Android's default Home settings. Only
after a working replacement is selected, reopen `HomeSetupActivity` and choose
**Disable OTTPlay Home entry**. Allow the settling interval, press Home and verify
the original launcher opens. The normal OTTPlay icon, profiles and registration
remain; no uninstall or data reset is necessary.

If needed during recovery, open settings or the saved launcher explicitly:

```sh
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 -a android.settings.SETTINGS
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 -n "$OTT_PREVIOUS_HOME"
```

Launching the old launcher does not by itself make it the default. If the settings
intent is unavailable, use that device's verified settings activity from step 2.

## 9. Keep the setup working

Use signed in-place updates for the same package. After each update, check the
version, profile, remote reconnect, Home selection and one real power-on again.
[Updates through OTT](android-distributions.md#update-through-ott) may require
**Install unknown apps** for OTTPlay and a local confirmation; unmanaged projectors
do not necessarily support silent installs.

Store the previous launcher component and setup record privately. Revoke temporary
installer permissions or debugging access when no longer needed. Turning off ADB
does not remove the Home selection or the separately authorized command-server
connection.
