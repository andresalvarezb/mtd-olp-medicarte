'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  listAuthorizationItems,
  type AuthorizationItemListQuery,
} from '@/lib/authorization-items-api';
import type { AuthorizationItemResponse } from '@authorization/contracts';
import {
  COVERAGE_LABELS,
  coveragePill,
  directionPill,
  DIRECTION_STATUS_LABELS,
  OPERATION_STATUS_LABELS,
  SITE_STATUS_LABELS,
  patientName,
  patientDocument,
  formatNumber,
  medicationName,
} from '@/lib/labels';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Cobertura' },
  { label: 'Direccionamiento' },
  { label: 'Estado' },
  { label: 'Punto aplicación' },
];

export function ListosParaDispensarView() {
  const { organizationId } = useRole();
  const [coverage, setCoverage] = useState<'todos' | 'PBS' | 'NO_PBS'>('todos');

  const query: AuthorizationItemListQuery = {
    limit: 50,
    operationStatus: 'LISTO_PARA_DISPENSAR',
    ...(coverage !== 'todos' ? { coverageType: coverage } : {}),
  };

  const list = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        ...query,
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId, coverage],
  );
  const { items, error, loading } = list;

  const rows = items.map((item) => [
    <span key="num" style={{ fontWeight: 600 }}>
      {item.numeroAutorizacion}
    </span>,
    patientDocument(item.sourceData),
    patientName(item.sourceData),
    medicationName(item.sourceData),
    <StatusBadge key="cov" tone={coveragePill(item.coverageType)}>
      {COVERAGE_LABELS[item.coverageType]}
    </StatusBadge>,
    <StatusBadge key="dir" tone={directionPill(item.directionStatus)}>
      {DIRECTION_STATUS_LABELS[item.directionStatus]}
    </StatusBadge>,
    OPERATION_STATUS_LABELS[item.operationStatus ?? ''] ?? '—',
    SITE_STATUS_LABELS[item.applicationSiteStatus],
  ]);

  return (
    <>
      <PageHeader
        title="Listos para dispensar"
        description="Ítems habilitados cuyo evento AUTHORIZATION_READY_TO_DISPENSE notifica a OLP y Medicarte en tiempo real."
        actions={
          <span className="pill blue">
            {formatNumber(items.length)} registros · página {list.page}
          </span>
        }
      />
      <Card>
        <FilterBar>
          <FilterField label="Cobertura">
            <select
              className="control"
              value={coverage}
              onChange={(event) => setCoverage(event.target.value as typeof coverage)}
            >
              <option value="todos">Todos</option>
              <option value="PBS">PBS</option>
              <option value="NO_PBS">NO PBS</option>
            </select>
          </FilterField>
        </FilterBar>
        {error ? (
          <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
            {error}
          </div>
        ) : null}
        <DataTable
          columns={COLUMNS}
          rows={loading ? undefined : rows}
          aria-label="Registros listos para dispensar"
          emptyIcon="RD"
          emptyTitle={loading ? 'Cargando…' : 'No hay registros listos para dispensar'}
          emptyDescription={
            loading
              ? 'Consultando la API…'
              : 'Los ítems aparecen cuando la fuente queda habilitada (PBS) o su direccionamiento MIPRES se confirma (NO PBS).'
          }
        />
        <TablePagination
          page={list.page}
          hasPrev={list.hasPrev}
          hasNext={list.hasNext}
          onPrev={list.prevPage}
          onNext={list.nextPage}
        />
      </Card>
    </>
  );
}
