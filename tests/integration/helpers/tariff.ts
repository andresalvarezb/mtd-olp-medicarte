import { randomUUID } from 'node:crypto';

export const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

export const MTD_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';

/**
 * Registra códigos de producto en el Anexo Tarifario (idempotente). Los gates
 * lo usan antes de confirmar cargues: sin producto listado la autorización
 * queda BLOCKED con la causal PRODUCT_NOT_IN_TARIFF_ANNEX (SPEC-014).
 */
export async function registerTariffProducts(
  adminToken: string,
  codes: readonly string[],
): Promise<void> {
  for (const code of codes) {
    const response = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/products`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-organization-id': MTD_ORGANIZATION_ID,
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({ codigoProducto: code }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { code?: string };
      throw new Error(
        `registerTariffProducts ${code} failed: ${response.status} ${payload.code ?? ''}`,
      );
    }
  }
}
