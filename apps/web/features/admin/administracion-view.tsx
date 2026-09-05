'use client';

import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { getDriveUrl, updateDriveUrl } from '@/lib/drive-api';
import { UsersAdminSection } from './users-admin';
import { useState } from 'react';

const ROLE_ACTIONS = [
  [
    'MTD_ADMIN',
    'Usuarios, organizaciones, catálogos, integraciones, parámetros y operación completa.',
  ],
  [
    'MTD_OPERATOR',
    'Cargas, autorizaciones, direccionamientos MIPRES, exportaciones y auditoría operativa.',
  ],
  [
    'MTD_GENERAL',
    'Lectura y exportación de MIPRES, disponibles, puntos, logística, soportes y consolidado.',
  ],
  [
    'MTD_AUDITORIA',
    'Lectura de resumen y autorizaciones; inicia, revisa, rechaza y aprueba auditorías.',
  ],
  [
    'COMPENSAR_VIEWER',
    'Consulta de autorizaciones y consolidado únicamente si tiene el permiso explícito.',
  ],
  [
    'OLP_OPERATOR',
    'Consulta y descarga de su operación; reporta fechas de dispensación masivamente.',
  ],
  [
    'MEDICARTE_OPERATOR',
    'Consulta y descarga de su operación; actualiza lugar y fecha de aplicación.',
  ],
  [
    'READ_ONLY',
    'Lectura de la aplicación completa, sin escritura, Administración ni Anexo Tarifario.',
  ],
] as const;

const PERMISSION_GROUPS = [
  ['Consulta', 'authorizations.read, application_site.read, audit.read, consolidated.read'],
  [
    'Navegación',
    'view.dashboard, view.authorizations, view.imports, view.mipres, view.available, view.application, view.purchase_orders, view.logistics, view.supports, view.audit, view.consolidated, view.failures',
  ],
  [
    'Operación',
    'imports.create, imports.confirm, mipres.recheck, audit.start, audit.reject, audit.approve',
  ],
  ['Exportación', 'exports.create, operational_exports.create'],
  [
    'Actualizaciones masivas',
    'bulk_updates.dispensation_location, bulk_updates.dispensation_date, bulk_updates.application_date, bulk_updates.purchase_order',
  ],
  ['Administración', 'users.manage, tariff_annex.read/create/import/update/delete'],
] as const;

export function AdministracionView() {
  const { organizationId, hasPermission } = useRole();
  const drive = useApiData(() => getDriveUrl(organizationId), [organizationId]);
  const [driveUrl, setDriveUrl] = useState<string | null>(null);
  const [driveMessage, setDriveMessage] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [savingDrive, setSavingDrive] = useState(false);
  const canManageUsers = hasPermission('users.manage');

  const currentDriveUrl = driveUrl ?? drive.data?.url ?? '';
  const saveDriveUrl = async () => {
    setSavingDrive(true);
    setDriveMessage(null);
    setDriveError(null);
    try {
      const result = await updateDriveUrl(organizationId, currentDriveUrl.trim());
      setDriveUrl(result.url);
      setDriveMessage('Enlace de Google Drive guardado.');
    } catch (error) {
      setDriveError(error instanceof Error ? error.message : 'No fue posible guardar el enlace.');
    } finally {
      setSavingDrive(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Administración"
        description="Configuración de soportes y parámetros operativos del producto."
      />
      <div className="config-grid">
        <Card>
          <CardHead
            title="Google Drive corporativo"
            subtitle="Destino para nuevas cargas de soportes."
          />
          <CardBody>
            <div className="field">
              <label htmlFor="drive-url">Enlace de Google Drive / carpeta</label>
              <input
                id="drive-url"
                className="control"
                type="url"
                placeholder="https://drive.google.com/..."
                value={currentDriveUrl}
                disabled={!canManageUsers || drive.loading || savingDrive}
                onChange={(event) => setDriveUrl(event.target.value)}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              {canManageUsers ? (
                <button type="button" className="btn" disabled={savingDrive || !currentDriveUrl.trim()} onClick={() => void saveDriveUrl()}>
                  {savingDrive ? 'Guardando…' : 'Guardar enlace'}
                </button>
              ) : <Note>Solo un administrador puede modificar este enlace.</Note>}
              {driveMessage ? <p>{driveMessage}</p> : null}
              {driveError ? <div className="login-error" role="alert">{driveError}</div> : null}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHead
            title="Usuarios y acceso"
            subtitle="La autenticación es local y los permisos se asignan por organización y rol."
          />
          <CardBody>
            <Note>
              Solo un usuario con <strong>users.manage</strong>, otorgado a{' '}
              <strong>MTD_ADMIN</strong>, puede crear cuentas, cambiar asignaciones, restablecer
              contraseñas o desactivar usuarios.
            </Note>
            <p style={{ margin: '14px 0 0' }}>
              Las cuentas se crean administrativamente, usan contraseña local con hash Argon2id y
              toda modificación relevante queda registrada en auditoría.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHead
            title="Roles y acciones"
            subtitle="El alcance también depende de la organización asignada."
          />
          <CardBody>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rol</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_ACTIONS.map(([role, actions]) => (
                    <tr key={role}>
                      <td>
                        <strong>{role}</strong>
                      </td>
                      <td>{actions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHead
            title="Catálogo de permisos"
            subtitle="La API vuelve a validar cada operación."
          />
          <CardBody>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Permisos</th>
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_GROUPS.map(([group, permissions]) => (
                    <tr key={group}>
                      <td>
                        <strong>{group}</strong>
                      </td>
                      <td>
                        <code>{permissions}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12 }}>
              <Note>
                <strong>READ_ONLY</strong> recibe permisos de consulta y navegación, pero no recibe
                permisos de escritura ni acceso a <strong>/administracion</strong> o{' '}
                <strong>/anexo-tarifario</strong>.
              </Note>
            </div>
          </CardBody>
        </Card>
      </div>
      <UsersAdminSection
        organizationId={organizationId}
        enabled={hasPermission('users.manage')}
      />
    </>
  );
}
