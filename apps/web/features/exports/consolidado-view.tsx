'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField, FilterActions } from '@/components/ui/filter-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import { downloadFile, listAuthorizationItems } from '@/lib/authorization-items-api';
import {
  AUDIT_STATUS_LABELS,
  COVERAGE_LABELS,
  patientName,
  patientDocument,
  medicationName,
  medicationQuantity,
} from '@/lib/labels';
import type { AuthorizationItemResponse } from '@authorization/contracts';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Cantidad' },
  { label: 'Medicamento' },
  { label: 'Cobertura' },
  { label: 'Punto aplicación' },
  { label: 'Fecha aplicación' },
  { label: 'Auditoría' },
];

export function ConsolidadoView() {
  const { organizationId, hasPermission } = useRole();
  const [coverage, setCoverage] = useState<'todos' | 'PBS' | 'NO_PBS'>('todos');
  const [applied, setApplied] = useState<'todos' | 'PBS' | 'NO_PBS'>('todos');
  const [authorizationNumber, setAuthorizationNumber] = useState('');
  const [patientDocumentFilter, setPatientDocumentFilter] = useState('');
  const [appliedAuthorizationNumber, setAppliedAuthorizationNumber] = useState('');
  const [appliedPatientDocument, setAppliedPatientDocument] = useState('');
  const [exporting, setExporting] = useState<'xlsx' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canExport = hasPermission('exports.create');

  const list = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
         ...(applied !== 'todos' ? { coverageType: applied } : {}),
         ...(appliedAuthorizationNumber ? { numeroAutorizacion: appliedAuthorizationNumber } : {}),
         ...(appliedPatientDocument ? { identificacionPaciente: appliedPatientDocument } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId, applied, appliedAuthorizationNumber, appliedPatientDocument],
  );
  const { items, error, loading } = list;

  const handleExport = () => {
    setExporting('xlsx');
    setActionError(null);
    downloadFile(
      '/exports/authorization-items.xlsx',
      organizationId,
      'consolidado.xlsx',
      {
        includeAll: 'true',
        ...(applied !== 'todos' ? { coverageType: applied } : {}),
        ...(appliedAuthorizationNumber ? { numeroAutorizacion: appliedAuthorizationNumber } : {}),
        ...(appliedPatientDocument ? { identificacionPaciente: appliedPatientDocument } : {}),
      },
    )
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : 'No fue posible exportar.'),
      )
      .finally(() => setExporting(null));
  };

  const rows = items.map((item) => [
    <span key="num" style={{ fontWeight: 600 }}>
      {item.numeroAutorizacion}
    </span>,
    patientDocument(item.sourceData),
    patientName(item.sourceData),
    medicationQuantity(item.sourceData),
    medicationName(item.sourceData),
    <StatusBadge key="cov" tone={item.coverageType === 'PBS' ? 'blue' : 'purple'}>
      {COVERAGE_LABELS[item.coverageType]}
    </StatusBadge>,
    item.lugarDispensacion ?? '—',
    item.fechaAplicacion ?? '—',
    AUDIT_STATUS_LABELS[item.auditStatus],
  ]);

  return (
    <>
      <PageHeader
        title="Consolidado"
        description="Vista completa de autorizaciones y estados operativos. No se persisten copias: cada descarga se genera y audita."
      />
      {actionError ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {actionError}
        </div>
      ) : null}
      <Card>
        <FilterBar>
          <FilterField label="Cobertura">
            <select
              className="control"
              value={coverage}
              onChange={(event) => setCoverage(event.target.value as typeof coverage)}
            >
              <option value="todos">Todas</option>
              <option value="PBS">PBS</option>
              <option value="NO_PBS">NO PBS</option>
            </select>
          </FilterField>
          <FilterField label="Número autorización">
            <input className="control" value={authorizationNumber} onChange={(event) => setAuthorizationNumber(event.target.value)} />
          </FilterField>
          <FilterField label="Identificación paciente">
            <input className="control" value={patientDocumentFilter} onChange={(event) => setPatientDocumentFilter(event.target.value)} />
          </FilterField>
          <FilterActions>
            <button type="button" className="btn soft" onClick={() => {
              setApplied(coverage);
              setAppliedAuthorizationNumber(authorizationNumber.trim());
              setAppliedPatientDocument(patientDocumentFilter.trim());
            }}>
              Aplicar filtros
            </button>
          </FilterActions>
        </FilterBar>
        {error ? (
          <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
            {error}
          </div>
        ) : null}
        <DataTable
          columns={COLUMNS}
          rows={loading ? undefined : rows}
          aria-label="Consolidado"
          emptyIcon="XLSX"
          emptyTitle={loading ? 'Cargando…' : 'No hay registros para consolidar'}
          emptyDescription={
            loading
              ? 'Consultando la API…'
              : 'Ajusta los filtros o verifica que existan autorizaciones cargadas.'
          }
        />
        <TablePagination
          page={list.page}
          hasPrev={list.hasPrev}
          hasNext={list.hasNext}
          onPrev={list.prevPage}
          onNext={list.nextPage}
        />
        {canExport ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={exporting !== null}
               onClick={handleExport}
            >
              {exporting === 'xlsx' ? 'Generando…' : 'Exportar XLSX'}
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Note>Requiere el permiso exports.create para descargar el consolidado.</Note>
          </div>
        )}
      </Card>
    </>
  );
}
