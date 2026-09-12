# Tauri updater + macOS notarization (Mode B)

Readiness for desktop auto-updates and optional Apple notarization. Complements multiarch release CI (#310). **No secrets are committed** — unsigned builds keep working when secrets are absent.

## Updater (GitHub Releases)

Config lives in `src-tauri/tauri.conf.json` under `plugins.updater`:

- **Endpoint:** `https://github.com/open-ott-play/ottplay-foss/releases/latest/download/latest.json`
- **Pubkey:** placeholder pubkey in `tauri.conf.json` (base64 stub — **not** production) until you generate a real keypair
- **`createUpdaterArtifacts`:** not enabled in the committed config. Release CI passes `--config '{"bundle":{"createUpdaterArtifacts":true}}'` only when `TAURI_SIGNING_PRIVATE_KEY` is set.

### Generate signing keys (human, once)

```bash
cd src-tauri
npx tauri signer generate -w ~/.tauri/ottplay-foss.key
```

1. Copy the **public** key into `plugins.updater.pubkey` in `tauri.conf.json` (commit that change).
2. Store the **private** key contents as GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`.
3. If you set a password on the key, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Never commit the private key, `.key` files, or dotenv copies of them.

### Release candidates and updater readiness

Use [the release workflow](release-workflow.md), not direct tag pushes:

```bash
python3 scripts/release.py check
python3 scripts/release.py rc --version 1.2.3
python3 scripts/release.py stable --rc v1.2.3-rc.1
```

Replace the example versions with the committed base version and the actual checked
RC tag. A base version already published as stable cannot receive new beta/RC
releases; bump all committed native version files through a PR first. Stable requires the protected `release` environment approval and copies the
RC bytes without rebuilding. The mandatory desktop/mobile build matrix produces
installers; the complete native matrix must still pass on hosted runners and be
smoke-tested on the intended devices.

Automatic updates are **not configured for production**. The committed updater
public key is a placeholder, and the release adapter does not generate `latest.json`.
Setting a signing secret produces signed updater payloads; it does not by itself
make the configured update endpoint usable. Manual installer downloads remain the
supported delivery path until a reviewed updater integration is implemented.

A future updater integration must commit the real public key and generate and
validate `latest.json` as part of the candidate artifact set, with URLs targeting
the eventual stable version. The manifest and signature files must be checked
before the candidate is published and copied unchanged during promotion. Never
attach, replace or edit assets on a checked RC or stable release: that changes the
inventory covered by its immutable evidence. Create a corrected candidate instead.

`scripts/ci-tauri-collect-artifacts.sh` packages `.app.zip` and `.dmg` on both Mac
architectures, preserves platform-specific installer/signature names, and fails
if required Mac packages are absent. Updater payloads are included only when the
signing key is configured. Optional Apple notarization remains separate from updater
signing, as described below.

Mode B JS checks for updates only when `window.__TAURI__` is defined (Mode A / browser companion unchanged).

### Permissions

`src-tauri/capabilities/default.json` includes `updater:default` (`check` / `download` / `install`).

## macOS notarization (optional)

Tauri reads these env vars during `tauri build` on macOS (see [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)):

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` Developer ID Application cert |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: …` (optional if cert import is enough) |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (CI maps this to `APPLE_PASSWORD`) |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `KEYCHAIN_PASSWORD` | Optional; CI generates a random unlock password if unset |

When any of the notarize-required secrets are missing, the macOS job builds **unsigned** artifacts and continues (same as today’s #310 path). Do not bake certs into the repo or workflow files.

Alternative to Apple ID + app password: App Store Connect API key via `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH` (see Tauri docs). Prefer documenting one path; this repo’s CI hooks the Apple ID path.

## Windows / Linux signing

- **Updater signatures** use the Tauri minisign keypair above (all desktop OSes).
- **Windows Authenticode / Linux package signing** are out of scope for this readiness PR — optional later; unsigned MSI/NSIS/AppImage/deb still attach to the release.

## Local smoke (no secrets)

```bash
cd src-tauri
npx tauri build --ci   # unsigned; no updater .sig
```

With signing key exported in the environment (never commit it):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/ottplay-foss.key)"
# export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...
npx tauri build --ci --config '{"bundle":{"createUpdaterArtifacts":true}}'
```

## Related

- Release workflows: `.github/workflows/release-build.yml` (native builds) and `.github/workflows/release-pipeline.yml` (validation and promotion)
- Artifact collect: `scripts/ci-tauri-collect-artifacts.sh`
- Upstream reference: inverter-desktop Tauri updater plugin wiring
