/**
 * Slice 2 — add/remove barcodes for a variant.
 */
import { useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { VariantBarcode } from '../../shared/ipc/dto';

interface Props {
  barcodes: VariantBarcode[];
  onAdd: (barcode: string) => Promise<void>;
  onRemove: (barcodeId: number) => Promise<void>;
  busy?: boolean;
}

export function BarcodeManager({ barcodes, onAdd, onRemove, busy }: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [barcode, setBarcode] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addOk, setAddOk] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (adding || !barcode.trim()) return;
    setAdding(true);
    setAddError(null);
    setAddOk(false);
    try {
      await onAdd(barcode.trim());
      setBarcode('');
      setAddOk(true);
    } catch (err) {
      setAddError(errorText(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(barcodeId: number) {
    if (removingId != null) return;
    setRemovingId(barcodeId);
    try {
      await onRemove(barcodeId);
    } catch {
      // parent will reload detail on next user action
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h3>{t('barcodes.title')}</h3>

      {barcodes.length === 0 ? (
        <Banner tone="info">{t('barcodes.empty')}</Banner>
      ) : (
        <table className="sk-table" data-testid="barcodes-table">
          <thead>
            <tr>
              <th>{t('barcodes.barcode')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {barcodes.map((b) => (
              <tr key={b.id}>
                <td>{b.barcode}</td>
                <td>
                  <Button
                    variant="danger"
                    onClick={() => void handleRemove(b.id)}
                    loading={removingId === b.id}
                    disabled={removingId != null || busy}
                  >
                    {t('barcodes.remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        onSubmit={handleAdd}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBlockStart: '0.5rem' }}
        aria-label={t('barcodes.add')}
        data-testid="barcode-form"
      >
        {addError ? <Banner tone="error" testId="barcode-error">{addError}</Banner> : null}
        {addOk ? <Banner tone="success" testId="barcode-ok">{t('barcodes.added')}</Banner> : null}
        <TextField
          label={t('barcodes.barcode')}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          disabled={adding || busy}
        />
        <Button type="submit" loading={adding} disabled={!barcode.trim() || busy} data-testid="add-barcode-btn">
          {t('barcodes.add')}
        </Button>
      </form>
    </div>
  );
}
