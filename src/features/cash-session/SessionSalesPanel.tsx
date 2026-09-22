import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import { listSessionSales, voidSale } from '../../shared/ipc/saleVoidGateway';
import { VOID_REASONS, type SessionSale, type VoidReason } from '../../shared/ipc/saleVoidDto';
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import { formatDisplayAmount } from '../../shared/utils/formatters';
import { printVoidSlip, type PrintOutcome } from '../pos/printReceipt';
import type { VoidSlipInput } from '../pos/voidSlipBuilder';

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Sales in this session',
    empty: 'No sales in this session yet.',
    number: 'Number',
    time: 'Time',
    type: 'Type',
    total: 'Total',
    status: 'Status',
    kindCash: 'Cash',
    kindCredit: 'Credit',
    posted: 'Completed',
    cancelled: 'Cancelled',
    cancelSale: 'Cancel sale',
    dialogTitle: 'Cancel sale {number}?',
    dialogWarning:
      "The items go back into stock and the amount is removed from the drawer or the customer's account. This cannot be undone.",
    reason: 'Reason',
    reason_CUSTOMER_CHANGED_MIND: 'Customer changed mind',
    reason_WRONG_ITEM: 'Wrong item',
    reason_WRONG_PRICE: 'Wrong price',
    reason_CASHIER_MISTAKE: 'Cashier mistake',
    reason_OTHER: 'Custom reason',
    customDescription: 'Describe the reason (required)',
    noteOptional: 'Note (optional)',
    customDescriptionRequired: 'Describe the reason before cancelling.',
    noteTooLong: 'The note can be at most 200 characters.',
    back: 'Back',
    confirmCancel: 'Cancel the sale',
    cancelledOk: 'Sale cancelled. Cancellation {number} recorded.',
    printFailed: 'The cancellation was recorded, but the slip could not be printed.',
    printAgain: 'Print slip again',
    retry: 'Retry',
  },
  fr: {
    title: 'Ventes de cette session',
    empty: 'Aucune vente dans cette session.',
    number: 'Numéro',
    time: 'Heure',
    type: 'Type',
    total: 'Total',
    status: 'Statut',
    kindCash: 'Comptant',
    kindCredit: 'Crédit',
    posted: 'Validée',
    cancelled: 'Annulée',
    cancelSale: 'Annuler la vente',
    dialogTitle: 'Annuler la vente {number} ?',
    dialogWarning:
      'Les articles reviennent en stock et le montant est retiré de la caisse ou du compte client. Cette action est définitive.',
    reason: 'Motif',
    reason_CUSTOMER_CHANGED_MIND: 'Le client a changé d’avis',
    reason_WRONG_ITEM: 'Mauvais article',
    reason_WRONG_PRICE: 'Mauvais prix',
    reason_CASHIER_MISTAKE: 'Erreur de caisse',
    reason_OTHER: 'Motif personnalisé',
    customDescription: 'Décrivez le motif (obligatoire)',
    noteOptional: 'Note (facultatif)',
    customDescriptionRequired: 'Décrivez le motif avant d’annuler.',
    noteTooLong: 'La note peut contenir au maximum 200 caractères.',
    back: 'Retour',
    confirmCancel: 'Annuler la vente',
    cancelledOk: 'Vente annulée. Annulation {number} enregistrée.',
    printFailed: 'L’annulation est enregistrée, mais le ticket n’a pas pu être imprimé.',
    printAgain: 'Réimprimer le ticket',
    retry: 'Réessayer',
  },
  ar: {
    title: 'مبيعات هذه الحصة',
    empty: 'لا توجد مبيعات في هذه الحصة بعد.',
    number: 'الرقم',
    time: 'الوقت',
    type: 'النوع',
    total: 'المجموع',
    status: 'الحالة',
    kindCash: 'نقدي',
    kindCredit: 'بالآجل',
    posted: 'منجزة',
    cancelled: 'ملغاة',
    cancelSale: 'إلغاء البيع',
    dialogTitle: 'إلغاء البيع {number}؟',
    dialogWarning: 'تعود السلع إلى المخزون ويُخصم المبلغ من الصندوق أو من حساب العميل. لا يمكن التراجع عن ذلك.',
    reason: 'السبب',
    reason_CUSTOMER_CHANGED_MIND: 'غيّر العميل رأيه',
    reason_WRONG_ITEM: 'منتج خاطئ',
    reason_WRONG_PRICE: 'سعر خاطئ',
    reason_CASHIER_MISTAKE: 'خطأ من أمين الصندوق',
    reason_OTHER: 'سبب مخصص',
    customDescription: 'اكتب وصف السبب (إلزامي)',
    noteOptional: 'ملاحظة (اختيارية)',
    customDescriptionRequired: 'اكتب وصف السبب قبل الإلغاء.',
    noteTooLong: 'يمكن أن تحتوي الملاحظة على 200 حرف كحد أقصى.',
    back: 'رجوع',
    confirmCancel: 'إلغاء البيع',
    cancelledOk: 'تم إلغاء البيع. تم تسجيل الإلغاء {number}.',
    printFailed: 'تم تسجيل الإلغاء، لكن تعذّرت طباعة الوصل.',
    printAgain: 'إعادة طباعة الوصل',
    retry: 'إعادة المحاولة',
  },
};

interface SessionSalesPanelProps {
  token: string;
  cashSessionId: number;
  onChanged: () => void;
}

function localTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function localDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hh}:${mm}`;
}

export function SessionSalesPanel({ token, cashSessionId, onChanged }: SessionSalesPanelProps) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();

  const [sales, setSales] = useState<SessionSale[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [printingSettings, setPrintingSettings] = useState<PrintingSettingsDto | null>(null);

  const [openSale, setOpenSale] = useState<SessionSale | null>(null);
  const [reason, setReason] = useState<VoidReason>('CUSTOMER_CHANGED_MIND');
  const [note, setNote] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const [printWarning, setPrintWarning] = useState(false);
  const [lastSlip, setLastSlip] = useState<VoidSlipInput | null>(null);
  const [, setPrintOutcome] = useState<PrintOutcome | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listSessionSales(token, cashSessionId);
      setSales(rows);
      setHidden(false);
      setLoadError(null);
    } catch (err) {
      if (codeForError(err) === 'PERMISSION_DENIED') {
        setHidden(true);
        return;
      }
      setHidden(false);
      setLoadError(errorText(err));
    }
  }, [token, cashSessionId, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    ipc.getPrintingSettings(token).then(setPrintingSettings).catch(() => setPrintingSettings(null));
  }, [token]);

  if (hidden) return null;

  function openDialog(sale: SessionSale) {
    setOpenSale(sale);
    setReason('CUSTOMER_CHANGED_MIND');
    setNote('');
    setDialogError(null);
  }

  function closeDialog() {
    setOpenSale(null);
    setDialogError(null);
  }

  async function confirmCancel() {
    if (!openSale) return;
    const trimmedNote = note.trim();
    if (reason === 'OTHER' && trimmedNote === '') {
      setDialogError(text.customDescriptionRequired);
      return;
    }
    if (trimmedNote.length > 200) {
      setDialogError(text.noteTooLong);
      return;
    }

    setConfirmBusy(true);
    setDialogError(null);
    try {
      const result = await voidSale(token, openSale.document_id, reason, trimmedNote || null);
      closeDialog();

      const reasonLabel = text[`reason_${reason}`];
      const reasonText = trimmedNote ? `${reasonLabel} - ${trimmedNote}` : reasonLabel;
      const slip: VoidSlipInput = {
        voidNumber: result.void_document_number,
        originalNumber: result.original_document_number ?? String(result.original_document_id),
        dateText: localDateTime(result.voided_at),
        reasonText,
        customerName: result.customer_name,
        lines: result.lines.map((l) => ({ name: l.name, qty: l.quantity, lineTotal: l.line_total })),
        total: formatDisplayAmount(result.total_amount),
        currency: 'DA',
        locale,
      };
      const outcome = await printVoidSlip(slip, printingSettings);
      setLastSlip(slip);
      setPrintOutcome(outcome);
      setPrintWarning(outcome.status === 'failed');
      setSuccessInfo(text.cancelledOk.replace('{number}', result.void_document_number));

      await load();
      onChanged();
    } catch (err) {
      setDialogError(errorText(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function printAgain() {
    if (!lastSlip) return;
    setPrintOutcome(await printVoidSlip(lastSlip, printingSettings));
  }

  return (
    <section className="sk-card" data-testid="session-sales-panel">
      <h3>{text.title}</h3>
      {successInfo ? <Banner tone="success">{successInfo}</Banner> : null}
      {printWarning ? <Banner tone="warning">{text.printFailed}</Banner> : null}
      {lastSlip ? (
        <Button type="button" variant="secondary" onClick={() => void printAgain()} data-testid="void-print-again">
          {text.printAgain}
        </Button>
      ) : null}

      {loadError ? (
        <>
          <Banner tone="error">{loadError}</Banner>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            {text.retry}
          </Button>
        </>
      ) : sales.length === 0 ? (
        <p>{text.empty}</p>
      ) : (
        <table className="sk-table">
          <thead>
            <tr>
              <th>{text.number}</th>
              <th>{text.time}</th>
              <th>{text.type}</th>
              <th>{text.total}</th>
              <th>{text.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.document_id}>
                <td>{sale.document_number ?? sale.document_id}</td>
                <td>{localTime(sale.posted_at)}</td>
                <td>
                  {sale.sale_kind === 'CASH' ? text.kindCash : text.kindCredit}
                  {sale.sale_kind === 'CREDIT' && sale.customer_name ? ` — ${sale.customer_name}` : ''}
                </td>
                <td>{formatDisplayAmount(sale.total_amount)}</td>
                <td>
                  {sale.status === 'REVERSED' ? (
                    <>
                      {text.cancelled} ({sale.void_document_number})
                    </>
                  ) : (
                    text.posted
                  )}
                </td>
                <td>
                  {sale.status === 'POSTED' ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => openDialog(sale)}
                      data-testid={`void-sale-${sale.document_id}`}
                    >
                      {text.cancelSale}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openSale ? (
        <div className="sk-modal__backdrop" role="presentation" onClick={closeDialog}>
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            data-testid="void-sale-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="sk-modal__title">
              {text.dialogTitle.replace('{number}', openSale.document_number ?? String(openSale.document_id))}
            </h2>
            <div className="sk-modal__body">
              <Banner tone="warning">{text.dialogWarning}</Banner>
              {dialogError ? <Banner tone="error">{dialogError}</Banner> : null}

              <label>
                {text.reason}
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as VoidReason)}
                  data-testid="void-reason"
                >
                  {VOID_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {text[`reason_${r}`]}
                    </option>
                  ))}
                </select>
              </label>

              <TextField
                label={reason === 'OTHER' ? text.customDescription : text.noteOptional}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="void-note"
              />
            </div>
            <div className="sk-modal__actions">
              <Button type="button" variant="secondary" onClick={closeDialog} disabled={confirmBusy}>
                {text.back}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmCancel()}
                loading={confirmBusy}
                data-testid="void-confirm"
              >
                {text.confirmCancel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
