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
