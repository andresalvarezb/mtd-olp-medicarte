'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { FilterBar, FilterField, FilterActions } from '@/components/ui/filter-bar';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import {
  downloadNovelties,
  listNovelties,
  reprocessAuthorizationItem,
  type NoveltyErrorType,
  type NoveltyFilters,
  type NoveltyStatus,
} from '@/lib/novelties-api';

const errorTypeLabels: Record<NoveltyErrorType, string> = {
  CORREGIBLE_POR_CARGUE: 'Corregible por cargue',
  REQUIERE_VALIDACION: 'Requiere validación',
  REPROCESABLE_INTERNAMENTE: 'Reprocesable internamente',
};

const STAGES = [
  'XLSX',
  'AUTORIZACIONES',
  'ANEXO_TARIFARIO',
  'CLASIFICACION',
  'MIPRES',
  'MEDICARTE',
  'MTD_COMPRAS',
  'OLP',
  'AUDITORIA',
  'OPERACION',
  'MIGRACION',
];

export function NovedadesView() {
  const { organizationId, hasPermission } = useRole();
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState('');
  const [document, setDocument] = useState('');
  const [stage, setStage] = useState('');
  const [errorType, setErrorType] = useState<NoveltyErrorType | ''>('');
  const [status, setStatus] = useState<NoveltyStatus | ''>('');
  const [batchId, setBatchId] = useState('');
  const [applied, setApplied] = useState<NoveltyFilters>({});
  const data = useApiData(() => listNovelties(organizationId, applied), [organizationId, applied]);
  const items = data.data?.items ?? [];
  const canReprocess = hasPermission('authorizations.reprocess');

  const filters = (): NoveltyFilters => {
    const result: NoveltyFilters = {};
    const authorizationValue = authorization.trim();
    const documentValue = document.trim();
    const batchValue = batchId.trim();
    if (authorizationValue) result.authorization = authorizationValue;
    if (documentValue) result.document = documentValue;
    if (stage) result.stage = stage;
    if (errorType) result.errorType = errorType;
    if (status) result.status = status;
    if (batchValue) result.batchId = batchValue;
    return result;
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadNovelties(organizationId, filters());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No fue posible descargar las novedades.');
    } finally {
      setDownloading(false);
    }
  };

  const reprocess = async (itemId: string) => {
    setReprocessing(itemId);
    setActionError(null);
    try {
      const result = await reprocessAuthorizationItem(organizationId, itemId, crypto.randomUUID());
      if (result.operationStatus === 'READY_TO_DISPENSE') {
        setActionError(`Registro reprocesado: quedó listo para dispensar (${result.resolvedNovelties} novedad(es) resueltas).`);
      } else {
        setActionError('El registro se re-evaluó; persisten causales activas en la bandeja.');
      }
      data.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No fue posible reprocesar el registro.');
    } finally {
      setReprocessing(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Novedades"
        description="Excepciones por registro de todas las cargas: causa exacta, etapa, lote, tipo de error y evidencia original descargable (ADR-027)."
        actions={hasPermission('exports.create') ? (
          <button type="button" className="btn" disabled={downloading} onClick={() => void download()}>
            {downloading ? 'Generando…' : 'Descargar rechazados (XLSX)'}
          </button>
        ) : null}
      />
      {actionError ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {actionError}
        </div>
      ) : null}
      <Card>
        <FilterBar>
          <FilterField label="Autorización / LLAVE">
            <input
              className="control"
              value={authorization}
              onChange={(event) => setAuthorization(event.target.value)}
              placeholder="NUMERO_AUTORIZACION o LLAVE"
            />
          </FilterField>
          <FilterField label="Documento paciente">
            <input
              className="control"
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              placeholder="IDENTIFICACION_PACIENTE"
            />
          </FilterField>
          <FilterField label="Etapa">
            <select className="control" value={stage} onChange={(event) => setStage(event.target.value)}>
              <option value="">Todas</option>
              {STAGES.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Tipo de error">
            <select
              className="control"
              value={errorType}
              onChange={(event) => setErrorType(event.target.value as NoveltyErrorType | '')}
            >
              <option value="">Todos</option>
              <option value="CORREGIBLE_POR_CARGUE">{errorTypeLabels.CORREGIBLE_POR_CARGUE}</option>
              <option value="REQUIERE_VALIDACION">{errorTypeLabels.REQUIERE_VALIDACION}</option>
              <option value="REPROCESABLE_INTERNAMENTE">{errorTypeLabels.REPROCESABLE_INTERNAMENTE}</option>
            </select>
          </FilterField>
          <FilterField label="Estado">
            <select
              className="control"
              value={status}
              onChange={(event) => setStatus(event.target.value as NoveltyStatus | '')}
            >
              <option value="">Pendientes</option>
              <option value="PENDIENTE">Solo pendientes</option>
              <option value="RESUELTO">Resueltas</option>
            </select>
          </FilterField>
          <FilterField label="Lote">
            <input
              className="control"
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              placeholder="ID de lote"
            />
          </FilterField>
          <FilterActions>
            <button
              type="button"
              className="btn soft"
              onClick={() => setApplied(filters())}
            >
              Filtrar
            </button>
          </FilterActions>
        </FilterBar>
        {data.error ? <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>{data.error}</div> : null}
        <DataTable
          columns={[
            { label: 'Código' },
            { label: 'Tipo' },
            { label: 'Etapa' },
            { label: 'LLAVE' },
            { label: 'Autorización' },
            { label: 'Paciente' },
            { label: 'Campo' },
            { label: 'Valor recibido' },
            { label: 'Descripción' },
            { label: 'Intentos' },
            { label: 'Estado' },
            { label: 'Procesada' },
            { label: 'Acciones' },
          ]}
          rows={data.loading ? undefined : items.map((item) => [
            item.code,
            errorTypeLabels[item.errorType],
            item.stage,
            item.authorizationKey ?? '—',
            item.numeroAutorizacion ?? '—',
            item.identificacionPaciente ?? '—',
            item.field ?? '—',
            item.receivedValue ?? '—',
            item.description,
            item.attemptCount,
            item.status,
            new Date(item.processedAt).toLocaleString('es-CO'),
            canReprocess && item.authorizationItemId && item.errorType === 'REPROCESABLE_INTERNAMENTE' ? (
              <button
                type="button"
                className="btn soft"
                disabled={reprocessing === item.authorizationItemId}
                onClick={() => void reprocess(item.authorizationItemId as string)}
              >
                {reprocessing === item.authorizationItemId ? 'Reprocesando…' : 'Reprocesar'}
              </button>
            ) : (
              '—'
            ),
          ])}
          aria-label="Novedades"
          emptyIcon="NV"
          emptyTitle={data.loading ? 'Cargando…' : 'No hay novedades pendientes'}
          emptyDescription="Descargue únicamente los registros rechazados, corríjalos y recárguelos; no es necesario volver a subir el archivo completo."
        />
      </Card>
    </>
  );
}
