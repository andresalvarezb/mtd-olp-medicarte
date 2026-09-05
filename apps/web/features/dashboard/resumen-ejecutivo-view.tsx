'use client';

import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Flow, type FlowStepData } from '@/components/ui/flow';
import { MetricMini, MetricList } from '@/components/ui/metric-mini';
import { EmptyState } from '@/components/ui/empty-state';
import { Timeline } from '@/components/ui/timeline';
import { RoleNote } from '@/components/layout/role-note';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { getIndicators } from '@/lib/authorization-items-api';

const FLOW_STEPS: FlowStepData[] = [
  { title: 'Ingesta', description: 'Archivo XLSX, staging y validación.' },
  { title: 'PBS / NO PBS', description: 'Clasificación y estado de origen.' },
  {
    title: 'MIPRES',
    description: 'Solo NO PBS habilitado. Vigencia por fecha máxima.',
    highlight: true,
  },
  { title: 'Listo para dispensar', description: 'Notifica a OLP y Medicarte.', logistics: true },
  {
    title: 'Punto de aplicación',
    description: 'Medicarte define dirección y se notifica a OLP.',
    logistics: true,
  },
  { title: 'Aplicación & auditoría', description: 'Soportes → auditoría humana → DISPENSED.' },
];

export function ResumenEjecutivoView() {
  const { organizationId } = useRole();
  const {
    data: indicators,
    error,
    loading,
  } = useApiData(() => getIndicators(organizationId), [organizationId]);

  const received = indicators
    ? Object.values(indicators.byOperationStatus).reduce((total, value) => total + value, 0)
    : 0;
  const hasActivity = received > 0;

  return (
    <>
      <PageHeader
        title="Resumen ejecutivo"
        description="Vista gerencial del proceso completo: ingreso de autorizaciones, clasificación PBS/NO PBS, direccionamiento, logística, aplicación, soportes y auditoría."
        actions={<span className="pill green">Datos en vivo</span>}
      />

      <RoleNote />

      {error ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}

      <KpiGrid>
        <KpiCard
          label="Autorizaciones recibidas"
          value={loading ? '…' : received}
          foot={hasActivity ? 'Total en tu organización' : 'Sin registros cargados'}
          icon="AU"
          iconBg="#eef4ff"
          iconColor="#2456c7"
        />
        <KpiCard
          label="Listas para dispensar"
          value={loading ? '…' : (indicators?.byOperationStatus.READY_TO_DISPENSE ?? 0)}
          foot="PBS + NO PBS habilitados"
          icon="RD"
          iconBg="#eaf8f2"
          iconColor="#16835d"
        />
        <KpiCard
          label="Pendientes punto aplicación"
          value={loading ? '…' : (indicators?.pendingDispensationLocation ?? 0)}
          foot="Pendientes de definición por Medicarte"
          icon="PA"
          iconBg="#fff4e5"
          iconColor="#b54708"
        />
        <KpiCard
          label="Auditorías aprobadas"
          value={loading ? '…' : (indicators?.byAuditStatus.APPROVED ?? 0)}
          foot="Dispensaciones confirmadas"
          icon="OK"
          iconBg="#f3f0ff"
          iconColor="#6941c6"
        />
      </KpiGrid>

      <Card>
        <CardHead
          title="Flujo operacional del medicamento"
          subtitle="La dirección de aplicación es una etapa logística independiente y auditable."
          aside={<StatusBadge tone="blue">Flujo aprobado</StatusBadge>}
        />
        <CardBody>
          <Flow steps={FLOW_STEPS} />
        </CardBody>
      </Card>

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <Card>
          <CardHead
            title="Estado actual de la operación"
            subtitle="Indicadores derivados de la base (GET /indicators)."
          />
          <CardBody>
            <MetricList>
              <MetricMini
                label="Pendiente lugar de dispensación"
                value={indicators?.pendingDispensationLocation ?? 0}
              />
              <MetricMini
                label="Pendiente fecha de dispensación"
                value={indicators?.pendingDispensationDate ?? 0}
              />
              <MetricMini
                label="Pendiente fecha de aplicación"
                value={indicators?.pendingApplicationDate ?? 0}
              />
              <MetricMini
                label="Listas para revisión de auditoría"
                value={indicators?.readyForReview ?? 0}
              />
              <MetricMini
                label="Aprobadas para admisión"
                value={indicators?.approvedForAdmission ?? 0}
              />
            </MetricList>
            {!loading && !hasActivity ? (
              <div style={{ marginTop: 14 }}>
                <EmptyState
                  icon="—"
                  title="Aún no hay actividad"
                  description="Los indicadores se actualizarán cuando se cargue el primer lote de autorizaciones."
                  minHeight={170}
                />
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHead
            title="Eventos logísticos"
            subtitle="Notificaciones críticas del flujo."
            aside={<StatusBadge tone="green">Event-driven</StatusBadge>}
          />
          <CardBody>
            <Timeline
              items={[
                {
                  title: 'Lista para dispensación',
                  description: 'Se notifica inmediatamente a OLP y Medicarte.',
                },
                {
                  title: 'Punto de aplicación asignado',
                  description: 'Medicarte define el punto de aplicación.',
                },
                {
                  title: 'Notificación logística OLP',
                  description: 'OLP recibe la dirección vigente para coordinar el envío.',
                },
                {
                  title: 'Reporte diario 08:00',
                  description: 'Resumen del día anterior; no reemplaza eventos operativos.',
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
