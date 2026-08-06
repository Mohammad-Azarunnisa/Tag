import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCompetitorSheet } from './linkedinController.js';

// Real LinkedIn competitor export: date-range row first, then headers, no total-followers column.
test('detectCompetitorSheet accepts real LinkedIn export layout (date row + no total followers)', () => {
  const grid = [
    [undefined, '7/27/2026', '', '', '', '', '8/2/2026'],        // date range row
    [undefined, 'Page', 'New Followers', 'Posts', 'Comments', 'Comments per day', 'Reactions'],
    [undefined, 'REVA University', '377', '11', '10', '1', '1275'],
    [undefined, 'SJCIT', '5', '0', '0', '0', '0'],
  ];

  const det = detectCompetitorSheet(grid, 'Competitors');
  assert.ok(det, 'sheet should be detected');
  assert.equal(det.headerRow, 1);
  assert.ok(det.map.name != null, 'name column mapped');
  assert.ok(det.map.newFollowers != null, 'newFollowers column mapped');
  assert.ok(det.map.posts != null, 'posts column mapped');
  assert.ok(det.map.comments != null, 'comments column mapped');
  assert.ok(det.map.reactions != null, 'reactions column mapped');
});

test('detectCompetitorSheet still accepts follower-only competitor exports', () => {
  const grid = [
    [undefined, 'Page', 'Followers'],
    [undefined, 'Example Org', '12500'],
  ];

  const det = detectCompetitorSheet(grid, 'Competitors');
  assert.ok(det, 'sheet should be detected');
  assert.equal(det.headerRow, 0);
  assert.ok(det.map.name != null);
  assert.ok(det.map.followers != null);
});
