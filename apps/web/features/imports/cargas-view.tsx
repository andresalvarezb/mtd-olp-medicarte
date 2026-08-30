import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Timeline, Note } from '@/components/ui/timeline';

const HISTORY_COLUMNS = [
  { label: 'Lote' },
  { label: 'Archivo' },
  { label: 'Fecha' },
  { label: 'Usuario' },
  { label: 'Filas' },
  { label: 'Aceptadas' },
  { label: 'Rechazadas' },
  { label: 'Estado' },
  { label: 'Acciones' },
];

export function CargasView() {
  return (
    <>
      <PageHeader
        title="Carga de autorizaciones"
        description="Los archivos pasan por staging, validación por fila y confirmación antes de afectar el proceso."
        actions={<button className="btn">Descargar plantilla</button>}
      />
      <div className="grid two-col">
        <Card>
          <CardHead title="Nueva carga" subtitle="CSV o Excel. Máximo 20 MB por archivo." />
          <CardBody>
            <div className="upload-box">
              <div className="upload-icon">↑</div>
              <h4>Arrastra el archivo aquí</h4>
              <p>o selecciónalo desde tu equipo. El archivo no se aplicará directamente a producción.</p>
              <button className="btn primary">Seleccionar archivo</button>
            </div>
            <div style={{ marginTop: 14 }}>
              <Note>
                Las llaves ya existentes se reportan para revisión humana. Solo pueden actualizarse si están en{' '}
                <strong>READY_TO_DISPENSE</strong> y no han avanzado a dispensación reportada.
              </Note>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Validaciones principales" subtitle="Controles previos a la confirmación." />
          <CardBody>
            <Timeline
              items={[
                {
                  title: 'Formato y campos obligatorios',
                  description: 'Incluye NUMERO_AUTORIZACION, COD_COMERCIAL y campos de negocio requeridos.',
                },
                { title: 'Duplicados', description: 'Dentro del archivo y contra la base de datos.' },
                { title: 'Clasificación', description: 'CUPS_PRINCIPAL determina PBS / NO PBS.' },
                { title: 'Confirmación', description: 'Resultado por fila y causal estable.' },
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <div style={{ marginTop: 16 }}>
        <Card>
          <CardHead title="Historial de cargas" subtitle="Lotes recibidos y su resultado." />
          <DataTable
            columns={HISTORY_COLUMNS}
            aria-label="Historial de cargas"
            emptyIcon="↑"
            emptyTitle="No se han realizado cargas"
            emptyDescription="Los lotes procesados aparecerán aquí con sus totales y el reporte de resultados."
          />
        </Card>
      </div>
    </>
  );
}
