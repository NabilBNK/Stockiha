import { invoke } from '@tauri-apps/api/core';

import { parseTauriError } from '../utils/tauriError';
import { COMMANDS, type CommandName } from './commands';
import type { DocumentJob } from './dto';
import type {
  CustomerDocumentPayload,
  GeneratedCustomerDocument,
  PrintableDocument,
} from './documentDto';
import { GatewayError } from './gateway';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function listPrintableDocuments(
  sessionToken: string,
  limit = 100,
): Promise<PrintableDocument[]> {
  return call<PrintableDocument[]>(COMMANDS.LIST_PRINTABLE_DOCUMENTS, { sessionToken, limit });
}

export function listBusinessDocuments(
  sessionToken: string,
  limit = 100,
  offset = 0,
  documentType: string | null = null,
): Promise<import('./documentDto').BusinessDocument[]> {
  return call<import('./documentDto').BusinessDocument[]>(COMMANDS.LIST_BUSINESS_DOCUMENTS, {
    sessionToken,
    limit,
    offset,
    documentType,
  });
}

export function getCustomerDocumentPayload(
  sessionToken: string,
  documentId: number,
): Promise<CustomerDocumentPayload> {
  return call<CustomerDocumentPayload>(COMMANDS.GET_CUSTOMER_DOCUMENT_PAYLOAD, {
    sessionToken,
    documentId,
  });
}

export function generateCustomerDocumentPdf(
  sessionToken: string,
  documentId: number,
): Promise<GeneratedCustomerDocument> {
  return call<GeneratedCustomerDocument>(COMMANDS.GENERATE_CUSTOMER_DOCUMENT_PDF, {
    sessionToken,
    documentId,
  });
}

export function enqueueCustomerReprint(
  sessionToken: string,
  documentId: number,
  idempotencyKey: string,
): Promise<number> {
  return call<number>(COMMANDS.ENQUEUE_CUSTOMER_REPRINT, {
    sessionToken,
    documentId,
    idempotencyKey,
  });
}

export function listCustomerDocumentJobs(
  sessionToken: string,
  documentId: number,
): Promise<DocumentJob[]> {
  return call<DocumentJob[]>(COMMANDS.LIST_DOCUMENT_JOBS, { sessionToken, documentId });
}

export function getBusinessDocumentDetail(
  sessionToken: string,
  documentId: number,
): Promise<import('./documentDto').BusinessDocumentDetail> {
  return call<import('./documentDto').BusinessDocumentDetail>(COMMANDS.GET_BUSINESS_DOCUMENT_DETAIL, {
    sessionToken,
    documentId,
  });
}

export function getBusinessDocumentReports(
  sessionToken: string,
  filter: import('./documentDto').DocumentReportFilter = {},
): Promise<import('./documentDto').BusinessDocumentReportResult> {
  return call<import('./documentDto').BusinessDocumentReportResult>(COMMANDS.GET_BUSINESS_DOCUMENT_REPORTS, {
    sessionToken,
    dateFrom: filter.date_from ?? null,
    dateTo: filter.date_to ?? null,
    documentType: filter.document_type ?? null,
    status: filter.status ?? null,
    search: filter.search ?? null,
    hasJournal: filter.has_journal ?? null,
    limit: filter.limit ?? 100,
    offset: filter.offset ?? 0,
  });
}
