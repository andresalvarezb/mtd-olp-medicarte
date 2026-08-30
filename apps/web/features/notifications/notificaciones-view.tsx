import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';

const COLUMNS = [
  { label: 'Fecha' },
  { label: 'Evento' },
  { label: 'Entidad' },
  { label: 'Destinatarios' },
  { label: 'Autorización' },
  { label: 'Plantilla' },
  { label: 'Estado' },
  { label: 'Intentos' },
  { label: 'Acciones' },
];

export function NotificacionesView() {
  return (
    <>
      <PageHeader
        title="Notificaciones"
        description="Monitoreo de correos operativos event-driven y reporte diario consolidado."
        actions={<button className="btn">Reintentar fallidos</button>}
      />
      <KpiGrid columns={3}>
        <KpiCard label="Operativas enviadas" value={0} foot="READY + punto aplicación" icon="EV" iconBg="#eaf8f2" iconColor="#16835d" />
        <KpiCard label="Reportes diarios" value={0} foot="Ejecución 08:00" icon="08" iconBg="#eef4ff" iconColor="#2456c7" />
        <KpiCard label="Fallidas" value={0} foot="Reintentables" icon="!" iconBg="#fff0ee" iconColor="#b42318" />
      </KpiGrid>
      <Card>
        <Tabs tabs={['Todas', 'OLP', 'Medicarte', 'EPS', 'Reporte 08:00']}>
          <DataTable
            columns={COLUMNS}
            aria-label="Notificaciones"
            emptyIcon="@"
            emptyTitle="No se han generado notificaciones"
            emptyDescription="Los envíos y reintentos quedarán trazados con su Gmail message ID e idempotency key."
          />
        </Tabs>
      </Card>
    </>
  );
}
