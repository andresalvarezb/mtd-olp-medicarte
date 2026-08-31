'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField, FilterActions } from '@/components/ui/filter-bar';
import { RoleActionButton } from '@/components/ui/role-action-button';
import { StatusBadge } from '@/components/ui/status-badge';
import { TablePagination } from '@/components/ui/table-pagination';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import {
  downloadFile,
  listAuthorizationItems,
  type AuthorizationItemListQuery,
} from '@/lib/authorization-items-api';
import type { AuthorizationItemResponse } from '@authorization/contracts';
import {
  auditPill,
  AUDIT_STATUS_LABELS,
  COVERAGE_LABELS,
  coveragePill,
  directionPill,
  DIRECTION_STATUS_LABELS,
  operationPill,
  OPERATION_STATUS_LABELS,
  SITE_STATUS_LABELS,
  TARIFF_MEMBERSHIP_LABELS,
  patientName,
  patientDocument,
  medicationName,
} from '@/lib/labels';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Cobertura' },
  { label: 'Direccionamiento' },
  { label: 'Punto aplicación' },
  { label: 'Operación' },
  { label: 'Anexo Tarifario' },
  { label: 'Auditoría' },
];

type EstadoProceso = 'todos' | 'listo' | 'pendiente-punto' | 'pendiente-auditoria';
type TariffFilter = 'todos' | 'LISTADO' | 'NO_LISTADO';

const ESTADO_PROCESO_PARAMS: Record<Exclude<EstadoProceso, 'todos'>, AuthorizationItemListQuery> = {
  listo: { operationStatus: 'LISTO_PARA_DISPENSAR' },
  'pendiente-punto': { operationStatus: 'LISTO_PARA_DISPENSAR', auditStatus: 'NO_INICIADO' },
  'pendiente-auditoria': { auditStatus: 'LISTO' },
};

export function AutorizacionesView() {
  const { organizationId, hasPermission } = useRole();
  const [search, setSearch] = useState('');
  const [coverage, setCoverage] = useState<'todos' | 'PBS' | 'NO_PBS'>('todos');
  const [estado, setEstado] = useState<EstadoProceso>('todos');
  const [tariff, setTariff] = useState<TariffFilter>('todos');
  const [applied, setApplied] = useState<{
    key: string;
    coverage: 'todos' | 'PBS' | 'NO_PBS';
    estado: EstadoProceso;
    tariff: TariffFilter;
  } | null>(null);

  const query: AuthorizationItemListQuery = {
    limit: 50,
    ...(applied?.key ? { authorizationKey: applied.key } : {}),
    ...(applied && applied.coverage !== 'todos' ? { coverageType: applied.coverage } : {}),
    ...(applied && applied.estado !== 'todos' ? ESTADO_PROCESO_PARAMS[applied.estado] : {}),
    ...(applied && applied.tariff !== 'todos' ? { tariffMembershipStatus: applied.tariff } : {}),
  };

  const querySignature = `${applied?.key ?? ''}|${applied?.coverage ?? 'todos'}|${applied?.estado ?? 'todos'}|${applied?.tariff ?? 'todos'}`;
  const list = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        ...query,
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId, querySignature],
  );
  const { items, error, loading } = list;

  const canExport = hasPermission('exports.create');
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleExport = () => {
    setExporting(true);
    setActionError(null);
    downloadFile(
      '/exports/authorization-items.csv',
      organizationId,
      'autorizaciones-aprobadas.csv',
      {
        ...(applied && applied.coverage !== 'todos' ? { coverageType: applied.coverage } : {}),
      },
    )
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : 'No fue posible exportar.'),
      )
      .finally(() => setExporting(false));
  };

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
    SITE_STATUS_LABELS[item.applicationSiteStatus],
    item.operationStatus ? (
      <StatusBadge key="op" tone={operationPill(item.operationStatus)}>
        {OPERATION_STATUS_LABELS[item.operationStatus]}
      </StatusBadge>
    ) : (
      '—'
    ),
    <StatusBadge
      key="tariff"
       tone={item.tariffMembershipStatus === 'LISTADO' ? 'green' : 'red'}
    >
      {TARIFF_MEMBERSHIP_LABELS[item.tariffMembershipStatus]}
    </StatusBadge>,
    <StatusBadge key="audit" tone={auditPill(item.auditStatus)}>
      {AUDIT_STATUS_LABELS[item.auditStatus]}
    </StatusBadge>,
  ]);

  return (
    <>
      <PageHeader
        title="Autorizaciones"
        description="Bandeja maestra de ítems de autorización. La llave es número de autorización + COD_COMERCIAL."
        actions={
          <>
            {canExport ? (
              <button type="button" className="btn" disabled={exporting} onClick={handleExport}>
                {exporting ? 'Exportando…' : 'Exportar aprobados (CSV)'}
              </button>
            ) : null}
            <RoleActionButton requiredPermission="imports.create">
              <Link
                href="/cargas"
                className="btn primary"
                style={{ textDecoration: 'none', display: 'inline-block' }}
              >
                Cargar autorizaciones
              </Link>
            </RoleActionButton>
          </>
        }
      />
      {actionError ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {actionError}
        </div>
      ) : null}
      <Card>
        <FilterBar>
          <FilterField label="Buscar">
            <input
              className="control"
              placeholder="Número de autorización"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </FilterField>
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
          <FilterField label="Estado proceso">
            <select
              className="control"
              value={estado}
              onChange={(event) => setEstado(event.target.value as EstadoProceso)}
            >
              <option value="todos">Todos</option>
              <option value="listo">Listo para dispensar</option>
              <option value="pendiente-punto">Pendiente punto aplicación</option>
              <option value="pendiente-auditoria">Pendiente auditoría</option>
            </select>
          </FilterField>
          <FilterField label="Anexo Tarifario">
            <select
              className="control"
              value={tariff}
              onChange={(event) => setTariff(event.target.value as TariffFilter)}
            >
              <option value="todos">Todos</option>
               <option value="LISTADO">En Anexo Tarifario</option>
               <option value="NO_LISTADO">Fuera del Anexo Tarifario</option>
            </select>
          </FilterField>
          <FilterActions>
            <button
              type="button"
              className="btn soft"
              onClick={() => setApplied({ key: search.trim(), coverage, estado, tariff })}
            >
              Filtrar
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
          aria-label="Bandeja de autorizaciones"
          emptyIcon="AU"
          emptyTitle={loading ? 'Cargando…' : 'No hay autorizaciones para mostrar'}
          emptyDescription={
            loading
              ? 'Consultando la API…'
              : 'Cuando se confirme una carga válida, cada medicamento aparecerá como un ítem independiente en esta bandeja.'
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
