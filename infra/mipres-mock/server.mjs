/**
 * Mock local del servicio MIPRES WSSUMMIPRESNOPBS para desarrollo y pruebas
 * E2E (Fase 3). No es parte del producto: emula GenerarToken y
 * DireccionamientoXPrescripcion con respuestas programadas por el ultimo
 * digito del numero de prescripcion.
 *
 *   0 -> direccionamiento vigente (CONFIRMED)
 *   1 -> sin direccionamientos (PENDING)
 *   2 -> todos anulados (PENDING)
 *   3 -> FecMaxEnt vencida (PENDING)
 *   4 -> FecMaxEnt = hoy Bogota (PENDING, igualdad no valida)
 *   5 -> HTTP 500 persistente (QUERY_ERROR)
 *   6 -> HTTP 401 en la consulta (QUERY_ERROR, token no recuperable)
 *   7 -> respuesta no interpretable (QUERY_ERROR)
 *   otro -> vacio (PENDING)
 */
import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '8090', 10);
const initialToken = process.env.MIPRES_MOCK_INITIAL_TOKEN ?? 'initial-secret';
const generatedToken = process.env.MIPRES_MOCK_OPERATIVE_TOKEN ?? 'operative-token';

function bogotaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function direction(id, maximumDeliveryDate, extra = {}) {
  return {
    ID: `ext-${id}`,
    IDDireccionamiento: id,
    NoPrescripcion: 'prescripcion',
    TipoTec: 'M',
    ConTec: '1',
    FecMaxEnt: maximumDeliveryDate,
    EstDireccionamiento: 'ACTIVO',
    FecAnulacion: '',
    ...extra,
  };
}

function directionsFor(prescription) {
  const suffix = prescription.slice(-1);
  const today = bogotaToday();
  switch (suffix) {
    case '0':
      return [direction(`${prescription}-a`, addDays(today, 30))];
    case '1':
      return [];
    case '2':
      return [direction(`${prescription}-a`, addDays(today, 30), { FecAnulacion: '01/01/2026' })];
    case '3':
      return [direction(`${prescription}-a`, addDays(today, -1))];
    case '4':
      return [direction(`${prescription}-a`, today)];
    default:
      return [];
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  if (request.method === 'GET' && url.pathname.startsWith('/api/GenerarToken/')) {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 4 || segments[3] !== initialToken) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'initial token rejected' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(generatedToken);
    return;
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/DireccionamientoXPrescripcion/')) {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 5 || segments[3] !== generatedToken) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'token rejected' }));
      return;
    }
    const prescription = decodeURIComponent(segments[4] ?? '');
    const suffix = prescription.slice(-1);
    if (suffix === '5') {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'mock internal error' }));
      return;
    }
    if (suffix === '6') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'token rejected for this prescription' }));
      return;
    }
    if (suffix === '7') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('not-json{');
      return;
    }
    const payload = directionsFor(prescription).map((entry) => ({
      ...entry,
      NoPrescripcion: prescription,
    }));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, () => {
  console.log(`mipres mock listening on ${port}`);
});
