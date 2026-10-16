import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveExportable } from './exportables-api';

describe('saveExportable: descarga de XLSX grandes', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mantiene el Blob accesible hasta después del clic del navegador', () => {
    vi.useFakeTimers();

    const sequence: string[] = [];
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(() => { sequence.push('click'); }),
      remove: vi.fn(() => { sequence.push('remove'); }),
    };
    const appendChild = vi.fn(() => { sequence.push('append'); });
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.fn(() => 'blob:authorization-large-xlsx');
    const revokeObjectURL = vi.fn();

    vi.stubGlobal('document', { createElement, body: { appendChild } });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    // El exportable real de producción supera los 25 MB.
    const workbook = new Blob([new Uint8Array(29 * 1024 * 1024)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveExportable(workbook, 'autorizaciones-consolidado.xlsx');

    expect(createObjectURL).toHaveBeenCalledWith(workbook);
    expect(createElement).toHaveBeenCalledWith('a');
    expect(anchor.href).toBe('blob:authorization-large-xlsx');
    expect(anchor.download).toBe('autorizaciones-consolidado.xlsx');
    expect(anchor.style.display).toBe('none');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(sequence).toEqual(['append', 'click', 'remove']);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:authorization-large-xlsx');
  });

  it('libera el enlace y programa revocación incluso si el clic falla', () => {
    vi.useFakeTimers();

    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(() => { throw new Error('CLICK_FAILED'); }),
      remove: vi.fn(),
    };
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:failed-click'),
      revokeObjectURL,
    });

    expect(() => saveExportable(new Blob(['x']), 'ejemplo.xlsx')).toThrow('CLICK_FAILED');
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed-click');
  });
});
