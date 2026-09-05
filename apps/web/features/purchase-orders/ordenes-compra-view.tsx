'use client';

import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { BulkUpdateUpload } from '@/components/bulk-update-upload';
import { DataTable } from '@/components/ui/data-table';
import { TablePagination } from '@/components/ui/table-pagination';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { downloadFile, listAuthorizationItems } from '@/lib/authorization-items-api';
import type { AuthorizationItemResponse } from '@authorization/contracts';
import { medicationName, medicationQuantity, patientDocument, patientName } from '@/lib/labels';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Cantidad' },
  { label: 'Medicamento' },
  { label: 'Punto aplicación' },
  { label: 'Fecha programada' },
];

export function OrdenesCompraView() {
  const { organizationId, hasPermission } = useRole();
  const canUpload = hasPermission('bulk_updates.purchase_order');
  const canExport = hasPermission('operational_exports.create');
  const list = usePaginatedList<AuthorizationItemResponse>(
    (cursor) => listAuthorizationItems(organizationId, {
      operationStatus: 'READY_TO_DISPENSE',
      purchaseOrderEligible: true,
      limit: 50,
      ...(cursor ? { cursor } : {}),
    }),
    [organizationId],
  );
  const rows = list.items.map((item) => [
    <span key="num" style={{ fontWeight: 600 }}>{item.numeroAutorizacion}</span>,
    patientDocument(item.sourceData),
    patientName(item.sourceData),
    medicationQuantity(item.sourceData),
    medicationName(item.sourceData),
    item.lugarDispensacion ?? '—',
    item.fechaProgramada ?? '—',
  ]);

  const handleExport = () => {
    void downloadFile(
      '/operational-exports/authorization-items',
      organizationId,
      'ordenes-compra.xlsx',
      { operationType: 'ASSIGN_PURCHASE_ORDER', format: 'xlsx' },
    );
  };

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        description="MTD registra la orden de compra únicamente para los registros previamente completados por MEDICARTE."
        actions={canExport ? (
          <button type="button" className="btn" onClick={handleExport}>
            Descargar base (XLSX)
          </button>
        ) : null}
      />
      <Card>
        {canUpload ? (
          <BulkUpdateUpload
            operationType="ASSIGN_PURCHASE_ORDER"
            buttonLabel="Cargar órdenes de compra"
            fileTitle="Archivo de órdenes de compra"
            columnsHint="Columnas requeridas: LLAVE, ORDEN_COMPRA"
          />
        ) : (
          <p className="muted">No tienes permiso para cargar órdenes de compra.</p>
        )}
      </Card>
      <div style={{ marginTop: 16 }}>
        <Card>
          <DataTable
            columns={COLUMNS}
            rows={list.loading ? undefined : rows}
            aria-label="Registros disponibles para órdenes de compra"
            emptyIcon="OC"
            emptyTitle={list.loading ? 'Cargando…' : 'No hay registros disponibles'}
            emptyDescription={list.loading
              ? 'Consultando la API…'
              : 'Aparecerán cuando MEDICARTE haya informado punto y fecha programada.'}
          />
          <TablePagination
            page={list.page}
            hasPrev={list.hasPrev}
            hasNext={list.hasNext}
            onPrev={list.prevPage}
            onNext={list.nextPage}
          />
        </Card>
      </div>
    </>
  );
}
