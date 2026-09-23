import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error The browser application intentionally excludes Node types; this test reads a fixture font.
import { readFile } from 'node:fs/promises';

import {
  renderOfficialDocumentHtml,
  renderOfficialDocumentPdf,
  type OfficialDocumentIdentity,
  type OfficialDocumentModel,
} from '../src/shared/documents/officialDocument';

const FULL_IDENTITY: OfficialDocumentIdentity = {
  shopName: 'Librairie Test',
  legalName: 'Librairie Test SARL',
  address: '10 Rue de la Paix, Alger',
  phone: '0550 12 34 56',
  email: 'contact@librairietest.dz',
  website: 'www.librairietest.dz',
  nif: '000116001234567',
  nis: '099816000012345',
  rc: '16/00-1234567 B 21',
  ai: '16012345678',
  rib: '00799999000123456789',
  logoDataUrl: null,
  showEmail: true,
  showWebsite: true,
  showRib: true,
  showLogo: true,
  amountInWords: true,
  a4FooterNote: 'Merci de votre confiance.',
  printLocale: 'fr',
};

const EMPTY_IDENTITY: OfficialDocumentIdentity = {
  shopName: null,
  legalName: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  nif: null,
  nis: null,
  rc: null,
  ai: null,
  rib: null,
  logoDataUrl: null,
  showEmail: false,
  showWebsite: false,
  showRib: false,
  showLogo: false,
  amountInWords: false,
  a4FooterNote: null,
  printLocale: 'fr',
};

function sampleModel(overrides: Partial<OfficialDocumentModel> = {}): OfficialDocumentModel {
  return {
    kind: 'SALE_INVOICE',
    title: 'FACTURE',
    documentNumber: 'FAC-2026-0001',
    documentDateText: '23/09/2026',
    statusText: 'POSTED',
    partyBlock: { title: 'Client', rows: [{ label: 'Client', value: 'Amine Client' }] },
    columns: [
      { key: 'designation', label: 'Désignation', align: 'start' },
      { key: 'quantity', label: 'Quantité', align: 'end' },
      { key: 'unitPrice', label: 'Prix unitaire', align: 'end' },
      { key: 'lineTotal', label: 'Montant', align: 'end' },
    ],
    rows: [
      { designation: 'Cahier 100 pages', quantity: '2', unitPrice: '150,00', lineTotal: '300,00' },
    ],
    totals: [{ label: 'Total', value: '300,00', emphasis: true }],
    amountInWordsValue: '300.00',
    ...overrides,
  };
}

function styleBlock(html: string): string {
  const match = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!match) throw new Error('no <style> block found');
  return match[1];
}

describe('renderOfficialDocumentHtml', () => {
  it('contains the shop identity and does not mention Stockiha except the footer credit', () => {
    const html = renderOfficialDocumentHtml(sampleModel(), FULL_IDENTITY);

    expect(html).toContain('Librairie Test');
    expect(html).toContain('10 Rue de la Paix, Alger');
    expect(html).toContain('0550 12 34 56');
    expect(html).toContain(FULL_IDENTITY.nif as string);
    expect(html).toContain(FULL_IDENTITY.nis as string);
    expect(html).toContain(FULL_IDENTITY.rc as string);
    expect(html).toContain(FULL_IDENTITY.ai as string);

    const stockihaMentions = html.match(/Stockiha/g) ?? [];
    expect(stockihaMentions.length).toBe(1);
    expect(html).toContain('footer-made-with');
  });

  it('renders successfully with every identity field empty, still containing the title and the table', () => {
    const html = renderOfficialDocumentHtml(sampleModel(), EMPTY_IDENTITY);
    expect(html).toContain('FACTURE');
    expect(html).toContain('<table');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('<div class="legal-line">');
  });

  it('never renders a signature block', () => {
    const html = renderOfficialDocumentHtml(sampleModel(), FULL_IDENTITY);
    expect(html.toLowerCase()).not.toContain('signature');
    expect(html).not.toContain('Visa');
  });

  it('uses only the A8 black-and-white palette in its stylesheet', () => {
    const style = styleBlock(renderOfficialDocumentHtml(sampleModel(), FULL_IDENTITY));
    const colors = new Set((style.match(/#[0-9a-fA-F]{3,6}/g) ?? []).map((c) => c.toLowerCase()));
    for (const color of colors) {
      expect(['#000', '#444', '#888', '#f2f2f2', '#fff']).toContain(color);
    }
  });

  it('resolves an "end" column to text-align: right for fr and text-align: left for ar', () => {
    const frHtml = renderOfficialDocumentHtml(sampleModel(), { ...FULL_IDENTITY, printLocale: 'fr' });
    expect(frHtml).toContain('text-align:right');

    const arHtml = renderOfficialDocumentHtml(sampleModel(), { ...FULL_IDENTITY, printLocale: 'ar' });
    expect(arHtml).toContain('text-align:left');
  });

  it('repeats the table header on every page via table-header-group', () => {
    const html = renderOfficialDocumentHtml(sampleModel(), FULL_IDENTITY);
    expect(html).toContain('thead { display: table-header-group; }');
  });

  it('escapes a value containing <script>', () => {
    const model = sampleModel({
      rows: [{ designation: '<script>alert(1)</script>', quantity: '1', unitPrice: '1,00', lineTotal: '1,00' }],
    });
    const html = renderOfficialDocumentHtml(model, FULL_IDENTITY);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('prints the amount-in-words sentence exactly once when amountInWords is true, and omits it when false', () => {
    const withWords = renderOfficialDocumentHtml(sampleModel(), FULL_IDENTITY);
    const occurrences = (withWords.match(/<div class="amount-in-words">/g) ?? []).length;
    expect(occurrences).toBe(1);

    const withoutWords = renderOfficialDocumentHtml(sampleModel(), { ...FULL_IDENTITY, amountInWords: false });
    expect(withoutWords).not.toContain('<div class="amount-in-words">');
  });

  it('the no-lines sentence renders when rows is empty', () => {
    const html = renderOfficialDocumentHtml(sampleModel({ rows: [] }), FULL_IDENTITY);
    expect(html).toContain('Aucune ligne.');
  });
});

describe('renderOfficialDocumentPdf', () => {
  const locales: Array<OfficialDocumentIdentity['printLocale']> = ['fr', 'ar', 'en'];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    const font = await readFile('src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf');
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(font, { status: 200 })) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(locales)('returns real PDF bytes for locale %s, with no logo', async (printLocale) => {
    const bytes = await renderOfficialDocumentPdf(sampleModel(), { ...FULL_IDENTITY, printLocale });
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it.each(locales)('returns real PDF bytes for locale %s, with a PNG logo', async (printLocale) => {
    // 1x1 transparent PNG.
    const pngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const bytes = await renderOfficialDocumentPdf(sampleModel(), {
      ...FULL_IDENTITY,
      printLocale,
      logoDataUrl: pngDataUrl,
    });
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('a webp logo renders in the HTML but is skipped (not crashed) in the PDF', async () => {
    const webpDataUrl = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
    const identity = { ...FULL_IDENTITY, logoDataUrl: webpDataUrl };

    const html = renderOfficialDocumentHtml(sampleModel(), identity);
    expect(html).toContain(webpDataUrl);

    const bytes = await renderOfficialDocumentPdf(sampleModel(), identity);
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });
});
