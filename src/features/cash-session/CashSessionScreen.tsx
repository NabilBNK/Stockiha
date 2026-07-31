import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import * as cashIpc from '../../shared/ipc/cashSessionGateway';
import type {
  CashDenomination,
  CashSessionCloseResult,
  CurrentCashSession,
  DenominationCountInput,
} from '../../shared/ipc/cashSessionDto';
import type { CashSessionDetail } from '../../shared/ipc/dto';

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const INTEGER_RE = /^\d+$/;

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    currentCashier: 'Current cashier', state: 'State', beginClose: 'Begin blind close',
    blindTitle: 'Blind denomination count', blindHelp: 'Count the drawer by denomination. Expected cash stays hidden until you submit.',
    cancelClose: 'Cancel close', submitCount: 'Submit blind count', expected: 'Expected cash', counted: 'Counted cash',
    variance: 'Variance', pendingApproval: 'Manager approval required', approvalHelp: 'A manager or administrator must authorize this exact close attempt.',
    managerUsername: 'Manager username', managerPassword: 'Manager password', approvalReason: 'Approval reason', approve: 'Approve and close',
    suspend: 'Suspend session', suspensionReason: 'Suspension reason', suspended: 'Session suspended', resume: 'Resume session',
    handoverTitle: 'Manager handover', targetCashier: 'Target cashier username', handoverReason: 'Handover reason', handover: 'Transfer ownership',
    handoverHelp: 'The session remains suspended after handover. The new cashier must sign in and resume it.',
    ownerChanged: 'Cash ownership changed. Only the displayed current cashier can resume this session.',
    closed: 'Session closed', exactClose: 'Blind count accepted. Session closed.', managerFields: 'Manager credentials and reason are required.',
    handoverFields: 'Manager credentials, target cashier, and reason are required.', reasonRequired: 'A reason is required.',
  },
  fr: {
    currentCashier: 'Caissier actuel', state: 'État', beginClose: 'Commencer la clôture à l’aveugle',
    blindTitle: 'Comptage à l’aveugle par coupure', blindHelp: 'Comptez la caisse par coupure. Le montant attendu reste masqué jusqu’à l’envoi.',
    cancelClose: 'Annuler la clôture', submitCount: 'Envoyer le comptage', expected: 'Espèces attendues', counted: 'Espèces comptées',
    variance: 'Écart', pendingApproval: 'Validation responsable requise', approvalHelp: 'Un responsable ou administrateur doit valider cette tentative exacte de clôture.',
    managerUsername: 'Utilisateur responsable', managerPassword: 'Mot de passe responsable', approvalReason: 'Motif de validation', approve: 'Valider et clôturer',
    suspend: 'Suspendre la session', suspensionReason: 'Motif de suspension', suspended: 'Session suspendue', resume: 'Reprendre la session',
    handoverTitle: 'Passation par responsable', targetCashier: 'Utilisateur du nouveau caissier', handoverReason: 'Motif de passation', handover: 'Transférer la responsabilité',
    handoverHelp: 'La session reste suspendue après la passation. Le nouveau caissier doit se connecter puis la reprendre.',
    ownerChanged: 'La responsabilité de caisse a changé. Seul le caissier affiché peut reprendre cette session.',
    closed: 'Session clôturée', exactClose: 'Comptage accepté. Session clôturée.', managerFields: 'Identifiants du responsable et motif requis.',
    handoverFields: 'Identifiants du responsable, nouveau caissier et motif requis.', reasonRequired: 'Un motif est obligatoire.',
  },
  ar: {
    currentCashier: 'أمين الصندوق الحالي', state: 'الحالة', beginClose: 'بدء الإغلاق بالجرد الأعمى',
    blindTitle: 'الجرد الأعمى حسب الفئة', blindHelp: 'عدّ محتوى الصندوق حسب كل فئة. المبلغ المتوقع يبقى مخفياً حتى إرسال الجرد.',
    cancelClose: 'إلغاء الإغلاق', submitCount: 'إرسال الجرد', expected: 'النقد المتوقع', counted: 'النقد المعدود',
    variance: 'الفارق', pendingApproval: 'موافقة المسؤول مطلوبة', approvalHelp: 'يجب على مسؤول أو مدير الموافقة على محاولة الإغلاق هذه تحديداً.',
    managerUsername: 'اسم مستخدم المسؤول', managerPassword: 'كلمة مرور المسؤول', approvalReason: 'سبب الموافقة', approve: 'موافقة وإغلاق',
    suspend: 'تعليق الجلسة', suspensionReason: 'سبب التعليق', suspended: 'الجلسة معلقة', resume: 'استئناف الجلسة',
    handoverTitle: 'تسليم الصندوق بموافقة المسؤول', targetCashier: 'اسم مستخدم أمين الصندوق الجديد', handoverReason: 'سبب التسليم', handover: 'نقل المسؤولية',
    handoverHelp: 'تبقى الجلسة معلقة بعد التسليم. يجب على أمين الصندوق الجديد تسجيل الدخول ثم استئنافها.',
    ownerChanged: 'تم تغيير مسؤولية الصندوق. فقط أمين الصندوق الظاهر يمكنه استئناف الجلسة.',
    closed: 'تم إغلاق الجلسة', exactClose: 'تم قبول الجرد وإغلاق الجلسة.', managerFields: 'بيانات المسؤول والسبب مطلوبة.',
    handoverFields: 'بيانات المسؤول وأمين الصندوق الجديد والسبب مطلوبة.', reasonRequired: 'السبب مطلوب.',
  },
};

function initialCounts(denominations: CashDenomination[]): Record<number, string> {
  return Object.fromEntries(denominations.map((denomination) => [denomination.id, '0']));
}

export function CashSessionScreen() {
  const { t, locale } = useI18n();
  const text = COPY[locale];
  const { user, refreshActiveCashSession, workstationId } = useSession();
  const { selectedWarehouseId } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [current, setCurrent] = useState<CurrentCashSession | null>(null);
  const [denominations, setDenominations] = useState<CashDenomination[]>([]);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [openingFloat, setOpeningFloat] = useState('0');
  const [suspensionReason, setSuspensionReason] = useState('');
  const [managerUsername, setManagerUsername] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [targetCashier, setTargetCashier] = useState('');
  const [handoverReason, setHandoverReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [closedSummary, setClosedSummary] = useState<CashSessionDetail | null>(null);

  const refreshLifecycle = useCallback(async () => {
    if (!token) {
      setCurrent(null);
      return;
    }
    const session = await cashIpc.inspectCurrentCashSession(token, workstationId);
    setCurrent(session);
  }, [token, workstationId]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      refreshLifecycle(),
      cashIpc.listCashDenominations(token).then((rows) => {
        setDenominations(rows);
        setCounts(initialCounts(rows));
      }),
    ]).catch((err) => setError(errorText(err)));
  }, [token, refreshLifecycle, errorText]);

  const countsValid = useMemo(
    () => denominations.length > 0 && denominations.every((d) => INTEGER_RE.test(counts[d.id] ?? '')),
    [denominations, counts],
  );

  async function sync() {
    await Promise.all([refreshLifecycle(), refreshActiveCashSession()]);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onOpen(event: FormEvent) {
    event.preventDefault();
    if (!token || selectedWarehouseId == null || !AMOUNT_RE.test(openingFloat)) return;
    await run(async () => {
      await ipc.openCashSession(token, selectedWarehouseId, workstationId, openingFloat);
      setClosedSummary(null);
      await sync();
    });
  }

  async function beginClose() {
    if (!current) return;
    await run(async () => {
      await cashIpc.beginCashSessionClose(token, current.id);
      setCounts(initialCounts(denominations));
      await sync();
    });
  }

  async function cancelClose() {
    if (!current) return;
    await run(async () => {
      await cashIpc.cancelCashSessionClose(token, current.id);
      await sync();
    });
  }

  async function submitCount(event: FormEvent) {
    event.preventDefault();
    if (!current || !countsValid) return;

    const payload: DenominationCountInput[] = denominations.map((denomination) => ({
      denomination_id: denomination.id,
      quantity: Number(counts[denomination.id]),
    }));

    await run(async () => {
      const result: CashSessionCloseResult = await cashIpc.submitCashSessionCount(token, current.id, payload);
      if (result.status === 'CLOSED') {
        setClosedSummary(await ipc.getCashSession(token, current.id));
        setInfo(text.exactClose);
      }
      await sync();
    });
  }

  async function suspend(event: FormEvent) {
    event.preventDefault();
    if (!current || !suspensionReason.trim()) {
      setError(text.reasonRequired);
      return;
    }
    await run(async () => {
      await cashIpc.suspendCashSession(token, current.id, suspensionReason.trim());
      setSuspensionReason('');
      await sync();
    });
  }

  async function resume() {
    if (!current) return;
    await run(async () => {
      await cashIpc.resumeCashSession(token, current.id);
      await sync();
    });
  }

  async function approveVariance(event: FormEvent) {
    event.preventDefault();
    if (!current?.close_attempt_id) return;
    if (!managerUsername.trim() || !managerPassword || !approvalReason.trim()) {
      setError(text.managerFields);
      return;
    }

    await run(async () => {
      let managerToken: string | null = null;
      try {
        const manager = await ipc.login(managerUsername.trim(), managerPassword, workstationId);
        managerToken = manager.session_token;
        await cashIpc.approveCashSessionVariance(
          managerToken,
          current.id,
          current.close_attempt_id!,
          approvalReason.trim(),
        );
        setClosedSummary(await ipc.getCashSession(token, current.id));
        setManagerPassword('');
        setApprovalReason('');
        setInfo(text.closed);
      } finally {
        if (managerToken) await ipc.logout(managerToken).catch(() => undefined);
      }
      await sync();
    });
  }

  async function handover(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    if (!managerUsername.trim() || !managerPassword || !targetCashier.trim() || !handoverReason.trim()) {
      setError(text.handoverFields);
      return;
    }

    await run(async () => {
      let managerToken: string | null = null;
      try {
        const manager = await ipc.login(managerUsername.trim(), managerPassword, workstationId);
        managerToken = manager.session_token;
        await cashIpc.handoverCashSession(
          managerToken,
          current.id,
          targetCashier.trim(),
          handoverReason.trim(),
        );
        setManagerPassword('');
        setTargetCashier('');
        setHandoverReason('');
        setInfo(text.ownerChanged);
      } finally {
        if (managerToken) await ipc.logout(managerToken).catch(() => undefined);
      }
      await sync();
    });
  }

  return (
    <section className="sk-page">
      <h1>{t('session.title')}</h1>
      {error ? <Banner tone="error" testId="session-error">{error}</Banner> : null}
      {info ? <Banner tone="success" testId="session-info">{info}</Banner> : null}

      {!current ? (
        <form className="sk-card sk-form" onSubmit={onOpen} aria-label={t('session.open')}>
          <Banner tone="info">{t('session.none')}</Banner>
          <TextField
            label={t('session.openingFloat')}
            value={openingFloat}
            inputMode="decimal"
            onChange={(e) => setOpeningFloat(e.target.value)}
            error={!AMOUNT_RE.test(openingFloat) ? t('errors.validation') : undefined}
            required
          />
          <Button type="submit" loading={busy} disabled={selectedWarehouseId == null || !AMOUNT_RE.test(openingFloat)}>
            {t('session.open')}
          </Button>
        </form>
      ) : null}

      {current ? (
        <div className="sk-card" data-testid="cash-session-lifecycle">
          <p><strong>{text.state}:</strong> {current.status}</p>
          <p><strong>{text.currentCashier}:</strong> {current.current_cashier_display_name}</p>
          <p><strong>{t('session.openingFloat')}:</strong> {current.opening_float}</p>
        </div>
      ) : null}

      {current?.status === 'OPEN' ? (
        <>
          <div className="sk-card sk-form">
            <Button type="button" variant="danger" loading={busy} onClick={beginClose}>
              {text.beginClose}
            </Button>
          </div>
          <form className="sk-card sk-form" onSubmit={suspend}>
            <TextField
              label={text.suspensionReason}
              value={suspensionReason}
              onChange={(event) => setSuspensionReason(event.target.value)}
              required
            />
            <Button type="submit" variant="secondary" loading={busy} disabled={!suspensionReason.trim()}>
              {text.suspend}
            </Button>
          </form>
        </>
      ) : null}

      {current?.status === 'CLOSING' ? (
        <form className="sk-card sk-form" onSubmit={submitCount} data-testid="blind-count-form">
          <h2>{text.blindTitle}</h2>
          <Banner tone="warning">{text.blindHelp}</Banner>
          {denominations.map((denomination) => (
            <TextField
              key={denomination.id}
              label={`${denomination.value} DZD`}
              value={counts[denomination.id] ?? '0'}
              inputMode="numeric"
              onChange={(event) => setCounts((previous) => ({
                ...previous,
                [denomination.id]: event.target.value,
              }))}
              error={!INTEGER_RE.test(counts[denomination.id] ?? '') ? t('errors.validation') : undefined}
              required
            />
          ))}
          <div className="sk-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={cancelClose}>
              {text.cancelClose}
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!countsValid}>
              {text.submitCount}
            </Button>
          </div>
        </form>
      ) : null}

      {current?.status === 'PENDING_APPROVAL' ? (
        <form className="sk-card sk-form" onSubmit={approveVariance} data-testid="variance-approval-form">
          <h2>{text.pendingApproval}</h2>
          <Banner tone="warning">{text.approvalHelp}</Banner>
          <p>{text.expected}: <strong>{current.expected_amount ?? '—'}</strong></p>
          <p>{text.counted}: <strong>{current.counted_amount ?? '—'}</strong></p>
          <p>{text.variance}: <strong>{current.variance_amount ?? '—'}</strong></p>
          <TextField label={text.managerUsername} value={managerUsername} onChange={(event) => setManagerUsername(event.target.value)} required />
          <TextField label={text.managerPassword} type="password" value={managerPassword} onChange={(event) => setManagerPassword(event.target.value)} required />
          <TextField label={text.approvalReason} value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} required />
          <Button type="submit" variant="danger" loading={busy}>{text.approve}</Button>
        </form>
      ) : null}

      {current?.status === 'SUSPENDED' ? (
        <>
          <div className="sk-card sk-form">
            <Banner tone="warning">{text.suspended}{current.suspension_reason ? ` — ${current.suspension_reason}` : ''}</Banner>
            <Button type="button" loading={busy} onClick={resume}>{text.resume}</Button>
          </div>
          <form className="sk-card sk-form" onSubmit={handover} data-testid="cash-session-handover-form">
            <h2>{text.handoverTitle}</h2>
            <p>{text.handoverHelp}</p>
            <TextField label={text.managerUsername} value={managerUsername} onChange={(event) => setManagerUsername(event.target.value)} required />
            <TextField label={text.managerPassword} type="password" value={managerPassword} onChange={(event) => setManagerPassword(event.target.value)} required />
            <TextField label={text.targetCashier} value={targetCashier} onChange={(event) => setTargetCashier(event.target.value)} required />
            <TextField label={text.handoverReason} value={handoverReason} onChange={(event) => setHandoverReason(event.target.value)} required />
            <Button type="submit" variant="secondary" loading={busy}>{text.handover}</Button>
          </form>
        </>
      ) : null}

      {closedSummary ? (
        <div className="sk-card" data-testid="closed-summary">
          <h2>{t('session.closedSummary')}</h2>
          <p>{t('session.openingFloat')}: {closedSummary.opening_float}</p>
          <p>{text.expected}: {closedSummary.expected_amount ?? '—'}</p>
          <p>{text.counted}: {closedSummary.counted_amount ?? '—'}</p>
          <p><strong>{text.variance}: {closedSummary.variance_amount ?? '—'}</strong></p>
        </div>
      ) : null}
    </section>
  );
}
