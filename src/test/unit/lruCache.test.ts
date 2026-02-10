import * as assert from 'assert';
import { LruCache } from '../../utils/lruCache';

suite('LruCache (unit)', () => {
  test('returns undefined for missing keys', () => {
    const cache = new LruCache<number>(2, 0);
    assert.strictEqual(cache.get('missing'), undefined);
  });

  test('stores and retrieves values', () => {
    const cache = new LruCache<number>(2, 0);
    cache.set('a', 1);
    assert.strictEqual(cache.get('a'), 1);
  });

  test('evicts least recently used entries', () => {
    const cache = new LruCache<number>(2, 0);
    cache.set('a', 1);
    cache.set('b', 2);
    // refresh "a"
    assert.strictEqual(cache.get('a'), 1);
    cache.set('c', 3);

    assert.strictEqual(cache.get('a'), 1);
    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.get('c'), 3);
  });

  test('expires entries based on ttl', () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;

    try {
      const cache = new LruCache<string>(2, 100);
      cache.set('a', 'value');
      assert.strictEqual(cache.get('a'), 'value');

      now = 1_101;
      assert.strictEqual(cache.get('a'), undefined);
    } finally {
      Date.now = originalNow;
    }
  });
});
