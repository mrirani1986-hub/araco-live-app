import type { Tx } from './prisma.js';

export type DocType = 'PR' | 'PO' | 'GRN' | 'ISS' | 'RET' | 'ADJ' | 'TRF' | 'SUP';

/**
 * Allocates the next document number inside the caller's transaction.
 * INSERT .. ON CONFLICT DO UPDATE .. RETURNING takes a row lock on the
 * (doc_type, year) counter, so concurrent transactions queue up and can never
 * receive the same number. If the surrounding transaction rolls back, the
 * number is released with it (no gaps from failed saves).
 */
export async function nextNumber(tx: Tx, docType: DocType, date = new Date()): Promise<string> {
  const year = date.getFullYear();
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO document_sequences (doc_type, year, last_value) VALUES (${docType}, ${year}, 1)
    ON CONFLICT (doc_type, year) DO UPDATE SET last_value = document_sequences.last_value + 1
    RETURNING last_value`;
  const n = rows[0].last_value;
  if (docType === 'SUP') return `SUP-${String(n).padStart(4, '0')}`;
  return `${docType}-${year}-${String(n).padStart(6, '0')}`;
}
