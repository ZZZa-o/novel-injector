function realChunkIdxForCombinedIndex(combinedIdx, mainPlots, pivotPlots) {
    return combinedIdx < mainPlots.length
        ? (mainPlots[combinedIdx]?._chunkIdx ?? combinedIdx)
        : (pivotPlots[combinedIdx - mainPlots.length]?._chunkIdx ?? combinedIdx);
}

function stageValues(stages) {
    return stages instanceof Set ? [...stages] : (Array.isArray(stages) ? stages : []);
}

export function buildStageMapping({
    slots = [],
    mainPlots = [],
    pivotPlots = [],
    chunkStatus = [],
    oldStageMap = {},
    oldChunkStageMap = null,
} = {}) {
    const sortedSlots = [...slots].sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const newMap = {};
    const chunkStageMap = {};

    sortedSlots.forEach(([, slot], slotIdx) => {
        const stageIdx = slotIdx + 1;
        slot.assignedChunks.forEach(combinedIdx => {
            newMap[combinedIdx] = stageIdx;
            const realChunkIdx = realChunkIdxForCombinedIndex(combinedIdx, mainPlots, pivotPlots);
            if (!chunkStageMap[realChunkIdx]) chunkStageMap[realChunkIdx] = new Set();
            chunkStageMap[realChunkIdx].add(stageIdx);
        });
    });

    sortedSlots.forEach(([, slot], slotIdx) => {
        const currentStage = slotIdx + 1;
        const nextStage = currentStage + 1;
        const nextSlot = sortedSlots[slotIdx + 1]?.[1];
        if (!nextSlot) return;

        let maxCurrentChunk = -1;
        slot.assignedChunks.forEach(combinedIdx => {
            maxCurrentChunk = Math.max(maxCurrentChunk, realChunkIdxForCombinedIndex(combinedIdx, mainPlots, pivotPlots));
        });
        let minNextChunk = Infinity;
        nextSlot.assignedChunks.forEach(combinedIdx => {
            minNextChunk = Math.min(minNextChunk, realChunkIdxForCombinedIndex(combinedIdx, mainPlots, pivotPlots));
        });

        if (maxCurrentChunk >= 0 && minNextChunk !== Infinity && minNextChunk - maxCurrentChunk === 1) {
            if (!chunkStageMap[maxCurrentChunk]) chunkStageMap[maxCurrentChunk] = new Set();
            chunkStageMap[maxCurrentChunk].add(nextStage);
            if (!chunkStageMap[minNextChunk]) chunkStageMap[minNextChunk] = new Set();
            chunkStageMap[minNextChunk].add(currentStage);
        }
    });

    const knownMap = {};
    Object.entries(chunkStageMap).forEach(([chunkIdx, stages]) => {
        knownMap[Number(chunkIdx)] = Math.min(...stages);
    });
    const knownIndices = Object.keys(knownMap).map(Number).sort((a, b) => a - b);
    if (knownIndices.length) {
        for (let chunkIdx = 0; chunkIdx < chunkStatus.length; chunkIdx++) {
            if (chunkStatus[chunkIdx] !== 'done' || chunkStageMap[chunkIdx]) continue;
            let nearest = knownIndices[0];
            let minDistance = Math.abs(chunkIdx - nearest);
            for (const knownIdx of knownIndices) {
                const distance = Math.abs(chunkIdx - knownIdx);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = knownIdx;
                } else if (distance > minDistance) {
                    break;
                }
            }
            chunkStageMap[chunkIdx] = new Set([knownMap[nearest]]);
        }
    }

    const movedExistingNode = Object.keys(oldStageMap || {}).some(combinedIdx => {
        const oldStage = oldStageMap[combinedIdx];
        const newStage = newMap[combinedIdx];
        return oldStage != null && oldStage !== newStage;
    });
    if (!movedExistingNode && oldChunkStageMap) {
        Object.entries(oldChunkStageMap).forEach(([chunkIdx, stages]) => {
            if (chunkStatus[Number(chunkIdx)] !== 'done') return;
            if (!chunkStageMap[chunkIdx]) chunkStageMap[chunkIdx] = new Set();
            stageValues(stages).forEach(stageIdx => chunkStageMap[chunkIdx].add(Number(stageIdx)));
        });
    }

    const changedStages = new Set();
    const allIndices = new Set([
        ...Object.keys(oldStageMap || {}).map(Number).filter(Number.isFinite),
        ...Object.keys(newMap).map(Number).filter(Number.isFinite),
    ]);
    allIndices.forEach(combinedIdx => {
        const oldStage = oldStageMap?.[combinedIdx] ?? oldStageMap?.[String(combinedIdx)];
        const newStage = newMap[combinedIdx] ?? newMap[String(combinedIdx)];
        if (oldStage != null && oldStage !== newStage) {
            changedStages.add(oldStage);
            if (newStage != null) changedStages.add(newStage);
        }
    });

    return { sortedSlots, newMap, chunkStageMap, movedExistingNode, changedStages };
}
