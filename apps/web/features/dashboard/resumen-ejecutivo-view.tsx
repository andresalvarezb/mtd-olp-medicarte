import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Flow, type FlowStepData } from '@/components/ui/flow';
import { MetricMini, MetricList } from '@/components/ui/metric-mini';
import { EmptyState } from '@/components/ui/empty-state';
import { Timeline } from '@/components/ui/timeline';
import { RoleNote } from '@/components/layout/role-note';

const FLOW_STEPS: FlowStepData[] = [
  { title: 'Ingesta', description: 'Archivo CSV/XLSX, staging y validación.' },
  { title: 'PBS / NO PBS', description: 'Clasificación y estado de origen.' },
  { title: 'MIPRES', description: 'Solo NO PBS habilitado. Vigencia por fecha máxima.', highlight: true },
  { title: 'Listo para dispensar', description: 'Notifica a OLP y Medicarte.', logistics: true },
  { title: 'Punto de aplicación', description: 'Medicarte define dirección y se notifica a OLP.', logistics: true },
  { title: 'Aplicación & auditoría', description: 'Soportes → auditoría humana → DISPENSED.' },
];

export function ResumenEjecutivoView() {
  return (
    <>
      <PageHeader
        title="Resumen ejecutivo"
        description="Vista gerencial del proceso completo: ingreso de autorizaciones, clasificación PBS/NO PBS, direccionamiento, logística, aplicación, soportes y auditoría."
        actions={
          <>
            <button className="btn">Últimos 30 días ▾</button>
            <button className="btn primary">Exportar resumen</button>
          </>
        }
      />

      <RoleNote />

      <KpiGrid>
        <KpiCard label="Autorizaciones recibidas" value={0} foot="Sin registros cargados" icon="AU" iconBg="#eef4ff" iconColor="#2456c7" />
        <KpiCard label="Listas para dispensar" value={0} foot="PBS + NO PBS habilitados" icon="RD" iconBg="#eaf8f2" iconColor="#16835d" />
        <KpiCard label="Pendientes punto aplicación" value={0} foot="Pendientes de definición por Medicarte" icon="PA" iconBg="#fff4e5" iconColor="#b54708" />
        <KpiCard label="Auditorías aprobadas" value={0} foot="Dispensaciones confirmadas" icon="OK" iconBg="#f3f0ff" iconColor="#6941c6" />
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
          <CardHead title="Estado actual de la operación" subtitle="Distribución por etapa." aside={<button className="btn">Ver detalle</button>} />
          <CardBody>
            <MetricList>
              <MetricMini label="Pendiente direccionamiento" value={0} />
              <MetricMini label="Pendiente punto aplicación" value={0} />
              <MetricMini label="Dispensación reportada" value={0} />
              <MetricMini label="Pendiente auditoría" value={0} />
            </MetricList>
            <div style={{ marginTop: 14 }}>
              <EmptyState
                icon="—"
                title="Aún no hay actividad"
                description="Los indicadores se actualizarán cuando se cargue el primer lote de autorizaciones."
                minHeight={170}
              />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Eventos logísticos" subtitle="Notificaciones críticas del flujo." aside={<StatusBadge tone="green">Event-driven</StatusBadge>} />
          <CardBody>
            <Timeline
              items={[
                { title: 'READY_TO_DISPENSE', description: 'Se notifica inmediatamente a OLP y Medicarte.' },
                { title: 'APPLICATION_SITE_ASSIGNED', description: 'Medicarte define el punto de aplicación.' },
                { title: 'Notificación logística OLP', description: 'OLP recibe la dirección vigente para coordinar el envío.' },
                { title: 'Reporte diario 08:00', description: 'Resumen del día anterior; no reemplaza eventos operativos.' },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
