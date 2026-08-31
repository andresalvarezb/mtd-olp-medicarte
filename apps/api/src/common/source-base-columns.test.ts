import { describe, expect, it } from 'vitest';
import { sourceBaseColumns, sourceBaseSelectSql } from './source-base-columns';

describe('source-base download projection', () => {
  it('includes CDGN001 after NOMBRE_PACIENTE and omits CPRG', () => {
    const patientNameIndex = sourceBaseColumns.indexOf('NOMBRE_PACIENTE');

    expect(sourceBaseColumns[patientNameIndex + 1]).toBe('CDGN001');
    expect(sourceBaseColumns).not.toContain('CPRG');
    expect(sourceBaseSelectSql('i')).toContain("i.source_data->>'CDGN001' as cdgn001");
    expect(sourceBaseSelectSql('i')).not.toContain('CPRG');
  });
});
