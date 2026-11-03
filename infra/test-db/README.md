# Base PostgreSQL local de pruebas

Esta carpeta contiene la configuración reproducible, el fixture sintético y los
comandos de validación. Las tablas no aparecen como archivos dentro del
proyecto: viven en PostgreSQL y se consultan con pgAdmin, DBeaver, psql o una
extensión PostgreSQL de VS Code.

## Instancia existente

- Host: 127.0.0.1
- Puerto: 55439
- Base: mtd_olp_medicarte_test
- Usuario: mtd_test
- Contraseña: vacía; la instancia local está limitada a loopback.
- Directorio físico: %LOCALAPPDATA%\mtd-olp-medicarte-test-db\pgdata

No copiar pgdata, respaldos, dumps ni credenciales al repositorio. PostgreSQL
administra su directorio binario fuera de Git; versionarlo no es portable y
puede corromperse. El respaldo C:\Users\Juan Diaz\Downloads\db_30102026 no
se usa ni forma parte de estos archivos.

## Uso desde la raíz del proyecto

    pnpm db:test:start
    pnpm db:test:verify
    pnpm db:test:migrate
    pnpm db:test:seed
    pnpm db:test:check

pnpm db:test:setup ejecuta la secuencia completa. El seed es transaccional,
idempotente y solo contiene identificadores y valores ficticios con prefijo
TEST. Cada operación que escribe verifica primero nombre de base, host, puerto
y data_directory; si no coinciden exactamente, termina con SAFETY_STOP.

`pnpm db:test:check` agrega fixtures sintéticos con UUID nuevos y eventos
financieros de prueba. El historial financiero tiene protección de
inmutabilidad, por lo que esos registros append-only no se eliminan al terminar
la prueba. Ejecutar el seed repuebla de forma idempotente las fixtures base;
no restablece el historial generado por las pruebas.

Para detener únicamente este clúster:

    pnpm db:test:stop

No usar pnpm db:reset, pnpm integration:setup ni docker compose down -v contra
esta instancia persistente. Esos flujos pertenecen al ambiente efímero de
integración.

## Verla en una herramienta gráfica

Crea una conexión PostgreSQL con los valores de “Instancia existente”. En
pgAdmin: Servers → Register → Server. En DBeaver: New Database Connection →
PostgreSQL. Después abre:

Databases → mtd_olp_medicarte_test → Schemas → public → Tables.

Si tu cliente exige contraseña, configura la conexión para no guardarla y deja
el campo vacío. No publiques el puerto ni cambies listen_addresses.

## Portabilidad local

Los valores predeterminados corresponden a Windows y PostgreSQL 17. Si cambia
la instalación, usa .env.test.example como referencia y define TEST_DB_PG_BIN,
TEST_DB_DATA_DIR o TEST_DATABASE_URL solo en tu sesión local. No crees un
archivo con secretos dentro del repositorio.
