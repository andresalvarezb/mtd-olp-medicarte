import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Prescripción' },
  { label: 'Última consulta' },
  { label: 'Fecha máxima' },
  { label: 'Estado' },
  { label: 'Próximo intento' },
  { label: 'Acciones' },
];

export function MipresView() {
  return (
    <>
      <PageHeader
        title="Direccionamientos MIPRES"
        description="Solo se consulta para registros NO PBS habilitados. Un direccionamiento es vigente cuando la fecha actual es inferior a la fecha máxima."
        actions={<button className="btn">Revalidar pendientes</button>}
      />
      <KpiGrid>
        <KpiCard label="Pendientes" value={0} foot="Esperando direccionamiento" icon="P" iconBg="#fff4e5" iconColor="#b54708" />
        <KpiCard label="Confirmados" value={0} foot="Fecha máxima vigente" icon="C" iconBg="#eaf8f2" iconColor="#16835d" />
        <KpiCard label="Errores consulta" value={0} foot="Separados de “sin direccionamiento”" icon="E" iconBg="#fff0ee" iconColor="#b42318" />
        <KpiCard label="Reintentos" value={0} foot="Jobs recuperables" icon="R" iconBg="#f3f0ff" iconColor="#6941c6" />
      </KpiGrid>
      <Card>
        <Tabs tabs={['Pendientes', 'Confirmados', 'Errores de consulta']}>
          <DataTable
            columns={COLUMNS}
            aria-label="Direccionamientos MIPRES"
            emptyIcon="MI"
            emptyTitle="No hay direccionamientos pendientes"
            emptyDescription="Los registros NO PBS que requieran validación aparecerán automáticamente en esta bandeja."
          />
        </Tabs>
      </Card>
    </>
  );
}
