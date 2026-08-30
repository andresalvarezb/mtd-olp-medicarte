import { IdentityPanel } from './identity-panel';

export default function Home() {
  return (
    <main>
      <section className="intro">
        <p className="eyebrow">MTD / Plataforma segura</p>
        <h1>Autorizaciones con trazabilidad desde el primer evento.</h1>
        <p className="lede">
          Operación activa: ingesta, disponibilidad, actualizaciones masivas y auditoría humana
          trazable.
        </p>
      </section>
      <IdentityPanel />
      <footer>Fase 6 · La autorización backend decide cada alcance</footer>
    </main>
  );
}
