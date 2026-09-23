'use client';

import { useState } from 'react';
import type {
  ApplicationAuditRejectionCode,
  ApplicationAuditResponse,
  ApplicationAuditStatus,
} from '@authorization/contracts';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { ApiError } from '@/lib/api-client';
import {
  approvePatientApplicationAudit,
  listPatientApplicationAudits,
  rejectPatientApplicationAudit,
  startPatientApplicationAudit,
} from '@/lib/patient-application-audits-api';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';

const statusMeta: Record<ApplicationAuditStatus, { label: string; tone: PillTone }> = {
  READY_FOR_AUDIT: { label: 'Lista para auditar', tone: 'blue' },
  IN_REVIEW: { label: 'En revisión', tone: 'orange' },
  APPROVED: { label: 'Aprobada', tone: 'green' },
  REJECTED: { label: 'Rechazada', tone: 'red' },
};
const rejectionCodes: ApplicationAuditRejectionCode[] = [
  'APPLICATION_DATA_INCONSISTENT',
  'AUTHORIZATION_INCONSISTENT',
  'QUANTITY_INCONSISTENT',
  'PRODUCT_INCONSISTENT',
  'SUPPORT_MISSING',
  'OTHER',
];

function describeError(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'No fue posible completar la operación.';
}

export function PatientApplicationAuditsView() {
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('application_audits.manage');
  const [status, setStatus] = useState<ApplicationAuditStatus | ''>('READY_FOR_AUDIT');
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [rejectionCode, setRejectionCode] = useState<ApplicationAuditRejectionCode>('OTHER');
  const [observation, setObservation] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [textFilter, setTextFilter] = useState({ patient: '', authorization: '', commercialCode: '' });
  const audits = useApiData(
    () =>
      listPatientApplicationAudits(organizationId, {
        ...(status ? { status } : {}),
        limit: 500,
      }),
    [organizationId, status],
  );
  const selected =
    audits.data?.items.find((item) => item.patientApplicationId === selectedApplicationId) ?? null;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      audits.reload();
    } catch (cause) {
      setError(describeError(cause));
      audits.reload();
    } finally {
      setBusy(false);
    }
  };
  const start = (item: ApplicationAuditResponse) =>
    void run(() => startPatientApplicationAudit(organizationId, item.patientApplicationId));
  const approve = (item: ApplicationAuditResponse) => {
    if (!item.id || item.version === null) return;
    void run(() =>
      approvePatientApplicationAudit(organizationId, item.id!, {
        expectedVersion: item.version!,
        ...(evidenceReference.trim() ? { evidenceReference: evidenceReference.trim() } : {}),
      }),
    );
  };
  const reject = (item: ApplicationAuditResponse) => {
    if (!item.id || item.version === null || (rejectionCode === 'OTHER' && !observation.trim())) {
      setError('OTHER requiere una observación.');
      return;
    }
    void run(() =>
      rejectPatientApplicationAudit(organizationId, item.id!, {
        expectedVersion: item.version!,
        rejectionCode,
        ...(observation.trim() ? { observation: observation.trim() } : {}),
        ...(evidenceReference.trim() ? { evidenceReference: evidenceReference.trim() } : {}),
      }),
    );
  };
  return (
    <main>
      <PageHeader
        title="Auditoría de aplicaciones"
        description="MTD valida aplicaciones confirmadas sin modificar el hecho físico ni el inventario."
      />
      <Card className="operational-list-workspace">
        <CardBody>
          <label>
            Estado
            <select
              className="control"
              value={status}
              onChange={(event) => setStatus(event.target.value as ApplicationAuditStatus | '')}
            >
              <option value="">Todos</option>
              <option value="READY_FOR_AUDIT">Lista para auditar</option>
              <option value="IN_REVIEW">En revisión</option>
              <option value="APPROVED">Aprobada</option>
              <option value="REJECTED">Rechazada</option>
            </select>
          </label>
          <FilterBar><FilterField label="Paciente"><input className="control" value={textFilter.patient} onChange={(event) => setTextFilter({ ...textFilter, patient: event.target.value })} placeholder="Nombre o identificación" /></FilterField><FilterField label="Autorización"><input className="control" value={textFilter.authorization} onChange={(event) => setTextFilter({ ...textFilter, authorization: event.target.value })} placeholder="Número" /></FilterField><FilterField label="Código producto"><input className="control" value={textFilter.commercialCode} onChange={(event) => setTextFilter({ ...textFilter, commercialCode: event.target.value })} placeholder="Código" /></FilterField></FilterBar>
          {error && <p role="alert">{error}</p>}
          {audits.loading ? <p>Cargando auditorías...</p> : null}
          {!audits.loading && audits.data?.items.length === 0 ? (
            <p>No hay aplicaciones para este filtro.</p>
          ) : null}
          <div className="table-wrap operational-list-table-wrap">
            <table aria-label="Auditoría de aplicaciones">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Documento</th>
                  <th>Autorización</th>
                  <th>Producto</th>
                  <th>Fecha aplicación</th>
                  <th>Punto</th>
                  <th>Cantidad</th>
                  <th>Estado</th>
                  <th>Auditor</th>
                  <th>Prioridad</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                 {audits.data?.items.filter((item) => (!textFilter.patient || `${item.patientName ?? ''} ${item.patientDocument ?? ''}`.toLowerCase().includes(textFilter.patient.toLowerCase())) && (!textFilter.authorization || item.authorizationNumber.toLowerCase().includes(textFilter.authorization.toLowerCase())) && (!textFilter.commercialCode || item.commercialCode.toLowerCase().includes(textFilter.commercialCode.toLowerCase()))).map((item) => {
                  const meta = statusMeta[item.status];
                  return (
                    <tr key={item.patientApplicationId}>
                      <td>{item.patientName ?? '—'}</td>
                      <td>{item.patientDocument ?? '—'}</td>
                      <td>{item.authorizationNumber}</td>
                      <td>{item.commercialCode}</td>
                      <td>{item.applicationDate}</td>
                      <td>{item.dispensingPointCode}</td>
                      <td>
                        {item.appliedQuantity}/{item.scheduledQuantity}
                      </td>
                      <td>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </td>
                      <td>{item.startedByName ?? item.startedBy ?? '—'}</td>
                      <td>{item.priorityLevel ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setSelectedApplicationId(item.patientApplicationId)}
                        >
                          Ver detalle
                        </button>{' '}
                        {canManage && item.status === 'READY_FOR_AUDIT' ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => start(item)}
                          >
                            Iniciar auditoría
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      {selected ? (
        <Card>
          <CardHead
            title="Detalle de aplicación"
            subtitle="La auditoría no permite editar programación, aplicación ni inventario."
          />
          <CardBody>
            <p>
              <strong>Paciente:</strong> {selected.patientName ?? '—'} · <strong>Documento:</strong>{' '}
              {selected.patientDocument ?? '—'}
            </p>
            <p>
              <strong>Autorización:</strong> {selected.authorizationNumber} ·{' '}
              <strong>Producto:</strong> {selected.commercialCode}
            </p>
            <p>
              <strong>Programada:</strong> {selected.scheduledDate} · <strong>Aplicada:</strong>{' '}
              {selected.applicationDate} · <strong>Punto:</strong> {selected.dispensingPointName}
            </p>
            <p>
              <strong>Cantidad programada:</strong> {selected.scheduledQuantity} ·{' '}
              <strong>Cantidad aplicada:</strong> {selected.appliedQuantity} ·{' '}
              <strong>Operacional:</strong> {selected.operationalStatus} ·{' '}
              <strong>Admisión:</strong> {selected.admissionStatus}
            </p>
            <p>
              <strong>Vencimiento autorización:</strong> {selected.authorizationExpiresOn ?? '—'} ·{' '}
              <strong>Prioridad:</strong> {selected.priorityLevel ?? '—'} ·{' '}
              <strong>Soporte:</strong> {selected.evidenceReference ?? '—'}
            </p>
            <p>
              <strong>Auditor:</strong> {selected.startedByName ?? selected.startedBy ?? '—'} ·{' '}
              <strong>Revisión programación:</strong> {selected.scheduleRevision}
            </p>
            <h3>Lotes</h3>
            <ul>
              {selected.lines.map((line) => (
                <li key={line.id}>
                  {line.lotNumber} · vence {line.expirationDate} · {line.quantity}
                </li>
              ))}
            </ul>
            <h3>Movimientos APPLICATION</h3>
            <ul>
              {selected.movements.map((movement) => (
                <li key={movement.id}>
                  {movement.id} · {movement.quantityDelta} · {movement.occurredAt}
                </li>
              ))}
            </ul>
            {canManage && selected.status === 'IN_REVIEW' ? (
              <div className="flow">
                <label>
                  Referencia externa de soporte
                  <input
                    className="control"
                    value={evidenceReference}
                    onChange={(event) => setEvidenceReference(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => approve(selected)}
                >
                  Aprobar
                </button>
                <label>
                  Código de rechazo
                  <select
                    className="control"
                    value={rejectionCode}
                    onChange={(event) =>
                      setRejectionCode(event.target.value as ApplicationAuditRejectionCode)
                    }
                  >
                    {rejectionCodes.map((code) => (
                      <option key={code}>{code}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Observación
                  <textarea
                    className="control"
                    value={observation}
                    onChange={(event) => setObservation(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="button"
                  disabled={busy || (rejectionCode === 'OTHER' && !observation.trim())}
                  onClick={() => reject(selected)}
                >
                  Rechazar
                </button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </main>
  );
}
