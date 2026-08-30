import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';

export function AdministracionView() {
  return (
    <>
      <PageHeader
        title="Administración"
        description="Configuración operativa del producto. Los cambios sensibles quedan auditados."
        actions={<button className="btn primary">Guardar cambios</button>}
      />
      <div className="config-grid">
        <Card>
          <CardHead title="Destinatarios de notificaciones" subtitle="Agregar o retirar correos sin cambiar código." />
          <CardBody>
            <div className="config-block">
              <h4>OLP — Disponibilidad</h4>
              <p>AUTHORIZATION_READY_TO_DISPENSE</p>
              <input className="control" placeholder="correo1@empresa.com, correo2@empresa.com" />
            </div>
            <div className="config-block" style={{ marginTop: 10 }}>
              <h4>OLP — Punto de aplicación</h4>
              <p>APPLICATION_SITE_ASSIGNED / CHANGED</p>
              <input className="control" placeholder="logistica@empresa.com" />
            </div>
            <div className="config-block" style={{ marginTop: 10 }}>
              <h4>Medicarte — Disponibilidad</h4>
              <p>Registros que requieren definición del punto de aplicación.</p>
              <input className="control" placeholder="operacion@medicarte.com" />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Google Drive corporativo" subtitle="Destino para nuevas cargas de soportes." />
          <CardBody>
            <div className="field">
              <label>ID del Drive / carpeta</label>
              <input className="control" placeholder="1AbC..." />
            </div>
            <div style={{ marginTop: 12 }}>
              <Note>
                Cambiar este ID solo afecta nuevas cargas. Las referencias históricas conservan el identificador del
                destino usado originalmente.
              </Note>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Reporte diario" subtitle="Resumen del día anterior." />
          <CardBody>
            <div className="split-status">
              <div className="status-box">
                <h4>Hora de ejecución</h4>
                <p>
                  <strong style={{ fontSize: 18, color: '#172033' }}>08:00</strong>
                  <br />
                  America/Bogota
                </p>
              </div>
              <div className="status-box">
                <h4>Ventana</h4>
                <p>Día calendario inmediatamente anterior.</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Integraciones" subtitle="Estado esperado de servicios externos." />
          <CardBody>
            <div className="split-status">
              <div className="status-box">
                <h4>MIPRES</h4>
                <p>
                  <StatusBadge tone="gray">Sin configurar</StatusBadge>
                </p>
              </div>
              <div className="status-box">
                <h4>Google Workspace</h4>
                <p>
                  <StatusBadge tone="gray">Sin configurar</StatusBadge>
                </p>
              </div>
            </div>
            <div className="split-status" style={{ marginTop: 10 }}>
              <div className="status-box">
                <h4>PostgreSQL</h4>
                <p>
                  <StatusBadge tone="gray">Prototipo</StatusBadge>
                </p>
              </div>
              <div className="status-box">
                <h4>Redis / BullMQ</h4>
                <p>
                  <StatusBadge tone="gray">Prototipo</StatusBadge>
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
