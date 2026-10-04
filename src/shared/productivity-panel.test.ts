import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPomodoroTime, productivityActionUrl } from './productivity-panel';

describe('productivity panel helpers', () => {
  it('formats timer seconds as a stable minute and second clock', () => {
    assert.equal(formatPomodoroTime(0), '00:00');
    assert.equal(formatPomodoroTime(61), '01:01');
    assert.equal(formatPomodoroTime(3_661), '61:01');
  });

  it('builds the host action route from the shared productivity route', () => {
    assert.equal(productivityActionUrl('/dsh-pet-desktop-7340/productivity'), '/dsh-pet-desktop-7340/productivity/action');
    assert.equal(productivityActionUrl('dsh-pet-desktop-bridge://host/dsh-pet-desktop-7340/productivity'), 'dsh-pet-desktop-bridge://host/dsh-pet-desktop-7340/productivity/action');
  });
});
