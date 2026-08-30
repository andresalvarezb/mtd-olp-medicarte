import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'Aplicado por' },
  { label: 'Punto aplicación' },
  { label: 'Fórmula' },
  { label: 'Soporte' },
  { label: 'Fecha aplicación' },
  { label: 'Auditor' },
  { label: 'Acciones' },
];

export function AuditoriaView() {
  return (
    <>
      <PageHeader
        title="Auditoría de soportes"
        description="Revisión exclusivamente humana y visual. La aprobación explícita confirma la dispensación y habilita el consolidado."
        actions={<button className="btn">Mis auditorías</button>}
      />
      <KpiGrid>
        <KpiCard label="Listos para auditar" value={0} foot="Soportes completos" icon="LA" iconBg="#eef4ff" iconColor="#2456c7" />
        <KpiCard label="En revisión" value={0} foot="Auditoría iniciada" icon="ER" iconBg="#fff4e5" iconColor="#b54708" />
        <KpiCard label="Rechazados" value={0} foot="Requieren corrección" icon="RJ" iconBg="#fff0ee" iconColor="#b42318" />
        <KpiCard label="Aprobados" value={0} foot="DISPENSED" icon="AP" iconBg="#eaf8f2" iconColor="#16835d" />
      </KpiGrid>
      <Card>
        <Tabs tabs={['Por revisar', 'En revisión', 'Rechazados', 'Aprobados']}>
          <DataTable
            columns={COLUMNS}
            aria-label="Auditoría de soportes"
            emptyIcon="✓"
            emptyTitle="No hay registros para auditar"
            emptyDescription="Cuando Medicarte complete los soportes, los registros quedarán disponibles para revisión humana."
          />
        </Tabs>
      </Card>
    </>
  );
}
