import { randomUUID } from 'node:crypto';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';

/**
 * DEC-018/SPEC-014: registra (alta idempotente) un producto del Anexo
 * Tarifario como MTD Admin. Los cargues de autorizaciones exigen un Anexo
 * cargado; los gates que importan autorizaciones lo aseguran aquí.
 */
export async function registerAnnexProduct(token: string, code: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/products`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ codigoProducto: code }),
  });
  if (response.status !== 200) {
    throw new Error(`Annex product registration failed for ${code}: ${response.status}`);
  }
}
