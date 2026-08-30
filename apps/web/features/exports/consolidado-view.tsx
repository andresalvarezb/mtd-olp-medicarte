import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField, FilterActions } from '@/components/ui/filter-bar';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Cobertura' },
  { label: 'Punto aplicación' },
  { label: 'Fecha aplicación' },
  { label: 'Auditoría' },
  { label: 'Fecha aprobación' },
];

export function ConsolidadoView() {
  return (
    <>
      <PageHeader
        title="Consolidado"
        description="Consulta y exportación bajo demanda. El archivo generado se entrega al usuario y no queda almacenado como copia permanente."
        actions={
          <>
            <button className="btn">Exportar CSV</button>
            <button className="btn primary">Exportar Excel</button>
          </>
        }
      />
      <Card>
        <FilterBar>
          <FilterField label="Fecha desde">
            <input className="control" type="date" />
          </FilterField>
          <FilterField label="Fecha hasta">
            <input className="control" type="date" />
          </FilterField>
          <FilterField label="Estado auditoría">
            <select className="control" defaultValue="Aprobados">
              <option>Aprobados</option>
              <option>Todos permitidos</option>
            </select>
          </FilterField>
          <FilterField label="Organización">
            <select className="control" defaultValue="Según mi alcance">
              <option>Según mi alcance</option>
            </select>
          </FilterField>
          <FilterActions>
            <button className="btn soft">Aplicar filtros</button>
          </FilterActions>
        </FilterBar>
        <DataTable
          columns={COLUMNS}
          aria-label="Consolidado"
          emptyIcon="CSV"
          emptyTitle="No hay registros para consolidar"
          emptyDescription="El consolidado definitivo incluirá únicamente registros aprobados dentro del alcance del usuario."
        />
      </Card>
    </>
  );
}
