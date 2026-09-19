# WS-K-6 — release process: publishing a new Stockiha update

Follow this exactly, in order, every time. Steps 1–4 are done by whoever
builds the app (a developer); steps 5–7 are done by the Owner (or anyone
the Owner trusts with the R2/hosting login) and need no coding knowledge.

## Before you start: two version numbers, not one

Stockiha carries two separate version strings, and **both must be bumped
for every release that should trigger an update**, or the update will
silently not appear:

- `src-tauri/tauri.conf.json`'s `"version"` field — a plain number like
  `"0.2.0"`. This is the ONLY one the updater plugin actually compares
  against the manifest to decide "is this newer?". It must follow real
  semantic versioning (`MAJOR.MINOR.PATCH`) — the updater's comparison
  logic depends on that shape.
- `src/shared/version.ts`'s `APP_VERSION_MARKER` — a human-readable string
  like `"WS-K-6.2"`, shown on screen and used to name the installer file.
  This is cosmetic — it helps a human tell builds apart — but it plays no
  part in whether the app thinks an update is available.

**Bump both, every release, even if the underlying number feels
redundant.** A release that bumps only the marker and not
`tauri.conf.json`'s version will build fine, install fine if run by hand,
and then never be offered as an automatic update to anyone, because the
updater will see no version increase at all.

## Step 1 — build the installer

```powershell
npm run tauri:build
```

This produces, inside `src-tauri/target/release/bundle/nsis/`:
- The installer: `Stockiha_<marker>-setup.exe`
- Its signature file: `Stockiha_<marker>-setup.exe.sig` (only produced if
  signing environment variables are set — see Step 2; if they are not
  set, the build still succeeds but produces an UNSIGNED installer that
  the updater will refuse to ever install, by design)

## Step 2 — sign it (usually happens automatically as part of Step 1)

Set these three environment variables before running `npm run
tauri:build`, and Tauri's own build tooling signs the installer for you
automatically — you do not run a separate signing command by hand:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "<paste the private key text from Bitwarden>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<paste the password from its own separate Bitwarden item>"
npm run tauri:build
```

**Never commit these values, never leave them sitting in a terminal
history file on a shared machine, and clear them from your shell after
the build** (`Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY`,
`Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

## Step 3 — get the signature value for the manifest

The `.sig` file next to the installer contains exactly the base64 string
`latest.json` needs in the `signature` field below. Open it in Notepad and
copy its entire single-line contents.

## Step 4 — write (or update) `latest.json`

This is Tauri's own manifest format — a worked, real-shaped example:

```json
{
  "version": "0.2.0",
  "notes": "Fixes the receipt printer margin on 58mm paper.",
  "pub_date": "2026-10-01T09:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...(the full contents of the .sig file, one long line)...",
      "url": "https://updates.yourdomain.com/Stockiha_WS-K-6.2-setup.exe"
    }
  }
}
```

Field by field:
- `version` — must exactly match `tauri.conf.json`'s bumped `"version"`
  from before this build (`"0.2.0"`, not `"v0.2.0"`, not `"WS-K-6.2"`).
- `notes` — shown nowhere in this app's current UI, but keep it accurate
  for your own records; a future version may surface it.
- `pub_date` — the release time, in the exact format shown (ISO 8601,
  UTC, with the trailing `Z`).
- `platforms.windows-x86_64.signature` — the full `.sig` file contents
  from Step 3.
- `platforms.windows-x86_64.url` — the exact public download URL of the
  installer you uploaded in Step 6 below. Must match the file's real name
  and location exactly, or the download will 404.

This file is **not itself signed** — only the installer it points to is.
Editing `version`, `notes`, `pub_date`, or `url` later never requires
touching any key or regenerating any signature; only pointing at a
*different installer file* needs a matching new signature for *that*
file.

## Step 5 — write (or update) `update-policy.json`

This is Stockiha's own small file, not part of Tauri's format at all —
this is the ONE field that decides whether this release is optional or
forced, and it is the ONE file you can edit alone, at any time, with no
rebuild, to change that decision:

```json
{
  "mode": "optional"
}
```

or

```json
{
  "mode": "forced"
}
```

That is the entire file. Anything other than exactly `"optional"` or
`"forced"` is treated by the app as `"optional"` (a safe default — see
`infrastructure::update_policy`'s own documentation for why an unclear
value must never accidentally become MORE urgent than intended).

**A forced update never stops the shop from selling.** It shows a notice
the operator cannot make disappear forever, but every other screen —
including the till — stays fully usable the whole time, and installing
only happens once no cash session is open. See
`WS-K-6-MANUAL-VERIFICATION.md` for how to confirm this yourself before
trusting it in production.

## Step 6 — upload the three files to R2 (or your chosen host)

Upload, into the `stockiha-updates` bucket (see `WS-K-6-R2-SETUP.md`):
1. The installer `.exe` from Step 1 (new file each release, never
   overwrite an old one while any machine might still be mid-download of
   it).
2. `latest.json` (overwrite the previous one — there is only ever one
   "current" manifest).
3. `update-policy.json` (overwrite the previous one, unless you are
   intentionally leaving the previous release's policy in place).

## Step 7 — confirm it actually works

Open `https://updates.yourdomain.com/latest.json` in an ordinary browser
tab. You should see the JSON you just wrote, plain text, no login prompt.
Do the same for `update-policy.json`. If either asks you to sign in or
shows an error, the update will silently fail for every client (per the
"fails silently" design — nobody will see an error, they just won't get
the update) — fix the hosting permissions before telling anyone a new
version shipped.

---

## Pulling a bad release

You discover, after publishing, that the release has a serious bug.

### What you CAN do immediately, with no rebuild

Edit `latest.json` on the host (R2 dashboard → open the file → replace
its contents, or delete and re-upload it) so its `"version"` field goes
back to the last known-good version number, or simply delete
`latest.json` entirely. Either way, `check()` on any machine that has not
yet updated will now report "nothing newer available" (a deleted or
reverted manifest looks, from the app's point of view, exactly like "you
are already up to date" or "could not check" — both fail harmlessly, per
the app's own offline-safe design). **This stops the bleeding for every
machine that has not updated yet.**

### What this does NOT do

**It does not touch machines that already updated to the bad version.**
Editing a file on your server has no way to reach a computer that is not
currently asking that server anything — those shops are already running
the broken build, with their database already migrated to whatever
schema that build shipped.

### Why "just reinstall the old version" is NOT a safe fix

This is the part that must be understood before you ever mark a release
`forced`: **WS-K-1's own compatibility check hard-stops an older binary
against a newer database.** If the bad release included any database
migration at all, a shop's database is now on a newer schema than the old
installer knows about. Installing the old `.exe` back over it does not
"undo" anything — it starts a binary that immediately detects
`SchemaCompatibility::NewerThanBinary` and refuses to run at all, showing
"This version of Stockiha is out of date." There is no override for this,
by design (see WS-K-1's own ruling — this is the one case where refusing
is correct, since an older binary genuinely does not understand a newer
schema and must not guess).

### What the actual recovery path is, honestly

1. **If the bad release added no new migrations at all** (a pure
   application-logic bug, no schema change): reinstalling the previous
   version over it is genuinely safe, because the database never moved.
   Check this from the migration count/marker before promising a shop
   anything.
2. **If the bad release DID migrate the schema**, the only real fixes
   are:
   - Ship a new, FIXED release with a HIGHER version number than the bad
     one (never reuse a version number), and push it the same way as any
     normal release. Affected shops update again, forward, onto the fix —
     this is almost always faster and safer than anything else.
   - As a last resort, on any one affected machine: WS-K-5's own
     automatic pre-upgrade backup (in `%APPDATA%\com.raqmenha.stockiha\
     backups\`) is still sitting on disk from when that machine updated
     into the bad release. A supplier visit could restore that backup
     with the bundled `pg_restore.exe` and reinstall the last-known-good
     build — but this is a manual, in-person, per-machine operation, not
     something "pulling" the release on the host ever does for you
     automatically.

**The practical rule this leads to:** test a release thoroughly, on the
TEST-installer path described in `WS-K-4-MANUAL-VERIFICATION.md`'s
Scenario 7, BEFORE marking it forced or pushing it widely — pulling a bad
release limits new damage, it does not undo damage already done.
