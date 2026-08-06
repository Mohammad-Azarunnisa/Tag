import test from 'node:test';
import assert from 'node:assert/strict';
import { logActivity } from './logActivity.js';

test('logActivity accepts system-generated entries without a user', async () => {
  const result = await logActivity({
    action: 'REPORT_GENERATED',
    description: 'Monthly report generated',
  });

  assert.strictEqual(result, undefined);
});
