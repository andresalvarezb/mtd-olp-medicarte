import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'PBS / NO PBS' },
  { label: 'Listo desde' },
  { label: 'Notificación OLP' },
  { label: 'Notificación Medicarte' },
  { label: 'Punto aplicación' },
  { label: 'Acciones' },
];

export function ListosParaDispensarView() {
  return (
    <>
      <PageHeader
        title="Listos para dispensar"
        description="Registros que ya superaron las reglas previas. Al entrar aquí se notifica de forma operativa a OLP y Medicarte."
        actions={<button className="btn">Exportar vista</button>}
      />
      <Card>
        <FilterBar>
          <FilterField label="Buscar">
            <input className="control" placeholder="Autorización, paciente, medicamento" />
          </FilterField>
          <FilterField label="Cobertura">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
              <option>PBS</option>
              <option>NO PBS</option>
            </select>
          </FilterField>
          <FilterField label="Punto de aplicación">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
              <option>Pendiente</option>
              <option>Asignado</option>
            </select>
          </FilterField>
          <FilterField label="Notificación">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
              <option>OLP enviado</option>
              <option>Medicarte enviado</option>
              <option>Fallido</option>
            </select>
          </FilterField>
        </FilterBar>
        <DataTable
          columns={COLUMNS}
          aria-label="Registros listos para dispensar"
          emptyIcon="RD"
          emptyTitle="No hay registros listos para dispensar"
          emptyDescription="Cuando un registro alcance READY_TO_DISPENSE aparecerá aquí y se generarán las notificaciones operativas correspondientes."
        />
      </Card>
    </>
  );
}
