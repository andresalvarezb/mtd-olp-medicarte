import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';

const COLUMNS = [
  { label: 'Fecha' },
  { label: 'Servicio' },
  { label: 'Job' },
  { label: 'Recurso' },
  { label: 'Error' },
  { label: 'Intentos' },
  { label: 'Próximo paso' },
  { label: 'Acciones' },
];

export function FallosRecuperablesView() {
  return (
    <>
      <PageHeader
        title="Fallos recuperables"
        description="Bandeja operativa para jobs que agotaron reintentos en MIPRES, Gmail, Drive u otros adaptadores."
        actions={<button className="btn">Reintentar seleccionados</button>}
      />
      <Card>
        <DataTable
          columns={COLUMNS}
          aria-label="Fallos recuperables"
          emptyIcon="!"
          emptyTitle="No hay fallos pendientes"
          emptyDescription="Los errores recuperables aparecerán aquí sin obligar al equipo operativo a revisar logs técnicos."
        />
      </Card>
    </>
  );
}
