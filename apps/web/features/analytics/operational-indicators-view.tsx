'use client';

import { useMemo, useState } from 'react';
import type {
  AnalyticsDrilldownKind,
  AnalyticsMoneyMetric,
  AnalyticsQuery,
  AnalyticsRatioMetric,
  OperationalAnalyticsResponse,
  PatientOperationalNovelty,
  PlanningPeriodResponse,
} from '@authorization/contracts';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import {
  getAnalyticsDrilldown,
  getAnalyticsInventory,
  getOperationalAnalytics,
} from '@/lib/analytics-api';
import { listPlanningPeriods } from '@/lib/planning-periods-api';
import { listDispensingPoints } from '@/lib/patient-schedules-api';
import {
  PROJECTED_TARIFF_NOTE,
  PURCHASE_COVERAGE_LABEL,
  PURCHASE_COVERAGE_NOTE,
  REQUESTED_QUANTITY_LABEL,
  REQUESTED_QUANTITY_NOTE,
} from './operational-indicators-ui';

const NOVELTY_LABELS: Record<PatientOperationalNovelty, string> = {
  PATIENT_NO_SHOW: 'Paciente no asiste',
  INCORRECT_PRESCRIPTION: 'Prescripción incorrecta',
  PRODUCT_NOT_CONTRACTED: 'Producto no contratado',
  AUTHORIZATION_CANCELLED: 'Autorización cancelada',
  INSUFFICIENT_STOCK: 'Stock insuficiente',
  RESCHEDULED: 'Reprogramado',
  OTHER: 'Otro',
};

function rateLabel(metric: AnalyticsRatioMetric) {
  if (metric.rate == null) return 'N/A';
  const negative = metric.rate.startsWith('-');
  const [whole = '0', fraction = '0000'] = metric.rate.replace('-', '').split('.');
  const padded = fraction.padEnd(4, '0').slice(0, 4);
  const percentWhole = Number(whole) * 100 + Number(padded.slice(0, 2));
  return `${negative ? '-' : ''}${percentWhole}.${padded.slice(2)}%`;
}

function moneyLabel(metric: AnalyticsMoneyMetric) {
  if (metric.availability !== 'EXACT' || metric.value == null) return 'No disponible';
  return `$ ${metric.value}`;
}

export function OperationalIndicatorsView() {
  const { organizationId, hasPermission } = useRole();
  const canReadEconomics = hasPermission('analytics.economics.read');
  const [planningPeriodId, setPlanningPeriodId] = useState('');
  const [dispensingPointId, setDispensingPointId] = useState('');
  const [commercialCode, setCommercialCode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [drilldownKind, setDrilldownKind] = useState<AnalyticsDrilldownKind | null>(null);
  const query = useMemo<AnalyticsQuery>(
    () => ({
      ...(planningPeriodId ? { planningPeriodId } : {}),
      ...(dispensingPointId ? { dispensingPointId } : {}),
      ...(commercialCode.trim() ? { commercialCode: commercialCode.trim() } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }),
    [planningPeriodId, dispensingPointId, commercialCode, dateFrom, dateTo],
  );
  const periods = useApiData(() => listPlanningPeriods(organizationId), [organizationId]);
  const points = useApiData(() => listDispensingPoints(organizationId), [organizationId]);
  const analytics = useApiData(
    () => getOperationalAnalytics(organizationId, query),
    [organizationId, JSON.stringify(query)],
  );
  const inventory = useApiData(
    () => getAnalyticsInventory(organizationId, query),
    [organizationId, JSON.stringify(query)],
  );
  const drilldown = useApiData(
    () =>
      drilldownKind
        ? getAnalyticsDrilldown(organizationId, { ...query, kind: drilldownKind, limit: 100 })
        : Promise.resolve({ kind: 'projected' as const, items: [] }),
    [organizationId, JSON.stringify(query), drilldownKind],
  );
  const data = analytics.data;
  const economics = data?.economics;

  return (
    <>
      <PageHeader
        title="Indicadores"
        description="Read model operacional y económico derivado de hechos persistidos. No es contabilidad ni fuente de verdad."
      />
      <Card>
        <CardHead title="Filtros" subtitle="Período, punto, producto y fechas de flujo." />
        <CardBody>
          <div className="grid two-col">
            <div className="field">
              <label htmlFor="analytics-period">Período</label>
              <select
                id="analytics-period"
                className="control"
                value={planningPeriodId}
                onChange={(event) => setPlanningPeriodId(event.target.value)}
              >
                <option value="">Todos los períodos</option>
                {(periods.data?.items ?? []).map((period: PlanningPeriodResponse) => (
                  <option key={period.id} value={period.id}>
                    {period.startDate} → {period.endDate}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="analytics-point">Punto de dispensación</label>
              <select
                id="analytics-point"
                className="control"
                value={dispensingPointId}
                onChange={(event) => setDispensingPointId(event.target.value)}
              >
                <option value="">Todos los puntos</option>
                {(points.data?.items ?? []).map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.code} · {point.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="analytics-code">Código comercial</label>
              <input
                id="analytics-code"
                className="control"
                value={commercialCode}
                onChange={(event) => setCommercialCode(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="analytics-from">Fecha desde</label>
              <input
                id="analytics-from"
                className="control"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="analytics-to">Fecha hasta</label>
              <input
                id="analytics-to"
                className="control"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {analytics.loading ? <p style={{ color: 'var(--muted)' }}>Cargando indicadores…</p> : null}
      {analytics.error ? (
        <div className="login-error" role="alert">
          {analytics.error}
        </div>
      ) : null}

      {data ? (
        <>
          <FreshnessBanner freshness={data.freshness} demand={data.demand} />
          <Card>
            <CardHead
              title="Funnel operacional"
              subtitle="Hechos independientes. Las etapas no se ocultan y no forman un pipeline monótono."
            />
            <CardBody>
              <KpiGrid>
                <FunnelKpi
                  label="Proyectado"
                  value={data.funnel.projectedQuantity}
                  foot={`Regular ${data.demand.regularProjectedQuantity} · Tardía ${data.demand.lateProjectedQuantity}`}
                  icon="PR"
                  onClick={() => setDrilldownKind('projected')}
                />
                <FunnelKpi
                  label={REQUESTED_QUANTITY_LABEL}
                  value={data.funnel.requestedQuantity}
                  foot="Excluye DRAFT"
                  icon="SO"
                  onClick={() => setDrilldownKind('ordered')}
                />
                <FunnelKpi
                  label="Aceptado OLP"
                  value={data.funnel.acceptedQuantity}
                  foot={`Aceptación ${rateLabel(data.procurement.supplierAcceptanceRate)}`}
                  icon="AC"
                  onClick={() => setDrilldownKind('accepted')}
                />
                <FunnelKpi
                  label="Despachado"
                  value={data.funnel.dispatchedQuantity}
                  foot={`Cumplimiento ${rateLabel(data.delivery.dispatchFulfillmentRate)}`}
                  icon="DE"
                  onClick={() => setDrilldownKind('dispatched')}
                />
                <FunnelKpi
                  label="Recibido físico"
                  value={data.funnel.physicallyReceivedQuantity}
                  foot="No es aceptado a inventario"
                  icon="RF"
                  onClick={() => setDrilldownKind('received')}
                />
                <FunnelKpi
                  label="Aceptado a inventario"
                  value={data.funnel.acceptedIntoInventoryQuantity}
                  foot={`Aceptación ${rateLabel(data.receipt.receiptAcceptanceRate)}`}
                  icon="AI"
                  onClick={() => setDrilldownKind('received')}
                />
                <FunnelKpi
                  label="Aplicado"
                  value={data.funnel.appliedQuantity}
                  foot={`Utilización ${rateLabel(data.application.applicationRate)}`}
                  icon="AP"
                  onClick={() => setDrilldownKind('applied')}
                />
              </KpiGrid>
            </CardBody>
          </Card>

          <div className="grid two-col">
            <Card>
              <CardHead
                title="Inventario actual"
                subtitle="Stock físico actual. No es sobrante del período."
              />
              <CardBody>
                <KpiGrid columns={3}>
                  <KpiCard
                    label="Stock físico actual"
                    value={data.inventory.currentOnHandQuantity}
                    foot="Saldo ledger, independiente del período"
                    icon="SF"
                    iconBg="#e8f1ff"
                    iconColor="#1d4f91"
                  />
                  <KpiCard
                    label="Stock utilizable actual"
                    value={data.inventory.usableBalance}
                    foot="Excluye vencidos"
                    icon="SU"
                    iconBg="#e9f7ef"
                    iconColor="#1e7a46"
                  />
                  <KpiCard
                    label="En tránsito"
                    value={data.inventory.inTransitQuantity}
                    foot="Traslados despachados no recibidos"
                    icon="TR"
                    iconBg="#fff4e5"
                    iconColor="#9a5b00"
                  />
                </KpiGrid>
                <p className="field-note">
                  Flujo del período ({data.inventory.receivedMinusAppliedFlow.disclaimer}):{' '}
                  {data.inventory.receivedMinusAppliedFlow.value}. No reutilizable:{' '}
                  {data.inventory.nonReusableQuantity}. Vencido:{' '}
                  {data.inventory.expiredPhysicalQuantity}. Por vencer (30 días):{' '}
                  {data.inventory.upcomingExpirationQuantity}.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardHead
                title="Faltantes separados"
                subtitle="No se colapsan en un único faltante."
              />
              <CardBody>
                <KpiGrid>
                  <KpiCard
                    label={PURCHASE_COVERAGE_LABEL}
                    value={data.procurement.effectivePurchaseCoverage}
                    foot={`${PURCHASE_COVERAGE_NOTE} Cobertura ${rateLabel(data.procurement.purchaseCoverageRate)}.`}
                    icon="CO"
                    iconBg="#e8f1ff"
                    iconColor="#1d4f91"
                  />
                  <KpiCard
                    label={REQUESTED_QUANTITY_LABEL}
                    value={data.procurement.requestedQuantity}
                    foot={REQUESTED_QUANTITY_NOTE}
                    icon="SO"
                    iconBg="#fff4e5"
                    iconColor="#9a5b00"
                  />
                </KpiGrid>
                <DataTable
                  columns={[{ label: 'Indicador' }, { label: 'Cantidad' }]}
                  rows={[
                    ['Brecha de compra vs proyección', data.procurement.procurementGapQuantity],
                    [
                      'Faltante proveedor (solicitado − aceptado)',
                      data.procurement.supplierShortageQuantity,
                    ],
                    ['Pendiente de despacho', data.delivery.deliveryPendingQuantity],
                    ['Faltante físico de recepción', data.receipt.receiptPhysicalShortageQuantity],
                    ['Rechazado en recepción', data.receipt.rejectedQuantity],
                  ]}
                  emptyIcon="SH"
                  emptyTitle="Sin faltantes"
                  emptyDescription="Los faltantes aparecen cuando hay hechos de compra, entrega o recepción."
                />
              </CardBody>
            </Card>
          </div>

          <div className="grid two-col">
            <Card>
              <CardHead
                title="Novedades de no aplicación"
                subtitle="Códigos de novedad, no estados."
              />
              <CardBody>
                <p className="field-note">
                  No show {data.outcomes.noShowCount} /{' '}
                  {data.outcomes.terminalOperationalResultCount} resultados operacionales terminales
                  ({rateLabel(data.outcomes.noShowRate)}).
                </p>
                <DataTable
                  columns={[
                    { label: 'Novedad' },
                    { label: 'Cantidad' },
                    { label: 'Participación' },
                  ]}
                  rows={data.outcomes.distribution.map((item) => [
                    NOVELTY_LABELS[item.noveltyCode],
                    item.count,
                    rateLabel(item.share),
                  ])}
                  emptyIcon="NV"
                  emptyTitle="Sin novedades"
                  emptyDescription="Los outcomes NOT_APPLIED aparecerán aquí."
                />
                <button
                  className="button"
                  type="button"
                  onClick={() => setDrilldownKind('not_applied')}
                >
                  Ver outcomes
                </button>
              </CardBody>
            </Card>
            <Card>
              <CardHead
                title="Auditoría de aplicaciones"
                subtitle="REJECTED de auditoría no es NOT_APPLIED."
              />
              <CardBody>
                <KpiGrid columns={4}>
                  <FunnelKpi
                    label="Lista para auditar"
                    value={data.audit.readyForAudit}
                    foot="CONFIRMADA sin auditoría"
                    icon="RA"
                    onClick={() => setDrilldownKind('audit')}
                  />
                  <KpiCard
                    label="En revisión"
                    value={data.audit.inReview}
                    foot="IN_REVIEW"
                    icon="IR"
                    iconBg="#fff4e5"
                    iconColor="#9a5b00"
                  />
                  <KpiCard
                    label="Aprobada"
                    value={data.audit.approved}
                    foot={`${data.audit.approvedApplicationsCount} aplicaciones`}
                    icon="OK"
                    iconBg="#e9f7ef"
                    iconColor="#1e7a46"
                  />
                  <KpiCard
                    label="Rechazada"
                    value={data.audit.rejected}
                    foot="No devuelve stock"
                    icon="RJ"
                    iconBg="#fdecec"
                    iconColor="#9b1c1c"
                  />
                </KpiGrid>
              </CardBody>
            </Card>
          </div>

          {canReadEconomics ? (
            <Card>
              <CardHead
                title="Referencias económicas"
                subtitle="Tarifa COMPENSAR y costo proveedor OLP se mantienen separados. No es utilidad contable."
              />
              <CardBody>
                {economics ? (
                  <div className="grid two-col">
                    <div>
                      <h3>COMPENSAR → MTD (tarifa)</h3>
                      <p className="field-note">{PROJECTED_TARIFF_NOTE}</p>
                      <DataTable
                        columns={[{ label: 'Métrica' }, { label: 'Valor' }]}
                        rows={[
                          [
                            'Tarifa proyectada de referencia',
                            moneyLabel(economics.compensar.projectedTariffReferenceValue),
                          ],
                          [
                            'Tarifa snapshot solicitada',
                            moneyLabel(economics.compensar.requestedTariffSnapshotValue),
                          ],
                          [
                            'Tarifa snapshot aceptada',
                            moneyLabel(economics.compensar.acceptedTariffSnapshotValue),
                          ],
                        ]}
                        emptyIcon="TA"
                        emptyTitle="Sin tarifa"
                        emptyDescription="Solo se muestra lineage exacto."
                      />
                    </div>
                    <div>
                      <h3>OLP → MTD (costo proveedor)</h3>
                      <DataTable
                        columns={[{ label: 'Métrica' }, { label: 'Valor' }]}
                        rows={[
                          [
                            'Valor proveedor solicitado',
                            moneyLabel(economics.olp.requestedSupplierValue),
                          ],
                          [
                            'Valor proveedor aceptado',
                            moneyLabel(economics.olp.acceptedSupplierValue),
                          ],
                          [
                            'Valor proveedor despachado',
                            moneyLabel(economics.olp.dispatchedSupplierValue),
                          ],
                          [
                            'Valor proveedor aceptado a inventario',
                            moneyLabel(economics.olp.acceptedReceiptSupplierValue),
                          ],
                          [
                            'Costo proveedor aplicado',
                            moneyLabel(economics.olp.appliedSupplierCost),
                          ],
                          [
                            'Diferencia tarifaria operacional estimada',
                            moneyLabel(economics.grossOperationalSpreadReference),
                          ],
                        ]}
                        emptyIcon="OL"
                        emptyTitle="Sin costo"
                        emptyDescription="Solo se muestra lineage exacto."
                      />
                    </div>
                  </div>
                ) : (
                  <p className="field-note">Sin permiso económico para este recorte.</p>
                )}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHead
              title="Lotes"
              subtitle="Vencidos y próximos a vencer según la regla de 30 días de ESP-008."
            />
            <CardBody>
              <DataTable
                columns={[
                  { label: 'Producto' },
                  { label: 'Punto' },
                  { label: 'Lote' },
                  { label: 'Vence' },
                  { label: 'Físico' },
                  { label: 'Utilizable' },
                  { label: 'Estado' },
                ]}
                rows={(inventory.data?.lots ?? []).map((lot) => [
                  lot.commercialCode,
                  lot.dispensingPointName,
                  lot.lotNumber,
                  lot.expirationDate,
                  lot.physicalBalance,
                  lot.usableBalance,
                  lot.expired ? 'Vencido' : lot.upcomingExpiration ? 'Por vencer' : 'Vigente',
                ])}
                emptyIcon="LT"
                emptyTitle="Sin lotes"
                emptyDescription="El ledger no tiene lotes en este recorte."
              />
            </CardBody>
          </Card>

          {drilldownKind ? (
            <Card>
              <CardHead
                title={`Detalle · ${drilldownKind}`}
                subtitle="Navegación a las entidades fuente del KPI."
                aside={
                  <button className="button" type="button" onClick={() => setDrilldownKind(null)}>
                    Cerrar
                  </button>
                }
              />
              <CardBody>
                <DataTable
                  columns={[
                    { label: 'Id' },
                    { label: 'Producto' },
                    { label: 'Cantidad' },
                    { label: 'Estado' },
                    { label: 'Referencia' },
                  ]}
                  rows={(drilldown.data?.items ?? []).map((item) => [
                    item.id,
                    item.commercialCode ?? '—',
                    item.quantity ?? '—',
                    item.status ?? '—',
                    item.reference ?? '—',
                  ])}
                  emptyIcon="DD"
                  emptyTitle="Sin filas"
                  emptyDescription="No hay entidades fuente para este recorte."
                />
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function FreshnessBanner({
  freshness,
  demand,
}: {
  freshness: OperationalAnalyticsResponse['freshness'];
  demand: OperationalAnalyticsResponse['demand'];
}) {
  return (
    <p className={demand.stale ? 'login-error' : 'field-note'} role="status">
      Consulta {freshness.generatedAt}. Última consolidación de demanda:{' '}
      {demand.lastConsolidatedAt ?? 'sin consolidar'}.
      {demand.stale
        ? ' La proyección materializada está desactualizada respecto de las programaciones vigentes. No es un dato en vivo.'
        : ' La proyección corresponde a la última consolidación materializada.'}
    </p>
  );
}

function FunnelKpi({
  label,
  value,
  foot,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  foot: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ all: 'unset', cursor: 'pointer', display: 'block' }}
    >
      <KpiCard
        label={label}
        value={value}
        foot={foot}
        icon={icon}
        iconBg="#eef2ff"
        iconColor="#3730a3"
      />
    </button>
  );
}
