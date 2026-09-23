/**
 * WS-M-2 (§M2-02): fallback layout for `BusinessDocumentDetailModal` when a
 * document type has no dedicated model builder (e.g. STOCK_RECEIPT,
 * STOCK_ADJUSTMENT). The caller has already resolved every label and value
 * (the modal's `subtype_detail` is untyped, so it is the one place still
 * responsible for picking the right fields out of it) -- this builder only
 * assembles them into the shared model shape.
 */
import type {
  OfficialDocumentColumn,
  OfficialDocumentInfoRow,
  OfficialDocumentModel,
  OfficialDocumentTotal,
} from '../officialDocument';

export interface GenericModelInput {
  title: string;
  documentNumber: string;
  documentDateText: string;
  statusText?: string;
  partyBlock?: { title: string; rows: OfficialDocumentInfoRow[] };
  metaBlock?: { title: string; rows: OfficialDocumentInfoRow[] };
  columns: OfficialDocumentColumn[];
  rows: Array<Record<string, string>>;
  totals?: OfficialDocumentTotal[];
  notes?: string[];
}

export function buildGenericModel(input: GenericModelInput): OfficialDocumentModel {
  return {
    kind: 'GENERIC',
    title: input.title,
    documentNumber: input.documentNumber,
    documentDateText: input.documentDateText,
    statusText: input.statusText,
    partyBlock: input.partyBlock,
    metaBlock: input.metaBlock,
    columns: input.columns,
    rows: input.rows,
    totals: input.totals,
    notes: input.notes,
  };
}
