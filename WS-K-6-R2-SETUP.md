# WS-K-6 — hosting updates on Cloudflare R2 (setup guide for the Owner)

This is written for someone who has never used Cloudflare R2 before. Follow
the numbered steps in order. It should take about 15–20 minutes, plus
however long Cloudflare takes to activate your domain if it is newly added
to your Cloudflare account.

You will need: your Cloudflare account login, and access to your domain's
DNS (already true if the domain is purchased through Cloudflare, as
yours is).

---

## Part A — create the R2 bucket

1. Log in to the Cloudflare dashboard at `dash.cloudflare.com`.
2. In the left sidebar, click **R2 Object Storage**.
3. The first time you open R2, Cloudflare will ask you to "enable R2" for
   your account. Click through this. **If it asks for a payment card
   here and refuses to continue without one, stop and read the "If R2
   asks for a card" section near the bottom of this document before going
   further.**
4. Click **Create bucket**.
5. Name it exactly: `stockiha-updates`
6. Leave "Location" on its default (Automatic).
7. Click **Create bucket**. You now have an empty bucket.

## Part B — attach your subdomain

This makes the bucket reachable at a normal web address
(`updates.yourdomain.com`) instead of Cloudflare's own long internal URL.

1. Open the `stockiha-updates` bucket you just created.
2. Click the **Settings** tab.
3. Find **Public access** → **Custom Domains** → click **Connect Domain**.
4. Type the subdomain you want to use, for example:
   `updates.yourdomain.com` (replace `yourdomain.com` with your real
   domain).
5. Cloudflare will show you a DNS record it wants to add. Since your
   domain is already on Cloudflare, click **Add** / **Connect** to let it
   create that DNS record automatically — you do not need to do this by
   hand.
6. Wait for the status to show **Active** (usually a minute or two,
   sometimes longer while DNS spreads). Refresh the page if it seems
   stuck.
7. **Write down the exact address you chose** (e.g.
   `https://updates.yourdomain.com`) — you will need it in two files
   later in this guide, and in the release process document.

## Part C — make the bucket's objects publicly readable

The app has no login or credential of its own for downloading updates —
by design, it cannot hold a secret, since anything baked into the app can
eventually be extracted. This means the files in this bucket must be
readable by anyone who has the exact link, the same way a public website
page is.

1. Still in **Settings** for the `stockiha-updates` bucket, confirm that
   connecting the custom domain in Part B already made the bucket's
   contents servable over that domain (this is what the custom domain
   feature is for — no separate "make public" switch should be needed
   once a custom domain is connected and active).
2. To double check: after Part D below uploads a test file, open
   `https://updates.yourdomain.com/<that file's name>` in an ordinary
   browser tab, with no login. If it downloads or displays the file
   without asking you to sign in, it is working. If it shows an error
   about access being denied, come back to this section and look for a
   **"Public Development URL"** or **"Allow Public Access"** toggle in
   the same Settings tab — Cloudflare's exact wording here changes from
   time to time.

### Why making these files public is safe (this is not "security by obscurity")

It is natural to worry that "anyone with the link can download it" sounds
insecure. It is not, for one specific reason: **the security here comes
from the Ed25519/minisign signature (see `WS-K-6-SIGNING-KEYS.md`), not
from hiding the file.** Concretely:

- Anyone in the world can already download and inspect a Stockiha
  installer today — it isn't secret software, it's an app you hand to
  clients. There is nothing sensitive inside the `.exe` itself.
- What actually matters is whether the app you run **trusts** a file
  before installing it. Every copy of Stockiha has the PUBLIC signing
  key built in, and refuses, unconditionally, to install anything that
  isn't signed by the matching PRIVATE key — the one that never leaves
  your Bitwarden. An attacker who finds the download URL (trivial, since
  it's public on purpose) gains nothing: they can download the genuine
  file, but they cannot produce a fake one the app will accept, because
  they don't have the private key.
- This is the same reasoning banks and Windows itself rely on for
  software updates generally: the *file* being public is fine; the
  *signature* is the actual lock. Hiding the URL instead of signing the
  file would be the weaker design — a leaked or guessed URL would then
  be a real problem, which is exactly the "security by obscurity" trap
  this setup avoids.
- `update-policy.json` (the forced/optional file) is the one exception
  worth naming: it is deliberately **not** signed at all, because it
  carries no executable code — at worst, someone editing a copy of it
  they hosted themselves could make their own fake copy of the app
  falsely claim "forced" or "optional", but they still cannot make the
  real Stockiha install anything unsigned, ever.

## Part D — where each file goes, and the exact public URL each one gets

Everything lives in the root of the `stockiha-updates` bucket (no
subfolders needed, though subfolders are harmless if you prefer to
organize by version). After each new release (see
`WS-K-6-RELEASE-PROCESS.md` for the full step-by-step), you will have
these files to upload.

**Worked example** — assume your chosen subdomain from Part B is
`updates.stockiha.example.com` (replace with your real one everywhere
below) and you are publishing version `WS-K-6.2`:

| File | Uploaded as (bucket root) | Resulting public URL | Purpose |
|---|---|---|---|
| The installer | `Stockiha_WS-K-6.2-setup.exe` | `https://updates.stockiha.example.com/Stockiha_WS-K-6.2-setup.exe` | The actual update, downloaded by the app |
| The manifest | `latest.json` | `https://updates.stockiha.example.com/latest.json` | Tells the app a new version exists, and where to get it — its own `url` field must contain the exact installer URL above |
| The policy file | `update-policy.json` | `https://updates.stockiha.example.com/update-policy.json` | Tells the app whether this release is optional or forced — the ONE file you edit to change that, without rebuilding anything |

The installer's signature is not a separate uploaded file — it is a
block of text that goes *inside* `latest.json`'s own `signature` field
(see `WS-K-6-RELEASE-PROCESS.md` step 3–4 for exactly where that text
comes from).

`latest.json` and `update-policy.json` get **overwritten** each release
(same file name, same URL, every time — this is what lets the app always
ask the same two addresses); the installer file itself gets a **new**
name each release (it includes the version number), and old installer
files can be deleted once you're confident nobody needs to fetch them
again — nothing reads an old installer's name from anywhere once
`latest.json` no longer points at it.

To upload: open the bucket in the Cloudflare dashboard, click **Upload**,
and drag the files in, OR use `rclone`/`aws-cli` configured for R2 if you
prefer a command-line tool later — the dashboard upload is enough for
now.

## Part E — once your real subdomain exists, two code files must be updated

This part is for whoever builds the app (a developer), not something you
need to do yourself — but you should know it exists, so you can ask for
it to be done before the first real release, and so you can verify it
was done by searching for the text below.

Right now, two files in the source code hold a **placeholder** domain
that does not point anywhere real. Search the codebase for this exact
text — it appears in both places, character for character:

```
PLACEHOLDER-REPLACE-WITH-YOUR-DOMAIN
```

The two places it appears:

1. **`src-tauri/tauri.conf.json`**, inside `plugins.updater.endpoints` —
   currently:
   ```
   "https://updates.PLACEHOLDER-REPLACE-WITH-YOUR-DOMAIN.com/latest.json"
   ```
   must become your real address, e.g.:
   ```
   "https://updates.stockiha.example.com/latest.json"
   ```
2. **`src-tauri/src/commands/update_policy.rs`**, the
   `UPDATE_POLICY_URL` constant — currently:
   ```
   "https://updates.PLACEHOLDER-REPLACE-WITH-YOUR-DOMAIN.com/update-policy.json"
   ```
   must become the same real domain, with `/update-policy.json` instead
   of `/latest.json`.

Both must point at the exact subdomain you set up in Part B, and the app
must be rebuilt after this change (a plain text edit does not take
effect until the next build) — this is a one-time change, not something
repeated per release.

---

## If R2 asks for a payment card and you don't have an international one

Sources disagree on whether Cloudflare currently requires a card to
activate R2 at all, even to stay on the free tier. If you hit this wall,
here are concrete alternatives — pick one and the steps above adapt with
only the hosting step changing (the manifest format and release process
stay identical, since both are just "some HTTPS URL"):

### Option 1 — a separate, empty PUBLIC GitHub repository (no card needed)

GitHub Releases is free and needs no payment card at all. The constraint
this task started from was "not GitHub Releases, because the source
repository is private and must stay private" — but a **second, brand-new,
empty repository** (containing nothing but release binaries, zero
Stockiha source code) can be public with no risk, since there is nothing
in it to leak. Concretely:

1. Create a new GitHub repository, e.g. `NabilBNK/stockiha-releases`, and
   make it **Public** (this is fine — it will only ever contain compiled
   installers, never source code).
2. For each release, create a GitHub Release in that repository and
   attach the installer `.exe` as a release asset.
3. GitHub gives each release asset a stable, permanent download URL —
   use that URL inside `latest.json` exactly like an R2 URL.
4. Host `latest.json` and `update-policy.json` the same way — as release
   assets, or as raw files in the repository (`raw.githubusercontent.com`
   URLs also work and update instantly on every push, which is arguably
   more convenient for the two small files you edit often).

What changes: nothing about the app or the manifest format — only which
URL you point `tauri.conf.json`'s `plugins.updater.endpoints` and this
task's `UPDATE_POLICY_URL` at.

### Option 2 — Bunny.net Storage

A paid-but-cheap (pay-as-you-go, fractions of a cent per GB) object
storage service that has historically accepted a wider range of payment
methods, including some cards Cloudflare's billing has been reported to
reject, and does not require a subscription commitment. Setup is
conceptually identical to R2 (a storage zone instead of a bucket, a
"Pull Zone" instead of a custom domain).

### Option 3 — any existing web hosting you already pay for

If you (or Raqmenha) already have any ordinary web hosting with FTP/SFTP
access, `latest.json`, `update-policy.json`, and the installer can simply
be uploaded there like any other file on a website, and served over
plain HTTPS. This needs no new account at all.

Whichever option you land on, come back and tell the development team the
final base URL you're using (e.g. `https://updates.yourdomain.com/` or
`https://github.com/NabilBNK/stockiha-releases/releases/latest/download/`)
so `tauri.conf.json` and the update-policy fetch can be pointed at it —
right now both contain a clearly-marked placeholder domain that must be
replaced before the first real release ships.
