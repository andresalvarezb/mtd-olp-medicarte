import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Paciente' },
  { label: 'Punto aplicación' },
  { label: 'Fórmula' },
  { label: 'Soporte aplicación' },
  { label: 'Estado' },
  { label: 'Última carga' },
  { label: 'Versión' },
  { label: 'Acciones' },
];

export function SoportesView() {
  return (
    <>
      <PageHeader
        title="Soportes de aplicación"
        description="Fórmula y soporte de aplicación en Drive corporativo. La carga registra la dispensación reportada y conserva versiones."
        actions={<button className="btn primary">Cargar soporte</button>}
      />
      <Card>
        <Tabs tabs={['Pendientes', 'Completos', 'Corrección requerida', 'Historial']}>
          <DataTable
            columns={COLUMNS}
            aria-label="Soportes de aplicación"
            emptyIcon="PDF"
            emptyTitle="No hay soportes pendientes"
            emptyDescription="Los registros aplicados aparecerán aquí para cargar o corregir documentos. Cada archivo puede pesar hasta 20 MB."
          />
        </Tabs>
      </Card>
    </>
  );
}
