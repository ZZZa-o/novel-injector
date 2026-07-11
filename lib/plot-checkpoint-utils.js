import {
    niEnsurePlotNodeId,
    niOrderedPlotEntries,
    niPlotChunkIdx,
    niPlotChunkOrder,
    niPlotManualOrder,
    niSortPlotsByStoryOrder,
} from './plot-order-utils.js';

export function getAllPlotsInStoryOrder(state) {
    return niOrderedPlotEntries([
        { type: 'main', items: state?.plots?.main || [] },
        { type: 'sub', items: state?.plots?.sub || [] },
        { type: 'pivot', items: state?.plots?.pivot || [] },
    ]);
}

export function rebuildStageMapFromPlotStageIdx(state) {
    if (!state || state.stageMapN <= 0) return;
    const rebuilt = {};
    const main = state.plots?.main || [];
    const pivot = state.plots?.pivot || [];
    main.forEach((plot, index) => {
        if (plot?.stageIdx != null) rebuilt[index] = plot.stageIdx;
    });
    pivot.forEach((plot, index) => {
        if (plot?.stageIdx != null) rebuilt[main.length + index] = plot.stageIdx;
    });
    state.stageMap = rebuilt;
}

export function normalizePlotCollections(state, syncSubPlotStageAssignments = null) {
    if (!state || !state.plots) return;
    ['main', 'sub', 'pivot'].forEach(type => {
        if (!Array.isArray(state.plots[type])) state.plots[type] = [];
        state.plots[type].forEach((plot, index) => {
            if (!plot || typeof plot !== 'object') return;
            plot.type = plot.type || type;
            plot._chunkIdx = niPlotChunkIdx(plot, plot._chunkIdx ?? 0);
            plot._chunkOrder = niPlotChunkOrder(plot, index);
            if (plot.stageIdx != null && !plot.stageLabel) plot.stageLabel = `第 ${plot.stageIdx} 阶段`;
            niEnsurePlotNodeId(plot, type, index);
        });
        niSortPlotsByStoryOrder(state.plots[type]);
    });
    rebuildStageMapFromPlotStageIdx(state);
    syncSubPlotStageAssignments?.();
}

export function capturePlotCheckpointMemory(state) {
    const memory = new Map();
    ['main', 'sub', 'pivot'].forEach(type => {
        (state?.plots?.[type] || []).forEach((plot, index) => {
            const manualOrder = niPlotManualOrder(plot);
            if (manualOrder == null && plot.stageIdx == null) return;
            memory.set(niEnsurePlotNodeId(plot, type, index), {
                manualOrder,
                stageIdx: plot.stageIdx ?? null,
                stageLabel: plot.stageLabel || null,
            });
        });
    });
    return memory;
}

export function restorePlotCheckpointMemory(state, memory) {
    if (!state?.plots || !memory?.size) return;
    ['main', 'sub', 'pivot'].forEach(type => {
        (state.plots[type] || []).forEach((plot, index) => {
            const id = niEnsurePlotNodeId(plot, type, index);
            if (!memory.has(id)) return;
            const saved = memory.get(id);
            if (typeof saved === 'number') {
                plot._manualOrder = saved;
                return;
            }
            if (saved?.manualOrder != null) plot._manualOrder = saved.manualOrder;
            if (saved?.stageIdx != null) {
                plot.stageIdx = saved.stageIdx;
                plot.stageLabel = saved.stageLabel || `第 ${saved.stageIdx} 阶段`;
            }
        });
    });
}

export function getAssignedStagesForChunk(state, chunkIdx) {
    const direct = state?.chunkStageMap?.[chunkIdx] ?? state?.chunkStageMap?.[String(chunkIdx)];
    const directStages = direct instanceof Set ? [...direct] : (Array.isArray(direct) ? direct : []);
    if (directStages.length) return [...new Set(directStages.map(Number).filter(Number.isFinite))];

    const inferred = [
        ...(state?.plots?.main || []),
        ...(state?.plots?.sub || []),
        ...(state?.plots?.pivot || []),
    ]
        .filter(plot => niPlotChunkIdx(plot, -1) === chunkIdx && plot.stageIdx != null)
        .map(plot => Number(plot.stageIdx))
        .filter(Number.isFinite);
    return [...new Set(inferred)];
}
