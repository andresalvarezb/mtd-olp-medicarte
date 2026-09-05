import { describe, expect, it } from 'vitest';
import { patientDocument } from './labels';

describe('patientDocument', () => {
  it('reads the original sensitive source field', () => {
    expect(patientDocument({ IDENTIFICACION_PACIENTE: '987654' })).toBe('987654');
  });
});
