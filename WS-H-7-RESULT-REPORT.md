# WS-H-7 Result Report — Translations, Documentation, and Workstream Closure

## Branch and commit

- Branch: `task/ws-h-7-translations-docs`
- Branched from `task/ws-h-6-automatic-backups` at commit `b0f137207f0ab4cf2a7f13b32ac5d03e32110d42` — the branch's actual tip at branch time (`git rev-parse HEAD` printed this, one commit ahead of the `229c6475...` the brief cited in prose, exactly as §3 anticipated: `b0f1372` is the WS-H-6 Result Report docs commit that landed after `229c647`).
- Code commit: `ee96bbf929227ae3ab560f6538d86484761d4a20`

## Steps completed

- **H7-01 (Arabic):** ran `grep -n "TODO(WS-H-7)" src/shared/i18n/locales.ts` (output below in "Strings translated"), then additionally reviewed every `recovery.*` key and the four WS-H-6 `update.*` keys in the `ar` dictionary per §5.1, and found 7 more `errors.*` keys carrying the same TODO marker (named explicitly in the plan's PART 11) that the brief's own §5.1 grep would also have caught — all translated. Every `// TODO(WS-H-7)` comment removed. No key renamed, added, or deleted (`npm run typecheck` confirms — it would fail loudly on a key-set mismatch across `fr`/`ar`/`en`). Every `{placeholder}` preserved. `RESTORE` kept in Latin letters. Numerals: none of the translated strings contain literal digits (dates arrive via `{date}`), so the Western-numeral rule had nothing to apply to.
- **H7-02 (French review):** reviewed every `recovery.*` string and the four WS-H-6 `update.*` strings, plus the same 7 `errors.*` keys, in the `fr` dictionary against the glossary in §6.1. **No changes were needed** — every string already used the typographic apostrophe `’` consistently, matched the glossary terms exactly (sauvegarde, restaurer, copie de sécurité, dossier de sauvegarde, tester, vérifier, automatique quotidienne, avant mise à jour, avant restauration), kept `RESTORE` untranslated (`Tapez RESTORE pour confirmer`), and contained no leftover English or grammar/agreement errors. See "French changes" below for the honest empty result.
- **H7-03 (Documentation):** all six documents updated exactly as specified in §7.1–§7.7 (see "Documentation changes" below).
- **H7-04 (Version marker):** `src/shared/version.ts` → `APP_VERSION_MARKER = 'WS-H-7.0'`. Nothing else in that file touched.

## Strings translated

Every key that carried `// TODO(WS-H-7)` before this task, plus the value it now holds. (English column is the value that was there before — i.e. what needed translating.)

| Key | English (before) | New Arabic |
|---|---|---|
| `update.downloading` | Downloading the update… | جارٍ تنزيل التحديث… |
| `update.backingUp` | Saving a safety backup before updating… this can take a minute or two. | جارٍ حفظ نسخة أمان قبل التحديث… قد يستغرق ذلك دقيقة أو دقيقتين. |
| `update.backupFailed` | The update was not installed because the safety backup failed. Check the backup folder in Settings, then try again. | لم يتم تثبيت التحديث لأن نسخة الأمان فشلت. تحقق من مجلد النسخ الاحتياطية في الإعدادات ثم أعد المحاولة. |
| `update.loginRequired` | Sign in before installing an update. | سجّل الدخول قبل تثبيت التحديث. |
| `errors.recoveryUnavailable` | Backup and restore are not available on this computer's setup. Contact your supplier. | النسخ الاحتياطي والاسترجاع غير متاحين على إعداد هذا الحاسوب. تواصل مع المورّد. |
| `errors.backupDestinationUnavailable` | The backup folder is not available. Plug in the drive or choose another folder. | مجلد النسخ الاحتياطية غير متاح. وصّل القرص أو اختر مجلدًا آخر. |
| `errors.backupNotRestorable` | This backup cannot be restored by this version of Stockiha. | لا يمكن استرجاع هذه النسخة الاحتياطية بهذا الإصدار من Stockiha. |
| `errors.restoreTestFailed` | The backup could not be restored in the safe test. Your data was not changed. | تعذر استرجاع النسخة الاحتياطية في الاختبار الآمن. لم تتغيّر بياناتك. |
| `errors.freshRestoreNotAllowed` | Restoring here is only possible on a new installation with no user accounts. | الاسترجاع هنا ممكن فقط على تثبيت جديد لا يحتوي على أي حسابات مستخدمين. |
| `errors.backupCopyFailed` | The backup could not be copied. Nothing was left behind in the target folder. | تعذر نسخ النسخة الاحتياطية. لم يُترك أي شيء في المجلد الهدف. |
| `errors.insufficientDiskSpace` | There is not enough free disk space for this operation. | لا توجد مساحة تخزين كافية لإجراء هذه العملية. |
| `recovery.destinationDefaultHelp` | Default folder on this computer. For real protection choose a USB drive or another disk. | المجلد الافتراضي على هذا الحاسوب. للحماية الفعلية اختر قرصًا خارجيًا أو قرصًا آخر. |
| `recovery.sameDriveWarning` | This folder is on the same disk as your data. If the disk fails, the backups are lost too. | هذا المجلد على نفس القرص الذي يحتوي بياناتك. إذا تعطّل القرص ستُفقد النسخ الاحتياطية أيضًا. |
| `recovery.openOtherFolder` | Open a backup from another folder… | فتح نسخة احتياطية من مجلد آخر… |
| `recovery.selectedBackup` | Selected backup | النسخة الاحتياطية المحددة |
| `recovery.listTitle` | Your backups | نسخك الاحتياطية |
| `recovery.listEmpty` | No backups in this folder yet. | لا توجد نسخ احتياطية في هذا المجلد بعد. |
| `recovery.colDate` | Date | التاريخ |
| `recovery.colType` | Type | النوع |
| `recovery.colSize` | Size | الحجم |
| `recovery.colVersion` | Version status | حالة الإصدار |
| `recovery.colActions` | Actions | الإجراءات |
| `recovery.verdictSame` | Current | محدّثة |
| `recovery.verdictOlder` | Older — will be updated | قديمة — سيتم تحديثها |
| `recovery.verdictNewer` | Newer — needs a newer Stockiha | أحدث — يتطلب إصدارًا أحدث من Stockiha |
| `recovery.verdictUnknown` | Unknown | غير معروفة |
| `recovery.actionCheck` | Check | فحص |
| `recovery.actionTest` | Test | اختبار |
| `recovery.actionCopyTo` | Copy to… | نسخ إلى… |
| `recovery.copyTargetTitle` | Select a folder to copy this backup into | اختر مجلدًا لنسخ هذه النسخة الاحتياطية إليه |
| `recovery.ariaCheckOf` | Check backup of {date} | فحص النسخة الاحتياطية بتاريخ {date} |
| `recovery.ariaTestOf` | Test backup of {date} | اختبار النسخة الاحتياطية بتاريخ {date} |
| `recovery.ariaCopyOf` | Copy backup of {date} | نسخ النسخة الاحتياطية بتاريخ {date} |
| `recovery.testDisabledNote` | Backup testing is turned off in Advanced. | اختبار النسخ الاحتياطية معطّل في الإعدادات المتقدمة. |
| `recovery.advancedTitle` | Advanced | إعدادات متقدمة |
| `recovery.testDialogTitle` | Test this backup? | اختبار هذه النسخة الاحتياطية؟ |
| `recovery.testDialogBody` | Stockiha will start a temporary database, load this backup into it, check it, and delete it. Your live data is not touched. This can take a few minutes. | سيقوم Stockiha بتشغيل قاعدة بيانات مؤقتة وتحميل هذه النسخة فيها وفحصها ثم حذفها. لن تُمس بياناتك الحالية. قد يستغرق ذلك بضع دقائق. |
| `recovery.testDialogConfirm` | Start test | بدء الاختبار |
| `recovery.copySuccess` | Backup copied to {path} | تم نسخ النسخة الاحتياطية إلى {path} |
| `recovery.copyFailed` | The backup could not be copied. | تعذر نسخ النسخة الاحتياطية. |
| `recovery.kind` | Backup type | نوع النسخة الاحتياطية |
| `recovery.kindManual` | Manual | يدوية |
| `recovery.kindDaily` | Daily automatic | تلقائية يومية |
| `recovery.kindPreUpdate` | Before update | قبل التحديث |
| `recovery.kindPreRestore` | Before restore | قبل الاسترجاع |
| `recovery.kindUnknown` | Unknown | غير معروفة |
| `recovery.restorable` | Can be restored by this version | يمكن استرجاعها بهذا الإصدار |
| `recovery.serverStopped` | Temporary database stopped | تم إيقاف قاعدة البيانات المؤقتة |
| `recovery.updatedToCurrent` | Updated to current version | تم التحديث إلى الإصدار الحالي |
| `recovery.cleanupPendingNote` | A temporary folder could not be removed yet; Stockiha will remove it at next start. | تعذر حذف مجلد مؤقت حتى الآن؛ سيقوم Stockiha بحذفه عند بدء التشغيل التالي. |
| `recovery.lastBackup` | Last successful backup: {date} | آخر نسخة احتياطية ناجحة: {date} |
| `recovery.noBackupYet` | No backup has been made yet. | لم يتم إنشاء أي نسخة احتياطية بعد. |
| `recovery.lastBackupFailed` | The last backup attempt failed. | فشلت آخر محاولة لإنشاء نسخة احتياطية. |
| `recovery.restoreConfirmTitle` | Replace your data with this backup? | استبدال بياناتك بهذه النسخة الاحتياطية؟ |
| `recovery.restoreConfirmWarning` | Everything recorded in Stockiha after {date} will be removed: sales, purchases, stock changes, customers, users. Before anything changes, Stockiha tests this backup and saves a safety copy of today's data. Stockiha will restart at the end. | سيتم حذف كل ما سُجّل في Stockiha بعد {date}: المبيعات والمشتريات وحركات المخزون والزبائن والمستخدمين. قبل أي تغيير، يقوم Stockiha باختبار هذه النسخة الاحتياطية وحفظ نسخة أمان من بيانات اليوم. سيُعيد Stockiha تشغيل نفسه في النهاية. |
| `recovery.restoreConfirmOlderNote` | This backup is from an older version; it will be updated automatically. | هذه النسخة الاحتياطية من إصدار أقدم؛ سيتم تحديثها تلقائيًا. |
| `recovery.restoreConfirmCheckbox` | I understand that recent data will be removed. | أفهم أنه سيتم حذف البيانات الحديثة. |
| `recovery.restoreConfirmWordLabel` | Type RESTORE to confirm | اكتب RESTORE للتأكيد |
| `recovery.restoreConfirmButton` | Restore now | استرجاع الآن |
| `recovery.restoreConfirmCashSessionOpen` | Close the open cash session before restoring. | أغلق جلسة الصندوق المفتوحة قبل الاسترجاع. |
| `recovery.actionRestore` | Restore… | استرجاع… |
| `recovery.ariaRestoreOf` | Restore backup of {date} | استرجاع النسخة الاحتياطية بتاريخ {date} |
| `recovery.takeoverDidNotStart` | The restore did not start. Your data was not changed. | لم تبدأ عملية الاسترجاع. لم تتغيّر بياناتك. |
| `recovery.restartButton` | Restart Stockiha | إعادة تشغيل Stockiha |
| `recovery.takeoverSucceeded` | Restore complete. Stockiha is restarting… | تم الاسترجاع. جارٍ إعادة تشغيل Stockiha… |
| `recovery.takeoverSucceededMigrated` | (leading space) It was updated to the current version. | (leading space) تم تحديثها إلى الإصدار الحالي. |
| `recovery.takeoverAbortedTitle` | The restore was stopped before anything changed. Your data is exactly as it was. | تم إيقاف الاسترجاع قبل تغيير أي شيء. بياناتك كما كانت تمامًا. |
| `recovery.takeoverRolledBackTitle` | The restore failed and your data was put back exactly as it was before. | فشل الاسترجاع وتمت إعادة بياناتك كما كانت تمامًا. |
| `recovery.takeoverRolledBackSafety` | A safety copy is kept in your backups list: {id}. | تم الاحتفاظ بنسخة أمان في قائمة نسخك الاحتياطية: {id}. |
| `recovery.takeoverRollbackFailedTitle` | The restore failed and Stockiha could not put your data back automatically. Do not use Stockiha. Contact your supplier now and give them this information: | فشل الاسترجاع ولم يتمكن Stockiha من إعادة بياناتك تلقائيًا. لا تستخدم Stockiha. اتصل بالمورّد الآن وأعطه هذه المعلومات: |
| `recovery.stepNotNeeded` | Not needed | غير مطلوب |
| `recovery.restoreStep.validateBackup` | Checking the backup | فحص النسخة الاحتياطية |
| `recovery.restoreStep.preflight` | Preliminary checks | فحوصات أولية |
| `recovery.restoreStep.testRestore` | Testing the restore | اختبار الاسترجاع |
| `recovery.restoreStep.safetyBackup` | Safety copy | نسخة أمان |
| `recovery.restoreStep.stopConnections` | Closing connections | إغلاق الاتصالات |
| `recovery.restoreStep.replaceData` | Replacing data | استبدال البيانات |
| `recovery.restoreStep.updateSchema` | Updating the schema | تحديث المخطط |
| `recovery.restoreStep.verify` | Verifying | التحقق |
| `recovery.restoreStep.restoreFiles` | Restoring files | استرجاع الملفات |
| `recovery.restoreStep.record` | Recording | التسجيل |
| `recovery.restoreStep.rollback` | Rolling back | التراجع |
| `recovery.freshInstallTitle` | Restore from a backup | الاسترجاع من نسخة احتياطية |
| `recovery.freshInstallBody` | Use this if Stockiha was used on another computer. Choose the backup folder (for example on a USB stick). Your user accounts and all data will come from the backup. | استخدم هذا إذا كان Stockiha مستخدمًا على حاسوب آخر. اختر مجلد النسخة الاحتياطية (على قرص خارجي مثلًا). ستأتي حسابات المستخدمين وكل البيانات من النسخة الاحتياطية. |
| `recovery.freshInstallChoose` | Choose backup folder… | اختيار مجلد النسخة الاحتياطية… |
| `recovery.freshInstallCheckbox` | I understand this installation will use the data from this backup. | أفهم أن هذا التثبيت سيستخدم بيانات هذه النسخة الاحتياطية. |
| `recovery.freshInstallRestoreButton` | Restore | استرجاع |
| `recovery.back` | Back | رجوع |
| `recovery.restoreFromBackupInstead` | Restore from a backup instead | الاسترجاع من نسخة احتياطية بدلًا من ذلك |
| `recovery.overdueWarning` | No backup has been made in the last 7 days. | لم يتم إنشاء أي نسخة احتياطية خلال آخر 7 أيام. |
| `recovery.overdueAction` | Open backup settings | فتح إعدادات النسخ الاحتياطية |

## Strings translated without a reference

Every key with an exact match in §5.4 or a direct glossary term (§5.3) is not repeated here. The following had no exact reference and were translated by meaning, using the glossary and the surrounding Arabic register:

| Key | English | My Arabic | Note |
|---|---|---|---|
| `recovery.openOtherFolder` | Open a backup from another folder… | فتح نسخة احتياطية من مجلد آخر… | — |
| `recovery.selectedBackup` | Selected backup | النسخة الاحتياطية المحددة | — |
| `recovery.listTitle` | Your backups | نسخك الاحتياطية | matches French "Vos sauvegardes" |
| `recovery.colDate`/`colType`/`colSize`/`colVersion`/`colActions` | Date / Type / Size / Version status / Actions | التاريخ / النوع / الحجم / حالة الإصدار / الإجراءات | plain table headers |
| `recovery.verdictSame` | Current | محدّثة | chose "updated/current" (محدّثة) to match French's meaning-based "À jour", not a literal "حالية" |
| `recovery.verdictOlder`/`verdictNewer`/`verdictUnknown` | Older — will be updated / Newer — needs a newer Stockiha / Unknown | قديمة — سيتم تحديثها / أحدث — يتطلب إصدارًا أحدث من Stockiha / غير معروفة | parallel adjective forms with `verdictSame` |
| `recovery.actionCheck`/`actionTest`/`actionCopyTo` | Check / Test / Copy to… | فحص / اختبار / نسخ إلى… | direct glossary terms |
| `recovery.copyTargetTitle` | Select a folder to copy this backup into | اختر مجلدًا لنسخ هذه النسخة الاحتياطية إليه | — |
| `recovery.ariaCheckOf`/`ariaTestOf`/`ariaCopyOf`/`ariaRestoreOf` | Check/Test/Copy/Restore backup of {date} | فحص/اختبار/نسخ/استرجاع النسخة الاحتياطية بتاريخ {date} | ARIA labels, kept parallel |
| `recovery.testDisabledNote` | Backup testing is turned off in Advanced. | اختبار النسخ الاحتياطية معطّل في الإعدادات المتقدمة. | — |
| `recovery.advancedTitle` | Advanced | إعدادات متقدمة | chose the two-word "Advanced settings" over a bare adjective, which reads incomplete alone as a section header in Arabic |
| `recovery.testDialogTitle`/`testDialogBody`/`testDialogConfirm` | Test this backup? / (long body) / Start test | اختبار هذه النسخة الاحتياطية؟ / (long body) / بدء الاختبار | body's first two sentences match the §5.4 `testDialogTitle`-adjacent reference almost verbatim; added the closing "this can take a few minutes" clause myself |
| `recovery.copySuccess`/`copyFailed` | Backup copied to {path} / The backup could not be copied. | تم نسخ النسخة الاحتياطية إلى {path} / تعذر نسخ النسخة الاحتياطية. | — |
| `recovery.kind`/`kindManual`/`kindPreUpdate`/`kindPreRestore`/`kindUnknown` | Backup type / Manual / Before update / Before restore / Unknown | نوع النسخة الاحتياطية / يدوية / قبل التحديث / قبل الاسترجاع / غير معروفة | `kindDaily` alone is a direct glossary term |
| `recovery.restorable`/`serverStopped`/`updatedToCurrent`/`cleanupPendingNote` | (see table above) | (see table above) | — |
| `recovery.restoreConfirmTitle`/`restoreConfirmOlderNote` | Replace your data with this backup? / This backup is from an older version; it will be updated automatically. | استبدال بياناتك بهذه النسخة الاحتياطية؟ / هذه النسخة الاحتياطية من إصدار أقدم؛ سيتم تحديثها تلقائيًا. | — |
| `recovery.restoreConfirmWarning` | (long warning, see table above) | (long warning, see table above) | one sentence beyond the reference table's scope |
| `recovery.actionRestore`/`back` | Restore… / Back | استرجاع… / رجوع | — |
| `recovery.takeoverDidNotStart`/`takeoverSucceededMigrated`/`takeoverRolledBackSafety` | (see table above) | (see table above) | — |
| `recovery.takeoverRollbackFailedTitle` | (see table above) | (see table above) | combined with the §5.4 "Do not use Stockiha. Contact your supplier now." reference for its second half |
| `recovery.stepNotNeeded` and all ten `recovery.restoreStep.*` keys | Not needed / Checking the backup / … / Rolling back | غير مطلوب / فحص النسخة الاحتياطية / … / التراجع | short progress-checklist labels, kept as terse gerund-like nouns to match each other |
| `recovery.freshInstallTitle`/`freshInstallBody`/`freshInstallChoose`/`freshInstallCheckbox`/`freshInstallRestoreButton` | (see table above) | (see table above) | — |
| `errors.recoveryUnavailable`/`backupNotRestorable`/`restoreTestFailed`/`freshRestoreNotAllowed`/`backupCopyFailed`/`insufficientDiskSpace` | (see table above) | (see table above) | `errors.backupDestinationUnavailable` alone had an exact §5.4 reference |

## French changes

**None.** Reviewed every `recovery.*` string, the four WS-H-6 `update.*` strings, and the 7 related `errors.*` strings in the `fr` dictionary against §6.1's glossary and §6.2's rules. Every string already:
- used the typographic apostrophe `’` consistently (no `'` found in any reviewed key),
- matched the glossary terms exactly,
- kept `RESTORE` untranslated (`recovery.restoreConfirmWordLabel`: "Tapez RESTORE pour confirmer"),
- contained no leftover English, and
- had no grammar or agreement errors.

No before/after table is included because there is nothing to show — asserting a change that didn't happen would misrepresent the work.

## Documentation changes

- `docs/recovery/RESTORE_PROCEDURE.md` — added `## Installed Stockiha (WS-H-5 and later)` at the top (the four required points: restore on a working install via Settings → Backup and recovery → Your backups → Restore…; restore on a new PC via first-run setup's "Restore from a backup instead"; the interrupted-restore/power-cut recovery path naming `Before restore` and `recovery.log`; and the closing note that the command-line procedure below applies only to `run.bat` databases), and added `## Developer databases only (run.bat)` immediately above the pre-existing content, which is otherwise untouched.
- `CURRENT_STEP.md` — replaced the WS-H row's Status and Verification Reference columns (§4 Acceptance Status table) with a summary stating WS-H-3 through WS-H-7 supersede the WS-H-1/WS-H-2 `run.bat`-only design for embedded installs, listing what now exists, and leaving the acceptance date as `<to be filled by the Owner>`. Table shape (columns, other rows) unchanged.
- `STOCKIHA_GROUND_TRUTH.md` — replaced only the WS-H entry's "Current status" line and MVP/Future lists with exactly the wording in §7.3. No other line in the file touched.
- `docs/slices/R6-001-operator-backup-validation.md` — inserted the exact superseded-notice blockquote as the first line after the title.
- `docs/slices/R6-002-controlled-restore-verification.md` — inserted the same blockquote, same wording.
- `scripts/recovery/README.md` — added a legacy note at the top: the script applies only to the developer `run.bat` path, has been out of date since 2026-08-27, and installed builds never use it.
- `WS-H-MANUAL-VERIFICATION.md` — appended `§M7 — Final end-to-end acceptance` with the exact five items from the brief.

## Files changed

```
 CURRENT_STEP.md                                    |   2 +-
 STOCKIHA_GROUND_TRUTH.md                           |  17 +-
 WS-H-MANUAL-VERIFICATION.md                        |   8 +
 docs/recovery/RESTORE_PROCEDURE.md                 |  29 +++
 docs/slices/R6-001-operator-backup-validation.md   |   2 +
 docs/slices/R6-002-controlled-restore-verification.md |   2 +
 scripts/recovery/README.md                         |   7 +
 src/shared/i18n/locales.ts                         | 273 +++++++--------------
 src/shared/version.ts                              |   2 +-
 9 files changed, 152 insertions(+), 190 deletions(-)
```

`src-tauri/Cargo.toml` shows as modified in `git status` but has an empty `git diff` (pre-existing CRLF/LF line-ending metadata noise, not a real change) — not staged, not part of this commit, and no `.rs`/`.sql`/other forbidden file was touched anywhere in this task.

## Gates

No Rust and no SQL gate applies to this sub-plan (no `.rs`, `.sql`, or migration file was touched) — stated explicitly per the brief rather than left unmentioned.

### `grep -rn "TODO(WS-H-7)" src/`
```
(no output — exit code 1, nothing found)
```

### `npm run typecheck`
```
> stockiha@0.1.0 typecheck
> tsc -b
(no output, exit 0)
```
Confirms the `fr`/`ar`/`en` dictionaries still carry exactly the same key set — a missing, extra, or renamed key would have failed this loudly (`Record<MessageKey, string>` is exhaustive and closed).

### `npm run lint`
```
> stockiha@0.1.0 lint
> eslint .
(no output, exit 0)
```

### `npm test -- --run`
```
Test Files  56 passed (56)
     Tests  562 passed (562)
```
Full pass, including the intermittently-flaky `tests/nav-role-based-access.workflow.test.tsx` theme-toggle test — it did not fail on this run, so there is nothing to re-run in isolation or report as expected-and-known this time.

### `npm run build`
```
> stockiha@0.1.0 build
> tsc -b && vite build
✓ 357 modules transformed.
✓ built in 6.17s
```

## Deviations from the brief

1. **Branched from `b0f1372`, not `229c647`.** The brief's §3 explicitly anticipated this ("more commits may have landed since... that is fine and expected — use it, and say so"). `b0f1372` is the WS-H-6 Result Report docs commit, one ahead of the `229c647` code commit named in the brief's prose. Reported per instruction.
2. **Translated 7 additional `errors.*` keys beyond the exact set named in the brief's §5.1 body text.** The brief's own first instruction in §5.1 is "Find every line marked `// TODO(WS-H-7)`" — running that exact `grep` (as instructed) surfaced 7 `errors.*` keys (`recoveryUnavailable`, `backupDestinationUnavailable`, `backupNotRestorable`, `restoreTestFailed`, `freshRestoreNotAllowed`, `backupCopyFailed`, `insufficientDiskSpace`) that the brief's prose list of "additionally review" keys did not name, but that the plan's PART 11 does name explicitly, and that all carried the identical `// TODO(WS-H-7)` marker the brief said to find and clear. Translated them for the same reason the brief's own instruction exists: an untranslated, marker-carrying string in the `ar` dictionary is exactly the defect H7-01 sets out to close. Left untranslated they would have made "`grep -rn TODO(WS-H-7) src/` must return nothing" (§9) impossible to satisfy.
3. **`recovery.verdictSame`'s Arabic ("محدّثة" — "updated/current") is a meaning-based rather than literal translation of "Current"**, chosen to match the French translator's own earlier meaning-based choice ("À jour" — "up to date") rather than a literal "حالية". Listed in "Strings translated without a reference" for the Owner's specific review, per §5.5.
4. **French review produced zero changes.** The brief's report template assumes a "before/after" table will have content; it does not, because the French text was already correct. Documented explicitly rather than silently omitting the section.

## Blockers / questions for the Architect

None. No repository state contradicted this brief.

## Pending manual checks (PART 14 §M7)

Appended verbatim to `WS-H-MANUAL-VERIFICATION.md`; all five require the installed Windows build:

1. Switch the language to Arabic: every backup and restore screen reads correctly right-to-left with no English text left, and the confirmation still asks for the Latin word `RESTORE`.
2. Switch to French: same check, correct wording, no English left.
3. Create a backup, record one sale, restore the backup, confirm the sale is gone and the app restarts to the login screen.
4. Restore the automatically created "Before restore" backup and confirm the sale is back.
5. Confirm the Settings status line shows the correct date of the last successful backup, in all three languages.

## WS-H workstream closure summary

| Sub-plan | Branch | Final code commit | Final report commit |
|---|---|---|---|
| WS-H-3 — Embedded backup foundation | `task/ws-h-3-embedded-backup` | `f960fe0` | `1c750b2` |
| WS-H-4 — Backup list, copy, isolated restore test | `task/ws-h-4-backup-list-and-test` | `0efd20e` | `7141c62` |
| WS-H-5 — Real restore and new-PC restore | `task/ws-h-5-live-restore` | `979c906` (schema-grant fix, supersedes the original `85ce300`) | `f8e8eab` |
| WS-H-6 — Automatic backups | `task/ws-h-6-automatic-backups` | `229c647` | `b0f1372` |
| WS-H-7 — Translations, documentation, closure | `task/ws-h-7-translations-docs` | `ee96bbf` | *(this commit, pushed separately below)* |

Each branch was created from the previous sub-plan's actual tip at the time (never from `main`, never rebased), so the five branches form one linear chain from `task/ws-h-3-embedded-backup` through `task/ws-h-7-translations-docs`. Merging `task/ws-h-7-translations-docs` into `main` in one fast-forward (or one merge commit) brings the entire WS-H-3..7 workstream in as a single unit.

## Unrelated problems noticed (not fixed)

None newly noticed in this task's scope. (WS-H-6's report already noted the `nav-role-based-access.workflow.test.tsx` theme-toggle flake and the now-fixed `BackupStatus`/`BackupStatusRow` deserialization bug; both remain accurately described there and neither recurred or needed further action here.)

---

**Commit:** `ee96bbf929227ae3ab560f6538d86484761d4a20`
**Pushed:** yes — confirmed via `git ls-remote origin task/ws-h-7-translations-docs`:
```
ee96bbf929227ae3ab560f6538d86484761d4a20	refs/heads/task/ws-h-7-translations-docs
```
