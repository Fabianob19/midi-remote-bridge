const { test, describe } = require('node:test');
const assert = require('node:assert');
const { getBroadcastAddresses } = require('../src/shared/discovery');

describe('Auto-Discovery Multi-Interface Logic', () => {
  test('getBroadcastAddresses - always returns an array of addresses', () => {
    const addresses = getBroadcastAddresses();
    
    assert.ok(Array.isArray(addresses), 'Should return an array');
    
    // We can't mock os.networkInterfaces easily in standard node:test without extra libs, 
    // but we can verify the output shape
    if (addresses.length > 0) {
      const first = addresses[0];
      assert.ok(first.name, 'Should have interface name');
      assert.ok(first.ip, 'Should have local IP');
      assert.ok(first.broadcast, 'Should have calculated broadcast address');
      assert.match(first.broadcast, /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/, 'Broadcast should be a valid IPv4');
    }
  });
});
