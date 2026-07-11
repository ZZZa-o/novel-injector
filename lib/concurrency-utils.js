export function concurrencyLimit(value, fallback = 0) {
    const parsed = parseInt(value ?? fallback, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export class DynamicSemaphore {
    constructor(getLimit) {
        this.getLimit = getLimit;
        this.running = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.running < this._limit()) {
            this.running++;
            return;
        }
        await new Promise(resolve => this.queue.push(resolve));
    }

    release() {
        this.running = Math.max(0, this.running - 1);
        this._drain();
    }

    _limit() {
        return concurrencyLimit(this.getLimit?.(), 1);
    }

    _drain() {
        while (this.queue.length && this.running < this._limit()) {
            const resolve = this.queue.shift();
            this.running++;
            resolve();
        }
    }

    get pendingCount() {
        return this.queue.length;
    }
}

export async function runWithSemaphore(semaphore, task) {
    await semaphore.acquire();
    try {
        return await task();
    } finally {
        semaphore.release();
    }
}
