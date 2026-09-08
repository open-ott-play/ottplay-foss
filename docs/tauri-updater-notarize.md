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

### Publish updates

1. Tag `v*` (or `workflow_dispatch` with a tag) so `.github/workflows/release.yml` builds multiarch bundles (#310).
2. With `TAURI_SIGNING_PRIVATE_KEY` present, each Tauri matrix job also emits updater payloads (`.sig`, macOS `.app.tar.gz`, etc.) and uploads them to the GitHub Release.
3. Publish a static `latest.json` on that release (asset name must match the endpoint). Example shape:

```json
{
  "version": "0.1.1",
  "notes": "Bug fixes",
  "pub_date": "2026-09-08T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of .app.tar.gz.sig>",
      "url": "https://github.com/open-ott-play/ottplay-foss/releases/download/v0.1.1/OttPlay.FOSS_aarch64-apple-darwin.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<...>",
      "url": "https://github.com/open-ott-play/ottplay-foss/releases/download/v0.1.1/OttPlay.FOSS_x86_64-apple-darwin.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "<contents of .AppImage.sig>",
      "url": "https://github.com/open-ott-play/ottplay-foss/releases/download/v0.1.1/ottplay-foss_amd64.AppImage"
    },
    "windows-x86_64": {
      "signature": "<contents of setup.exe.sig>",
      "url": "https://github.com/open-ott-play/ottplay-foss/releases/download/v0.1.1/OttPlay.FOSS_x64-setup.exe"
    }
  }
}
```

Exact filenames follow `scripts/ci-tauri-collect-artifacts.sh` (arch suffix when `TAURI_TARGET` is set). Adjust URLs to match the assets on the release.

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

- Release workflow: `.github/workflows/release.yml` (multiarch + optional hooks)
- Artifact collect: `scripts/ci-tauri-collect-artifacts.sh`
- Upstream reference: inverter-desktop Tauri updater plugin wiring
