import { IdentityPanel } from './identity-panel';

export default function Home() {
  return (
    <main>
      <section className="intro">
        <p className="eyebrow">MTD / Plataforma segura</p>
        <h1>Autorizaciones con trazabilidad desde el primer evento.</h1>
        <p className="lede">
          Operación activa: ingesta, disponibilidad y actualizaciones masivas trazables por fila.
        </p>
      </section>
      <IdentityPanel />
      <footer>Fase 5 · La autorización backend decide cada alcance</footer>
    </main>
  );
}
