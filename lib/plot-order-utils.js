export const NI_PLOT_TYPE_RANK = { main: 0, sub: 1, pivot: 2 };
export const NI_PLOT_CHUNK_ORDER_STEP = 1000000;
export const NI_PLOT_NODE_ORDER_STEP = 1000;

export function niFiniteNumber(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function niMaybeNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function niPlotChunkIdx(plot, fallback = 0) {
    return niFiniteNumber(plot?._chunkIdx ?? plot?.chunk_index ?? plot?.chunkIndex, fallback);
}

export function niPlotChunkOrder(plot, fallback = 0) {
    return niFiniteNumber(
        plot?._chunkOrder ??
        plot?.chunk_order ??
        plot?.chunkOrder ??
        plot?.order ??
        plot?.order_index ??
        plot?.node_order,
        fallback
    );
}

export function niPlotTypeRank(plot) {
    const type = plot?._type || plot?.type || '';
    return NI_PLOT_TYPE_RANK[type] ?? 99;
}

export function niPlotBaseOrder(plot, fallback = 0) {
    return niPlotChunkIdx(plot) * NI_PLOT_CHUNK_ORDER_STEP +
        niPlotChunkOrder(plot, fallback) * NI_PLOT_NODE_ORDER_STEP +
        niPlotTypeRank(plot);
}

export function niPlotManualOrder(plot) {
    return niMaybeNumber(
        plot?._manualOrder ??
        plot?.manual_order ??
        plot?.manualOrder ??
        plot?._sortOrder ??
        plot?.sort_order
    );
}

export function niPlotStoryOrder(plot, fallback = 0) {
    const manual = niPlotManualOrder(plot);
    return manual != null ? manual : niPlotBaseOrder(plot, fallback);
}

export function niComparePlotOrder(a, b) {
    const aFallback = niFiniteNumber(a?._originalIdx ?? a?._origIdx ?? a?._sourceIdx, 0);
    const bFallback = niFiniteNumber(b?._originalIdx ?? b?._origIdx ?? b?._sourceIdx, 0);
    return niPlotStoryOrder(a, aFallback) - niPlotStoryOrder(b, bFallback) ||
        niPlotTypeRank(a) - niPlotTypeRank(b) ||
        aFallback - bFallback;
}

export function niComparePlotBaseOrder(a, b) {
    const aFallback = niFiniteNumber(a?._originalIdx ?? a?._origIdx ?? a?._sourceIdx, 0);
    const bFallback = niFiniteNumber(b?._originalIdx ?? b?._origIdx ?? b?._sourceIdx, 0);
    return niPlotBaseOrder(a, aFallback) - niPlotBaseOrder(b, bFallback) ||
        niPlotTypeRank(a) - niPlotTypeRank(b) ||
        aFallback - bFallback;
}

export function niSortPlotsByStoryOrder(items) {
    return (items || []).sort(niComparePlotOrder);
}

export function niHashShort(text) {
    let h = 2166136261;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

export function niEnsurePlotNodeId(plot, type = 'main', index = 0) {
    if (!plot || typeof plot !== 'object') return `${type}:${index}`;
    const existing = plot._nodeId || plot.node_id || plot.nodeId || plot.id;
    if (existing) {
        plot._nodeId = String(existing);
        return plot._nodeId;
    }
    const chunk = niPlotChunkIdx(plot, index);
    const order = niPlotChunkOrder(plot, index);
    plot._nodeId = `${type}:${chunk}:${order}:${niHashShort(`${plot.title || ''}\n${plot.body || ''}`)}`;
    return plot._nodeId;
}

export function niNormalizeIncomingPlots(incoming) {
    if (Array.isArray(incoming)) return incoming;
    if (!incoming || typeof incoming !== 'object') return [];
    return ['main', 'sub', 'pivot'].flatMap(type =>
        (Array.isArray(incoming[type]) ? incoming[type] : [])
            .map(plot => ({ ...(plot || {}), type: plot?.type || type }))
    );
}

export function niOrderedPlotEntries(groups) {
    return groups.flatMap(({ type, items }) =>
        (items || []).map((plot, index) => {
            if (plot && typeof plot === 'object') niEnsurePlotNodeId(plot, type, index);
            return {
                ...(plot || {}),
                type: plot?.type || type,
                _type: type,
                _sourceIdx: index,
                _originalIdx: plot?._originalIdx ?? index,
                _plotRef: plot,
            };
        })
    ).sort(niComparePlotOrder);
}

export function niMergeStageNodes(nodes) {
    return niOrderedPlotEntries([
        { type: 'main', items: nodes?.main || [] },
        { type: 'sub', items: nodes?.sub || [] },
        { type: 'pivot', items: nodes?.pivot || [] },
    ]);
}
