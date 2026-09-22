import { describe, expect, it } from 'vitest';

import {
  buildInventoryAvailabilityTemplate,
  parseInventoryAvailabilityWorkbook,
} from './inventory-availability-xlsx';

describe('inventory availability xlsx', () => {
  it('round-trips the official OC template', () => {
    const content = buildInventoryAvailabilityTemplate();

    expect(content.length).toBeGreaterThan(0);

    expect(() => parseInventoryAvailabilityWorkbook(content)).toThrow(
      'INVENTORY_AVAILABILITY_NO_ROWS',
    );
  });
});
