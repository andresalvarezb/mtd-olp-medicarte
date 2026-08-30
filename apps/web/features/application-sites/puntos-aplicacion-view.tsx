import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Municipio paciente' },
  { label: 'Punto / sede' },
  { label: 'Dirección' },
  { label: 'Versión' },
  { label: 'Última actualización' },
  { label: 'Acciones' },
];

export function PuntosAplicacionView() {
  return (
    <>
      <PageHeader
        title="Puntos de aplicación"
        description="Medicarte define la sede o dirección donde realizará la aplicación. Cada cambio genera una nueva versión y notifica a OLP."
        actions={<button className="btn primary">Asignar punto</button>}
      />
      <KpiGrid>
        <KpiCard label="Pendientes de asignar" value={0} foot="Requieren acción de Medicarte" icon="PA" iconBg="#fff4e5" iconColor="#b54708" />
        <KpiCard label="Asignados hoy" value={0} foot="Direcciones confirmadas" icon="AS" iconBg="#eaf8f2" iconColor="#16835d" />
        <KpiCard label="Modificados" value={0} foot="Nuevas versiones generadas" icon="MV" iconBg="#eef4ff" iconColor="#2456c7" />
        <KpiCard label="Notificaciones a OLP" value={0} foot="Por asignación/modificación" icon="OL" iconBg="#f3f0ff" iconColor="#6941c6" />
      </KpiGrid>
      <Card>
        <Tabs tabs={['Pendientes', 'Asignados', 'Historial de cambios']}>
          <DataTable
            columns={COLUMNS}
            aria-label="Puntos de aplicación"
            emptyIcon="PA"
            emptyTitle="No hay puntos pendientes"
            emptyDescription="Los registros READY_TO_DISPENSE aparecerán aquí para que Medicarte defina la ubicación de aplicación."
          />
        </Tabs>
      </Card>
    </>
  );
}
