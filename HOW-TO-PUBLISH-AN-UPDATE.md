# How to send a new Stockiha update to every shop — explained super simply

This is written for someone who does not code. If you can copy, paste, and
click buttons on GitHub, you can do this.

> **Heads up:** there is an older file in this folder called
> `WS-K-6-RELEASE-PROCESS.md`. It describes uploading files to a service
> called "R2." **Ignore that part — it is out of date.** The app has since
> been set up to check a different place: a GitHub repository. This new
> guide describes what the app *actually* checks today. Everything else in
> that old file (the two version numbers, the forced/optional idea, how to
> undo a bad release) is still true and worth reading once.

---

## The big idea, in one picture

Every Stockiha app, once a day (or whenever it's opened), quietly asks one
question to one address on the internet:

> "Is there a newer version of you than the one I'm running?"

That address is a small text file called `latest.json`, sitting inside a
GitHub repository named **`Stockiha-releases`**
(`https://github.com/NabilBNK/Stockiha-releases`). If `latest.json` says
"yes, version X is newer, download it from here," the shop's Stockiha will
offer to install it.

**So "publishing an update" really just means: change what that one file
says.** Everything else is just getting that file's content right.

Think of `latest.json` like a note taped to a vending machine that says
"new snacks arrived, go get them from Aisle 3." The note itself is tiny.
The actual snacks (the installer `.exe`, which is about 50 MB) live
somewhere else — in a **GitHub Release**, which is basically a labeled box
GitHub lets you upload big files into, with its own download link.

---

## The three things you are touching, and what each one is for

| File / thing | Lives where | What it's for |
|---|---|---|
| `Stockiha_<name>-setup.exe` | Uploaded as a **GitHub Release asset**, in the `Stockiha-releases` repo | The actual program shops download and run. |
| `latest.json` | A plain file on the `main` branch of the `Stockiha-releases` repo | The "note on the vending machine" — tells every Stockiha app the new version number, where to download it, and proves it's really from you (not tampered with). |
| `update-policy.json` | Same repo, same branch | One tiny switch: is this update **optional** (a little banner, shop can ignore it) or **forced** (shop must install it before continuing — but they can still finish selling first, see the old guide for that detail). |

---

## Before you start: the two version numbers

Stockiha has two version labels, and you must update **both**, every time,
or shops will never be offered the update:

1. **`src-tauri/tauri.conf.json`**, the `"version"` field. This one is the
   *only* one the app actually compares to decide "is this newer?" It must
   look like `"0.7.0"` — three numbers, no letters, no "WS-" prefix.
2. **`src/shared/version.ts`**, the `APP_VERSION_MARKER` constant. This one
   is just a friendly name shown on screen, like `"WS-M-4.0"`. It also
   becomes part of the installer's file name.

**If you only change the second one and forget the first one, nothing
breaks — but nobody ever gets offered the update.** The app checks the
first number, silently, every time.

---

## Step-by-step

### Step 1 — Bump both version numbers

Open `src-tauri/tauri.conf.json`, find `"version": "0.6.0"`, change it to
the next number up, for example `"0.7.0"`.

Open `src/shared/version.ts`, find `APP_VERSION_MARKER = 'WS-M-4.0'`,
change it to whatever you're calling this release, for example
`'WS-M-5.0'`.

Save both files.

### Step 2 — Build the installer

In a terminal, inside the Stockiha project folder:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "<the signing key, from wherever you keep it safe>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<the password for that key>"
npm run tauri:build
```

This takes a few minutes. When it's done, you will have **two new files**
sitting in `src-tauri/target/release/bundle/nsis/`:

- `Stockiha_<your marker>-setup.exe` — the installer itself.
- `Stockiha_<your marker>-setup.exe.sig` — a small text file. This is the
  "wax seal" that proves the `.exe` really came from you and was not
  swapped by anyone in between. **Never publish an update without this
  file matching the exact `.exe` you're publishing.**

Once the build finishes, clear those two secret lines from your terminal
(close the terminal, or run `Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY` and
`Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) so the key doesn't
sit around in your command history.

### Step 3 — Upload the installer to a GitHub Release

1. Go to `https://github.com/NabilBNK/Stockiha-releases/releases/new` in
   your browser.
2. Where it asks for a **tag**, type something like `v0.7.0` — it must
   match the version number from Step 1, with a `v` in front.
3. Give it a title (anything — "Version 0.7.0" is fine).
4. Drag the `Stockiha_<your marker>-setup.exe` file from Step 2 into the
   box that says "Attach binaries."
5. Click the green **Publish release** button.

GitHub now gives that file a permanent public web address that looks like:

```
https://github.com/NabilBNK/Stockiha-releases/releases/download/v0.7.0/Stockiha_<your marker>-setup.exe
```

Keep that exact address — you need it in the next step.

### Step 4 — Copy the "wax seal" text

Open the `.sig` file from Step 2 in Notepad (just double-click it). Select
everything inside, copy it. It's one long jumble of letters and numbers —
that's normal, don't try to read it.

### Step 5 — Edit `latest.json`

Still on GitHub: go to
`https://github.com/NabilBNK/Stockiha-releases/blob/main/latest.json`,
click the pencil icon (Edit this file), and replace everything with this,
filling in your own values:

```json
{
  "version": "0.7.0",
  "notes": "A short, honest sentence about what changed.",
  "pub_date": "2026-10-01T09:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "PASTE THE ENTIRE .sig FILE CONTENTS FROM STEP 4 HERE",
      "url": "https://github.com/NabilBNK/Stockiha-releases/releases/download/v0.7.0/Stockiha_<your marker>-setup.exe"
    }
  }
}
```

A few rules that matter:
- `"version"` must be **exactly** the number from Step 1 — `"0.7.0"`, not
  `"v0.7.0"`.
- `"pub_date"` must look exactly like that example (date, the letter `T`,
  time, and a `Z` at the very end — that `Z` means "this is UTC time").
- `"url"` must be the **exact** address from Step 3, spelled perfectly, or
  every shop's download will fail with a "not found" error.

Scroll down, write a one-line commit message like "release 0.7.0," and
click **Commit changes directly to the `main` branch**.

### Step 6 — Check (or set) `update-policy.json`

Go to
`https://github.com/NabilBNK/Stockiha-releases/blob/main/update-policy.json`.
It should just say:

```json
{
  "mode": "optional"
}
```

Leave it as `"optional"` unless you specifically want to **force**
everyone to install this update (change `"optional"` to `"forced"`). Only
do that for something serious — a security fix or a broken calculation —
because a forced update nags the shop until they install it. When in
doubt, leave it `"optional"`.

### Step 7 — Check your work

Open these two links in an ordinary browser tab (no login):

- `https://raw.githubusercontent.com/NabilBNK/Stockiha-releases/main/latest.json`
- `https://raw.githubusercontent.com/NabilBNK/Stockiha-releases/main/update-policy.json`

You should see plain text — exactly what you just typed. If either one
shows an error or asks you to sign in, something is wrong and **no shop
will get this update** (it fails silently — nobody sees an error, they
just never get offered the new version). Fix it before telling anyone a
new version is out.

That's it. **You just shipped a live update.** Any shop that opens
Stockiha from now on will quietly notice a newer version exists.

---

## If something goes wrong after you publish

**Quick fix, works instantly, needs no rebuild:** edit `latest.json` again
and change `"version"` back to the old number (or delete the whole file).
Every machine that hasn't updated yet will now think "nothing new here"
and stop offering the bad version. This does **not** fix machines that
already installed the bad version — see `WS-K-6-RELEASE-PROCESS.md`'s
"Pulling a bad release" section for the full, honest explanation of what
recovery looks like if the bad release changed the database.

---

## The whole thing, as a short checklist you can print

1. Bump the version number in `tauri.conf.json` **and** `version.ts`.
2. `npm run tauri:build` (with the two signing keys set first).
3. Create a new GitHub Release in `Stockiha-releases`, upload the `.exe`.
4. Copy the `.sig` file's contents.
5. Edit `latest.json` on `main`: new version, new URL, the signature you
   just copied, today's date.
6. Leave (or set) `update-policy.json`'s `mode`.
7. Open both files in a browser to make sure they load with no login.
8. Done. Shops will see it next time they open the app.
