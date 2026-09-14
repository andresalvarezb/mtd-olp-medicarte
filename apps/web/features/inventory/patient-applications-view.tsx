'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { listInventory } from '@/lib/inventory-api';
import {
  cancelPatientApplication,
  confirmPatientApplication,
  createPatientApplication,
  listEligibleApplicationSchedules,
  listPatientApplications,
} from '@/lib/patient-applications-api';

export function PatientApplicationsView() {
  const { organizationId } = useRole();
  const searchParams = useSearchParams();
  const applications = useApiData(() => listPatientApplications(organizationId), [organizationId]);
  const schedules = useApiData(
    () => listEligibleApplicationSchedules(organizationId),
    [organizationId],
  );
  const inventory = useApiData(
    () => listInventory(organizationId, { usable: 'true' }),
    [organizationId],
  );
  const [scheduleId, setScheduleId] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const schedule = schedules.data?.items.find((item) => item.id === scheduleId);
  const lots = (inventory.data?.items ?? []).filter(
    (lot) =>
      lot.commercialCode === schedule?.commercialCode &&
      lot.dispensingPointId === schedule?.dispensingPointId &&
      lot.usableBalance > 0,
  );
  const selectedTotal = Object.values(selected).reduce((sum, value) => sum + value, 0);
  useEffect(() => {
    const requestedScheduleId = searchParams.get('patientScheduleId');
    if (
      !requestedScheduleId ||
      !schedules.data?.items.some((item) => item.id === requestedScheduleId)
    )
      return;
    setScheduleId((current) => current || requestedScheduleId);
  }, [searchParams, schedules.data]);
  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      applications.reload();
      schedules.reload();
      setSelected({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible completar la operación');
    }
  };
  return (
    <>
      <PageHeader
        title="Aplicaciones"
        description="Aplicación física al paciente. El borrador no reserva inventario; la confirmación consume el ledger."
      />
      {error && <div className="login-error">{error}</div>}
      <Card>
        <CardBody>
          <h2>Nueva aplicación</h2>
          <div className="flow">
            <label>
              Programación
              <select
                className="control"
                value={scheduleId}
                onChange={(e) => {
                  setScheduleId(e.currentTarget.value);
                  setSelected({});
                }}
              >
                <option value="">Seleccionar programación</option>
                {(schedules.data?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.patientName ?? item.patientDocument ?? 'Paciente'} · {item.commercialCode}{' '}
                    · {item.scheduledDate} · {item.quantity}
                  </option>
                ))}
              </select>
            </label>
            {schedule && (
              <>
                <div>
                  <strong>Paciente:</strong> {schedule.patientName ?? 'Sin nombre'} ·{' '}
                  <strong>Documento:</strong> {schedule.patientDocument ?? 'Sin documento'} ·{' '}
                  <strong>Punto:</strong> {schedule.dispensingPointId}
                </div>
                <div>
                  <strong>Cantidad programada:</strong> {schedule.quantity} ·{' '}
                  <strong>Seleccionada:</strong> {selectedTotal}
                </div>
                {lots.map((lot) => (
                  <label key={lot.id}>
                    <input
                      type="number"
                      min="0"
                      max={lot.usableBalance}
                      value={selected[lot.id] ?? 0}
                      onChange={(e) =>
                        setSelected({
                          ...selected,
                          [lot.id]: Math.max(0, Number(e.currentTarget.value)),
                        })
                      }
                    />{' '}
                    {lot.lotNumber} · vence {lot.expirationDate} · usable {lot.usableBalance}
                  </label>
                ))}
                <label>
                  Motivo si no sigue FEFO
                  <input
                    className="control"
                    value={reason}
                    onChange={(e) => setReason(e.currentTarget.value)}
                    placeholder="Obligatorio solo para seleccionar un lote posterior"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={selectedTotal !== schedule.quantity}
                  onClick={() =>
                    void run(async () => {
                      const application = await createPatientApplication(organizationId, {
                        patientScheduleId: schedule.id,
                        scheduleRevision: schedule.revision,
                        applicationDate: schedule.scheduledDate,
                        lines: Object.entries(selected)
                          .filter(([, quantity]) => quantity > 0)
                          .map(([inventoryLotId, quantity]) => ({
                            inventoryLotId,
                            quantity,
                            fefoOverride: Boolean(reason),
                            ...(reason ? { fefoOverrideReason: reason } : {}),
                          })),
                      });
                      await confirmPatientApplication(
                        organizationId,
                        application.id,
                        application.version,
                      );
                    })
                  }
                >
                  Crear y confirmar
                </button>
                {selectedTotal !== schedule.quantity && (
                  <p>La cantidad seleccionada debe coincidir exactamente con la programación.</p>
                )}
              </>
            )}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2>Aplicaciones registradas</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Autorización</th>
                <th>Producto</th>
                <th>Fecha</th>
                <th>Cantidad</th>
                <th>Estado</th>
                <th>Lotes</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(applications.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.patientName ?? 'Sin nombre'}
                    <br />
                    {item.patientDocument ?? 'Sin documento'}
                  </td>
                  <td>{item.authorizationNumber}</td>
                  <td>{item.commercialCode}</td>
                  <td>{item.applicationDate}</td>
                  <td>
                    {item.selectedQuantity}/{item.scheduledQuantity}
                  </td>
                  <td>{item.status}</td>
                  <td>
                    {item.lines.map((line) => `${line.lotNumber}: ${line.quantity}`).join(' | ')}
                  </td>
                  <td>
                    {item.status === 'DRAFT' && (
                      <>
                        <button
                          className="button primary"
                          disabled={item.selectedQuantity !== item.scheduledQuantity}
                          onClick={() =>
                            void run(() =>
                              confirmPatientApplication(organizationId, item.id, item.version),
                            )
                          }
                        >
                          Confirmar
                        </button>{' '}
                        <button
                          className="button"
                          onClick={() =>
                            void run(() =>
                              cancelPatientApplication(organizationId, item.id, item.version),
                            )
                          }
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                    {item.status === 'CONFIRMED' && 'Inmutable'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
