# Install OTT-play on a Samsung Tizen TV

The Samsung TV package contains the shared OTT-play web player, its interface,
provider modules and local assets. It is a **packaged TV application**, not a
shortcut to the hosted website. Its application ID is **`OttPlayFss.Player`**
and its package ID is **`OttPlayFss`**.

Use this guide for a Samsung **television**. Samsung Family Hub refrigerators
are a separate target; see [Family Hub](#family-hub-refrigerators) below.

## What the release provides

Download these four assets from the same [OTT-play release](https://github.com/open-ott-play/ottplay-foss/releases)
and put them in one directory:

- `ottplay-foss-tizen-unsigned.wgt` — the packaged player, without certificates.
- `ottplay-foss-tizen.sha256` — its SHA-256 checksum.
- `ottplay-foss-tizen.json` — version, source and package metadata.
- `ottplay-foss-tizen-install.py` — a standalone Python 3 helper for verification,
  local signing and explicit installation.

**The release WGT must be signed before installation.** Samsung TVs require a
certificate profile accepted by that TV, normally a Samsung author certificate
and a distributor certificate containing its DUID. The release does not contain
an author key, a distributor certificate, your Samsung credentials or a universal
TV signing identity. See [Samsung's certificate guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).

The initial package declares Tizen **5.5** as its installation floor. This is
not a claim that every TV with Tizen 5.5 or newer has been tested. Browser,
decoder, DRM and provider compatibility still depend on the model and firmware.
Automated package and browser checks do not establish physical-TV compatibility.

## Prepare the computer and television

1. Install the current official Tizen Studio tools and Samsung TV extensions
   appropriate to your computer, following [Samsung's SDK setup](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html).
   Keep the `tizen` CLI and SDB available. OTT-play does not download or execute
   an SDK installer automatically.
2. Enable Developer Mode on the TV using Samsung's [TV device guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
   The current documented flow opens **Apps → App Settings**, enters `12345`,
   enables Developer Mode, records the developer computer's IP address, and
   restarts the TV. Older interfaces may accept the code directly in Apps.
3. Connect the TV in Device Manager. Check the displayed model and target name;
   do not select a different device merely because it is reachable.
4. Use Certificate Manager and Samsung Certificate Extension to create or select
   the certificate profile, include this TV's DUID, and complete the official
   device installation permission step where required.

The TV and computer need a working local-network route. Guest-network isolation,
a changed computer IP, or a VPN can prevent the developer connection. The helper
uses an explicitly selected, already configured target; it does not scan the
network, enable Developer Mode or alter device permissions for you.

## Verify, sign and install

The helper's signing and installation commands support **macOS and Linux**.
Package verification also works on Windows, but the helper does not invoke
Windows batch-based SDK commands. On Windows, use Samsung's official Studio
workflow to sign and install with the selected certificate profile and TV.

From the directory containing all four release files, verify the unsigned
package first:

```sh
python3 ottplay-foss-tizen-install.py verify
```

Use the **profile name** displayed in Certificate Manager for `MySamsungTV`.
This is not a password. Sign into a new output directory:

```sh
python3 ottplay-foss-tizen-install.py sign --profile MySamsungTV --output ./signed
```

If the official CLI is not on `PATH`, supply its absolute location with
`--tizen /path/to/tizen`. Keep certificate files and their passwords outside
the download directory and repository. The helper delegates signing to the
official CLI; it does not generate a substitute certificate.

After signing, use the configured target name shown by the SDK for `MyTV`:

```sh
python3 ottplay-foss-tizen-install.py install --target MyTV --signed ./signed
```

Installation is a separate command; signing does not install or launch the
application. The helper verifies that the signed archive retains the original
player payload, allowing the expected signature files. A matching payload does
not itself prove that the TV accepts the certificates: Samsung's installer
performs that device-specific check.

Open OTT-play from the TV's Apps screen. If desired, launch it explicitly with
the official CLI:

```sh
tizen run -p OttPlayFss.Player -t MyTV
```

See [Samsung's CLI reference](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html)
for target management and installation diagnostics. Never publish certificate
passwords, author keys or private provider credentials in an issue.

## Configure and check the player

Configure a provider normally, or connect through **Settings → Remote control**
and load your profile through the existing OTT remote tooling. The package does
not preconfigure a provider, account, remote-control token or Home profile.

Check the actual TV after installation:

- Launch, close and launch again; verify the saved provider and Favorites.
- Open the channel list and menus; exercise arrows, Enter, Return and media keys.
- Play a source you can access; check picture, sound, pause/resume and seeking.
- Check audio/subtitle selection only where the source and active engine expose it.
- Verify network recovery without losing the profile.

The player retains its existing HTML video, Hls.js and Shaka engines. This
delivery does **not** add the AVPlay decoder integration used by SamSUCKS and
does not inherit that project's direct-play rates or codec claims. A bundled
interface can start without fetching its scripts from here.now; network
providers still need a connection. Packaging does not grant arbitrary access
to a TV's filesystem or make computer SMB/AFP mount paths available on the TV.

## Updates and version numbers

Install future releases with the same application ID and compatible author
identity. Preserve and back up your author certificate according to Samsung's
guidance; replacing it can prevent updating an existing installation. Do not
automatically uninstall the old application to get past a certificate error,
because removal can discard its settings.

The WGT contains a snapshot of the player. Publishing a new here.now website
does not replace that installed snapshot. Updating it means downloading a new
qualified WGT, verifying it, signing locally and installing it explicitly.
There is no silent TV package updater or central store listing implied here.

Samsung requires numeric widget versions. We map the frozen release build
number `n` to:

```text
(1 + floor(n / 16777216)).(floor(n / 65536) % 256).(n % 65536)
```

For example, build `10531` becomes `1.0.10531`; build `65536` becomes `1.1.0`.
The original release label, build number, source commit and version-plan hash
remain in the metadata and WGT. RC-to-stable promotion preserves the qualified
package bytes; the embedded candidate identity is not rewritten during promotion.

## Family Hub refrigerators

**Do not install this TV WGT on a refrigerator on the assumption that both run
Tizen.** Samsung says [Family Hub and Smart TV are not fully compatible](https://developer.samsung.com/smarttv/develop/faq/other-features.html).
The TV profile, remote-control privileges, certificates and installation flow
are not evidence that a Family Hub device accepts the same application.

Samsung's [consumer Family Hub instructions](https://www.samsung.com/us/support/answer/ANS10006847/)
describe adding the applications offered in its Apps menu. The separate
[Family Hub developer program](https://developer.samsung.com/family-hub) does
not make the Smart TV Developer Mode instructions a refrigerator installation
procedure. A dedicated Family Hub package requires confirmed SDK access,
application profile, signing/distribution requirements and a device test.

For current Family Hub use, open the [hosted OTT-play player](https://player.ottplay.here.now/)
in the built-in browser and use the existing remote-control pairing flow.
That established browser route is separate from this TV package. No Family Hub
WGT, SDB access, package autostart or AVPlay support is claimed by this release.

## Troubleshooting

- **Certificate or installation permission error:** check the selected Samsung
  profile, target DUID and device installation permission in the official SDK.
  For detailed SDK output, use Samsung's CLI or Studio directly; the helper
  reports failure without copying its captured SDK output into the terminal.
  A generic Tizen author certificate alone is not a universal TV profile.
- **Target cannot be reached:** check the TV's Developer Mode computer address,
  local route and Device Manager target. Do not change another device's settings.
- **Player opens but a source fails:** record the model, firmware, package version
  and source type; separate provider availability from browser/decoder support.
- **Updated website but unchanged TV application:** the WGT is bundled and must
  be updated separately.
- **Application disappeared after a platform change:** check Samsung's developer
  installation state and reinstall the correctly signed package when appropriate.

## Build from source

After installing project dependencies and producing the validated classic web
bundle, create and inspect an explicitly local package:

```sh
npm run build
npm run check:bundle
npm run check:es5
npm run package:modea
npm run package:tizen -- --local
npm run verify:tizen -- --local
```

The normal CI build also opens the verified WGT in isolated headless Chromium
using a simulated Tizen bridge. It checks local asset loading, remote-key
navigation, engines, providers, subtitles and fonts without contacting a TV or
provider. Run the same check after packaging locally:

```sh
npx playwright install chromium
npm run test:tizen:browser -- --package-dir build/packages --output build/tizen-browser
```

The JSON result and screenshot are saved in the output directory. This checks
packaged browser startup; it does not replace testing on an actual Samsung TV.

Local packages use an explicit development identity and are not qualified release
assets. Official builds instead use the applied frozen `.release-plan.json`:

```sh
npm run package:tizen -- --plan .release-plan.json
npm run verify:tizen -- --plan .release-plan.json
```

The release workflow publishes all four files only after verification. The
[SamSUCKS delivery review](samsucks-delivery-review.md) explains the architecture
and signing decisions.
