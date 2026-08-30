import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField, FilterActions } from '@/components/ui/filter-bar';
import { RoleActionButton } from '@/components/ui/role-action-button';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'COD_COMERCIAL' },
  { label: 'Cobertura' },
  { label: 'Direccionamiento' },
  { label: 'Punto aplicación' },
  { label: 'Operación' },
  { label: 'Auditoría' },
  { label: 'Acciones' },
];

export function AutorizacionesView() {
  return (
    <>
      <PageHeader
        title="Autorizaciones"
        description="Bandeja maestra de ítems de autorización. La llave es número de autorización + COD_COMERCIAL."
        actions={
          <>
            <button className="btn">Exportar</button>
            <RoleActionButton allowedRole="MTD">
              <Link href="/cargas" className="btn primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
                Cargar autorizaciones
              </Link>
            </RoleActionButton>
          </>
        }
      />
      <Card>
        <FilterBar>
          <FilterField label="Buscar">
            <input className="control" placeholder="Autorización, paciente o medicamento" />
          </FilterField>
          <FilterField label="Cobertura">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
              <option>PBS</option>
              <option>NO PBS</option>
            </select>
          </FilterField>
          <FilterField label="Estado proceso">
            <select className="control" defaultValue="Todos">
              <option>Todos</option>
              <option>Listo para dispensar</option>
              <option>Pendiente punto aplicación</option>
              <option>Pendiente auditoría</option>
            </select>
          </FilterField>
          <FilterField label="Organización">
            <select className="control" defaultValue="Todas">
              <option>Todas</option>
              <option>MTD</option>
              <option>OLP</option>
              <option>Medicarte</option>
            </select>
          </FilterField>
          <FilterActions>
            <button className="btn soft">Filtrar</button>
          </FilterActions>
        </FilterBar>
        <DataTable
          columns={COLUMNS}
          aria-label="Bandeja de autorizaciones"
          emptyIcon="AU"
          emptyTitle="No hay autorizaciones para mostrar"
          emptyDescription="Cuando se confirme una carga válida, cada medicamento aparecerá como un ítem independiente en esta bandeja."
        />
      </Card>
    </>
  );
}
