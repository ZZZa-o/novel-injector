export function isVectorRowCompatible(row, currentFingerprint) {
    const stored = String(row?.fingerprint || '');
    return !stored || stored === String(currentFingerprint || '');
}

export function areStageVectorRowsComplete(rows, expected) {
    const count = Math.max(0, parseInt(expected, 10) || 0);
    if (count <= 0) return false;
    const indices = new Set((rows || []).map(row => Number(row.chunkIdx)).filter(Number.isFinite));
    if (indices.size < count) return false;
    for (let index = 0; index < count; index++) {
        if (!indices.has(index)) return false;
    }
    return true;
}

export function rebuildStageVectorCompletion({
    rows = [],
    expectedByStage = {},
    oldDone = {},
    fingerprint = '',
} = {}) {
    const grouped = {};
    rows
        .filter(row => isVectorRowCompatible(row, fingerprint))
        .forEach(row => {
            const stageIdx = Number(row.stageIdx);
            if (!Number.isFinite(stageIdx)) return;
            (grouped[stageIdx] ||= []).push(row);
        });

    const stageVecDone = {};
    Object.entries(grouped).forEach(([stageKey, stageRows]) => {
        const stageIdx = Number(stageKey);
        const expected = expectedByStage?.[stageIdx];
        if (expected > 0) {
            if (areStageVectorRowsComplete(stageRows, expected)) stageVecDone[stageIdx] = true;
        } else if (oldDone?.[stageIdx] === true && stageRows.length > 0) {
            stageVecDone[stageIdx] = true;
        }
    });

    return {
        stageVecDone,
        vecDone: Object.values(stageVecDone).some(Boolean),
    };
}
