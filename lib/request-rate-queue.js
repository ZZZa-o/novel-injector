export function parseRateLimit(value, fallback = 3) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function readQueueLastAt(storage, key) {
    try {
        const parsed = parseInt(storage?.getItem?.(key) || '0', 10);
        return Number.isFinite(parsed) ? parsed : 0;
    } catch (_) {
        return 0;
    }
}

export function saveQueueLastAt(storage, key, value) {
    try { storage?.setItem?.(key, String(value || 0)); } catch (_) {}
}

export class PersistedRateQueue {
    constructor({
        storageKey,
        getLimit,
        fallbackLimit = 3,
        storage = globalThis.localStorage,
        now = () => Date.now(),
        setTimer = (callback, delay) => setTimeout(callback, delay),
    }) {
        this.pending = [];
        this.processing = false;
        this.storageKey = storageKey;
        this.getLimit = getLimit;
        this.fallbackLimit = fallbackLimit;
        this.storage = storage;
        this.now = now;
        this.setTimer = setTimer;
        this.lastAt = readQueueLastAt(storage, storageKey);
    }

    async acquire() {
        return new Promise(resolve => {
            this.pending.push(resolve);
            this._flush();
        });
    }

    _flush() {
        if (this.processing) return;
        this.processing = true;
        this._tick();
    }

    _tick() {
        if (!this.pending.length) {
            this.processing = false;
            return;
        }

        const limit = parseRateLimit(this.getLimit?.(), this.fallbackLimit);
        if (limit <= 0) {
            const all = this.pending.splice(0);
            all.forEach(resolve => resolve());
            this.processing = false;
            return;
        }

        const now = this.now();
        const minGap = Math.ceil(60000 / limit) + 250;
        const waitMs = Math.max(0, (this.lastAt || 0) + minGap - now);
        if (waitMs > 0) {
            this.setTimer(() => this._tick(), waitMs);
            return;
        }

        const resolve = this.pending.shift();
        this.lastAt = this.now();
        saveQueueLastAt(this.storage, this.storageKey, this.lastAt);
        resolve();
        this.setTimer(() => this._tick(), 0);
    }
}
