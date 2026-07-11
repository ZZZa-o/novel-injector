export function splitNovelText(text, kb, charsPerByte = 0.5) {
    const safeText = String(text || '');
    const ratio = Number(charsPerByte) > 0 ? Number(charsPerByte) : 0.5;
    const targetChars = Math.max(1, Math.round(Number(kb) * 1024 * ratio));
    const chunks = [];
    let start = 0;

    while (start < safeText.length) {
        let end = start + targetChars;
        if (end >= safeText.length) {
            chunks.push(safeText.slice(start));
            break;
        }
        const lookAhead = safeText.indexOf('\n', end);
        if (lookAhead !== -1 && lookAhead - end < 500) end = lookAhead + 1;
        chunks.push(safeText.slice(start, end));
        start = end;
    }
    return chunks;
}

export function buildRechunkLayout({
    chunks: oldChunks = [],
    status: oldStatus = [],
    results: oldResults = [],
    meta: oldMeta = [],
    kb,
    charsPerByte = 0.5,
} = {}) {
    const chunks = [];
    const status = [];
    const results = [];
    const meta = [];
    const oldToNewChunkIdx = new Map();
    let pendingText = '';
    let preserved = 0;

    const flushPending = () => {
        if (!pendingText) return;
        splitNovelText(pendingText, kb, charsPerByte).forEach(text => {
            chunks.push(text);
            status.push('pending');
            results.push('');
            meta.push(null);
        });
        pendingText = '';
    };

    oldChunks.forEach((text, index) => {
        const canPreserve = oldStatus[index] === 'done'
            && String(oldResults[index] || '').trim()
            && oldMeta[index];
        if (!canPreserve) {
            pendingText += text || '';
            return;
        }
        flushPending();
        oldToNewChunkIdx.set(index, chunks.length);
        chunks.push(text);
        status.push('done');
        results.push(oldResults[index]);
        meta.push(oldMeta[index]);
        preserved++;
    });
    flushPending();

    return {
        chunks,
        status,
        results,
        meta,
        preserved,
        pending: status.filter(value => value !== 'done').length,
        oldToNewChunkIdx,
    };
}
