export class LruCache<T> {
    private map = new Map<string, { value: T; expiresAt: number | null }>();

    constructor(
        private readonly maxEntries: number,
        private readonly ttlMs: number
    ) {}

    get(key: string): T | undefined {
        const entry = this.map.get(key);
        if (!entry) return undefined;

        if (this.ttlMs > 0 && entry.expiresAt !== null && entry.expiresAt < Date.now()) {
            this.map.delete(key);
            return undefined;
        }

        // refresh LRU
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        if (this.maxEntries <= 0) return;

        const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : null;
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        this.map.set(key, { value, expiresAt });
        this.trim();
    }

    private trim(): void {
        while (this.map.size > this.maxEntries) {
            const oldestKey = this.map.keys().next().value;
            if (!oldestKey) break;
            this.map.delete(oldestKey);
        }
    }
}
