export function canUseDerivedModules(state) {
    return !state?.cleanRunning
        && Array.isArray(state?.chunkStatus)
        && state.chunkStatus.some(status => status === 'done');
}

export function getCleanProgressStats(state) {
    const total = Array.isArray(state?.chunks) && state.chunks.length
        ? state.chunks.length
        : (Array.isArray(state?.chunkStatus) ? state.chunkStatus.length : 0);
    let done = 0;
    let error = 0;
    let running = 0;
    let pending = 0;
    for (let i = 0; i < total; i++) {
        const status = state?.chunkStatus?.[i] || 'pending';
        if (status === 'done') done++;
        else if (status === 'error') error++;
        else if (status === 'running') running++;
        else pending++;
    }
    return {
        total,
        done,
        error,
        running,
        pending,
        hasAnyProgress: done > 0 || error > 0 || running > 0,
        isPartial: total > 0 && (done > 0 || error > 0 || running > 0) && done < total,
        isComplete: total > 0 && done === total && error === 0 && running === 0,
    };
}

export function hasPartialCleanProgress(state) {
    return getCleanProgressStats(state).isPartial;
}

export function normalizeCleanArraysToChunks(state) {
    if (!state || typeof state !== 'object') return 0;
    if (!Array.isArray(state.chunks)) state.chunks = [];
    const total = state.chunks.length;
    const valid = new Set(['pending', 'done', 'error']);
    state.chunkStatus = state.chunks.map((_, i) => {
        const status = state.chunkStatus?.[i] || 'pending';
        return valid.has(status) ? status : 'pending';
    });
    state.chunkResults = state.chunks.map((_, i) => state.chunkResults?.[i] || '');
    state.chunkMeta = state.chunks.map((_, i) => state.chunkMeta?.[i] || null);
    return total;
}
