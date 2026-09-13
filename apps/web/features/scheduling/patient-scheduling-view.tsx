'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ExpirationPriorityLevel,
  LateHandling,
  PatientScheduleImportBatchResponse,
  PatientScheduleImportRowResponse,
  PatientScheduleResponse,
  ScheduleAuthorizationOption,
  ScheduleTimingPreviewResponse,
} from '@authorization/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { Tabs } from '@/components/ui/tabs';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { ApiError } from '@/lib/api-client';
import {
  cancelPatientSchedule,
  confirmPatientScheduleImport,
  createPatientSchedule,
  createPatientScheduleImport,
  downloadPatientScheduleTemplate,
  getPatientScheduleHistory,
  getPatientScheduleImportRows,
  listDispensingPoints,
  listPatientSchedules,
  previewScheduleTiming,
  reschedulePatientSchedule,
  searchScheduleAuthorizations,
} from '@/lib/patient-schedules-api';

const PRIORITY_META: Record<ExpirationPriorityLevel, { label: string; tone: PillTone }> = {
  CRITICAL: { label: 'Crítica', tone: 'red' },
  HIGH: { label: 'Alta', tone: 'orange' },
  NORMAL: { label: 'Normal', tone: 'green' },
};

const TIMING_META: Record<'ON_TIME' | 'LATE', { label: string; tone: PillTone }> = {
  ON_TIME: { label: 'Dentro del corte', tone: 'green' },
  LATE: { label: 'Después del corte', tone: 'red' },
};

const LATE_HANDLING_LABELS: Record<LateHandling, string> = {
  COMPLEMENTARY_PURCHASE_ORDER: 'OC complementaria (intención)',
  NEXT_PERIOD: 'Siguiente período',
};

const STATUS_META: Record<
  PatientScheduleResponse['status'],
  { label: string; tone: PillTone }
> = {
  SCHEDULED: { label: 'Programada', tone: 'green' },
  RESCHEDULED: { label: 'Reprogramada', tone: 'blue' },
  CANCELLED: { label: 'Cancelada', tone: 'gray' },
};

const STAGING_META: Record<PatientScheduleImportRowResponse['stagingStatus'], PillTone> = {
  VALID: 'green',
  INVALID: 'red',
  DUPLICATE: 'orange',
  CONFLICT: 'purple',
};

const IMPORT_STATUS_LABELS: Record<PatientScheduleImportBatchResponse['status'], string> = {
  UPLOADED: 'Cargado',
  VALIDATING: 'Validando',
  READY_TO_CONFIRM: 'Listo para confirmar',
  CONFIRMING: 'Confirmando',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

const BOGOTA_DATE_TIME = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(iso: string): string {
  return BOGOTA_DATE_TIME.format(new Date(iso));
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'Error inesperado.';
}

export function PatientSchedulingView() {
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('patient_schedules.manage');
  const fileInput = useRef<HTMLInputElement>(null);

  const [searchAuthorization, setSearchAuthorization] = useState('');
  const [searchDocument, setSearchDocument] = useState('');
  const [searchResults, setSearchResults] = useState<ScheduleAuthorizationOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<ScheduleAuthorizationOption | null>(null);
  const [form, setForm] = useState({
    quantity: '',
    dispensingPointId: '',
    scheduledDate: '',
    lateHandling: '' as '' | LateHandling,
  });
  const [timing, setTiming] = useState<ScheduleTimingPreviewResponse | null>(null);
  const [timingLoading, setTimingLoading] = useState(false);

  const [filters, setFilters] = useState({
    authorization: '',
    patientDocument: '',
    status: '' as '' | PatientScheduleResponse['status'],
    dispensingPointId: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [selectedSchedule, setSelectedSchedule] = useState<PatientScheduleResponse | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<PatientScheduleResponse | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    scheduledDate: '',
    dispensingPointId: '',
    lateHandling: '' as '' | LateHandling,
  });

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBatch, setImportBatch] = useState<PatientScheduleImportBatchResponse | null>(null);
  const [importRows, setImportRows] = useState<PatientScheduleImportRowResponse[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const points = useApiData(() => listDispensingPoints(organizationId), [organizationId]);
  const schedules = useApiData(
    () =>
      listPatientSchedules(organizationId, {
        limit: 100,
        ...(appliedFilters.authorization ? { authorization: appliedFilters.authorization } : {}),
        ...(appliedFilters.patientDocument
          ? { patientDocument: appliedFilters.patientDocument }
          : {}),
        ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
        ...(appliedFilters.dispensingPointId
          ? { dispensingPointId: appliedFilters.dispensingPointId }
          : {}),
      }),
    [organizationId, appliedFilters],
  );
  const history = useApiData(
    () =>
      selectedSchedule
        ? getPatientScheduleHistory(organizationId, selectedSchedule.id)
        : Promise.resolve({ items: [] }),
    [organizationId, selectedSchedule?.id],
  );

  useEffect(() => {
    if (!form.scheduledDate) {
      setTiming(null);
      return;
    }
    let cancelled = false;
    setTimingLoading(true);
    previewScheduleTiming(organizationId, form.scheduledDate)
      .then((result) => {
        if (!cancelled) setTiming(result);
      })
      .catch(() => {
        if (!cancelled) setTiming(null);
      })
      .finally(() => {
        if (!cancelled) setTimingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, form.scheduledDate]);

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    setMessage(null);
    void action()
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setBusy(false));
  };

  const handleSearch = (): void =>
    run(async () => {
      const result = await searchScheduleAuthorizations(organizationId, {
        ...(searchAuthorization ? { authorization: searchAuthorization } : {}),
        ...(searchDocument ? { patientDocument: searchDocument } : {}),
      });
      setSearchResults(result.items);
      if (result.items.length === 0) setMessage('Sin autorizaciones para los filtros de búsqueda.');
    });

  const startScheduling = (option: ScheduleAuthorizationOption): void => {
    setSelectedOption(option);
    setForm({
      quantity: option.authorizedQuantity ? String(option.authorizedQuantity) : '',
      dispensingPointId: '',
      scheduledDate: '',
      lateHandling: '',
    });
    setTiming(null);
    setError(null);
    setMessage(null);
  };

  const handleCreate = (): void =>
    run(async () => {
      if (!selectedOption) return;
      const created = await createPatientSchedule(organizationId, {
        authorizationItemId: selectedOption.authorizationItemId,
        commercialCode: selectedOption.commercialCode,
        dispensingPointId: form.dispensingPointId,
        scheduledDate: form.scheduledDate,
        quantity: Number(form.quantity),
        ...(timing?.lateHandlingRequired && form.lateHandling
          ? { lateHandling: form.lateHandling }
          : {}),
      });
      setSelectedSchedule(created);
      setSelectedOption(null);
      setTiming(null);
      setMessage(`Programación ${created.id.slice(0, 8)} creada (revisión ${created.revision}).`);
      schedules.reload();
      history.reload();
    });

  const handleReschedule = (): void =>
    run(async () => {
      if (!rescheduleTarget) return;
      const updated = await reschedulePatientSchedule(organizationId, rescheduleTarget.id, {
        expectedRevision: rescheduleTarget.revision,
        scheduledDate: rescheduleForm.scheduledDate,
        ...(rescheduleForm.dispensingPointId
          ? { dispensingPointId: rescheduleForm.dispensingPointId }
          : {}),
        ...(rescheduleForm.lateHandling ? { lateHandling: rescheduleForm.lateHandling } : {}),
      });
      setSelectedSchedule(updated);
      setRescheduleTarget(null);
      setMessage(`Programación reprogramada (revisión ${updated.revision}).`);
      schedules.reload();
      history.reload();
    });

  const handleCancel = (schedule: PatientScheduleResponse): void => {
    if (!window.confirm('¿Cancelar esta programación? No se elimina: se conserva el histórico.')) {
      return;
    }
    run(async () => {
      const updated = await cancelPatientSchedule(organizationId, schedule.id, {
        expectedRevision: schedule.revision,
      });
      setSelectedSchedule(updated);
      setMessage('Programación cancelada; el histórico se conserva.');
      schedules.reload();
      history.reload();
    });
  };

  const handleDownloadTemplate = (): void =>
    run(async () => {
      const blob = await downloadPatientScheduleTemplate(organizationId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'plantilla-programacion-pacientes.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
    });

  const handleUpload = (): void =>
    run(async () => {
      if (!importFile) {
        setError('Selecciona un archivo .xlsx.');
        return;
      }
      const batch = await createPatientScheduleImport(
        organizationId,
        importFile,
        crypto.randomUUID(),
      );
      setImportBatch(batch);
      const rows = await getPatientScheduleImportRows(organizationId, batch.id);
      setImportRows(rows.items);
      setMessage(
        `Staging listo: ${batch.validRows} válidas, ${batch.invalidRows} inválidas, ` +
          `${batch.duplicateRows} duplicadas y ${batch.conflictRows} en conflicto.`,
      );
    });

  const handleConfirmImport = (): void =>
    run(async () => {
      if (!importBatch) return;
      const confirmed = await confirmPatientScheduleImport(organizationId, importBatch.id);
      setImportBatch(confirmed);
      const rows = await getPatientScheduleImportRows(organizationId, confirmed.id);
      setImportRows(rows.items);
      setMessage(`Carga confirmada: ${confirmed.confirmedRows} programaciones escritas.`);
      schedules.reload();
    });

  const scheduleItems = schedules.data?.items ?? [];
  const pointItems = points.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Programación de pacientes"
        description="Medicarte registra la intención de aplicar productos autorizados. La programación no reserva inventario ni crea órdenes de compra."
        actions={<span className="pill blue">{scheduleItems.length} programaciones</span>}
      />

      {error ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="pill green" role="status" style={{ marginBottom: 14 }}>
          {message}
        </div>
      ) : null}

      <Tabs tabs={['Programación individual', 'Programaciones', 'Carga masiva XLSX']}>
        {(active) => (
          <>
            {active === 0 ? (
              <>
                <Card>
                  <CardHead
                    title="Buscar paciente o autorización"
                    subtitle="Busca por número de autorización o documento del paciente."
                  />
                  <CardBody>
                    <div className="config-grid">
                      <div className="field">
                        <label htmlFor="schedule-search-authorization">Autorización</label>
                        <input
                          id="schedule-search-authorization"
                          className="control"
                          value={searchAuthorization}
                          placeholder="Número de autorización"
                          onChange={(event) => setSearchAuthorization(event.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="schedule-search-document">Documento paciente</label>
                        <input
                          id="schedule-search-document"
                          className="control"
                          value={searchDocument}
                          placeholder="Documento"
                          onChange={(event) => setSearchDocument(event.target.value)}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || (!searchAuthorization && !searchDocument)}
                        onClick={handleSearch}
                      >
                        {busy ? 'Buscando…' : 'Buscar'}
                      </button>
                    </div>
                  </CardBody>
                </Card>

                {searchResults.length > 0 ? (
                  <Card>
                    <CardHead
                      title="Resultados"
                      subtitle="Un paciente puede tener varios productos autorizados. La alerta de vencimiento es visual y no reserva stock."
                    />
                    <CardBody>
                      <div className="table-wrap">
                        <table aria-label="Autorizaciones para programar">
                          <thead>
                            <tr>
                              <th>Autorización</th>
                              <th>Documento</th>
                              <th>Paciente</th>
                              <th>Código comercial</th>
                              <th>Cantidad autorizada</th>
                              <th>Vencimiento</th>
                              <th>Prioridad</th>
                              <th>Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {searchResults.map((option) => (
                              <tr key={option.authorizationItemId}>
                                <td>{option.authorizationNumber}</td>
                                <td>{option.patientDocument ?? '—'}</td>
                                <td>{option.patientName ?? '—'}</td>
                                <td>
                                  <strong>{option.commercialCode}</strong>
                                </td>
                                <td>{option.authorizedQuantity ?? '—'}</td>
                                <td>{option.authorizationExpiresOn ?? 'Sin dato'}</td>
                                <td>
                                  {option.priorityLevel ? (
                                    <StatusBadge tone={PRIORITY_META[option.priorityLevel].tone}>
                                      {PRIORITY_META[option.priorityLevel].label}
                                      {option.daysUntilExpiration !== null
                                        ? ` · ${option.daysUntilExpiration} días`
                                        : ''}
                                    </StatusBadge>
                                  ) : (
                                    <span className="pill gray">Sin dato</span>
                                  )}
                                </td>
                                <td>
                                  {canManage ? (
                                    <button
                                      type="button"
                                      className="btn"
                                      style={{ padding: '2px 8px', fontSize: 10 }}
                                      disabled={!option.canSchedule}
                                      onClick={() => startScheduling(option)}
                                    >
                                      {option.canSchedule ? 'Programar' : 'No habilitada'}
                                    </button>
                                  ) : (
                                    <span style={{ color: 'var(--muted)' }}>Solo lectura</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardBody>
                  </Card>
                ) : null}

                {selectedOption ? (
                  <Card>
                    <CardHead
                      title={`Programar ${selectedOption.commercialCode}`}
                      subtitle={`Autorización ${selectedOption.authorizationNumber} · cantidad autorizada ${
                        selectedOption.authorizedQuantity ?? 'sin dato'
                      }`}
                      aside={
                        selectedOption.priorityLevel ? (
                          <StatusBadge tone={PRIORITY_META[selectedOption.priorityLevel].tone}>
                            Vence {selectedOption.authorizationExpiresOn} ·{' '}
                            {PRIORITY_META[selectedOption.priorityLevel].label}
                          </StatusBadge>
                        ) : null
                      }
                    />
                    <CardBody>
                      <div className="config-grid">
                        <div className="field">
                          <label htmlFor="schedule-quantity">Cantidad a programar</label>
                          <input
                            id="schedule-quantity"
                            className="control"
                            type="number"
                            min={1}
                            value={form.quantity}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, quantity: event.target.value }))
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="schedule-point">Punto</label>
                          <select
                            id="schedule-point"
                            className="control"
                            value={form.dispensingPointId}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                dispensingPointId: event.target.value,
                              }))
                            }
                          >
                            <option value="">Selecciona un punto</option>
                            {pointItems.map((point) => (
                              <option key={point.id} value={point.id}>
                                {point.code} · {point.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="schedule-date">Fecha programada</label>
                          <input
                            id="schedule-date"
                            className="control"
                            type="date"
                            value={form.scheduledDate}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                scheduledDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                        {timing?.lateHandlingRequired ? (
                          <div className="field">
                            <label htmlFor="schedule-late-handling">Manejo tardío</label>
                            <select
                              id="schedule-late-handling"
                              className="control"
                              value={form.lateHandling}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  lateHandling: event.target.value as LateHandling,
                                }))
                              }
                            >
                              <option value="">Selecciona una decisión</option>
                              <option value="COMPLEMENTARY_PURCHASE_ORDER">
                                {LATE_HANDLING_LABELS.COMPLEMENTARY_PURCHASE_ORDER}
                              </option>
                              <option value="NEXT_PERIOD">
                                {LATE_HANDLING_LABELS.NEXT_PERIOD}
                              </option>
                            </select>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {timingLoading ? (
                          <span className="pill gray">Calculando período…</span>
                        ) : timing ? (
                          <>
                            <StatusBadge tone={TIMING_META[timing.scheduleTiming].tone}>
                              {TIMING_META[timing.scheduleTiming].label}
                            </StatusBadge>
                            <span className="pill blue">
                              Período {timing.planningPeriodStartDate} → {timing.planningPeriodEndDate}
                            </span>
                          </>
                        ) : (
                          <span className="pill gray">Selecciona una fecha con período vigente</span>
                        )}
                      </div>
                      {timing?.lateHandlingRequired ? (
                        <Note>
                          La fecha está después del corte ({formatDateTime(timing.schedulingCutoffAt)}).
                          Indica si se gestionará con OC complementaria o en el siguiente período.
                          ESP-003 solo registra la intención: no crea OC ni demanda consolidada.
                        </Note>
                      ) : null}

                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={
                            busy ||
                            !form.quantity ||
                            Number(form.quantity) <= 0 ||
                            !form.dispensingPointId ||
                            !form.scheduledDate ||
                            (timing?.lateHandlingRequired === true && !form.lateHandling)
                          }
                          onClick={handleCreate}
                        >
                          Guardar programación
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => {
                            setSelectedOption(null);
                            setTiming(null);
                          }}
                        >
                          Cerrar
                        </button>
                      </div>
                    </CardBody>
                  </Card>
                ) : null}
              </>
            ) : null}

            {active === 1 ? (
              <>
                <Card>
                  <CardHead
                    title="Filtros"
                    subtitle="Consultas por autorización, documento, período, punto, estado y código comercial."
                  />
                  <CardBody>
                    <div className="config-grid">
                      <div className="field">
                        <label htmlFor="schedule-filter-authorization">Autorización</label>
                        <input
                          id="schedule-filter-authorization"
                          className="control"
                          value={filters.authorization}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              authorization: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="schedule-filter-document">Documento</label>
                        <input
                          id="schedule-filter-document"
                          className="control"
                          value={filters.patientDocument}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              patientDocument: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="schedule-filter-point">Punto</label>
                        <select
                          id="schedule-filter-point"
                          className="control"
                          value={filters.dispensingPointId}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              dispensingPointId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Todos</option>
                          {pointItems.map((point) => (
                            <option key={point.id} value={point.id}>
                              {point.code} · {point.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="schedule-filter-status">Estado</label>
                        <select
                          id="schedule-filter-status"
                          className="control"
                          value={filters.status}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              status: event.target.value as typeof current.status,
                            }))
                          }
                        >
                          <option value="">Todos</option>
                          <option value="SCHEDULED">Programada</option>
                          <option value="RESCHEDULED">Reprogramada</option>
                          <option value="CANCELLED">Cancelada</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setAppliedFilters(filters)}
                      >
                        Filtrar
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          const cleared = {
                            authorization: '',
                            patientDocument: '',
                            status: '' as const,
                            dispensingPointId: '',
                          };
                          setFilters(cleared);
                          setAppliedFilters(cleared);
                        }}
                      >
                        Limpiar
                      </button>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHead
                    title="Programaciones registradas"
                    subtitle="Cancelar o reprogramar conserva el histórico append-only."
                  />
                  <CardBody>
                    {schedules.loading ? (
                      <Note>Cargando programaciones…</Note>
                    ) : scheduleItems.length === 0 ? (
                      <Note>Sin programaciones para los filtros seleccionados.</Note>
                    ) : (
                      <div className="table-wrap">
                        <table aria-label="Programaciones registradas">
                          <thead>
                            <tr>
                              <th>Autorización</th>
                              <th>Paciente</th>
                              <th>Código</th>
                              <th>Cantidad</th>
                              <th>Punto</th>
                              <th>Fecha</th>
                              <th>Período</th>
                              <th>Timing</th>
                              <th>Prioridad</th>
                              <th>Estado</th>
                              <th>Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheduleItems.map((schedule) => (
                              <tr key={schedule.id}>
                                <td>{schedule.authorizationNumber}</td>
                                <td>{schedule.patientName ?? schedule.patientDocument ?? '—'}</td>
                                <td>{schedule.commercialCode}</td>
                                <td>{schedule.quantity}</td>
                                <td>{schedule.dispensingPointCode}</td>
                                <td>{schedule.scheduledDate}</td>
                                <td>
                                  {schedule.planningPeriodStartDate} → {schedule.planningPeriodEndDate}
                                </td>
                                <td>
                                  <StatusBadge tone={TIMING_META[schedule.scheduleTiming].tone}>
                                    {TIMING_META[schedule.scheduleTiming].label}
                                  </StatusBadge>
                                </td>
                                <td>
                                  {schedule.priorityLevel ? (
                                    <StatusBadge tone={PRIORITY_META[schedule.priorityLevel].tone}>
                                      {PRIORITY_META[schedule.priorityLevel].label}
                                    </StatusBadge>
                                  ) : (
                                    <span className="pill gray">—</span>
                                  )}
                                </td>
                                <td>
                                  <StatusBadge tone={STATUS_META[schedule.status].tone}>
                                    {STATUS_META[schedule.status].label}
                                  </StatusBadge>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      className="btn"
                                      style={{ padding: '2px 8px', fontSize: 10 }}
                                      onClick={() => setSelectedSchedule(schedule)}
                                    >
                                      Historial
                                    </button>
                                    {canManage && schedule.status !== 'CANCELLED' ? (
                                      <>
                                        <button
                                          type="button"
                                          className="btn"
                                          style={{ padding: '2px 8px', fontSize: 10 }}
                                          disabled={busy}
                                          onClick={() => {
                                            setRescheduleTarget(schedule);
                                            setRescheduleForm({
                                              scheduledDate: schedule.scheduledDate,
                                              dispensingPointId: schedule.dispensingPointId,
                                              lateHandling: '',
                                            });
                                          }}
                                        >
                                          Reprogramar
                                        </button>
                                        <button
                                          type="button"
                                          className="btn"
                                          style={{ padding: '2px 8px', fontSize: 10 }}
                                          disabled={busy}
                                          onClick={() => handleCancel(schedule)}
                                        >
                                          Cancelar
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardBody>
                </Card>

                {rescheduleTarget ? (
                  <Card>
                    <CardHead
                      title={`Reprogramar ${rescheduleTarget.commercialCode}`}
                      subtitle="Se conserva el lineage: se crea una nueva revisión del historial."
                    />
                    <CardBody>
                      <div className="config-grid">
                        <div className="field">
                          <label htmlFor="reschedule-date">Nueva fecha</label>
                          <input
                            id="reschedule-date"
                            className="control"
                            type="date"
                            value={rescheduleForm.scheduledDate}
                            onChange={(event) =>
                              setRescheduleForm((current) => ({
                                ...current,
                                scheduledDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="reschedule-point">Punto</label>
                          <select
                            id="reschedule-point"
                            className="control"
                            value={rescheduleForm.dispensingPointId}
                            onChange={(event) =>
                              setRescheduleForm((current) => ({
                                ...current,
                                dispensingPointId: event.target.value,
                              }))
                            }
                          >
                            {pointItems.map((point) => (
                              <option key={point.id} value={point.id}>
                                {point.code} · {point.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="reschedule-late">Manejo tardío (solo si aplica)</label>
                          <select
                            id="reschedule-late"
                            className="control"
                            value={rescheduleForm.lateHandling}
                            onChange={(event) =>
                              setRescheduleForm((current) => ({
                                ...current,
                                lateHandling: event.target.value as LateHandling,
                              }))
                            }
                          >
                            <option value="">Sin cambio</option>
                            <option value="COMPLEMENTARY_PURCHASE_ORDER">
                              {LATE_HANDLING_LABELS.COMPLEMENTARY_PURCHASE_ORDER}
                            </option>
                            <option value="NEXT_PERIOD">{LATE_HANDLING_LABELS.NEXT_PERIOD}</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={busy || !rescheduleForm.scheduledDate}
                          onClick={handleReschedule}
                        >
                          Guardar reprogramación
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => setRescheduleTarget(null)}
                        >
                          Cerrar
                        </button>
                      </div>
                    </CardBody>
                  </Card>
                ) : null}

                {selectedSchedule ? (
                  <Card>
                    <CardHead
                      title={`Historial de ${selectedSchedule.commercialCode}`}
                      subtitle="Revisiones append-only: fecha, punto y cantidad de cada cambio."
                      aside={
                        <StatusBadge tone={STATUS_META[selectedSchedule.status].tone}>
                          {STATUS_META[selectedSchedule.status].label}
                        </StatusBadge>
                      }
                    />
                    <CardBody>
                      {history.loading ? (
                        <Note>Cargando historial…</Note>
                      ) : (history.data?.items.length ?? 0) === 0 ? (
                        <Note>Sin revisiones registradas.</Note>
                      ) : (
                        <div className="table-wrap">
                          <table aria-label="Historial de programación">
                            <thead>
                              <tr>
                                <th>Revisión</th>
                                <th>Cambio</th>
                                <th>Fecha</th>
                                <th>Punto</th>
                                <th>Cantidad</th>
                                <th>Estado</th>
                                <th>Timing</th>
                                <th>Manejo tardío</th>
                                <th>Registrado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {history.data?.items.map((entry) => (
                                <tr key={entry.revision}>
                                  <td>v{entry.revision}</td>
                                  <td>{entry.changeType}</td>
                                  <td>{entry.scheduledDate}</td>
                                  <td>{entry.dispensingPointId.slice(0, 8)}</td>
                                  <td>{entry.quantity}</td>
                                  <td>{STATUS_META[entry.status].label}</td>
                                  <td>{TIMING_META[entry.scheduleTiming].label}</td>
                                  <td>
                                    {entry.lateHandling
                                      ? LATE_HANDLING_LABELS[entry.lateHandling]
                                      : '—'}
                                  </td>
                                  <td>{formatDateTime(entry.changedAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                ) : null}
              </>
            ) : null}

            {active === 2 ? (
              <Card>
                <CardHead
                  title="Carga masiva XLSX"
                  subtitle="Columnas mínimas: AUTORIZACION, DOCUMENTO, COD_COMERCIAL, CANTIDAD, PUNTO, FECHA_PROGRAMADA. COD_COMERCIAL es la identidad del producto."
                  aside={
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={handleDownloadTemplate}
                    >
                      Descargar plantilla
                    </button>
                  }
                />
                <CardBody>
                  {canManage ? (
                    <>
                      <div className="field">
                        <label htmlFor="schedule-import-file">Archivo XLSX</label>
                        <input
                          id="schedule-import-file"
                          ref={fileInput}
                          className="control"
                          type="file"
                          accept=".xlsx"
                          onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !importFile}
                          onClick={handleUpload}
                        >
                          {busy ? 'Procesando…' : 'Validar archivo'}
                        </button>
                        {importBatch?.status === 'READY_TO_CONFIRM' ? (
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            onClick={handleConfirmImport}
                          >
                            Confirmar filas válidas
                          </button>
                        ) : null}
                      </div>
                      <Note>
                        La confirmación escribe únicamente las filas VALID en una transacción por
                        fila. Las filas inválidas, duplicadas o en conflicto se conservan para
                        corrección y no bloquean a las válidas.
                      </Note>
                    </>
                  ) : (
                    <Note>Tu rol permite consultar cargas, pero no crear ni confirmar.</Note>
                  )}

                  {importBatch ? (
                    <>
                      <div className="metric-list" style={{ marginTop: 14 }}>
                        <div className="metric-mini">
                          <span>Estado</span>
                          <strong>{IMPORT_STATUS_LABELS[importBatch.status]}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Total</span>
                          <strong>{importBatch.totalRows}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Válidas</span>
                          <strong>{importBatch.validRows}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Inválidas</span>
                          <strong>{importBatch.invalidRows}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Duplicadas</span>
                          <strong>{importBatch.duplicateRows}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Conflictos</span>
                          <strong>{importBatch.conflictRows}</strong>
                        </div>
                        <div className="metric-mini">
                          <span>Confirmadas</span>
                          <strong>{importBatch.confirmedRows}</strong>
                        </div>
                      </div>
                      {importRows.length > 0 ? (
                        <div className="table-wrap" style={{ marginTop: 14 }}>
                          <table aria-label="Filas de la carga">
                            <thead>
                              <tr>
                                <th>Fila</th>
                                <th>Autorización</th>
                                <th>Documento</th>
                                <th>Código</th>
                                <th>Cantidad</th>
                                <th>Punto</th>
                                <th>Fecha</th>
                                <th>Timing</th>
                                <th>Resultado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importRows.map((row) => (
                                <tr key={row.id}>
                                  <td>{row.rowNumber}</td>
                                  <td>{row.authorizationNumber ?? '—'}</td>
                                  <td>{row.patientDocument ?? '—'}</td>
                                  <td>{row.commercialCode ?? '—'}</td>
                                  <td>{row.quantity ?? '—'}</td>
                                  <td>{row.dispensingPointCode ?? '—'}</td>
                                  <td>{row.scheduledDate ?? '—'}</td>
                                  <td>
                                    {row.scheduleTiming
                                      ? TIMING_META[row.scheduleTiming].label
                                      : '—'}
                                  </td>
                                  <td>
                                    <StatusBadge tone={STAGING_META[row.stagingStatus]}>
                                      {row.stagingStatus}
                                    </StatusBadge>
                                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                                      {row.resultCode}
                                      {row.resultMessage ? ` · ${row.resultMessage}` : ''}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </CardBody>
              </Card>
            ) : null}
          </>
        )}
      </Tabs>
    </>
  );
}
