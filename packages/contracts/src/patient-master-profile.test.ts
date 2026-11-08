import { describe, expect, it } from 'vitest';
import { patientMasterBasicProfileSchema, patientMasterPersonalProfileSchema } from './index';

const syntheticBasicProfile = {
  tipo_identificacion: 'TEST',
  identificacion: 'SYN-0001',
  primer_nombre: 'FICTICIO',
  segundo_nombre: null,
  primer_apellido: 'PRUEBA',
  segundo_apellido: null,
  sexo: null,
  ciudad: null,
  codigo_ciudad: null,
  departamento: null,
  codigo_departamento: null,
  eps: null,
  codigo_eps: null,
  plan: null,
  codigo_plan: null,
  tipo: null,
  codigo_tipo: null,
  condicion: null,
  activo: false,
  paciente_vivo: null,
  fecha_fallecimiento: null,
  presente_en_fuente_actual: true,
  registraduria_estado: null,
  fecha_ultima_validacion_registraduria: null,
  actualizado_en: '2026-11-08T00:00:00.000Z',
};

describe('patient master profile contracts', () => {
  it('accepts the exact basic allowlist and preserves false and null values distinctly', () => {
    const parsed = patientMasterBasicProfileSchema.parse(syntheticBasicProfile);
    expect(parsed.activo).toBe(false);
    expect(parsed.paciente_vivo).toBeNull();
  });

  it('rejects additional profile fields rather than silently forwarding them', () => {
    expect(() =>
      patientMasterBasicProfileSchema.parse({ ...syntheticBasicProfile, raw_source: 'synthetic' }),
    ).toThrow();
    expect(() =>
      patientMasterBasicProfileSchema.parse({
        ...syntheticBasicProfile,
        primer_nombre: 'X'.repeat(2049),
      }),
    ).toThrow();
  });

  it('accepts nullable synthetic personal fields while rejecting extra attributes', () => {
    const parsed = patientMasterPersonalProfileSchema.parse({
      fecha_nacimiento: null,
      direccion: 'DIRECCION-FICTICIA',
      barrio: null,
      zona: null,
      latitud: null,
      longitud: null,
      telefono1: null,
      telefono2: null,
      email: null,
      email_validado: null,
    });
    expect(parsed.direccion).toBe('DIRECCION-FICTICIA');
    expect(() =>
      patientMasterPersonalProfileSchema.parse({
        ...parsed,
        identificacion: 'SYN-0001',
      }),
    ).toThrow();
    expect(() =>
      patientMasterPersonalProfileSchema.parse({
        ...parsed,
        latitud: 91,
      }),
    ).toThrow();
  });
});
