import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { Flow, type FlowStepData } from '@/components/ui/flow';

const TARGET_FLOW: FlowStepData[] = [
  { title: 'Autorización', description: 'Unidad clínica y contractual.' },
  { title: 'Programación', description: 'Fecha, período, cantidad y punto físico.' },
  { title: 'Demanda', description: 'Consolidación por período, punto y código.' },
  { title: 'Abastecimiento', description: 'OC, entrega y recepción independientes.' },
  { title: 'Inventario', description: 'Saldo derivado de movimientos por lote.' },
  { title: 'Aplicación', description: 'Consumo que vincula inventario y paciente.' },
];

export function ResumenEjecutivoView() {
  return (
    <>
      <PageHeader
        title="Base de reconstrucción"
        description="La implementación operacional anterior fue retirada. refactor.md es la única especificación funcional vigente."
      />
      <Card>
        <CardHead
          title="Flujo objetivo"
          subtitle="El paciente genera la necesidad, pero no es dueño del inventario."
        />
        <CardBody>
          <Flow steps={TARGET_FLOW} />
        </CardBody>
      </Card>
      <div className="grid two-col" style={{ marginTop: 16 }}>
        <Card>
          <CardHead title="Conservado" subtitle="Fundamentos reutilizables." />
          <CardBody>
            <p>
              PostgreSQL, migraciones históricas, autenticación, RBAC, auditoría técnica, outbox,
              BullMQ e idempotencia.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Siguiente fase" subtitle="Orden obligatorio de implementación." />
          <CardBody>
            <p>
              Dominio, períodos, segregación por organización y trazabilidad técnica antes de crear
              inventario.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
