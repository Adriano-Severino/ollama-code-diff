"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LruCache = void 0;
class LruCache {
    constructor(maxEntries, ttlMs) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.map = new Map();
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return undefined;
        if (this.ttlMs > 0 && entry.expiresAt !== null && entry.expiresAt < Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        // refresh LRU
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }
    set(key, value) {
        if (this.maxEntries <= 0)
            return;
        const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : null;
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        this.map.set(key, { value, expiresAt });
        this.trim();
    }
    trim() {
        while (this.map.size > this.maxEntries) {
            const oldestKey = this.map.keys().next().value;
            if (!oldestKey)
                break;
            this.map.delete(oldestKey);
        }
    }
}
exports.LruCache = LruCache;
//# sourceMappingURL=lruCache.js.map