# Opt-in Firefox content-crash diagnostics

The compatibility acceptance runner can collect a bounded binary crash signature
when `CI_FIREFOX_CRASH_DIAGNOSTICS=1` and the selected engine is Firefox. This is
additional evidence on Linux, not a retry, acceptance result, or browser workaround. The
provider scenarios, zero retries, failure exit status, and terminal observer stay
unchanged. Other engines do not enable the collector. On Windows and macOS, the explicit
flag leaves browser launch unchanged and writes `unsupported-platform`; it does
not attempt Linux filesystem ownership checks or configure crash storage.

The runner creates a nonce-owned private temporary directory, uses its `tmp`
subdirectory as `TMPDIR`, and directs crash-report data into its `data`
subdirectory. It enables `MOZ_CRASHREPORTER=1` and
`MOZ_CRASHREPORTER_NO_REPORT=1`, removes inherited crash-disable/full-dump/custom
submission settings, and does not change sandbox arguments. It does not invoke a
crash reporter, upload a report, or rely on geckodriver's `MINIDUMP_SAVE_PATH`.
The test fixture retains available dumps before Playwright removes its temporary
profile. A missing or unsupported dump is reported as unavailable; a green test
is not evidence that crash collection itself has been exercised.

Only `firefox-crash-summary.json` is written to the ordinary diagnostic artifact
folder. Its allowlisted fields contain dump SHA-256 and size, exception code,
module-relative exception offset, module image size, and ELF build ID or RSDS
GUID/age where present. Linux AMD64 dumps can additionally contain
`instructionModuleOffset` and `instructionBuildId`, taken from the exception
thread's saved RIP only when SystemInfo identifies Linux/AMD64 and the context
flags declare AMD64 CONTROL registers valid. These fields use their own prefix
to avoid confusing an instruction module with a different fault-address module.
There are no module filenames, absolute process
addresses, memory strings, annotations, environment values, or raw dump bytes in
this summary. It is a signature for comparing crashes, not a symbolized stack or
proof of the underlying cause. On Linux the exception address can be the fault
address rather than an instruction pointer; a module-relative offset is emitted
only when that recorded address belongs to a module. No instruction pointer is inferred from the fault address. The separately saved
RIP is never emitted as an absolute address, and no stack is unwound.
A captured dump without an exception stream is
identified separately. A malformed dump yields a fixed status, not its contents.

Raw dumps stay outside the artifact directory. Reads are bounded to 32 MiB per
file, 64 MiB per scan, eight distinct dump hashes, 512 directory entries and six
subdirectory levels. Symlinks are skipped; files use no-follow opens and inode
checks. A private ownership marker is checked before reading and cleanup.
Collection failure never replaces the original test result. If initialization
fails, the child process receives no diagnostic opt-in or ownership fields, so
its browser config does not attempt an invalid session; the parent writes the
fixed `initialization-unavailable` status without the error message. The runner removes
its owned private tree after collection, including after test failure. If
ownership changed, it refuses recursive cleanup and reports that failure rather
than deleting an unowned directory. Abrupt process termination can prevent
cleanup; hosted runners must remain ephemeral. These checks do not claim
isolation against a malicious process running as the same operating-system user.

The initial target is the pinned Linux Firefox compatibility runner. Mozilla's
Unix initial-dump path honors `TMPDIR`; platform-specific Windows/macOS crash
paths can differ. Data-directory configuration alone does not prove that an
initial dump was preserved. Actual collection on a crashing pinned browser must
be established by a future CI summary. No full dump or external native analyzer
is executed by this helper.

## Source basis

- [Mozilla crash reporter architecture](https://firefox-source-docs.mozilla.org/toolkit/crashreporter/crashreporter/)
  describes dump contents, client submission, and the data directory.
- [The pinned Firefox source](https://github.com/mozilla-firefox/firefox/blob/f1b6c0f86b96b7e0688c26f65803576f27cdaf88/toolkit/crashreporter/nsExceptionHandler.cpp)
  defines `MOZ_CRASHREPORTER_NO_REPORT`, treats any nonempty
  `MOZ_CRASHREPORTER_DISABLE` as disabled, and implements Unix `TMPDIR` selection.
- [Playwright 1.62.1 browser launch](https://github.com/microsoft/playwright/blob/v1.62.1/packages/playwright-core/src/server/browserType.ts)
  passes launch environment overrides to the browser;
  [its Firefox implementation](https://github.com/microsoft/playwright/blob/v1.62.1/packages/playwright-core/src/server/firefox/firefox.ts)
  preserves these variables on Linux apart from its separate Snap handling.
- [Geckodriver crash report documentation](https://firefox-source-docs.mozilla.org/testing/geckodriver/CrashReports.html)
  documents `MINIDUMP_SAVE_PATH` for geckodriver; that preservation mechanism is
  not assumed for Playwright.
- [Breakpad's format definitions](https://github.com/google/breakpad/blob/main/src/google_breakpad/common/minidump_format.h)
  define the fixed minidump stream, exception, module and CodeView fields parsed
  by the bounded helper. The companion
  [AMD64 context definition](https://github.com/google/breakpad/blob/main/src/google_breakpad/common/minidump_cpu_amd64.h)
  places context flags at byte 48 and RIP at byte 248; SystemInfo architecture 9
  and Linux platform `0x8201` are both required. Context descriptor and buffer
  bounds are checked before reading. Unknown streams and free-form strings are
  not decoded.

Run the portable regression checks with:

```sh
node --test tests/test_firefox_crash_diagnostics.cjs tests/test_browser_terminal_diagnostics.cjs
```
