'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { Card, CardHead } from '@/components/ui/card';

import { DataTable } from '@/components/ui/data-table';

import { useRole } from '@/components/layout/role-context';

import {
  confirmAvailabilityImport,
  downloadAvailabilityTemplate,
  getAvailabilityImport,
  listAvailabilityImports,
  prepareAvailabilityImport,
  type AvailabilityImportBatch,
  type AvailabilityImportHistoryItem,
} from '@/lib/inventory-availability-api';

const HISTORY_COLUMNS = [
  {
    label: 'Fecha',
  },
  {
    label: 'Archivo',
  },
  {
    label: 'Registros',
  },
  {
    label: 'Válidos',
  },
  {
    label: 'Novedades',
  },
  {
    label: 'Estado',
  },
  {
    label: 'Ver',
  },
];

const DETAIL_COLUMNS = [
  {
    label: 'Clave autorización',
  },
  {
    label: 'OC',
  },
  {
    label: 'Cantidad',
  },
  {
    label: 'Producto',
  },
  {
    label: 'Resultado',
  },
];

const STATUS_LABELS: Record<string, string> = {
  PREPARED: 'Lista para confirmar',

  CONFIRMED: 'Aplicada',

  FAILED: 'Con novedades',

  CANCELLED: 'Cancelada',
};

const STATUS_CLASS: Record<string, string> = {
  PREPARED: 'pill orange',

  CONFIRMED: 'pill green',

  FAILED: 'pill red',

  CANCELLED: 'pill gray',
};

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-CO', {
    dateStyle: 'medium',

    timeStyle: 'short',
  });
}

function formatNumber(value: number) {
  return value.toLocaleString('es-CO');
}

export function DisponibilidadCargarView() {
  const { organizationId, hasPermission } = useRole();

  const canAllocate = hasPermission('inventory.allocate');

  const fileRef = useRef<HTMLInputElement>(null);

  const [history, setHistory] = useState<AvailabilityImportHistoryItem[]>([]);

  const [selected, setSelected] = useState<AvailabilityImportBatch | null>(null);

  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);

  const [confirming, setConfirming] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);

  async function loadHistory() {
    if (!organizationId) {
      setHistory([]);

      setLoading(false);

      return;
    }

    setLoading(true);

    try {
      const result = await listAvailabilityImports(organizationId, 50);

      setHistory(result.items);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No fue posible consultar el historial de cargas.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, [organizationId]);

  async function downloadTemplate() {
    if (!organizationId) {
      return;
    }

    setError(null);

    try {
      const blob = await downloadAvailabilityTemplate(organizationId);

      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');

      anchor.href = url;

      anchor.download = 'plantilla-disponibilidad.xlsx';

      anchor.click();

      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible descargar la plantilla.');
    }
  }

  async function upload(file: File) {
    if (!organizationId || !canAllocate || uploading) {
      return;
    }

    setUploading(true);

    setError(null);

    setMessage(null);

    try {
      const result = await prepareAvailabilityImport(organizationId, file);

      setSelected(result);

      if (result.invalidRows > 0) {
        setMessage(
          `El archivo contiene ${formatNumber(
            result.invalidRows,
          )} registro(s) con novedad. Corrige el archivo y vuelve a cargarlo.`,
        );
      } else {
        setMessage(
          `Archivo validado: ${formatNumber(result.validRows)} registro(s) listos para confirmar.`,
        );
      }

      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible validar el archivo.');
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      void upload(file);
    }

    event.target.value = '';
  }

  async function openBatch(id: string) {
    if (!organizationId) {
      return;
    }

    setError(null);

    try {
      const detail = await getAvailabilityImport(organizationId, id);

      setSelected(detail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible consultar el detalle.');
    }
  }

  async function confirm() {
    if (
      !organizationId ||
      !selected ||
      confirming ||
      selected.status !== 'PREPARED' ||
      selected.invalidRows > 0
    ) {
      return;
    }

    setConfirming(true);

    setError(null);

    try {
      const result = await confirmAvailabilityImport(organizationId, selected.id);

      setMessage(
        `${formatNumber(result.allocatedQuantity)} unidad(es) fueron asignadas correctamente.`,
      );

      const detail = await getAvailabilityImport(organizationId, selected.id);

      setSelected(detail);

      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible confirmar la carga.');
    } finally {
      setConfirming(false);
    }
  }

  const historyRows = history.map((batch) => [
    formatDate(batch.createdAt),

    batch.originalFilename,

    formatNumber(batch.totalRows),

    formatNumber(batch.validRows),

    formatNumber(batch.invalidRows),

    <span key={`${batch.id}-status`} className={STATUS_CLASS[batch.status] ?? 'pill gray'}>
      {STATUS_LABELS[batch.status] ?? batch.status}
    </span>,

    <button
      key={`${batch.id}-view`}
      type="button"
      className="btn"
      onClick={() => void openBatch(batch.id)}
    >
      Ver detalle
    </button>,
  ]);

  const detailRows = selected
    ? selected.rows.map((row) => [
        row.authorizationKey,

        row.purchaseOrderCode,

        formatNumber(row.requestedQuantity),

        row.commercialCode ?? '—',

        row.validationStatus === 'VALID'
          ? 'Válido'
          : (row.errorMessage ?? row.errorCode ?? 'Con novedad'),
      ])
    : [];

  return (
    <>
      <PageHeader
        title="Cargar Disponibilidad"
        description="Carga las asignaciones mediante la plantilla. Si algún registro presenta una novedad, corrige el archivo y vuelve a subirlo."
        actions={
          <>
            <button type="button" className="btn" onClick={() => void downloadTemplate()}>
              Descargar plantilla
            </button>

            <button
              type="button"
              className="btn primary"
              disabled={!canAllocate || uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Validando…' : 'Seleccionar archivo XLSX'}
            </button>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              style={{
                display: 'none',
              }}
              onChange={handleFileChange}
            />
          </>
        }
      />

      {error ? (
        <div
          className="login-error"
          role="alert"
          style={{
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      ) : null}

      {message ? (
        <div
          style={{
            marginBottom: 14,
          }}
        >
          {message}
        </div>
      ) : null}

      <Card>
        <CardHead
          title="Historial de cargas"
          subtitle="Archivos de asignación de disponibilidad procesados por MTD."
        />

        <DataTable
          columns={HISTORY_COLUMNS}
          rows={loading ? undefined : historyRows}
          aria-label="Historial de cargas de disponibilidad"
          emptyIcon="XLSX"
          emptyTitle={loading ? 'Cargando…' : 'No se han realizado cargas'}
          emptyDescription={
            loading
              ? 'Consultando el historial…'
              : 'Los archivos procesados aparecerán aquí con su resultado.'
          }
        />
      </Card>

      {selected ? (
        <div
          style={{
            marginTop: 16,
          }}
        >
          <Card>
            <CardHead
              title="Detalle de la carga"
              subtitle={`${formatNumber(selected.totalRows)} registros · ${formatNumber(
                selected.validRows,
              )} válidos · ${formatNumber(selected.invalidRows)} novedades`}
              aside={
                selected.status === 'PREPARED' && selected.invalidRows === 0 && canAllocate ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={confirming}
                    onClick={() => void confirm()}
                  >
                    {confirming ? 'Confirmando…' : 'Confirmar carga'}
                  </button>
                ) : (
                  <span className={STATUS_CLASS[selected.status] ?? 'pill gray'}>
                    {STATUS_LABELS[selected.status] ?? selected.status}
                  </span>
                )
              }
            />

            <DataTable
              columns={DETAIL_COLUMNS}
              rows={detailRows}
              aria-label="Detalle de carga de disponibilidad"
              emptyIcon="XLSX"
              emptyTitle="Sin registros"
              emptyDescription="El archivo no contiene registros para mostrar."
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
