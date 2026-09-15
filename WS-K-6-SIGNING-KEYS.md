# WS-K-6 — the update signing key: what it is, and what to do with it

This is the single point of trust for every future Stockiha update. Read
this whole page before doing anything else with the key.

## What was generated

An Ed25519 key pair, using Tauri's own signing tool (`tauri signer
generate`) — this is the same free, open cryptographic scheme
([minisign](https://jedisct1.github.io/minisign/)) used to sign updates for
many well-known desktop apps. It has nothing to do with a Windows
code-signing certificate (which costs money per year and which you have
already ruled out for this pilot) — it only proves that a downloaded
update file is exactly what Stockiha itself produced and signed, not
something altered in transit or substituted by someone else.

- **Public key** — goes inside the app itself (`tauri.conf.json`), shipped
  to every installed copy of Stockiha. It is not a secret. It is committed
  to the source code repository, exactly like any other setting.
- **Private key** — never goes in the app, never goes in the source code
  repository, and was shown to you once, directly in the chat, at the end
  of the task that generated it. It is yours alone to keep.

## What you must do with the private key, right now

1. Open Bitwarden.
2. Create a new, separate item for the private key itself. Suggested name:
   `Stockiha — update signing PRIVATE KEY`. Paste the private key text into
   its notes/secure-note field.
3. Create a **second, separate** item for its password. Suggested name:
   `Stockiha — update signing key PASSWORD`. Do not put the password in the
   same item as the key. If Bitwarden (or whoever might ever see one item)
   is ever compromised, keeping them apart means a thief needs both items,
   not one.
4. Copy the private key file onto a USB drive as well, and store that USB
   drive somewhere physically safe (a drawer, a safe — not left in a
   laptop bag). This is your offline backup if Bitwarden is ever
   inaccessible.
5. Do **not** email it to yourself, do not put it in a shared cloud folder
   (Google Drive, Dropbox, WhatsApp, etc.), and do not paste it into any
   chat, ticket, or document other than Bitwarden and the USB copy above.

## If this key is ever lost

**There is no recovery.** If the private key and its password are both
lost (Bitwarden account lost with no export, USB drive destroyed, etc.):

- You can no longer sign new updates. Every future release would need a
  brand new key pair.
- Every copy of Stockiha already installed at every client site has the
  OLD public key baked in, and will refuse (correctly — this is the
  security working as intended) to install anything signed by a new key.
- **The only remedy is an in-person reinstall at every single site**,
  manually, with a fresh installer built from a new key pair. There is no
  remote fix for this.

Treat this key with the same seriousness as a bank vault combination — not
because it is fragile technology, but because losing it is expensive and
slow to fix, one shop at a time.

## A second, separate key for licensing (future)

WS-K-7 (a later task) may introduce a software-licensing key, if the
Owner wants copy-protection or per-shop licensing. That will be a
**completely different key pair**, generated and stored the same way but
kept as its own separate Bitwarden items. The update-signing key and any
future licensing key must never be the same key: compromising one must
never compromise the other.

## Where each thing actually lives

| What | Where | Committed to the repository? |
|---|---|---|
| Public key | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` | Yes — this is meant to be public |
| Private key | Bitwarden (2 items) + a USB backup | **Never** |
| Private key password | Bitwarden (its own separate item) | **Never** |

`.gitignore` also now refuses `*.key`, `*.key.pub`, `*.minisign`, and any
file named `stockiha-update-signing*` — a safety net in case a future
`tauri signer generate` run is ever made without explicitly pointing its
output somewhere outside the repository.
