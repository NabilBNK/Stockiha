# Stockiha licence issuing (WS-K-7)

A one-page guide for the Owner. If you can copy, paste, and run a command
in PowerShell, you can do this.

## The two keys — never confuse them

Stockiha has **two separate** Ed25519/minisign key pairs:

| Key pair | What it signs | Where |
|---|---|---|
| Update-signing key | the NSIS installer (WS-K-6) | see `HOW-TO-PUBLISH-AN-UPDATE.md` / `WS-K-6-RELEASE-PROCESS.md` |
| **Licence-signing key** | a shop's licence key text | this document |

They are deliberately never the same key: if one leaks, the other stays
safe. **Never reuse a password between them.**

## 1. Generate the licence key pair (once, ever)

```powershell
mkdir $env:USERPROFILE\StockihaLicences
npx tauri signer generate -w $env:USERPROFILE\StockihaLicences\licence-signing.key
```

You will be asked for a password — choose a strong, **new** one, different
from the update-signing password. Two files are created:

- `licence-signing.key` — **private, secret**. This is what lets you issue
  licences. Store it, and its password, in Bitwarden as "Stockiha licence
  signing key", plus a second copy on a USB stick kept somewhere safe.
  **If you lose this key, you can never issue a licence that existing
  builds accept again** — a new key pair would need a new app build with
  the new public key compiled in.
- `licence-signing.key.pub` — public, safe to share. Its single line is
  what goes into `src-tauri/licence/licence-public.key` in the repository
  (a Claude Code kickoff prompt asks for this).

**The private key and its password never go into the repository, a chat,
or an email.** Only the public key's one line is ever pasted anywhere.

## 2. Issue a licence for a shop

You need the shop's **machine code** first (`STKH-XXXX-XXXX-XXXX-XXXX`) —
it is shown on their Settings → Licence screen, with a Copy button.

```powershell
$env:STOCKIHA_LICENCE_KEY_PATH = "$env:USERPROFILE\StockihaLicences\licence-signing.key"
$env:STOCKIHA_LICENCE_KEY_PASSWORD = "<the password from Bitwarden>"

node scripts/licence/issue-licence.mjs `
  --machine-code STKH-7Q2M-K9XD-4HPA-TZ3E `
  --licensee "Boutique El Nour - Ouargla" `
  --expires 2027-09-26
```

Use `--expires permanent` instead of a date for a licence that never
expires. The command prints the licence key text between two lines of `=`
and also writes it to a `.txt` file — copy either one and send it to the
shop (WhatsApp, email, whatever they normally use). They paste it into
Settings → Licence → Activate.

Optional flags:

- `--licence-id` — a custom identifier; otherwise one is generated from the
  current date and time.
- `--notes` — up to 200 characters, shown nowhere except the ledger below.
- `--out-dir` — where the output files go; defaults to
  `%USERPROFILE%\StockihaLicences\issued`.

## 3. The ledger

Every licence you issue is appended as one row to
`issued-licences.csv` in the output folder above — licence id, licensee,
machine code, dates, and when it was created. Keep this folder backed up;
it is the only record of what has been issued to whom.

## 4. When a shop's PC is replaced, or Windows is reinstalled

`MachineGuid` changes with the operating system, so the shop's machine code
changes too. There is no way around this offline. The fix is simple: the
shop opens Settings → Licence on the new install, copies the new machine
code, sends it to you, and you issue a new licence for it with the command
above. Their old licence key still works if they ever restore the old
machine, but it will not work on the new one.

## 5. Limitations, plainly

- **A licence already installed on a machine cannot be revoked offline.**
  There is no server calling the app to say "stop working" — that is the
  whole point of this being offline in the first place. If a licence needs
  to stop working, that is a business conversation with the shop, not a
  technical one.
- **If you lose the private key or its password, it's gone.** No one,
  including Anthropic or the original developer, can recover it or issue
  new licences that existing installed builds will accept. The only fix is
  a new key pair compiled into a new app version, which every existing shop
  would eventually need to update to.

## For developers

- `src-tauri/licence/test-fixtures/test-licence-signing.key` is a
  **deliberately public, test-only** key pair — the Tauri CLI does not
  write a plaintext warning line into the generated `.pub`/`.key` files
  (both are themselves base64), so this note stands in for one. It signs
  the committed fixtures under that same folder and nothing else; it must
  never be pointed at by `STOCKIHA_LICENCE_KEY_PATH` for a real licence.
- `STOCKIHA_LICENCE_FORCE_MODE=READ_ONLY` forces the enforcement gate into
  read-only mode for manual testing. It is honoured **only** in debug
  builds (`cfg!(debug_assertions)`) — a release build ignores it entirely.

