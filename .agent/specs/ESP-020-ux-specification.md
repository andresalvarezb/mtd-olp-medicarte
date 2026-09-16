# ESP-020 — UX Specification

Estado: **DISEÑO IMPLEMENTABLE / D01–D10 APPROVED / NO IMPLEMENTADO**

Decisiones de producto aprobadas el 2026-09-15. Esta especificación describe el
target; no autoriza todavía cambios de frontend, backend ni contratos.

La UI administra conceptos de usuario, rol, módulo, acción y scope por separado.
No muestra permission codes como modelo principal y no sustituye los checks
backend.

## 1. Navegación target

La administración se separa en rutas:

```text
/administracion/usuarios
/administracion/usuarios/nuevo
/administracion/usuarios/:id
/administracion/roles
/administracion/roles/:roleCode/acceso
```

Los paths exactos pueden conservar el router existente si los redirects son
compatibles. Actualmente solo existe `/administracion`; la división es target,
no una ruta ya implementada.

## 2. Selector de organización activa

Como `/me` devuelve varias organizaciones y el frontend hoy elige una
automáticamente, la UI target debe mostrar un selector cuando haya más de una:

- nombre y código de organización;
- indicador visible de contexto activo;
- persistencia de la selección en `sessionStorage`, nunca como autoridad;
- todas las requests envían `X-Organization-Id`;
- cambiar organización invalida/refresca el read model de navegación;
- si la organización ya no está disponible, seleccionar la primera válida;
- nunca permitir escoger una organización que no esté en `/me`.

**APPROVED — D04=A:** se aceptan usuarios multi-organización. El selector
explícito es obligatorio cuando haya más de una organización; no se mueve la
organización a la URL y la autoridad sigue siendo backend.

## 3. Usuarios — listado

Ruta: `/administracion/usuarios`.

### Header

```text
Usuarios
Administra las personas que pueden acceder a la plataforma.
```

Acción primaria: `Nuevo usuario`.

### Resumen superior

Cards opcionales:

- Usuarios activos.
- Usuarios inactivos.
- Roles asignados.

Los contadores se calculan desde la API; no desde el total filtrado de una tabla
parcial sin que la respuesta lo declare.

### Tabla

Columnas:

| Columna | Contenido |
|---|---|
| Usuario | display name, username y email si existe |
| Organización | contexto/asignaciones visibles |
| Rol | labels de rol, nunca códigos técnicos como primer nivel |
| Estado | Activo/Inactivo |
| Último acceso | fecha/hora o “Nunca” |
| Acciones | Ver/Editar y menú contextual |

No mostrar passwordConfigured como columna principal. Puede ser una señal de
seguridad en el detalle.

## Decisiones UX aprobadas

- **D01:** mostrar `MTD_ADMIN` como “Administrador”; no mostrar
  `SYSTEM_ADMIN`, `isSystemAdmin` ni códigos técnicos como modelo de negocio.
- **D02:** la UI ofrece únicamente roles predefinidos y solo capabilities
  configurables expresamente permitidas.
- **D03:** la compatibilidad organización–rol es una frontera estructural; la UI
  no ofrece un editor de esa matriz.
- **D05:** permissions `LEGACY`, `ORPHAN` y `RETIRED` no aparecen en la UX
  normal del administrador salvo una vista técnica explícita de diagnóstico.
- **D06:** provenance es metadata informativa; nunca se presenta como fuente de
  autorización.
- **D07:** point scopes se gestionan solo donde el modelo actual los admite.
- **D08:** los mensajes de éxito solo se muestran después de confirmar cambio y
  audit event.
- **D09/D10:** reset productivo no se ofrece en esta UI y clean install/existing
  DB siguen los caminos operativos aprobados.

### Filtros

- búsqueda por nombre/username/email;
- estado activo/inactivo;
- organización activa;
- rol;
- paginación server-side si el volumen lo requiere.

### Estados

- loading: skeleton de tabla;
- empty sin usuarios: explicar que las cuentas se crean desde `Nuevo usuario`;
- empty filtrado: “No hay usuarios que coincidan” + limpiar filtros;
- error 403: estado de acceso denegado;
- error de red: retry sin perder filtros.

## 4. Crear usuario

Ruta recomendada: página o drawer ancho, no modal pequeño; el formulario actual
contiene demasiados controles para un modal.

### Paso 1 — Información

- Nombre completo, obligatorio.
- Username, obligatorio, normalizado por backend.
- Email opcional.
- Password inicial o mecanismo seguro aprobado.

La password nunca se almacena ni se muestra en audit. Si se genera una password,
se muestra una vez con advertencia de canal seguro y `mustChangePassword=true`.

### Paso 2 — Rol

- Seleccionar organización válida.
- Mostrar solo roles compatibles con esa organización.
- Mostrar descripción del rol y módulos principales.
- El rol `Administrador` muestra advertencia de privilegio elevado.
- No permitir `MTD_ADMIN` fuera de la organización MTD.

### Paso 3 — Scope

Solo aparece si el rol/organización requiere scope explícito:

- Medicarte + `MEDICARTE_OPERATOR`: selector de puntos;
- MTD/global: mostrar “Acceso global; no requiere seleccionar puntos”;
- OLP/Compensar: mostrar “El acceso se limita por organización; no aplica scope
  de puntos”.

No presentar scopes como acciones de módulo.

### Confirmación

Resumen antes de guardar:

```text
Usuario
Organización
Rol
Scope
```

El submit debe ser una operación backend transaccional que crea user,
assignment, scope inicial y audit cuando corresponda.

## 5. User detail/edit

Ruta: `/administracion/usuarios/:id`.

Secciones:

1. Información básica.
2. Organizaciones y roles.
3. Acceso a puntos, si aplica.
4. Estado y seguridad.
5. Historial de auditoría relevante.

Acciones disponibles según backend:

- editar display name/email;
- activar/desactivar;
- cambiar rol;
- añadir/revocar una asignación concreta;
- gestionar scope;
- restablecer password si existe flujo administrativo aprobado.

### Último administrador

Si el target es el último administrador activo:

- desactivar: botón disabled o confirmación que termina en error de dominio;
- retirar rol: bloquear acción;
- quitarse acceso propio: bloquear;
- mostrar mensaje:

```text
Este administrador es el último acceso administrativo activo.
Asigna otro administrador antes de retirar este acceso.
```

El frontend mejora la comprensión, pero el backend debe rechazar igualmente.

### Administrator card

Para el rol `Administrador`:

```text
Administrador
Acceso completo al sistema
Rol protegido del sistema
```

No mostrar checkboxes de module/action que parezcan editables.

## 6. Roles — listado

Ruta: `/administracion/roles`.

Cards o tabla:

| Campo | Ejemplo |
|---|---|
| Nombre | Administrador |
| Descripción | Acceso completo al sistema |
| Módulos | 18 módulos |
| Usuarios | N usuarios activos |
| Estado | Protegido / Configurable |
| Acción | Editar acceso |

El conteo de módulos debe venir del backend/read model y distinguir módulos
visibles de actions concedidas.

Empty state:

```text
No hay roles configurables disponibles.
Los roles base del sistema se cargan con la configuración de autorización.
```

Para ESP-020 no se muestra “Crear rol custom” porque D02=A aprueba mantener
únicamente roles predefinidos.

## 7. Role access editor

Ruta: `/administracion/roles/:roleCode/acceso`.

### Header

```text
Acceso de [Rol]
Configura qué módulos y acciones puede utilizar este rol.
```

### Matriz visual

```text
MÓDULO: Inventario                         [Acceso ON]
  Ver                                     [ON]
  Transferir                              [OFF]
  Exportar                                [ON]
```

Requisitos:

- agrupar por sección;
- mostrar label, descripción y route;
- mostrar toggle de módulo como shortcut;
- mostrar actions debajo;
- si no hay action configurable, no mostrar control ficticio;
- no mostrar permission codes en el flujo normal;
- mostrar warning cuando una action está restringida por actor boundary;
- explicar que scope por punto se administra aparte.

### Shortcuts

- Solo lectura: activa las actions `VIEW` configurables y desactiva mutaciones.
- Acceso completo: activa todas las actions permitidas por el boundary del rol.
- Limpiar: desactiva todas las actions configurables.

Los shortcuts llaman a una policy backend que filtra structural actions. No son
escrituras directas del navegador.

### Concurrente

El editor recibe `version`/ETag:

- si otro administrador modificó el rol, mostrar conflicto;
- permitir recargar cambios;
- no sobrescribir silenciosamente.

## 8. Rol Administrador

Editor read-only:

- lock icon;
- texto “Rol protegido del sistema”;
- “Acceso completo al sistema”;
- sin checkbox editable;
- link a documentación de boundaries si el usuario necesita entender por qué
  otros roles no pueden recibir ciertas capacidades.

## 9. Scope por punto

La UI existente de `OperationalScopesSection` se integra en User detail, no en
Role access editor.

Estados:

- `global`: “Acceso global MTD; no requiere grants”.
- `explicit` sin grants: warning “Sin puntos asignados; el usuario no puede
  operar puntos”.
- `explicit` con grants: lista seleccionable de puntos activos.
- `unrestricted`: “No aplica scope por punto”.

La asignación reemplaza el conjunto completo con confirmación y muestra:

- puntos nuevos;
- puntos que serán retirados;
- impacto inmediato;
- audit event resultante.

No se listan puntos inactivos para nuevas asignaciones.

## 10. Sidebar dinámico

El sidebar consume `accessibleModules` de `/me` y labels/routes del registry.

Secciones target, sujetas al audit final:

```text
OPERACIÓN
  Dashboard
  Programación
  Demanda

ABASTECIMIENTO
  Órdenes de compra
  Logística OLP
  Recepciones

INVENTARIO
  Inventario
  Transferencias

ATENCIÓN
  Aplicaciones
  Resultados operacionales

CONTROL
  Auditoría
  Analítica
  Integridad
  Importaciones

ADMINISTRACIÓN
  Usuarios
  Roles y accesos
  Configuración
```

La lista final debe corresponder a rutas reales del registry. Se elimina la
sección única `Plataforma` solo cuando el nuevo registry y `/me` estén listos.

Reglas:

- módulo no autorizado: no aparece;
- sección sin módulos: no aparece;
- route directa: frontend muestra forbidden;
- API directa: backend devuelve 403;
- el icono y label nunca conceden permisos.

## 11. 403 / forbidden

La pantalla `/acceso-denegado` debe mostrar:

- título “Acceso no disponible”;
- explicación sin revelar permisos internos;
- organización activa;
- botón volver al dashboard;
- botón cambiar organización si el usuario tiene otra;
- correlation ID opcional para soporte.

Un 401 sigue siendo expiración/sesión y redirige a login. Un 403 no debe cerrar
sesión automáticamente.

## 12. Audit trail UX

En user detail mostrar eventos relevantes:

- creado;
- actualizado;
- activado/desactivado;
- role cambiado;
- scope cambiado;
- password reset, sin valor de password.

En role detail mostrar:

- accesos cambiados;
- actor;
- fecha;
- before/after solo con códigos de módulo/action, no secretos.

Si no existe endpoint de consulta, el detalle debe mostrar un estado
“Auditoría disponible cuando el endpoint esté habilitado” solo durante una
implementación incremental; el DoD final exige endpoint real.

## 13. Accesibilidad y consistencia

- toggles navegables por teclado;
- labels explícitos;
- estados ON/OFF no solo por color;
- confirmación para desactivar/revocar;
- no truncar nombres de roles sin tooltip accesible;
- responsive para tabla y editor;
- no depender de nombres de usuario para decidir visibilidad.

