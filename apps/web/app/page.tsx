import { IdentityPanel } from './identity-panel';

export default function Home() {
  return (
    <main>
      <section className="intro">
        <p className="eyebrow">MTD / Plataforma segura</p>
        <h1>Autorizaciones con trazabilidad desde el primer evento.</h1>
        <p className="lede">
          Fundación técnica activa: identidad corporativa, alcance organizacional y procesamiento confiable.
        </p>
      </section>
      <IdentityPanel />
      <footer>Fase 1 · Sin información clínica en esta pantalla</footer>
    </main>
  );
}
