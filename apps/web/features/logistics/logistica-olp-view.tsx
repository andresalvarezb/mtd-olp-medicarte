import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Estado punto' },
  { label: 'Sede' },
  { label: 'Dirección aplicación' },
  { label: 'Versión' },
  { label: 'Recibida' },
  { label: 'Acciones' },
];

export function LogisticaOlpView() {
  return (
    <>
      <PageHeader
        title="Logística OLP"
        description="Bandeja para coordinar el envío del medicamento una vez Medicarte haya definido el punto de aplicación."
        actions={<button className="btn">Exportar pendientes</button>}
      />
      <KpiGrid columns={3}>
        <KpiCard label="Esperando dirección" value={0} foot="Listos, aún sin ubicación" icon="ED" iconBg="#fff4e5" iconColor="#b54708" />
        <KpiCard label="Dirección recibida" value={0} foot="Pendientes de coordinar envío" icon="DR" iconBg="#eef4ff" iconColor="#2456c7" />
        <KpiCard label="Actualizaciones de dirección" value={0} foot="Cambios informados por Medicarte" icon="AD" iconBg="#f3f0ff" iconColor="#6941c6" />
      </KpiGrid>
      <Card>
        <FilterBar>
          <FilterField label="Estado logístico">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
              <option>Esperando dirección</option>
              <option>Dirección recibida</option>
            </select>
          </FilterField>
          <FilterField label="Departamento">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
            </select>
          </FilterField>
          <FilterField label="Municipio">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
            </select>
          </FilterField>
          <FilterField label="Buscar">
            <input className="control" placeholder="Autorización o paciente" />
          </FilterField>
        </FilterBar>
        <DataTable
          columns={COLUMNS}
          aria-label="Logística OLP"
          emptyIcon="OL"
          emptyTitle="No hay envíos por coordinar"
          emptyDescription="Cuando Medicarte asigne una dirección, OLP recibirá la notificación y el registro aparecerá en esta bandeja."
        />
      </Card>
    </>
  );
}
