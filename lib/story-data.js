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

export function niGenerationConcurrency(settings = {}, defaults = {}, total = Infinity) {
    const configured = parseInt(settings?.apiConcurrency ?? defaults?.apiConcurrency, 10);
    const limit = Number.isFinite(configured) && configured > 0 ? configured : 1;
    const count = Number.isFinite(total) ? Math.max(1, Math.floor(total)) : limit;
    return Math.max(1, Math.min(limit, count));
}

export async function niRunGenerationPool(items, concurrency, worker, { signal = null } = {}) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return 0;
    const workerCount = Math.max(1, Math.min(parseInt(concurrency, 10) || 1, list.length));
    let cursor = 0;
    const runners = Array.from({ length: workerCount }, async () => {
        while (true) {
            if (signal?.aborted) return;
            const position = cursor++;
            if (position >= list.length) return;
            await worker(list[position], position);
        }
    });
    await Promise.all(runners);
    return workerCount;
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
    if (Object.keys(rebuilt).length) state.stageMap = rebuilt;
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

function niCloneCheckpointValue(value) {
    if (Array.isArray(value)) return value.map(niCloneCheckpointValue);
    if (value instanceof Set) return new Set([...value].map(niCloneCheckpointValue));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, niCloneCheckpointValue(item)]));
}

function niBuildPlotSourceSnapshots(state) {
    const source = new Map();
    (state?.chunkMeta || []).forEach((meta, chunkIndex) => {
        const plots = niNormalizeIncomingPlots(meta?.plots || [])
            .map((plot, sourceIndex) => ({ ...(plot || {}), _sourceIdx: sourceIndex }))
            .sort((a, b) => {
                const ai = niFiniteNumber(a._sourceIdx, 0);
                const bi = niFiniteNumber(b._sourceIdx, 0);
                return niPlotChunkOrder(a, ai) - niPlotChunkOrder(b, bi) ||
                    niPlotTypeRank(a) - niPlotTypeRank(b) || ai - bi;
            });
        plots.forEach((plot, localIndex) => {
            const type = ['main', 'sub', 'pivot'].includes(plot.type) ? plot.type : 'main';
            const chunkOrder = niPlotChunkOrder(plot, plot._sourceIdx ?? localIndex);
            const snapshot = {
                ...niCloneCheckpointValue(plot),
                type,
                _chunkIdx: chunkIndex,
                _chunkOrder: chunkOrder,
            };
            snapshot._nodeId = plot._nodeId || plot.node_id || plot.nodeId || plot.id ||
                `${type}:${chunkIndex}:${chunkOrder}:${niHashShort(`${plot.title || ''}\n${plot.body || ''}`)}`;
            source.set(String(snapshot._nodeId), { type, plot: snapshot });
        });
    });
    return source;
}

function niFindPlotSourceMatch(plot, type, sourceSnapshots, usedSourceIds, index) {
    const existingId = niEnsurePlotNodeId(plot, type, index);
    if (sourceSnapshots.has(existingId) && !usedSourceIds.has(existingId)) return existingId;
    const chunkIdx = niPlotChunkIdx(plot, -1);
    const chunkOrder = niPlotChunkOrder(plot, index);
    const matches = [...sourceSnapshots.entries()].filter(([id, saved]) =>
        !usedSourceIds.has(id) &&
        niPlotChunkIdx(saved.plot, -2) === chunkIdx &&
        niPlotChunkOrder(saved.plot, -2) === chunkOrder
    );
    return matches.length === 1 ? matches[0][0] : '';
}

export function capturePlotCheckpointMemory(state) {
    const memory = new Map();
    const snapshots = new Map();
    const sourceSnapshots = niBuildPlotSourceSnapshots(state);
    const usedSourceIds = new Set();
    const manualIds = new Set();

    ['main', 'sub', 'pivot'].forEach(type => {
        (state?.plots?.[type] || []).forEach((plot, index) => {
            if (!plot || typeof plot !== 'object') return;
            const sourceId = niFindPlotSourceMatch(plot, type, sourceSnapshots, usedSourceIds, index);
            const id = sourceId || niEnsurePlotNodeId(plot, type, index);
            if (sourceId) {
                usedSourceIds.add(sourceId);
                plot._nodeId = sourceId;
            } else {
                manualIds.add(id);
            }
            const snapshot = { type, plot: niCloneCheckpointValue({ ...plot, _nodeId: id, type }) };
            snapshots.set(id, snapshot);
            memory.set(id, {
                manualOrder: niPlotManualOrder(plot),
                stageIdx: plot.stageIdx ?? null,
                stageLabel: plot.stageLabel || null,
            });
        });
    });

    memory._plotSnapshots = snapshots;
    memory._plotSourceSnapshots = sourceSnapshots;
    memory._manualPlotIds = manualIds;
    memory._deletedPlotIds = new Set([...sourceSnapshots.keys()].filter(id => !usedSourceIds.has(id)));
    return memory;
}

export function restorePlotCheckpointMemory(state, memory) {
    if (!state?.plots || !(memory instanceof Map)) return;
    const snapshots = memory._plotSnapshots;
    if (!(snapshots instanceof Map)) {
        if (!memory.size) return;
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
        return;
    }

    const deletedIds = memory._deletedPlotIds instanceof Set ? memory._deletedPlotIds : new Set();
    const manualIds = memory._manualPlotIds instanceof Set ? memory._manualPlotIds : new Set();
    const sourceSnapshots = memory._plotSourceSnapshots instanceof Map ? memory._plotSourceSnapshots : new Map();
    const next = { main: [], sub: [], pivot: [] };
    const restoredIds = new Set();

    ['main', 'sub', 'pivot'].forEach(type => {
        (state.plots[type] || []).forEach((plot, index) => {
            const id = niEnsurePlotNodeId(plot, type, index);
            let checkpointId = id;
            if (!snapshots.has(checkpointId) && !deletedIds.has(checkpointId)) {
                const chunkIdx = niPlotChunkIdx(plot, -1);
                const chunkOrder = niPlotChunkOrder(plot, index);
                const positionMatches = [...sourceSnapshots.entries()].filter(([sourceId, saved]) =>
                    !restoredIds.has(sourceId) &&
                    niPlotChunkIdx(saved.plot, -2) === chunkIdx &&
                    niPlotChunkOrder(saved.plot, -2) === chunkOrder
                );
                if (positionMatches.length === 1) checkpointId = positionMatches[0][0];
            }
            if (deletedIds.has(checkpointId)) return;
            const saved = snapshots.get(checkpointId);
            if (saved?.plot) {
                const restored = niCloneCheckpointValue(saved.plot);
                const targetType = ['main', 'sub', 'pivot'].includes(saved.type) ? saved.type : type;
                restored.type = targetType;
                restored._nodeId = checkpointId;
                next[targetType].push(restored);
                restoredIds.add(checkpointId);
            } else {
                next[type].push(plot);
            }
        });
    });

    manualIds.forEach(id => {
        if (restoredIds.has(id)) return;
        const saved = snapshots.get(id);
        if (!saved?.plot) return;
        const type = ['main', 'sub', 'pivot'].includes(saved.type) ? saved.type : 'main';
        const restored = niCloneCheckpointValue(saved.plot);
        restored.type = type;
        restored._nodeId = id;
        next[type].push(restored);
        restoredIds.add(id);
    });

    state.plots = next;
    ['main', 'sub', 'pivot'].forEach(type => niSortPlotsByStoryOrder(state.plots[type]));
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

export function isSameCharacter(a, b) {
    const nameA = (a?.name || '').trim();
    const nameB = (b?.name || '').trim();
    if (!nameA || !nameB) return false;
    if (nameA === nameB) return true;
    if (nameA.length >= 2 && nameB.includes(nameA)) return true;
    if (nameB.length >= 2 && nameA.includes(nameB)) return true;
    return false;
}

export function normalizeCharacterAlias(raw, chunkIndex, fallbackCharName = '') {
    const source = typeof raw === 'string' ? { text: raw } : (raw || {});
    const text = String(source.text || source.name || source.alias || source.title || '').trim();
    if (!text) return null;
    return {
        character_name: String(source.character_name || source.characterName || source.char || fallbackCharName || '').trim(),
        text,
        kind: String(source.kind || source.type || 'alias').trim() || 'alias',
        note: String(source.note || source.desc || '').trim(),
        _chunkIdx: chunkIndex ?? null,
    };
}

export function mergeAliasesIntoCharacter(character, aliases, chunkIndex) {
    if (!character || !Array.isArray(aliases)) return;
    if (!Array.isArray(character.aliases)) character.aliases = [];
    aliases.forEach(raw => {
        const alias = normalizeCharacterAlias(raw, chunkIndex, character.name);
        if (!alias || alias.text === character.name) return;
        const existing = character.aliases.find(item => (item.text || '') === alias.text);
        if (!existing) {
            character.aliases.push(alias);
        } else if (existing._chunkIdx == null || (alias._chunkIdx != null && alias._chunkIdx < existing._chunkIdx)) {
            existing._chunkIdx = alias._chunkIdx;
        }
    });
}

export function mergeCharacters(state, incoming, chunkIndex) {
    if (!state || !Array.isArray(incoming)) return;
    if (!Array.isArray(state.characters)) state.characters = [];
    for (const character of incoming) {
        if (!character?.name) continue;
        const existing = state.characters.find(item => isSameCharacter(item, character));
        if (!existing) {
            const isProtagonist = (character.role || '其他') === '主角';
            const nextCharacter = {
                name: character.name,
                role: character.role || '其他',
                identity: character.identity || character.bio || '',
                appearance: character.appearance || '',
                gender: character.gender || '',
                personality: character.personality || '',
                relations: character.relations || '',
                aliases: [],
                _firstChunkIdx: chunkIndex ?? null,
                enabled: isProtagonist,
            };
            nextCharacter._characterId = `char:${chunkIndex ?? 'manual'}:${niHashShort(nextCharacter.name)}`;
            state.characters.push(nextCharacter);
            mergeAliasesIntoCharacter(state.characters[state.characters.length - 1], character.aliases || character.character_aliases || [], chunkIndex);
        } else {
            mergeAliasesIntoCharacter(existing, character.aliases || character.character_aliases || [], chunkIndex);
        }
    }
}

export function mergeCharacterAliases(state, incoming, chunkIndex) {
    if (!state || !Array.isArray(incoming) || !incoming.length) return;
    if (!Array.isArray(state.characters)) state.characters = [];
    incoming.forEach(raw => {
        const alias = normalizeCharacterAlias(raw, chunkIndex);
        if (!alias) return;
        const owner = state.characters.find(character =>
            isSameCharacter(character, { name: alias.character_name }) ||
            isSameCharacter(character, { name: alias.text }) ||
            (Array.isArray(character.aliases) && character.aliases.some(item => (item.text || '') === alias.character_name))
        );
        if (owner) mergeAliasesIntoCharacter(owner, [alias], chunkIndex);
    });
}

function niEnsureCharacterId(character, index = 0) {
    if (!character || typeof character !== 'object') return `char:manual:${index}`;
    const existing = character._characterId || character.character_id || character.characterId;
    if (existing) {
        character._characterId = String(existing);
        return character._characterId;
    }
    const chunkIdx = character._firstChunkIdx ?? 'manual';
    character._characterId = `char:${chunkIdx}:${niHashShort(character.name || `角色${index}`)}`;
    return character._characterId;
}

function niBuildCharacterSourceSnapshots(state) {
    const baselineState = { characters: [] };
    (state?.chunkMeta || []).forEach((meta, chunkIndex) => {
        if (!meta) return;
        mergeCharacters(baselineState, meta.characters || [], chunkIndex);
        mergeCharacterAliases(baselineState, meta.character_aliases || meta.aliases || [], chunkIndex);
    });
    const source = new Map();
    baselineState.characters.forEach((character, index) => {
        const id = niEnsureCharacterId(character, index);
        source.set(id, niCloneCheckpointValue(character));
    });
    return source;
}

function niFindCharacterSourceMatch(character, sourceSnapshots, usedSourceIds, index) {
    const existingId = character?._characterId || character?.character_id || character?.characterId;
    if (existingId && sourceSnapshots.has(String(existingId)) && !usedSourceIds.has(String(existingId))) return String(existingId);
    const byName = [...sourceSnapshots.entries()].filter(([id, source]) => !usedSourceIds.has(id) && isSameCharacter(character, source));
    if (byName.length === 1) return byName[0][0];
    const firstChunkIdx = niMaybeNumber(character?._firstChunkIdx);
    if (firstChunkIdx != null) {
        const byChunkAndRole = [...sourceSnapshots.entries()].filter(([id, source]) =>
            !usedSourceIds.has(id) &&
            niMaybeNumber(source?._firstChunkIdx) === firstChunkIdx &&
            String(source?.role || '其他') === String(character?.role || '其他')
        );
        if (byChunkAndRole.length === 1) return byChunkAndRole[0][0];
    }
    return '';
}

export function captureCharacterMemory(state) {
    const memory = [];
    const sourceSnapshots = niBuildCharacterSourceSnapshots(state);
    const snapshots = new Map();
    const usedSourceIds = new Set();
    const manualIds = new Set();

    (state?.characters || []).forEach((character, index) => {
        const sourceId = niFindCharacterSourceMatch(character, sourceSnapshots, usedSourceIds, index);
        const id = sourceId || niEnsureCharacterId(character, index);
        if (sourceId) {
            usedSourceIds.add(sourceId);
            character._characterId = sourceId;
        } else {
            manualIds.add(id);
        }
        const snapshot = niCloneCheckpointValue({ ...character, _characterId: id });
        memory.push(snapshot);
        snapshots.set(id, snapshot);
    });

    memory._characterSnapshots = snapshots;
    memory._characterSourceSnapshots = sourceSnapshots;
    memory._manualCharacterIds = manualIds;
    memory._deletedCharacterIds = new Set([...sourceSnapshots.keys()].filter(id => !usedSourceIds.has(id)));
    return memory;
}

export function restoreCharacterMemory(state, memory) {
    if (!state || !Array.isArray(state.characters) || !Array.isArray(memory)) return;
    const snapshots = memory._characterSnapshots;
    if (!(snapshots instanceof Map)) {
        if (!memory.length) return;
        state.characters.forEach(current => {
            const previous = memory.find(character => isSameCharacter(character, current));
            if (!previous) return;
            const aliases = [];
            [...(previous.aliases || []), ...(current.aliases || [])].forEach(alias => {
                if (!alias?.text || aliases.some(item => item.text === alias.text)) return;
                aliases.push({ ...alias });
            });
            const firstChunkIdx = Math.min(
                niFiniteNumber(previous._firstChunkIdx, Number.MAX_SAFE_INTEGER),
                niFiniteNumber(current._firstChunkIdx, Number.MAX_SAFE_INTEGER)
            );
            Object.assign(current, previous);
            current.aliases = aliases;
            current._firstChunkIdx = firstChunkIdx === Number.MAX_SAFE_INTEGER ? null : firstChunkIdx;
        });
        return;
    }

    const deletedIds = memory._deletedCharacterIds instanceof Set ? memory._deletedCharacterIds : new Set();
    const manualIds = memory._manualCharacterIds instanceof Set ? memory._manualCharacterIds : new Set();
    const next = [];
    const restoredIds = new Set();

    state.characters.forEach((current, index) => {
        const id = niEnsureCharacterId(current, index);
        if (deletedIds.has(id)) return;
        const previous = snapshots.get(id) || memory.find(character => isSameCharacter(character, current));
        if (!previous) {
            next.push(current);
            return;
        }
        const aliases = [];
        [...(previous.aliases || []), ...(current.aliases || [])].forEach(alias => {
            if (!alias?.text || aliases.some(item => item.text === alias.text)) return;
            aliases.push(niCloneCheckpointValue(alias));
        });
        const firstChunkIdx = Math.min(
            niFiniteNumber(previous._firstChunkIdx, Number.MAX_SAFE_INTEGER),
            niFiniteNumber(current._firstChunkIdx, Number.MAX_SAFE_INTEGER)
        );
        const restored = niCloneCheckpointValue(previous);
        restored._characterId = id;
        restored.aliases = aliases;
        restored._firstChunkIdx = firstChunkIdx === Number.MAX_SAFE_INTEGER ? null : firstChunkIdx;
        next.push(restored);
        restoredIds.add(id);
    });

    manualIds.forEach(id => {
        if (restoredIds.has(id)) return;
        const saved = snapshots.get(id);
        if (!saved) return;
        const sameIndex = next.findIndex(character => isSameCharacter(character, saved));
        if (sameIndex >= 0) next[sameIndex] = niCloneCheckpointValue(saved);
        else next.push(niCloneCheckpointValue(saved));
        restoredIds.add(id);
    });
    state.characters = next;
}

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

export function niCleanGenerationJsonText(raw) {
    return String(raw || '').replace(/```json|```/g, '').trim();
}

export function niEmptyCharacterAiProfile(extra = {}) {
    return { identity: '', appearance: '', personality: '', relations: '', ...extra };
}

export function niNormalizeCharacterAiProfile(profile) {
    if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
        return {
            identity: String(profile.identity || '').trim(),
            appearance: String(profile.appearance || '').trim(),
            personality: String(profile.personality || '').trim(),
            relations: String(profile.relations || '').trim(),
        };
    }
    if (typeof profile === 'string' && profile.trim()) {
        return niEmptyCharacterAiProfile({ identity: profile.trim() });
    }
    return niEmptyCharacterAiProfile();
}

export function niCharacterAiProfileHasContent(profile) {
    const normalized = niNormalizeCharacterAiProfile(profile);
    return !!(normalized.identity || normalized.appearance || normalized.personality || normalized.relations);
}

export function niBuildCharacterBaseProfile(character, aliases = []) {
    const lines = [
        `姓名：${character?.name || '未知'}`,
        character?.role ? `分类：${character.role}` : '',
        character?.gender ? `性别：${character.gender}` : '',
        character?.identity ? `原始身份：${character.identity}` : '',
        character?.appearance ? `原始外貌：${character.appearance}` : '',
        character?.personality ? `原始性格：${character.personality}` : '',
        character?.relations ? `原始关系：${character.relations}` : '',
    ].filter(Boolean);
    const usableAliases = aliases
        .map(alias => String(alias || '').trim())
        .filter(Boolean);
    if (usableAliases.length) lines.push(`可靠别名：${[...new Set(usableAliases)].join('、')}`);
    return lines.join('\n');
}

export function niNormalizeCharacterEvidenceText(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, '');
}

export function niCharacterEvidenceHasTarget(text, terms) {
    const normalized = niNormalizeCharacterEvidenceText(text);
    return (terms || []).some(term => {
        const needle = niNormalizeCharacterEvidenceText(term);
        return !!needle && normalized.includes(needle);
    });
}

export function niSelectCharacterEvidenceMessages(messages, terms, {
    messageLimit = 40,
    textLimit = 30000,
    hasTarget = niCharacterEvidenceHasTarget,
} = {}) {
    const rawMessages = (Array.isArray(messages) ? messages : []).slice(-messageLimit)
        .map((message, localIdx) => ({
            localIdx,
            isUser: !!message?.is_user,
            name: message?.name || (message?.is_user ? '用户' : 'AI'),
            text: String(message?.mes || '').trim(),
        }))
        .filter(message => message.text);

    const hitIndices = [];
    rawMessages.forEach((message, localIdx) => {
        if (hasTarget(message.text, terms)) hitIndices.push(localIdx);
    });

    const includedIndices = new Set();
    hitIndices.forEach(index => {
        includedIndices.add(index);
        if (index > 0) includedIndices.add(index - 1);
        if (index < rawMessages.length - 1) includedIndices.add(index + 1);
    });

    const recentChat = rawMessages
        .filter((_, index) => includedIndices.has(index))
        .map(message => `${message.name || (message.isUser ? '用户' : 'AI')}：${message.text}`)
        .join('\n')
        .slice(-textLimit);

    return {
        rawMessages,
        hitIndices,
        recentChat,
        hasTargetEvidence: hitIndices.length > 0,
    };
}

export function niParseCharacterAiProfileResponse(raw, character, {
    matchesTarget = (candidate, target) => String(candidate?.name || '').trim() === String(target || '').trim(),
} = {}) {
    const text = niCleanGenerationJsonText(raw);
    if (!text) throw new Error('AI 返回为空');

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (_) {
        throw new Error('AI 返回不是完整 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('AI 返回 JSON 结构异常');
    }

    const target = String(parsed.target || parsed.name || '').trim();
    if (target && !matchesTarget(character, target)) {
        throw new Error(`AI 返回目标角色不匹配：${target}`);
    }
    if (parsed.appeared === false || String(parsed.appeared).toLowerCase() === 'false') {
        return niEmptyCharacterAiProfile({ _noEvidence: true });
    }
    return {
        identity: String(parsed.identity || ''),
        appearance: String(parsed.appearance || ''),
        personality: String(parsed.personality || ''),
        relations: String(parsed.relations || ''),
    };
}

export function niBuildStageNodeText(nodes) {
    return (Array.isArray(nodes) ? nodes : [])
        .map(node => `[${node?.type}] ${node?.title}：${node?.body}`)
        .join('\n');
}

export function niBuildUserGenerationMessages(content) {
    return [{ role: 'user', content }];
}

export function niBuildStageGenerationInput(nodes, buildPrompt) {
    const nodeText = niBuildStageNodeText(nodes);
    const content = buildPrompt(nodeText);
    return { nodeText, messages: niBuildUserGenerationMessages(content) };
}

export function niNormalizeStageGenerationResult(result) {
    return {
        title: String(result?.title || '').trim(),
        summary: String(result?.summary || '').trim(),
    };
}

export function niParseStageGenerationResponse(raw) {
    return niNormalizeStageGenerationResult(JSON.parse(niCleanGenerationJsonText(raw)));
}

export function niSelectCharacterGenerationIndices(characters, {
    skipIndices = null,
    isExcluded = () => false,
} = {}) {
    return (Array.isArray(characters) ? characters : [])
        .map((character, index) => character?.enabled ? index : -1)
        .filter(index => index !== -1 && !isExcluded(index) && !(skipIndices && skipIndices.has(index)));
}

export function niSelectStageGenerationIndices(stageCount, summaries = {}, skipExisting = false) {
    const count = Math.max(0, parseInt(stageCount, 10) || 0);
    return Array.from({ length: count }, (_, index) => index + 1)
        .filter(stageIndex => !(skipExisting && summaries?.[stageIndex]));
}

export function niParseDeviationGuideSections(text) {
    const raw = String(text || '').trim();
    const empty = { changedFacts: '', currentConstraint: '', preservedFacts: '' };
    if (!raw) return empty;

    const re = /【(已改变事实|当前偏差约束|主要偏差|仍保留的原著事实)】/g;
    const hits = [];
    let match;
    while ((match = re.exec(raw))) hits.push({ title: match[1], index: match.index, end: re.lastIndex });
    if (!hits.length) return { ...empty, currentConstraint: raw };

    const sections = { ...empty };
    hits.forEach((hit, index) => {
        const next = hits[index + 1]?.index ?? raw.length;
        const body = raw.slice(hit.end, next).trim();
        if (!body) return;
        if (hit.title === '已改变事实') {
            sections.changedFacts = [sections.changedFacts, body].filter(Boolean).join('\n');
        } else if (hit.title === '仍保留的原著事实') {
            sections.preservedFacts = [sections.preservedFacts, body].filter(Boolean).join('\n');
        } else if (hit.title === '主要偏差') {
            sections.currentConstraint = [sections.currentConstraint, `【主要偏差】\n${body}`].filter(Boolean).join('\n\n');
        } else {
            sections.currentConstraint = [sections.currentConstraint, body].filter(Boolean).join('\n\n');
        }
    });
    return sections;
}

export const NI_DEV_FACT_SCHEMA_VERSION = 1;

function niDevFactFloor(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function niNormalizeDeviationFact(value, index = 0) {
    const objectValue = value && typeof value === 'object' ? value : null;
    const text = niDevCleanText(objectValue?.text ?? objectValue?.fact ?? objectValue?.statement ?? value);
    if (!text) return null;
    const explicitId = niDevCleanText(objectValue?.id ?? objectValue?.factId ?? objectValue?.fact_id);
    const id = explicitId || `fact:${niHashShort(niDevLineKey(text) || `${index}:${text}`)}`;
    const status = ['active', 'retired', 'superseded'].includes(objectValue?.status)
        ? objectValue.status
        : 'active';
    return {
        id,
        text,
        kind: niDevCleanText(objectValue?.kind ?? objectValue?.type) || 'fact',
        status,
        createdFloor: niDevFactFloor(objectValue?.createdFloor ?? objectValue?.created_floor),
        updatedFloor: niDevFactFloor(objectValue?.updatedFloor ?? objectValue?.updated_floor),
        confirmedFloor: niDevFactFloor(objectValue?.confirmedFloor ?? objectValue?.confirmed_floor),
        sourceFloor: niDevFactFloor(objectValue?.sourceFloor ?? objectValue?.source_floor ?? objectValue?.evidenceFloor ?? objectValue?.evidence_floor),
    };
}

export function niNormalizeDeviationFacts(source) {
    let raw = source;
    if (source && !Array.isArray(source) && typeof source === 'object') {
        raw = source.facts ?? source.changedFacts ?? source.devChangedFacts ?? [];
    }
    if (typeof raw === 'string') raw = raw.split(/\n+/);
    if (!Array.isArray(raw)) raw = [];
    const facts = [];
    const seenIds = new Set();
    const seenKeys = new Set();
    raw.forEach((value, index) => {
        const fact = niNormalizeDeviationFact(value, index);
        if (!fact) return;
        const key = niDevLineKey(fact.text);
        if (seenIds.has(fact.id) || (key && seenKeys.has(key))) return;
        seenIds.add(fact.id);
        if (key) seenKeys.add(key);
        facts.push(fact);
    });
    return facts;
}

export function niActiveDeviationFacts(source) {
    return niNormalizeDeviationFacts(source).filter(fact => fact.status === 'active');
}

export function niBuildDeviationFactsText(source) {
    return niActiveDeviationFacts(source)
        .map(fact => `- ${fact.text}`)
        .join('\n')
        .trim();
}

export function niBuildDeviationFactsContext(source) {
    return niActiveDeviationFacts(source).map(fact => ({
        id: fact.id,
        kind: fact.kind,
        text: fact.text,
        recorded_floor: fact.createdFloor ?? fact.confirmedFloor ?? fact.updatedFloor,
        updated_floor: fact.updatedFloor != null
            && fact.updatedFloor > (fact.createdFloor ?? fact.confirmedFloor ?? fact.updatedFloor)
            ? fact.updatedFloor
            : null,
    }));
}

export function niNormalizeDeviationFactHistory(source) {
    if (!Array.isArray(source)) return [];
    return source
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            action: ['add', 'update', 'remove'].includes(item.action) ? item.action : 'update',
            factId: niDevCleanText(item.factId ?? item.fact_id ?? item.id),
            before: niDevCleanText(item.before),
            after: niDevCleanText(item.after),
            floor: niDevFactFloor(item.floor ?? item.atFloor ?? item.at_floor),
        }))
        .filter(item => item.factId || item.before || item.after);
}

export function niDiffDeviationFacts(before, after, { floor = null } = {}) {
    const oldFacts = niActiveDeviationFacts(before);
    const newFacts = niActiveDeviationFacts(after);
    const oldById = new Map(oldFacts.map(fact => [fact.id, fact]));
    const newById = new Map(newFacts.map(fact => [fact.id, fact]));
    const changes = [];
    newFacts.forEach(fact => {
        const old = oldById.get(fact.id);
        if (!old) {
            changes.push({ action: 'add', factId: fact.id, before: '', after: fact.text, floor: niDevFactFloor(floor) });
        } else if (old.text !== fact.text) {
            changes.push({ action: 'update', factId: fact.id, before: old.text, after: fact.text, floor: niDevFactFloor(floor) });
        }
    });
    oldFacts.forEach(fact => {
        if (!newById.has(fact.id)) {
            changes.push({ action: 'remove', factId: fact.id, before: fact.text, after: '', floor: niDevFactFloor(floor) });
        }
    });
    return changes;
}

export function niReconcileDeviationFacts(existing, incoming, {
    floor = null,
    range = null,
    preserveMissing = true,
    removed = [],
} = {}) {
    const oldFacts = niNormalizeDeviationFacts(existing);
    const incomingFacts = niNormalizeDeviationFacts(incoming);
    const oldById = new Map(oldFacts.map(fact => [fact.id, fact]));
    const oldByKey = new Map(oldFacts.map(fact => [niDevLineKey(fact.text), fact]));
    const matched = new Set();
    const currentFloor = niDevFactFloor(floor);
    const rangeStart = niDevFactFloor(range?.startFloor ?? range?.start_floor);
    const rangeEnd = niDevFactFloor(range?.endFloor ?? range?.end_floor);
    const sourceFloorFor = fact => {
        const sourceFloor = niDevFactFloor(fact?.sourceFloor);
        if (sourceFloor == null) return range ? null : currentFloor;
        if (rangeStart != null && sourceFloor < rangeStart) return null;
        if (rangeEnd != null && sourceFloor > rangeEnd) return null;
        return sourceFloor;
    };
    const nextFacts = [];

    incomingFacts.forEach((incomingFact) => {
        const key = niDevLineKey(incomingFact.text);
        const old = oldById.get(incomingFact.id)
            || oldByKey.get(key);
        if (old) {
            matched.add(old.id);
            const textChanged = old.text !== incomingFact.text;
            const recordedFloor = old.createdFloor ?? old.confirmedFloor ?? old.updatedFloor ?? incomingFact.createdFloor ?? sourceFloorFor(incomingFact);
            nextFacts.push({
                ...old,
                ...incomingFact,
                id: old.id,
                status: incomingFact.status === 'active' ? 'active' : incomingFact.status,
                updatedFloor: textChanged ? sourceFloorFor(incomingFact) : old.updatedFloor,
                confirmedFloor: old.confirmedFloor,
                createdFloor: recordedFloor,
                sourceFloor: null,
            });
        } else {
            const recordedFloor = sourceFloorFor(incomingFact) ?? incomingFact.createdFloor;
            nextFacts.push({
                ...incomingFact,
                status: 'active',
                createdFloor: recordedFloor,
                updatedFloor: null,
                confirmedFloor: null,
                sourceFloor: null,
            });
        }
    });

    const removedValues = Array.isArray(removed) ? removed : [removed];
    const removedKeys = new Set(
        removedValues
            .map(value => niDevCleanText(value && typeof value === 'object' ? value.id ?? value.factId ?? value.fact_id : value))
            .filter(value => value.startsWith('fact:')),
    );
    const removedTextKeys = new Set(
        removedValues
            .map(value => niDevCleanText(value && typeof value === 'object' ? value.text ?? value.fact : value))
            .filter(value => !value.startsWith('fact:'))
            .map(niDevLineKey)
            .filter(Boolean),
    );
    oldFacts.forEach(old => {
        const shouldRemove = removedKeys.has(old.id) || removedTextKeys.has(niDevLineKey(old.text));
        if (shouldRemove) {
            nextFacts.push({ ...old, status: 'retired', updatedFloor: currentFloor ?? old.updatedFloor });
            matched.add(old.id);
        } else if (preserveMissing && !matched.has(old.id)) {
            nextFacts.push(old);
        }
    });

    return {
        facts: niNormalizeDeviationFacts(nextFacts),
        changes: niDiffDeviationFacts(oldFacts, nextFacts, { floor: currentFloor }),
    };
}

export function niNormalizeDeviationSections(source = {}) {
    const legacyText = String(source?.deviationGuide ?? source?.guide ?? '').trim();
    const parsed = legacyText ? niParseDeviationGuideSections(legacyText) : {};
    const facts = niNormalizeDeviationFacts(
        source?.facts ?? source?.devFacts ?? (source?.changedFacts ?? source?.devChangedFacts ?? parsed.changedFacts),
    );
    return {
        facts,
        factHistory: niNormalizeDeviationFactHistory(source?.factHistory ?? source?.devFactHistory),
        removedFacts: Array.isArray(source?.removedFacts) ? source.removedFacts : [],
        changedFacts: niBuildDeviationFactsText(facts),
        currentConstraint: String(source?.currentConstraint ?? source?.devCurrentConstraint ?? parsed.currentConstraint ?? '').trim(),
        preservedFacts: String(source?.preservedFacts ?? source?.devPreservedFacts ?? parsed.preservedFacts ?? '').trim(),
    };
}

export function niBuildDeviationGuideFromSections(sections = {}) {
    const normalized = niNormalizeDeviationSections(sections);
    const parts = [];
    if (normalized.changedFacts) parts.push(`【已改变事实】\n${normalized.changedFacts}`);
    if (normalized.currentConstraint) parts.push(`【当前偏差约束】\n${normalized.currentConstraint}`);
    if (normalized.preservedFacts) parts.push(`【仍保留的原著事实】\n${normalized.preservedFacts}`);
    return parts.join('\n\n').trim();
}

export function niDevCleanText(value) {
    return String(value ?? '').trim();
}

export function niDevListText(items) {
    const list = Array.isArray(items) ? items.map(niDevCleanText).filter(Boolean) : [];
    if (!list.length) return '';
    return list.map(text => /^([-*•]|\d+[.、])\s*/.test(text) ? text : `- ${text}`).join('\n');
}

export function niBuildMajorDeviationText(json) {
    const major = Array.isArray(json?.major_deviations) ? json.major_deviations : [];
    const lines = major.map(item => {
        if (!item || typeof item !== 'object') return '';
        const type = niDevCleanText(item.type);
        const original = niDevCleanText(item.original_fact);
        const current = niDevCleanText(item.current_fact);
        const impact = niDevCleanText(item.impact);
        const lock = item.irreversible ? '；约束：不得用同一事件、同一事故或同一理由强行恢复原著结果' : '';
        const head = type ? `【${type}】` : '';
        return `- ${head}原著：${original || '未提供'}；当前：${current || '未提供'}${impact ? `；影响：${impact}` : ''}${lock}`;
    }).filter(Boolean);
    return lines.length ? `【主要偏差】\n${lines.join('\n')}` : '';
}

export function niBuildDeviationSectionsFromAnalysis(json) {
    if (!json || typeof json !== 'object') return { changedFacts: '', currentConstraint: '', preservedFacts: '' };
    const guide = niDevCleanText(json.current_deviation_constraint ?? json.deviation_injection_prompt);
    const major = niBuildMajorDeviationText(json);
    const facts = niNormalizeDeviationFacts(json.changed_facts ?? json.facts);
    return niNormalizeDeviationSections({
        facts,
        removedFacts: Array.isArray(json.removed_facts) ? json.removed_facts : [],
        currentConstraint: [guide, major].filter(Boolean).join('\n\n'),
        preservedFacts: niDevListText(json.preserved_facts),
    });
}

export function niDevLineKey(text) {
    return String(text || '')
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[.、]\s*/, '')
        .replace(/\s+/g, '')
        .trim();
}

export function niAppendDeviationFacts(existing, additions) {
    const oldLines = String(existing || '').split(/\n+/).map(text => text.trim()).filter(Boolean);
    const newLines = String(additions || '').split(/\n+/).map(text => text.trim()).filter(Boolean);
    const seen = new Set(oldLines.map(niDevLineKey).filter(Boolean));
    for (const line of newLines) {
        const key = niDevLineKey(line);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        oldLines.push(line);
    }
    return oldLines.join('\n').trim();
}

export function niMergeDeviationSections(existing, next, { floor = null, range = null } = {}) {
    const oldSections = niNormalizeDeviationSections(existing);
    const nextSections = niNormalizeDeviationSections(next);
    const factResult = niReconcileDeviationFacts(oldSections.facts, nextSections.facts, {
        floor,
        range,
        preserveMissing: true,
        removed: nextSections.removedFacts,
    });
    const factHistory = [
        ...oldSections.factHistory,
        ...factResult.changes,
    ];
    return niNormalizeDeviationSections({
        facts: factResult.facts,
        factHistory,
        currentConstraint: nextSections.currentConstraint,
        preservedFacts: nextSections.preservedFacts,
    });
}

export const NI_DEV_CURRENT_TEXT_LIMIT = 30000;
export const NI_DEV_RECALL_TEXT_LIMIT = 2600;
export const NI_DEV_MIN_ENTRY_TEXT_LIMIT = 180;

export function niDevStripInternalBlocks(text) {
    return String(text || '')
        .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
        .trim();
}

export function niDevClipMiddle(text, limit) {
    const raw = String(text || '').trim();
    const max = Math.max(20, parseInt(limit, 10) || 20);
    if (raw.length <= max) return raw;
    const marker = `\n……（本楼中间省略 ${raw.length - max} 字）……\n`;
    const keep = Math.max(10, max - marker.length);
    const head = Math.ceil(keep * 0.45);
    const tail = Math.max(10, keep - head);
    return `${raw.slice(0, head).trimEnd()}${marker}${raw.slice(-tail).trimStart()}`;
}

export function niBuildDevChatEntriesText(entries, totalLimit = NI_DEV_CURRENT_TEXT_LIMIT, options = {}) {
    const list = Array.isArray(entries) ? entries.filter(entry => entry?.text) : [];
    if (!list.length) return '';
    const minEntryLimit = Math.max(40, parseInt(options.minEntryLimit, 10) || NI_DEV_MIN_ENTRY_TEXT_LIMIT);
    const preserveEachEntry = options.preserveEachEntry !== false;
    const requestedTotal = Math.max(200, parseInt(totalLimit, 10) || NI_DEV_CURRENT_TEXT_LIMIT);
    const maxTotal = preserveEachEntry ? Math.max(list.length * minEntryLimit, requestedTotal) : requestedTotal;
    let perEntryLimit = Math.max(minEntryLimit, Math.floor((maxTotal - list.length * 24) / list.length));
    const build = () => list
        .map(entry => `【第 ${entry.floor} 楼】${entry.role}\n${niDevClipMiddle(entry.text, perEntryLimit)}`)
        .join('\n\n');
    let text = build();
    while (text.length > maxTotal && perEntryLimit > minEntryLimit) {
        perEntryLimit = Math.max(minEntryLimit, Math.floor(perEntryLimit * 0.82));
        text = build();
    }
    return text.length > maxTotal ? niDevClipMiddle(text, maxTotal) : text;
}

export function niDevMessageMesId(message) {
    const candidates = [message?.mes_id, message?.mesId, message?.message_id, message?.messageId, message?.id];
    for (const value of candidates) {
        if (value === undefined || value === null || value === '') continue;
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0) return Math.floor(number);
    }
    return null;
}

export function niDevMessageFloor(message, fallbackIndex = null) {
    const explicit = Number(message?._niFloor ?? message?.floor);
    if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
    const mesId = niDevMessageMesId(message);
    if (mesId != null) return mesId;
    const index = Number(fallbackIndex);
    return Number.isFinite(index) && index >= 0 ? Math.floor(index) : null;
}

export function niDevMessageText(message) {
    const raw = String(message?.mes ?? message?.message ?? message?.content ?? '').trim();
    return niDevStripInternalBlocks(raw) || raw;
}

export function niDevIsCountableMessage(message) {
    const role = String(message?.role || '').toLowerCase();
    if (role === 'system' || message?.is_system === true || message?.extra?.isSmallSys === true) return false;
    return !!niDevMessageText(message);
}

export function niDevMessageRole(message) {
    const role = String(message?.role || '').toLowerCase();
    if (message?.is_user || role === 'user') return '[用户]';
    if (role === 'system' || message?.is_system === true || message?.extra?.isSmallSys === true) return '[系统]';
    return '[AI]';
}

export function niMergeDevMessagesByFloor(...sources) {
    const byFloor = new Map();
    sources.flat().filter(Boolean).forEach((message, index) => {
        const floor = niDevMessageFloor(message, index);
        if (floor == null) return;
        const existing = byFloor.get(floor);
        if (!existing || !niDevMessageText(existing) || (niDevMessageMesId(existing) == null && niDevMessageMesId(message) != null)) {
            byFloor.set(floor, message);
        }
    });
    return [...byFloor.values()].sort((a, b) => (niDevMessageFloor(a) || 0) - (niDevMessageFloor(b) || 0));
}

export function niNormalizeDevRange(range) {
    if (!range) return null;
    const start = parseInt(range.startFloor ?? range.start ?? range.from, 10);
    const end = parseInt(range.endFloor ?? range.end ?? range.to, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) return null;
    const startFloor = Math.min(start, end);
    const endFloor = Math.max(start, end);
    return { startFloor, endFloor, count: endFloor - startFloor + 1 };
}

export function niDevRangeLabel(range) {
    const normalized = niNormalizeDevRange(range);
    if (!normalized) return '当前范围';
    return normalized.startFloor === normalized.endFloor
        ? `第 ${normalized.startFloor} 楼`
        : `第 ${normalized.startFloor}-${normalized.endFloor} 楼`;
}

export function niDevRangeProgressLabel(range, action = '更新') {
    const normalized = niNormalizeDevRange(range);
    if (!normalized) return `当前范围${action}中...`;
    return normalized.startFloor === normalized.endFloor
        ? `第 ${normalized.startFloor} 层${action}中...`
        : `第 ${normalized.startFloor} 到 ${normalized.endFloor} 层${action}中...`;
}

export function createStoryController(deps = {}) {
    const niEmptyCharAiProfile = niEmptyCharacterAiProfile;
    const niNormalizeCharAiProfile = niNormalizeCharacterAiProfile;
    const niCharAiProfileHasContent = niCharacterAiProfileHasContent;
    const S = deps.state || {};
    const q = deps.query || (() => null);
    const qa = deps.queryAll || (() => []);
    const document = deps.document || globalThis.document;
    const window = deps.globalWindow || globalThis.window || {};
    const console = deps.logger || globalThis.console || { log() {}, warn() {}, error() {} };
    const alert = deps.alert || (message => globalThis.alert?.(message));
    const confirm = deps.confirm || (message => globalThis.confirm?.(message));
    const prompt = deps.prompt || ((...args) => globalThis.prompt?.(...args));
    const toastr = deps.toastr || globalThis.toastr;
    const extension_settings = deps.extensionSettings || {};
    const EXT_NAME = deps.extensionName || '';
    const DEFAULT_SETTINGS = deps.defaultSettings || {};
    const niEscHtml = deps.escapeHtml || (value => String(value ?? ''));
    const niEscAttr = deps.escapeAttr || niEscHtml;
    const niSaveSettings = deps.saveSettings || (() => {});
    const saveSettingsDebounced = deps.saveSettingsDebounced || (() => {});
    const canUseDerivedModules = deps.canUseDerived || (() => false);
    const callCleanApi = deps.callCleanApi;
    const callApiSeq = deps.callApiSeq;
    const getContext = deps.getContext || (() => null);
    const niSwitchPage = deps.switchPage || (() => {});
    const niRenderVecStageSelector = deps.renderVectorStageSelector || (() => {});
    const niUpdateVecOffBtn = deps.updateVectorOffButton || (() => {});
    const niEnsureChunksLoaded = deps.ensureChunksLoaded || (async () => false);
    const niBuildStagesWithChunksIfNeeded = deps.buildStagesWithChunksIfNeeded || (async () => '');
    const niRenderUserSubUI = deps.renderUserSubUI || (() => {});
    const niSyncRoleplayToDepth = deps.syncRoleplayToDepth || (() => {});
    const niGetUserSubConfig = deps.getUserSubConfig || (() => ({}));
    const niIsUserSubPlayMode = deps.isUserSubPlayMode || (() => false);
    const niIsUserSubSelectedChar = deps.isUserSubSelectedChar || (() => false);
    const niIsUserSubReplaceSelectedChar = deps.isUserSubReplaceSelectedChar || (() => false);
    const niGetActiveUserSubNames = deps.getActiveUserSubNames || (() => []);
    const niGetSelectedUserSubCharName = deps.getSelectedUserSubCharName || (() => '');
    const niGetUserSubAliasOverride = deps.getUserSubAliasOverride || (() => null);
    const niUserSubAliasKind = deps.userSubAliasKind || (alias => alias?.kind || '');
    const niUserSubAliasIsActive = deps.userSubAliasIsActive || (() => true);
    const niUserSubStageReached = deps.userSubStageReached || (() => true);
    const niUserSubAliasKey = deps.userSubAliasKey || (alias => String(alias?.text || ''));
    const niHasLoadedChunks = deps.hasLoadedChunks || (() => false);
    const setTimeout = deps.setTimeout || globalThis.setTimeout;
    const AbortController = deps.AbortController || globalThis.AbortController;

    function niApplyManualPlotOrderForType(type, orderedRefs = null) {
        const refs = (orderedRefs || S.plots[type] || []).filter(Boolean);
        const all = getAllPlotsInStoryOrder(S).sort(niComparePlotBaseOrder);
        const slots = all
            .map((entry, index) => entry._type === type ? niPlotBaseOrder(entry, index) : null)
            .filter(slot => slot != null);
        let nextSlot = slots.length ? slots[slots.length - 1] : null;
        refs.forEach((ref, index) => {
            if (slots[index] != null) {
                ref._manualOrder = slots[index];
                return;
            }
            nextSlot = nextSlot == null
                ? niPlotBaseOrder(ref, index)
                : nextSlot + NI_PLOT_NODE_ORDER_STEP;
            ref._manualOrder = nextSlot;
        });
        S.plots[type] = refs;
        rebuildStageMapFromPlotStageIdx(S);
        niSyncSubPlotStageAssignments();
    }
    
    function niMovePlotByDisplayPosition(type, fromPos, toPos) {
        const arr = S.plots[type] || [];
        const entries = niOrderedPlotEntries([{ type, items: arr }]);
        if (fromPos < 0 || toPos < 0 || fromPos >= entries.length || toPos >= entries.length || fromPos === toPos) return false;
        const [moved] = entries.splice(fromPos, 1);
        entries.splice(toPos, 0, moved);
        const orderedRefs = entries.map(entry => entry._plotRef).filter(Boolean);
        niApplyManualPlotOrderForType(type, orderedRefs);
        return true;
    }
    
    function niSyncPlotActionButtons(exitModes = false) {
        const tab = ['timeline', 'main', 'sub', 'pivot'].includes(_currentPlotTab) ? _currentPlotTab : 'timeline';
        _currentPlotTab = tab;
    
        const isTimeline = tab === 'timeline';
        const delBtn  = q('#ni-plot-del-btn');
        const editBtn = q('#ni-plot-edit-btn');
        const linkBtn = q('#ni-plot-link-btn');
        if (delBtn)  delBtn.style.display  = isTimeline ? 'none' : '';
        if (editBtn) editBtn.style.display = isTimeline ? 'none' : '';
        if (linkBtn) linkBtn.style.display = isTimeline ? '' : 'none';
    
        if (exitModes && isTimeline) {
            if (_plotDelMode)  niTogglePlotDel();
            if (_plotEditMode) niTogglePlotEdit();
        }
    
        if (delBtn) {
            delBtn.classList.toggle('ni-mode-on', _plotDelMode && !isTimeline);
            delBtn.setAttribute('aria-pressed', String(_plotDelMode && !isTimeline));
        }
        if (editBtn) {
            editBtn.classList.toggle('ni-mode-on', _plotEditMode && !isTimeline);
            editBtn.setAttribute('aria-pressed', String(_plotEditMode && !isTimeline));
        }
    }
    
    function renderPlots() {
        // 记录原始数组下标再排序，确保编辑/删除时能正确定位 S.plots[type][originalIdx]
        const main  = niOrderedPlotEntries([{ type: 'main',  items: S.plots.main  || [] }]);
        const sub   = niOrderedPlotEntries([{ type: 'sub',   items: S.plots.sub   || [] }]);
        const pivot = niOrderedPlotEntries([{ type: 'pivot', items: S.plots.pivot || [] }]);
    
        q('#ni-plot-count-lbl').textContent =
            `主线 ${main.length} · 支线 ${sub.length} · 转折 ${pivot.length}`;
    
        renderTimeline(main, sub, pivot);
        renderPlotList('ni-tp-main',  main,  'ni-bp', '主线');
        renderPlotList('ni-tp-sub',   sub,   'ni-bt', '支线');
        renderPlotList('ni-tp-pivot', pivot, 'ni-bc', '转折');
    
        niSyncPlotActionButtons(false);
    }
    
    // ============================================================
    // 时间轴渲染
    // ============================================================
    function renderTimeline(main, sub, pivot) {
        const el = q('#ni-tp-timeline');
        if (!el) return;
    
        // Merge main + pivot, sort by chunkIdx
        const nodes = [
            ...main.map((p, i) => ({ ...p, _type: 'main', _mainIdx: i })),
            ...pivot.map((p, i) => ({ ...p, _type: 'pivot', _pivotIdx: i })),
        ].sort(niComparePlotOrder);
    
        if (!nodes.length) {
            el.innerHTML = '<div class="ni-empty"><i class="ti ti-book-off"></i>暂无数据</div>';
            return;
        }
    
        // Build sub lookup using branch_links
        // sub title → { subIdx, subObj }
        const subTitleMap = {};
        sub.forEach((s, i) => { subTitleMap[s.title] = { _subIdx: i, ...s }; });
    
        // For each node, resolve branch_links → matched sub items + foreshadow strings
        // subByNode[ni] = { subs: [...], foreshadows: [...] }
        const subByNode = {};
        nodes.forEach((node, ni) => {
            const links = node.branch_links || [];
            const subs = [];
            const foreshadows = [];
            links.forEach(link => {
                if (link.startsWith('【伏笔】')) {
                    foreshadows.push(link.replace('【伏笔】', '').trim());
                } else if (subTitleMap[link]) {
                    subs.push(subTitleMap[link]);
                }
            });
            if (subs.length || foreshadows.length) subByNode[ni] = { subs, foreshadows };
        });
    
        el.innerHTML = '<div class="ni-timeline">' + nodes.map((node, ni) => {
            const isPivot = node._type === 'pivot';
            const badgeCls = isPivot ? 'ni-bc' : 'ni-bp';
            const badgeTxt = isPivot ? '转折' : '主线';
            const nodeId = `ni-tl-${ni}`;
    
            // sub_notes as small numbered items
            const subNotesHtml = node.sub_notes?.length
                ? '<div class="ni-tl-subnotes">' +
                  node.sub_notes.map((s, si) =>
                      `<span class="ni-tl-note"><span class="ni-tl-note-num">${si + 1}</span>${niEscHtml(s)}</span>`
                  ).join('') +
                  '</div>'
                : '';
    
            // linked sub plots + foreshadows
            const linked = subByNode[ni] || { subs: [], foreshadows: [] };
            const subLinksHtml = (linked.subs.length || linked.foreshadows.length)
                ? '<div class="ni-tl-branches">' +
                  linked.subs.map(s =>
                      `<button class="ni-tl-branch-link" data-sub-idx="${s._subIdx}" title="${niEscAttr(s.title)}"><i class="ti ti-git-branch"></i><span>${niEscHtml(s.title)}</span></button>`
                  ).join('') +
                  linked.foreshadows.map(f =>
                      `<span class="ni-tl-foreshadow"><i class="ti ti-bookmark"></i><span>${niEscHtml(f)}</span></span>`
                  ).join('') +
                  '</div>'
                : '';
    
            const metaHtml = (node.time || node.location || node.stageLabel)
                ? `<div class="ni-tl-meta">
                    ${node.time ? `<span class="ni-pmeta"><i class="ti ti-clock"></i>${niEscHtml(node.time)}</span>` : ''}
                    ${node.location ? `<span class="ni-pmeta"><i class="ti ti-map-pin"></i>${niEscHtml(node.location)}</span>` : ''}
                    ${node.stageIdx != null ? `<button class="ni-stage-link" data-stage-idx="${node.stageIdx}"><i class="ti ti-layout-list"></i>${niEscHtml(node.stageLabel)}</button>` : ''}
                  </div>`
                : '';
    
            return `<div class="ni-tl-item${isPivot ? ' ni-tl-pivot' : ''}" id="${nodeId}">
              <div class="ni-tl-spine">
                <div class="ni-tl-dot${isPivot ? ' ni-tl-dot-pivot' : ''}"></div>
                <div class="ni-tl-line"></div>
              </div>
              <div class="ni-tl-content">
                <div class="ni-tl-head" data-tl-id="${nodeId}">
                  <span class="ni-badge ${badgeCls}">${badgeTxt}</span>
                  <span class="ni-plot-name">${niEscHtml(node.title)}</span>
                  <i class="ti ti-chevron-down ni-plot-chev"></i>
                </div>
                <div class="ni-tl-body">
                  <p class="ni-plot-txt">${niEscHtml(node.body)}</p>
                  ${subNotesHtml}
                  ${subLinksHtml}
                  ${metaHtml}
                </div>
              </div>
            </div>`;
        }).join('') + '</div>';
    }
    function renderPlotList(containerId, items, badgeCls, label) {
        const el = q(`#${containerId}`);
        if (!el) return;
        if (!items.length) {
            el.innerHTML = '<div class="ni-empty"><i class="ti ti-book-off"></i>暂无数据</div>';
            return;
        }
    
        // Build sub title → index map for branch_links resolution
        const allSub = niOrderedPlotEntries([{ type: 'sub', items: S.plots.sub || [] }]);
        const subTitleMap = {};
        allSub.forEach((s, i) => { subTitleMap[s.title] = i; });
    
        el.innerHTML = items.map((it, i) => {
            const origIdx = it._originalIdx ?? i;
            const id = `ni-pi-${containerId}-${origIdx}`;
            const nodeId = niEnsurePlotNodeId(it, it._type || label, origIdx);
    
            // sub_notes: small numbered events
            const subNotesHtml = it.sub_notes?.length
                ? '<div class="ni-tl-subnotes">' +
                  it.sub_notes.map((s, si) =>
                      `<span class="ni-tl-note"><span class="ni-tl-note-num">${si + 1}</span>${niEscHtml(s)}</span>`
                  ).join('') +
                  '</div>'
                : '';
    
            // branch_links: sub plot buttons + foreshadow tags
            const links = it.branch_links || [];
            const subBtns = [], foreshadows = [];
            links.forEach(lk => {
                if (lk.startsWith('【伏笔】')) {
                    foreshadows.push(lk.replace('【伏笔】', '').trim());
                } else if (subTitleMap[lk] !== undefined) {
                    subBtns.push({ idx: subTitleMap[lk], title: lk });
                }
            });
            const branchHtml = (subBtns.length || foreshadows.length)
                ? '<div class="ni-tl-branches">' +
                  subBtns.map(s =>
                      `<button class="ni-tl-branch-link" data-sub-idx="${s.idx}" title="${niEscAttr(s.title)}"><i class="ti ti-git-branch"></i><span>${niEscHtml(s.title)}</span></button>`
                  ).join('') +
                  foreshadows.map(f =>
                      `<span class="ni-tl-foreshadow"><i class="ti ti-bookmark"></i><span>${niEscHtml(f)}</span></span>`
                  ).join('') +
                  '</div>'
                : '';
    
            return `<div class="ni-plot-item" id="${id}" draggable="true" data-plot-type="${containerId}" data-plot-idx="${origIdx}" data-plot-pos="${i}" data-node-id="${niEscAttr(nodeId)}">
              <div class="ni-plot-head" data-plot-id="${id}">
                <i class="ti ti-grip-vertical ni-plot-drag-handle" title="拖拽排序"></i>
                <span class="ni-badge ${badgeCls}">${label}${i + 1}</span>
                <span class="ni-plot-name">${niEscHtml(it.title)}</span>
                <i class="ti ti-chevron-down ni-plot-chev"></i>
              </div>
              <div class="ni-plot-body">
                <p class="ni-plot-txt">${niEscHtml(it.body)}</p>
                ${subNotesHtml}
                ${branchHtml}
                <div class="ni-plot-meta">
                  ${it.time ? `<span class="ni-pmeta"><i class="ti ti-clock"></i>${niEscHtml(it.time)}</span>` : ''}
                  ${it.location ? `<span class="ni-pmeta"><i class="ti ti-map-pin"></i>${niEscHtml(it.location)}</span>` : ''}
                  ${it.stageIdx != null ? `<button class="ni-stage-link" data-stage-idx="${it.stageIdx}"><i class="ti ti-layout-list"></i>${niEscHtml(it.stageLabel)}</button>` : ''}
                </div>
              </div>
            </div>`;
        }).join('');
    
        // 拖拽排序绑定
        niBindPlotDrag(el, containerId);
    }
    
    function niTogglePlot(id) { q(`#${id}`)?.classList.toggle('open'); }
    
    // ============================================================
    // 剧情列表拖拽排序
    // ============================================================
    function niBindPlotDrag(container, containerId) {
        const typeMap = { 'ni-tp-main': 'main', 'ni-tp-sub': 'sub', 'ni-tp-pivot': 'pivot' };
        const plotType = typeMap[containerId];
        if (!plotType) return;
    
        let dragSrc = null;
    
        container.querySelectorAll('.ni-plot-item').forEach(item => {
            item.setAttribute('draggable', 'true');
    
            const handle = item.querySelector('.ni-plot-drag-handle');
            if (handle) {
                // ── 手机端 Touch 拖拽支持 ──
                handle.addEventListener('touchstart', e => {
                    if (_plotEditMode || _plotDelMode) return;
                    e.stopPropagation();
                    dragSrc = item;
                    item.classList.add('ni-drag-ghost');
                }, { passive: true });
    
                handle.addEventListener('touchmove', e => {
                    if (!dragSrc) return;
                    e.preventDefault(); // 阻止页面滚动，确保拖拽优先
                    const touch = e.touches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const overItem = target?.closest('.ni-plot-item');
                    if (overItem && overItem !== dragSrc) {
                        container.querySelectorAll('.ni-plot-item').forEach(el => el.classList.remove('ni-drag-over'));
                        overItem.classList.add('ni-drag-over');
                    }
                }, { passive: false });
    
                handle.addEventListener('touchend', e => {
                    if (!dragSrc) return;
                    const touch = e.changedTouches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const overItem = target?.closest('.ni-plot-item');
                    if (overItem && overItem !== dragSrc) {
                        const fromPos = parseInt(dragSrc.dataset.plotPos);
                        const toPos   = parseInt(overItem.dataset.plotPos);
                        if (!isNaN(fromPos) && !isNaN(toPos) && fromPos !== toPos) {
                            niMovePlotByDisplayPosition(plotType, fromPos, toPos);
                            niSaveSettings();
                            renderPlots();
                        }
                    }
                    container.querySelectorAll('.ni-plot-item').forEach(el => {
                        el.classList.remove('ni-drag-ghost', 'ni-drag-over');
                    });
                    dragSrc = null;
                });
            }
    
            item.addEventListener('dragstart', e => {
                if (_plotEditMode || _plotDelMode) {
                    e.preventDefault();
                    return;
                }
                dragSrc = item;
                item.classList.add('ni-drag-ghost');
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('dragend', () => {
                dragSrc = null;
                container.querySelectorAll('.ni-plot-item').forEach(el => {
                    el.classList.remove('ni-drag-ghost', 'ni-drag-over');
                });
            });
            item.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (item !== dragSrc) {
                    container.querySelectorAll('.ni-plot-item').forEach(el => el.classList.remove('ni-drag-over'));
                    item.classList.add('ni-drag-over');
                }
            });
            item.addEventListener('drop', e => {
                e.preventDefault();
                if (!dragSrc || dragSrc === item) return;
    
                const fromPos = parseInt(dragSrc.dataset.plotPos);
                const toPos   = parseInt(item.dataset.plotPos);
                if (isNaN(fromPos) || isNaN(toPos) || fromPos === toPos) return;
                if (!niMovePlotByDisplayPosition(plotType, fromPos, toPos)) return;
    
                niSaveSettings();
                renderPlots();
            });
        });
    
        // 拖拽手柄阻止展开/折叠事件
        container.querySelectorAll('.ni-plot-drag-handle').forEach(handle => {
            handle.addEventListener('click', e => e.stopPropagation());
        });
    }
    window.niTogglePlot = niTogglePlot;
    
    function niJumpToStage(idx) {
        const btn = q('.ni-nav-btn:nth-child(4)');
        niSwitchPage('stage', btn);
        buildStages(); // 确保向量化状态标签实时更新
        setTimeout(() => {
            const el = q(`#ni-si-${idx}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 80);
    }
    window.niJumpToStage = niJumpToStage;
    
    // ============================================================
    // 修补 branch_links 关联
    // ============================================================
    async function niRepairBranchLinks() {
        const btn = q('#ni-plot-link-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i>修补中…'; }
    
        const main  = S.plots.main  || [];
        const sub   = S.plots.sub   || [];
        const pivot = S.plots.pivot || [];
    
        if (!sub.length) {
            toastr?.info('没有支线节点，无需修补。');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-link"></i>修补关联'; }
            return;
        }
        if (!main.length && !pivot.length) {
            toastr?.info('没有主线/转折节点，无需修补。');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-link"></i>修补关联'; }
            return;
        }
    
        // 构造给 AI 的数据摘要
        const mainList = niOrderedPlotEntries([
            { type: 'main', items: main },
            { type: 'pivot', items: pivot },
        ]).map((p, order) => ({ order, idx: p._sourceIdx, type: p._type, title: p.title, time: p.time || '', body: (p.body || '').slice(0, 60) }));
        const subList = niOrderedPlotEntries([{ type: 'sub', items: sub }])
            .map(s => ({ idx: s._sourceIdx, title: s.title, time: s.time || '', body: (s.body || '').slice(0, 100) }));
    
        const prompt = `你是小说剧情关联分析师。
    以下是小说的主线/转折节点列表，按故事时间顺序排列（order 越小越靠前）：
    ${JSON.stringify(mainList, null, 2)}
    
    以下是支线节点列表：
    ${JSON.stringify(subList, null, 2)}
    
    任务：为每个 main/pivot 节点找出与其真正同期发生的 sub 节点。
    
    判断规则（必须同时满足）：
    ① 时间逻辑成立：支线描述的事件必须能在该主线节点发生期间同时存在（例如：某人已离开某地，则该地点的支线不能再关联此后的主线）
    ② 内容直接相关：支线与主线在人物、地点或事件上有直接交集，而非仅主题相似
    ③ 不重复关联：同一支线若已明确属于某主线节点的时间段，不应再关联其后续节点
    
    自检：关联前问自己——"在这条主线事件发生时，这条支线的前提条件是否依然成立？"若否，不关联。
    
    没有符合条件的关联时返回空数组。
    
    严格按下面结构输出，不要输出任何其他文字：
    {
      "links": [
        { "type": "main|pivot", "idx": 0, "branch_links": ["支线title1"] }
      ]
    }
    
    输出前暗中自检一次，不输出自检过程：
    - 顶层是否只有 links 字段，且 links 为数组
    - 每个元素是否只包含 type、idx、branch_links
    - type 是否只能为 main 或 pivot，idx 是否对应上方节点列表
    - branch_links 是否为数组，且只填写真实存在的支线 title
    - 没有符合条件时是否返回 {"links":[]}
    - 是否没有 Markdown、代码块或结构外文本`;
    
        try {
            const raw = await callCleanApi([{ role: 'user', content: prompt }]);
            const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
            const links = json.links || [];
    
            let patched = 0;
            links.forEach(({ type, idx, branch_links }) => {
                const arr = S.plots[type];
                if (!arr || !arr[idx]) return;
                // 合并而不是覆盖，保留已有的伏笔条目
                const existing = arr[idx].branch_links || [];
                const foreshadows = existing.filter(x => x.startsWith('【伏笔】'));
                const newLinks = [...new Set([...branch_links, ...foreshadows])];
                arr[idx].branch_links = newLinks;
                if (newLinks.length) patched++;
            });
    
            niSyncSubPlotStageAssignments();
            niSaveSettings();
            renderPlots();
            toastr?.success(`修补完成，共关联 ${patched} 个节点。`);
        } catch (e) {
            toastr?.error(`修补失败: ${e.message}`);
        }
    
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-link"></i>修补关联'; }
    }
    window.niRepairBranchLinks = niRepairBranchLinks;
    
    
    // ============================================================
    // 剧情事件 增 / 删 / 编辑
    // ============================================================
    let _plotDelMode = false;
    let _plotEditMode = false;
    let _plotDelSelected = new Set(); // { type, idx }
    let _plotEditTarget = null;       // { type, idx }
    let _plotModalMode = 'add';       // 'add' | 'edit'
    let _plotInsertAt = null;          // null = append | number = insert before this index
    let _currentPlotTab = 'timeline'; // 当前激活tab
    
    function niPlotStageNumber(value) {
        const n = parseInt(value, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    
    function niGetPrimaryPlotEntries() {
        return niOrderedPlotEntries([
            { type: 'main', items: S.plots.main || [] },
            { type: 'pivot', items: S.plots.pivot || [] },
        ]);
    }
    
    function niGetSubParentPlotEntries(subTitle) {
        const title = String(subTitle || '').trim();
        if (!title) return [];
        return niGetPrimaryPlotEntries().filter(parent =>
            Array.isArray(parent.branch_links) &&
            parent.branch_links.includes(title)
        );
    }
    
    function niPickNearestStageFromPlots(subPlot, candidates) {
        const usable = (candidates || [])
            .map(parent => ({ parent, stage: niPlotStageNumber(parent?.stageIdx ?? parent?._plotRef?.stageIdx) }))
            .filter(item => item.stage != null);
        if (!usable.length) return null;
    
        const subOrder = niPlotStoryOrder(subPlot, 0);
        usable.sort((a, b) => {
            const ao = niPlotStoryOrder(a.parent, 0);
            const bo = niPlotStoryOrder(b.parent, 0);
            return Math.abs(ao - subOrder) - Math.abs(bo - subOrder) || ao - bo;
        });
        return usable[0].stage;
    }
    
    function niGetSingleChunkStage(chunkIdx) {
        if (chunkIdx == null || !S.chunkStageMap) return null;
        const stages = S.chunkStageMap[chunkIdx] ?? S.chunkStageMap[String(chunkIdx)];
        const list = niStageListFromValue(stages)
            .map(niPlotStageNumber)
            .filter(v => v != null);
        const unique = [...new Set(list)];
        return unique.length === 1 ? unique[0] : null;
    }
    
    function niResolveSubPlotStageIdx(plot) {
        if (!plot) return null;
        const parentStage = niPickNearestStageFromPlots(plot, niGetSubParentPlotEntries(plot.title));
        if (parentStage != null) return parentStage;
    
        const chunkStage = niGetSingleChunkStage(plot._chunkIdx);
        if (chunkStage != null) return chunkStage;
    
        const sameChunk = niGetPrimaryPlotEntries()
            .filter(parent => parent?._chunkIdx === plot._chunkIdx);
        return niPickNearestStageFromPlots(plot, sameChunk);
    }
    
    function niSyncSubPlotStageAssignments() {
        let changed = false;
        (S.plots.sub || []).forEach(plot => {
            const mapped = niResolveSubPlotStageIdx(plot);
            if (mapped == null || plot.stageIdx === mapped) return;
            plot.stageIdx = mapped;
            plot.stageLabel = `第 ${mapped} 阶段`;
            changed = true;
        });
        return changed;
    }
    
    function niFindMainParentForSubTitle(subTitle) {
        if (!subTitle) return '';
        const parent = niGetSubParentPlotEntries(subTitle)[0];
        if (!parent) return '';
        return niPlotPickerEntryKey(parent);
    }
    
    function niRefreshPlotParentField(type, subTitle = '', resetSelection = false) {
        const wrap = q('#ni-plot-modal-parent-wrap');
        const sel = q('#ni-plot-modal-parent');
        if (!wrap || !sel) return;
        wrap.style.display = 'none';
        if (type !== 'sub') {
            if (resetSelection) sel.value = '';
            return;
        }
        if (resetSelection) sel.value = niFindMainParentForSubTitle(subTitle);
    }
    
    function niSetSubParentLink(subTitle, parentKey, oldSubTitle = '') {
        const titlesToRemove = [oldSubTitle, subTitle].filter(Boolean);
        const allParents = [...(S.plots.main || []), ...(S.plots.pivot || [])];
        allParents.forEach(parent => {
            if (!Array.isArray(parent.branch_links)) parent.branch_links = [];
            parent.branch_links = parent.branch_links.filter(link => !titlesToRemove.includes(link));
        });
    
        if (!subTitle || !parentKey) return;
        const key = String(parentKey);
        const stableMatch = key.match(/^(main|pivot)-id:(.+)$/);
        let parent = null;
        if (stableMatch) {
            const [, parentType, nodeId] = stableMatch;
            const parentArr = parentType === 'pivot' ? (S.plots.pivot || []) : (S.plots.main || []);
            parent = parentArr.find((plot, index) => niEnsurePlotNodeId(plot, parentType, index) === nodeId) || null;
        } else {
            const [parentType, rawIdx] = key.split(':');
            const parentArr = parentType === 'pivot' ? (S.plots.pivot || []) : (S.plots.main || []);
            parent = parentArr[parseInt(rawIdx, 10)] || null;
        }
        if (!parent) return;
        if (!Array.isArray(parent.branch_links)) parent.branch_links = [];
        if (!parent.branch_links.includes(subTitle)) parent.branch_links.push(subTitle);
    }

    function niFindPreviousMainKeyForPivot(pivotPlot) {
        if (!pivotPlot) return '';
        let previousMainKey = '';
        for (const entry of niGetPrimaryPlotEntries()) {
            if (entry._plotRef === pivotPlot) return previousMainKey;
            if (entry._type === 'main') previousMainKey = `main-id:${niEnsurePlotNodeId(entry._plotRef, 'main', entry._sourceIdx)}`;
        }
        return '';
    }

    function niPlotPickerType() {
        return q('.ni-plot-type-btn.on')?.dataset.ptype || 'main';
    }

    function niPlotPickerEntryKey(entry) {
        const type = entry?._type === 'pivot' ? 'pivot' : 'main';
        return `${type}-id:${niEnsurePlotNodeId(entry?._plotRef, type, entry?._sourceIdx ?? 0)}`;
    }

    function niPlotPickerItems() {
        const pickerType = niPlotPickerType();
        const editingMain = _plotEditTarget?.type === 'main'
            ? (S.plots.main || [])[_plotEditTarget.idx]
            : null;
        const entries = pickerType === 'sub'
            ? niGetPrimaryPlotEntries()
            : niOrderedPlotEntries([{ type: 'main', items: S.plots.main || [] }])
                .filter(entry => entry._plotRef !== editingMain);
        const counters = { main: 0, pivot: 0 };
        return entries.map(entry => {
            const type = entry._type === 'pivot' ? 'pivot' : 'main';
            counters[type]++;
            const typeLabel = type === 'pivot' ? '转折' : '主线';
            const number = String(counters[type]).padStart(3, '0');
            const stage = niPlotStageNumber(entry.stageIdx ?? entry._plotRef?.stageIdx);
            const stageText = stage != null ? `第 ${stage} 阶段` : '未分阶段';
            return { entry, type, typeLabel, number, stageText, key: niPlotPickerEntryKey(entry) };
        });
    }

    function niPlotPickerValueElement() {
        return q(niPlotPickerType() === 'sub' ? '#ni-plot-modal-parent' : '#ni-plot-modal-after-main');
    }

    function niUpdatePivotMainPickerLabel() {
        const hidden = niPlotPickerValueElement();
        const label = q('#ni-plot-main-picker-label');
        if (!hidden || !label) return;
        const selected = niPlotPickerItems().find(item => item.key === hidden.value);
        if (!selected) {
            label.textContent = niPlotPickerType() === 'sub'
                ? '不指定'
                : (_plotModalMode === 'add' ? '不指定（末尾追加）' : '不指定（保留原位置）');
            return;
        }
        label.textContent = `${selected.typeLabel} ${selected.number}｜${selected.entry.title || '（无标题）'}`;
    }

    function niRenderPivotMainPicker(query = '') {
        const list = q('#ni-plot-main-picker-list');
        const hidden = niPlotPickerValueElement();
        if (!list || !hidden) return;
        const pickerType = niPlotPickerType();
        const keyword = String(query || '').trim().toLocaleLowerCase();
        const visible = niPlotPickerItems().map(item => {
            const haystack = [item.typeLabel, item.number, parseInt(item.number, 10), item.entry.title, item.entry.time, item.entry.location, item.stageText]
                .map(value => String(value || '').toLocaleLowerCase())
                .join('\n');
            return { ...item, matches: !keyword || haystack.includes(keyword) };
        }).filter(item => item.matches);

        const html = [];
        if (!keyword) {
            const defaultMeta = pickerType === 'sub'
                ? '不关联主线或关键转折'
                : (_plotModalMode === 'add' ? '将关键转折追加到当前剧情末尾' : '保留关键转折当前所在位置');
            html.push(`<button type="button" class="ni-main-picker-option${hidden.value ? '' : ' on'}" data-main-key="" role="option" aria-selected="${hidden.value ? 'false' : 'true'}">
              <span class="ni-main-picker-option-title">不指定</span>
              <span class="ni-main-picker-option-meta">${defaultMeta}</span>
            </button>`);
        }
        let lastStage = null;
        visible.forEach(item => {
            if (item.stageText !== lastStage) {
                lastStage = item.stageText;
                html.push(`<div class="ni-main-picker-group">${niEscHtml(lastStage)}</div>`);
            }
            const selected = hidden.value === item.key;
            const meta = [item.stageText, item.entry.time, item.entry.location].filter(Boolean).join(' · ');
            html.push(`<button type="button" class="ni-main-picker-option${selected ? ' on' : ''}" data-main-key="${niEscAttr(item.key)}" role="option" aria-selected="${selected ? 'true' : 'false'}">
              <span class="ni-main-picker-option-title">${item.typeLabel} ${item.number}｜${niEscHtml(item.entry.title || '（无标题）')}</span>
              <span class="ni-main-picker-option-meta">${niEscHtml(meta || '暂无时间地点信息')}</span>
            </button>`);
        });
        if (!html.length) {
            html.push(`<div class="ni-main-picker-empty">没有找到匹配的${pickerType === 'sub' ? '剧情' : '主线'}</div>`);
        }
        list.innerHTML = html.join('');
    }

    function niClosePivotMainPicker() {
        const panel = q('#ni-plot-main-picker-panel');
        const toggle = q('#ni-plot-main-picker-toggle');
        if (panel) panel.style.display = 'none';
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function niTogglePivotMainPicker(forceOpen = null) {
        const panel = q('#ni-plot-main-picker-panel');
        const toggle = q('#ni-plot-main-picker-toggle');
        const search = q('#ni-plot-main-picker-search');
        if (!panel || !toggle) return;
        const shouldOpen = forceOpen == null ? panel.style.display === 'none' : !!forceOpen;
        if (!shouldOpen) {
            niClosePivotMainPicker();
            return;
        }
        niRenderPivotMainPicker(search?.value || '');
        panel.style.display = '';
        toggle.setAttribute('aria-expanded', 'true');
        setTimeout(() => search?.focus(), 0);
    }

    function niFilterPivotMainPicker(query) {
        niRenderPivotMainPicker(query);
    }

    function niSelectPivotMain(mainKey) {
        const hidden = niPlotPickerValueElement();
        if (!hidden) return;
        hidden.value = String(mainKey || '');
        niUpdatePivotMainPickerLabel();
        niClosePivotMainPicker();
    }

    function niRefreshPivotAfterMainField(type, pivotPlot = null, resetSelection = false) {
        const wrap = q('#ni-plot-modal-after-main-wrap');
        const hidden = q('#ni-plot-modal-after-main');
        const fieldLabel = q('#ni-plot-picker-field-label');
        const search = q('#ni-plot-main-picker-search');
        if (!wrap || !hidden) return;
        if (resetSelection) hidden.value = type === 'pivot' ? niFindPreviousMainKeyForPivot(pivotPlot) : '';
        if (type !== 'pivot' && type !== 'sub') {
            wrap.style.display = 'none';
            niClosePivotMainPicker();
            return;
        }
        if (fieldLabel) fieldLabel.textContent = type === 'sub' ? '关联剧情' : '位于主线之后';
        if (search) search.value = '';
        wrap.style.display = '';
        niUpdatePivotMainPickerLabel();
        niRenderPivotMainPicker('');
    }

    function niPlacePivotAfterMain(pivotPlot, mainKey) {
        if (!pivotPlot || !mainKey) return false;
        const key = String(mainKey);
        const nodeId = key.startsWith('main-id:') ? key.slice('main-id:'.length) : '';
        const selectedMain = (S.plots.main || []).find((plot, index) =>
            niEnsurePlotNodeId(plot, 'main', index) === nodeId
        );
        if (!selectedMain) return false;

        const ordered = niGetPrimaryPlotEntries().filter(entry => entry._plotRef !== pivotPlot);
        const selectedIndex = ordered.findIndex(entry => entry._plotRef === selectedMain);
        if (selectedIndex < 0) return false;
        let insertAt = ordered.length;
        for (let i = selectedIndex + 1; i < ordered.length; i++) {
            if (ordered[i]._type === 'main') {
                insertAt = i;
                break;
            }
        }
        ordered.splice(insertAt, 0, { _type: 'pivot', _plotRef: pivotPlot });
        ordered.forEach((entry, index) => {
            if (entry._plotRef) entry._plotRef._manualOrder = (index + 1) * NI_PLOT_NODE_ORDER_STEP;
        });

        const stage = niPlotStageNumber(selectedMain.stageIdx);
        if (stage != null) {
            pivotPlot.stageIdx = stage;
            pivotPlot.stageLabel = `第 ${stage} 阶段`;
        }
        rebuildStageMapFromPlotStageIdx(S);
        niSyncSubPlotStageAssignments();
        return true;
    }
    
    function niRefreshPlotInsertField(type) {
        const selWrap = q('#ni-plot-modal-pos-wrap');
        const sel = q('#ni-plot-modal-pos');
        if (!selWrap || !sel) return;
    
        if (_plotModalMode !== 'add' || type === 'pivot') {
            selWrap.style.display = 'none';
            return;
        }
    
        const currentType = ['main', 'sub', 'pivot'].includes(type) ? type : 'main';
        const existingItems = niOrderedPlotEntries([{ type: currentType, items: S.plots[currentType] || [] }]);
        sel.innerHTML = '<option value="end">末尾（追加）</option>' +
            existingItems.map((it, i) =>
                `<option value="${i}">第 ${i + 1} 位之前（${niEscHtml((it.title || '').slice(0, 12))}${(it.title || '').length > 12 ? '…' : ''}）</option>`
            ).join('');
        sel.value = 'end';
        _plotInsertAt = null;
        selWrap.style.display = '';
    }
    
    function niOpenPlotModal(mode, type, idx) {
        _plotModalMode = mode;
        const modal = q('#ni-plot-modal');
        if (!modal) return;
        const currentType = ['main', 'sub', 'pivot'].includes(type) ? type : 'main';
        // 重置type按钮
        qa('.ni-plot-type-btn').forEach(b => b.classList.toggle('on', b.dataset.ptype === currentType));
        if (mode === 'add') {
            q('#ni-plot-modal-title').textContent = '添加事件';
            q('#ni-plot-modal-title-input').value = '';
            q('#ni-plot-modal-body').value = '';
            q('#ni-plot-modal-time').value = '';
            q('#ni-plot-modal-location').value = '';
            niRefreshPlotParentField(currentType, '', true);
            niRefreshPivotAfterMainField(currentType, null, true);
            niRefreshPlotInsertField(currentType);
        } else {
            q('#ni-plot-modal-title').textContent = '编辑事件';
            const selWrap = q('#ni-plot-modal-pos-wrap');
            if (selWrap) selWrap.style.display = 'none';
            const item = (S.plots[type] || [])[idx] || {};
            q('#ni-plot-modal-title-input').value = item.title || '';
            q('#ni-plot-modal-body').value = item.body || '';
            q('#ni-plot-modal-time').value = item.time || '';
            q('#ni-plot-modal-location').value = item.location || '';
            _plotEditTarget = { type, idx };
            niRefreshPlotParentField(currentType, item.title || '', true);
            niRefreshPivotAfterMainField(currentType, item, true);
        }
        modal.style.display = 'flex';
    }
    
    function niClosePlotModal() {
        const modal = q('#ni-plot-modal');
        if (modal) modal.style.display = 'none';
        niClosePivotMainPicker();
        _plotEditTarget = null;
    }
    
    function niSavePlotModal() {
        const type = q('.ni-plot-type-btn.on')?.dataset.ptype || 'main';
        const title = q('#ni-plot-modal-title-input')?.value.trim() || '（无标题）';
        const body  = q('#ni-plot-modal-body')?.value.trim() || '';
        const time  = q('#ni-plot-modal-time')?.value.trim() || '';
        const location = q('#ni-plot-modal-location')?.value.trim() || '';
        const parentKey = q('#ni-plot-modal-parent')?.value ?? '';
        const afterMainKey = q('#ni-plot-modal-after-main')?.value ?? '';
        if (_plotModalMode === 'add') {
            if (!S.plots[type]) S.plots[type] = [];
            const newItem = { type, title, body, time, location, sub_notes: [], branch_links: [] };
            niEnsurePlotNodeId(newItem, type, S.plots[type].length);
            const posVal = q('#ni-plot-modal-pos')?.value;
            const insertIdx = (posVal && posVal !== 'end') ? parseInt(posVal) : null;
            const orderedRefs = niOrderedPlotEntries([{ type, items: S.plots[type] }]).map(entry => entry._plotRef).filter(Boolean);
            if (insertIdx !== null && insertIdx >= 0 && insertIdx <= orderedRefs.length) {
                orderedRefs.splice(insertIdx, 0, newItem);
            } else {
                orderedRefs.push(newItem);
            }
            niApplyManualPlotOrderForType(type, orderedRefs);
            if (type === 'sub') niSetSubParentLink(title, parentKey);
            if (type === 'pivot' && afterMainKey) niPlacePivotAfterMain(newItem, afterMainKey);
        } else if (_plotEditTarget) {
            const { type: t, idx } = _plotEditTarget;
            // 如果类型改变，移动到新bucket
            if (t !== type) {
                const item = (S.plots[t] || []).splice(idx, 1)[0];
                if (item) {
                    const oldSubTitle = t === 'sub' ? (item.title || '') : '';
                    item.title = title; item.body = body; item.time = time; item.location = location;
                    item.type = type;
                    if (type === 'sub') {
                        item.branch_links = [];
                        niSetSubParentLink(title, parentKey, oldSubTitle);
                    } else if (oldSubTitle) {
                        niSetSubParentLink('', '', oldSubTitle);
                    }
                    if (!S.plots[type]) S.plots[type] = [];
                    S.plots[type].push(item);
                    const sourceRefs = niOrderedPlotEntries([
                        { type: t, items: S.plots[t] || [] },
                    ]).map(entry => entry._plotRef).filter(Boolean);
                    const targetRefs = niOrderedPlotEntries([
                        { type, items: S.plots[type] || [] },
                    ]).map(entry => entry._plotRef).filter(Boolean);
                    niApplyManualPlotOrderForType(t, sourceRefs);
                    niApplyManualPlotOrderForType(type, targetRefs);
                    if (type === 'pivot' && afterMainKey) niPlacePivotAfterMain(item, afterMainKey);
                }
            } else {
                const item = (S.plots[type] || [])[idx];
                if (item) {
                    const oldSubTitle = type === 'sub' ? (item.title || '') : '';
                    item.title = title; item.body = body; item.time = time; item.location = location;
                    item.type = type;
                    if (type === 'sub') niSetSubParentLink(title, parentKey, oldSubTitle);
                    if (type === 'pivot' && afterMainKey) niPlacePivotAfterMain(item, afterMainKey);
                }
            }
        }
        niSyncSubPlotStageAssignments();
        niSaveSettings();
        renderPlots();
        niClosePlotModal();
    }
    
    function niTogglePlotDel() {
        _plotDelMode = !_plotDelMode;
        _plotEditMode = false;
        _plotDelSelected.clear();
        const bar = q('#ni-plot-del-bar');
        if (bar) bar.style.display = _plotDelMode ? 'flex' : 'none';
        ['ni-tp-timeline','ni-tp-main','ni-tp-sub','ni-tp-pivot'].forEach(id => {
            q(`#${id}`)?.classList.toggle('ni-plot-del-mode', _plotDelMode);
            q(`#${id}`)?.classList.remove('ni-plot-edit-mode');
        });
        niSyncPlotActionButtons(false);
    }
    
    function niTogglePlotEdit() {
        _plotEditMode = !_plotEditMode;
        _plotDelMode = false;
        _plotDelSelected.clear();
        const bar = q('#ni-plot-del-bar');
        if (bar) bar.style.display = 'none';
        ['ni-tp-timeline','ni-tp-main','ni-tp-sub','ni-tp-pivot'].forEach(id => {
            q(`#${id}`)?.classList.toggle('ni-plot-edit-mode', _plotEditMode);
            q(`#${id}`)?.classList.remove('ni-plot-del-mode');
        });
        niSyncPlotActionButtons(false);
    }
    
    function niConfirmPlotDel() {
        _plotDelSelected.forEach(key => {
            const [type, idx] = key.split(':');
            if (S.plots[type]) S.plots[type][parseInt(idx)] = null;
        });
        ['main','sub','pivot'].forEach(t => {
            S.plots[t] = (S.plots[t] || []).filter(Boolean);
            niApplyManualPlotOrderForType(t);
        });
        _plotDelSelected.clear();
        _plotDelMode = false;
        const bar = q('#ni-plot-del-bar');
        if (bar) bar.style.display = 'none';
        niSaveSettings();
        renderPlots();
    }
    
    // ============================================================
    
    let _charTab = '主角';
    let _charDelMode = false;
    let _charDelSelected = new Set();
    
    // 将 aiProfile 对象渲染为四字段 HTML
    function niRenderAiFields(profile) {
        const AI_FIELDS = [
            { key: 'identity',    icon: 'ti-id-badge', label: '身份' },
            { key: 'appearance',  icon: 'ti-eye',       label: '外貌' },
            { key: 'personality', icon: 'ti-sparkles',  label: '性格' },
            { key: 'relations',   icon: 'ti-users',     label: '关系' },
        ];
        // 兼容旧版：字符串直接显示
        if (typeof profile === 'string') {
            return `<span>${niEscHtml(profile)}</span>`;
        }
        // 两列布局：左列[身份,外貌] 右列[性格,关系]
        const leftFields  = [AI_FIELDS[0], AI_FIELDS[1]];
        const rightFields = [AI_FIELDS[2], AI_FIELDS[3]];
        const renderCol = (fields) => fields.map(f => {
            const val = (profile && profile[f.key]) || '';
            if (!val) return '';
            return `<div class="ni-char-field ni-af-item"><span class="ni-char-field-lbl"><span class="ni-char-field-lbl-text"><i class="ti ${f.icon}"></i>${f.label}</span></span><span class="ni-char-field-val">${niEscHtml(val)}</span></div>`;
        }).join('');
        const leftHtml  = renderCol(leftFields);
        const rightHtml = renderCol(rightFields);
        if (!leftHtml && !rightHtml) return '<span style="opacity:.5">暂无内容</span>';
        return `<div class="ni-af-grid">${leftHtml}${rightHtml}</div>`;
    }
    
    function niCharRawEyeButton(c, i) {
        const rawEyeOn = c.showRaw !== false;
        return `<button class="ni-char-eye ni-char-eye-raw${rawEyeOn ? ' on' : ''}" data-char-idx="${i}" title="原始人设注入开/关"><i class="ti ${rawEyeOn ? 'ti-eye' : 'ti-eye-off'}"></i></button>`;
    }
    
    function renderCharacters() {
        const list = q('#ni-char-list');
        if (!list) return;
        if (!S.characters.length) {
            list.innerHTML = '<div class="ni-empty"><i class="ti ti-ghost"></i>暂无角色数据</div>';
            return;
        }
        const filtered = S.characters
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => (c.role || '其他') === _charTab)
            .sort((a, b) => {
                const aOff = a.c.enabled === false || niIsUserSubReplaceSelectedChar(a.i) ? 1 : 0;
                const bOff = b.c.enabled === false || niIsUserSubReplaceSelectedChar(b.i) ? 1 : 0;
                if (aOff !== bOff) return aOff - bOff;
                const aStage = getCharFirstStage(a.c) ?? Number.MAX_SAFE_INTEGER;
                const bStage = getCharFirstStage(b.c) ?? Number.MAX_SAFE_INTEGER;
                if (aStage !== bStage) return aStage - bStage;
                return a.i - b.i;
            });
    
        if (!filtered.length) {
            list.innerHTML = '<div class="ni-empty"><i class="ti ti-ghost"></i>该分类暂无角色</div>';
            return;
        }
    
        list.innerHTML = filtered.map(({ c, i }) => {
            const av = (c.name || '?').charAt(0);
            const replacedByUserSub = niIsUserSubReplaceSelectedChar(i);
            const enabled = c.enabled !== false && !replacedByUserSub;
            const toggleTitle = replacedByUserSub
                ? '已由当前聊天的用户代入角色替换，原角色人设不注入'
                : '开启/关闭此角色注入';
            const autoSleepStage = parseInt(c._autoSleepStage, 10);
            const autoSleepTitle = Number.isNaN(autoSleepStage)
                ? '该角色已由自动休眠关闭'
                : `该角色未在第 ${autoSleepStage} 阶段正文中出现，已由自动休眠关闭`;
            const autoSleepBadge = (!enabled && c._autoSleep)
                ? `<div class="ni-char-sleep-badge" title="${niEscAttr(autoSleepTitle)}">自动休眠</div>`
                : '';
            const detailHtml = niRenderRawDetail(c, i);
            const aiProfile = niGetCharAiProfile(i);
            const aiEyeOn  = niGetCharAiShowEnabled(i);
    
            const hasAiContent = niCharAiProfileHasContent(aiProfile);
            const aiProfileHtml = hasAiContent
                ? `<div class="ni-char-ai-profile${aiEyeOn ? '' : ' ni-char-ai-profile-off'}" id="ni-caip-${i}">
                    <div class="ni-char-ai-profile-hdr">
                      <span class="ni-char-ai-profile-lbl"><i class="ti ti-sparkles"></i>AI 实时人设</span>
                      <button class="ni-char-eye ni-char-eye-ai${aiEyeOn ? ' on' : ''}" data-char-idx="${i}" title="AI人设注入开/关">
                        <i class="ti ${aiEyeOn ? 'ti-eye' : 'ti-eye-off'}"></i>
                      </button>
                    </div>
                    <div class="ni-char-ai-body">
                      ${aiEyeOn ? niRenderAiFields(aiProfile) : '<span class="ni-char-ai-off-text">（AI 实时人设已关闭注入）</span>'}
                    </div>
                  </div>`
                : '';
    
            return `<div class="ni-char-card${_charDelMode ? ' ni-del-mode' : ''}${enabled ? '' : ' ni-char-disabled'}" id="ni-cc-${i}">
              <div class="ni-char-card-top">
                <div class="ni-char-card-left">
                  <div class="ni-char-chk${enabled ? ' ni-char-chk-on' : ''}" data-char-idx="${i}" title="${niEscAttr(toggleTitle)}">
                    <i class="ti ti-check ni-char-chk-icon"></i>
                  </div>
                </div>
                <div class="ni-char-card-mid">
                  <div class="ni-char-head">
                    <div class="ni-char-av">${niEscHtml(av)}</div>
                    <div>
                      <div class="ni-char-name-row">
                        <div class="ni-char-name">${niEscHtml(c.name)}</div>
                        <button class="ni-char-ai-one-btn" data-char-idx="${i}" title="AI 更新此角色人设" aria-label="AI 更新此角色人设"><i class="ti ti-sparkles" aria-hidden="true"></i></button>
                      </div>
                      <div class="ni-char-role-row"><div class="ni-char-role">${niEscHtml(c.role || '其他')}</div>${c.gender ? `<div class="ni-char-gender">${niEscHtml(c.gender)}</div>` : ''}${autoSleepBadge}</div>
                      ${(() => { const fs = getCharFirstStage(c); return fs != null ? `<button class="ni-char-stage-tag" data-stage-idx="${fs}">初次登场：第 ${fs} 阶段</button>` : ''; })()}
                    </div>
                  </div>
                  <div class="ni-char-edit-form" id="ni-cef-${i}" style="display:none">
                    <div class="ni-cef-save-row" style="margin-bottom:4px;margin-top:0">
                      <button class="ni-char-save-btn" id="ni-csave-${i}" data-char-idx="${i}">保存</button>
                    </div>
                    <div class="ni-cef-field" id="ni-cef-raw-${i}">
                      <div class="ni-cef-inner">
                        <div class="ni-cef-field ni-cef-field-inline">
                          <label class="ni-cef-label"><i class="ti ti-tag" aria-hidden="true"></i>分类</label>
                          <select class="ni-cef-input ni-cef-select" id="ni-cta-role-${i}">
                            ${['主角','配角','反派','其他'].map(r => `<option value="${r}"${(c.role||'其他')===r?' selected':''}>${r}</option>`).join('')}
                          </select>
                          <label class="ni-cef-label" style="margin-left:6px"><i class="ti ti-layout-list" aria-hidden="true"></i>登场</label>
                          <select class="ni-cef-input ni-cef-select" id="ni-cta-firststage-${i}">
                            <option value="">—</option>
                            ${Array.from({length: S.stageMapN}, (_, k) => k+1).map(s => `<option value="${s}"${getCharFirstStage(c)===s?' selected':''}>${s}</option>`).join('')}
                          </select>
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline">
                          <label class="ni-cef-label"><i class="ti ti-gender-bigender" aria-hidden="true"></i>性别</label>
                          <input class="ni-cef-input" type="text" id="ni-cta-gender-${i}" placeholder="男/女/其他…" value="${niEscAttr(c.gender || '')}">
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-id-badge" aria-hidden="true"></i>身份</label>
                          <textarea class="ni-cef-ta" id="ni-cta-identity-${i}" placeholder="身份背景、出身、职位…">${niEscHtml(c.identity || '')}</textarea>
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-eye" aria-hidden="true"></i>外貌</label>
                          <textarea class="ni-cef-ta" id="ni-cta-appearance-${i}" placeholder="外貌描写关键词…">${niEscHtml(c.appearance || '')}</textarea>
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-sparkles" aria-hidden="true"></i>性格</label>
                          <textarea class="ni-cef-ta" id="ni-cta-personality-${i}" placeholder="性格特征…">${niEscHtml(c.personality || '')}</textarea>
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-users" aria-hidden="true"></i>关系</label>
                          <textarea class="ni-cef-ta" id="ni-cta-relations-${i}" placeholder="角色名：关系描述，多个用分号分隔…">${niEscHtml(c.relations || '')}</textarea>
                        </div>
                      </div>
                    </div>
                    <div class="ni-cef-field ni-cef-ai-wrap" id="ni-cef-ai-${i}" style="display:none">
                      <div class="ni-cef-ai-hdr"><i class="ti ti-sparkles" aria-hidden="true"></i>AI 实时人设</div>
                      <div class="ni-cef-inner">
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-id-badge" aria-hidden="true"></i>身份</label>
                          <textarea class="ni-cef-ta" id="ni-cta-ai-identity-${i}" placeholder="身份背景、出身、职位…">${niEscHtml(aiProfile?.identity || '')}</textarea>
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-eye" aria-hidden="true"></i>外貌</label>
                          <textarea class="ni-cef-ta" id="ni-cta-ai-appearance-${i}" placeholder="外貌描写关键词…">${niEscHtml(aiProfile?.appearance || '')}</textarea>
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-sparkles" aria-hidden="true"></i>性格</label>
                          <textarea class="ni-cef-ta" id="ni-cta-ai-personality-${i}" placeholder="性格特征…">${niEscHtml(aiProfile?.personality || '')}</textarea>
                        </div>
                        <div class="ni-cef-field ni-cef-field-inline ni-cef-field-text">
                          <label class="ni-cef-label"><i class="ti ti-users" aria-hidden="true"></i>关系</label>
                          <textarea class="ni-cef-ta" id="ni-cta-ai-relations-${i}" placeholder="角色名：关系描述，多个用分号分隔…">${niEscHtml(aiProfile?.relations || '')}</textarea>
                        </div>
                      </div>
                    </div>
    
                  </div>
                </div>
                <div class="ni-char-card-right">
                  <button class="ni-char-edit-btn" data-char-idx="${i}"><i class="ti ti-pencil"></i>编辑</button>
                </div>
              </div>
              <div class="ni-char-detail-wrap">
                <div class="ni-char-detail" id="ni-cbio-${i}">
                  ${detailHtml}
                </div>
              </div>
              ${aiProfileHtml}
            </div>`;
        }).join('');
    
        const oldBar = q('#ni-char-del-bar');
        if (oldBar) oldBar.remove();
        if (_charDelMode) {
            const bar = document.createElement('div');
            bar.id = 'ni-char-del-bar';
            bar.className = 'ni-char-del-bar';
            bar.innerHTML = `<span>点击角色选择删除</span><div>
              <button class="ni-char-del-cancel" id="ni-char-del-cancel-btn">取消</button>
              <button class="ni-char-del-confirm" id="ni-char-del-confirm-btn">删除所选</button>
            </div>`;
            list.prepend(bar);
        }
        niRefreshCharStageSel();
        niRenderUserSubUI();
    }
    
    function niResizeCharEditTextarea(textarea) {
        if (!textarea) return;
        const lineHeight = Number(String(getComputedStyle(textarea).lineHeight || '0').replace('px', '')) || 19.2;
        textarea.style.height = `${lineHeight + 1}px`;
        const borderHeight = Math.max(0, textarea.offsetHeight - textarea.clientHeight);
        const contentHeight = textarea.scrollHeight <= Math.ceil(lineHeight)
            ? lineHeight
            : textarea.scrollHeight;
        textarea.style.height = `${contentHeight + borderHeight}px`;
        const clippedHeight = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
        if (clippedHeight > 0) {
            textarea.style.height = `${contentHeight + borderHeight + clippedHeight}px`;
        }
    }

    function niBindCharEditTextareaSizing(form) {
        form?.querySelectorAll('.ni-cef-ta').forEach(textarea => {
            textarea.oninput = () => niResizeCharEditTextarea(textarea);
            niResizeCharEditTextarea(textarea);
        });
    }

    function niEditChar(i) {
        const form    = q(`#ni-cef-${i}`);
        const sb      = q(`#ni-csave-${i}`);
        const rawArea = q(`#ni-cef-raw-${i}`);
        const aiArea  = q(`#ni-cef-ai-${i}`);
        if (!form) return;
        const c = S.characters[i] || {};
        // 回填原始人设字段
        q(`#ni-cta-identity-${i}`)?.value    != null && (q(`#ni-cta-identity-${i}`).value    = c.identity    || '');
        q(`#ni-cta-appearance-${i}`)?.value  != null && (q(`#ni-cta-appearance-${i}`).value  = c.appearance  || '');
        q(`#ni-cta-personality-${i}`)?.value != null && (q(`#ni-cta-personality-${i}`).value = c.personality || '');
        q(`#ni-cta-relations-${i}`)?.value   != null && (q(`#ni-cta-relations-${i}`).value   = c.relations   || '');
        q(`#ni-cta-gender-${i}`)?.value      != null && (q(`#ni-cta-gender-${i}`).value      = c.gender      || '');
        const roleEl = q(`#ni-cta-role-${i}`);
        if (roleEl) roleEl.value = c.role || '其他';
        const fsEl = q(`#ni-cta-firststage-${i}`);
        if (fsEl) fsEl.value = String(getCharFirstStage(c) ?? '');
        // 编辑时隐藏右列，让表单撑满全宽
        const rightCol = q(`#ni-cc-${i}`)?.querySelector('.ni-char-card-right');
        if (rightCol) rightCol.style.display = 'none';
        // 回填AI人设字段
        const rawAp = niGetCharAiProfile(i);
        let ap = {};
        if (rawAp && typeof rawAp === 'object') {
            ap = rawAp;
        } else if (rawAp && typeof rawAp === 'string' && rawAp.trim()) {
            // 旧版字符串：尝试解析 "身份：xxx 性格：xxx" 格式，否则全放入identity
            const parsed = {};
            const lines = rawAp.split(/\n|；|;/).map(s => s.trim()).filter(Boolean);
            const keyMap = { '身份': 'identity', '外貌': 'appearance', '性格': 'personality', '关系': 'relations' };
            let matched = false;
            lines.forEach(line => {
                for (const [cn, en] of Object.entries(keyMap)) {
                    const m = line.match(new RegExp(`^${cn}[：:](.+)`));
                    if (m) { parsed[en] = (parsed[en] ? parsed[en] + '；' : '') + m[1].trim(); matched = true; }
                }
            });
            ap = matched ? parsed : { identity: rawAp.trim() };
        }
        const setAiField = (key) => {
            const el = q(`#ni-cta-ai-${key}-${i}`);
            if (el) el.value = ap[key] || '';
        };
        setAiField('identity'); setAiField('appearance'); setAiField('personality'); setAiField('relations');
        // 根据眼睛状态决定显示哪个编辑区
        const rawEyeOn = c.showRaw !== false;
        const aiEyeOn  = niGetCharAiShowEnabled(i);
        if (rawArea) rawArea.style.display = rawEyeOn ? 'block' : 'none';
        // AI编辑区：只要有aiProfile数据就显示
        const hasAiProfile = niCharAiProfileHasContent(niGetCharAiProfile(i));
        if (aiArea) aiArea.style.display = hasAiProfile ? 'block' : 'none';
        // 编辑时隐藏展示区和粉框
        const detailEl2 = q(`#ni-cbio-${i}`);
        if (detailEl2) detailEl2.style.display = 'none';
        const aipEl2 = q(`#ni-caip-${i}`);
        if (aipEl2) aipEl2.style.display = 'none';
        form.style.display = 'block';
        if (sb) sb.style.display = 'flex';
        niBindCharEditTextareaSizing(form);
    }
    window.niEditChar = niEditChar;
    
    
    function niRenderRawDetail(c, i) {
        const rawEyeOn = c.showRaw !== false;
        const fields = [
            { key: 'identity',    icon: 'ti-id-badge',  label: '身份背景' },
            { key: 'appearance',  icon: 'ti-eye',        label: '外貌'     },
            { key: 'personality', icon: 'ti-sparkles',   label: '性格'     },
            { key: 'relations',   icon: 'ti-users',      label: '关系'     },
        ];
        const cells = fields.map((f) => {
            const val = c[f.key] || '';
            if (!val) return '';
            const lbl = `<div class="ni-char-field-lbl"><span class="ni-char-field-lbl-text"><i class="ti ${f.icon}"></i>${f.label}</span></div>`;
            return `<div class="ni-char-field ni-af-item">${lbl}<span class="ni-char-field-val">${niEscHtml(val)}</span></div>`;
        }).join('');
        const body = rawEyeOn
            ? (cells ? `<div class="ni-af-grid">${cells}</div>` : '<span class="ni-char-raw-empty">暂无人设</span>')
            : '<span class="ni-char-raw-off-text">（原始人设已关闭注入）</span>';
        return `<div class="ni-char-raw-profile${rawEyeOn ? '' : ' ni-char-raw-profile-off'}">
            <div class="ni-char-raw-hdr">
              <span class="ni-char-raw-lbl"><i class="ti ti-id-badge"></i>原始人设</span>
              ${niCharRawEyeButton(c, i)}
            </div>
            <div class="ni-char-raw-body">${body}</div>
          </div>`;
    }
    async function niSaveChar(i) {
        const form = q(`#ni-cef-${i}`);
        if (S.characters[i]) {
            S.characters[i].identity    = q(`#ni-cta-identity-${i}`)?.value?.trim()    || '';
            S.characters[i].appearance  = q(`#ni-cta-appearance-${i}`)?.value?.trim()  || '';
            S.characters[i].personality = q(`#ni-cta-personality-${i}`)?.value?.trim() || '';
            S.characters[i].relations   = q(`#ni-cta-relations-${i}`)?.value?.trim()   || '';
            S.characters[i].gender      = q(`#ni-cta-gender-${i}`)?.value?.trim()      || '';
            // 保存分类
            const newRole = q(`#ni-cta-role-${i}`)?.value || '其他';
            S.characters[i].role = newRole;
            // 保存初次登场阶段
            const newFsVal = q(`#ni-cta-firststage-${i}`)?.value;
            const newFs = newFsVal ? parseInt(newFsVal) : null;
            if (newFs != null && S.stageMapN > 0) {
                // 找到属于该阶段的第一个 chunkIdx
                const chunkIdx = Object.entries(S.stageMap).find(([, si]) => si === newFs)?.[0];
                if (chunkIdx != null) S.characters[i]._firstChunkIdx = Number(chunkIdx);
            } else if (!newFsVal) {
                S.characters[i]._firstChunkIdx = null;
            }
            // 如果AI编辑区可见，同步保存AI人设
            const aiArea = q(`#ni-cef-ai-${i}`);
            if (aiArea && aiArea.style.display !== 'none') {
                const aiIdentity    = q(`#ni-cta-ai-identity-${i}`)?.value?.trim()    || '';
                const aiAppearance  = q(`#ni-cta-ai-appearance-${i}`)?.value?.trim()  || '';
                const aiPersonality = q(`#ni-cta-ai-personality-${i}`)?.value?.trim() || '';
                const aiRelations   = q(`#ni-cta-ai-relations-${i}`)?.value?.trim()   || '';
                await niSetCharAiProfile(i, { identity: aiIdentity, appearance: aiAppearance, personality: aiPersonality, relations: aiRelations });
            }
        }
        if (form) form.style.display = 'none';
        const sb = q(`#ni-csave-${i}`);
        if (sb) sb.style.display = 'none';
        // 恢复右列
        const rightColR = q(`#ni-cc-${i}`)?.querySelector('.ni-char-card-right');
        if (rightColR) rightColR.style.display = '';
        // 恢复展示区和粉框，并刷新展示
        const aipEl = q(`#ni-caip-${i}`);
        if (aipEl) aipEl.style.display = '';
        const detailEl = q(`#ni-cbio-${i}`);
        if (detailEl) detailEl.style.display = '';
        if (detailEl && S.characters[i]) {
            const c = S.characters[i];
            detailEl.innerHTML = niRenderRawDetail(c, i);
            detailEl.style.opacity = '';
            detailEl.style.fontStyle = '';
        }
        // 刷新头部显示，无需整体重绘
        if (S.characters[i]) {
            const c = S.characters[i];
            const card = q(`#ni-cc-${i}`);
            if (card) {
                const roleRow = card.querySelector('.ni-char-role-row');
                if (roleRow) {
                    roleRow.innerHTML = `<div class="ni-char-role">${niEscHtml(c.role || '其他')}</div>${c.gender ? `<div class="ni-char-gender">${niEscHtml(c.gender)}</div>` : ''}`;
                }
                const stageTagWrap = card.querySelector('.ni-char-stage-tag')?.parentElement
                    ?? card.querySelector('.ni-char-head > div');
                // rebuild stage tag
                const existing = card.querySelector('.ni-char-stage-tag');
                if (existing) existing.remove();
                const fs = getCharFirstStage(c);
                if (fs != null && stageTagWrap) {
                    const btn = document.createElement('button');
                    btn.className = 'ni-char-stage-tag';
                    btn.dataset.stageIdx = fs;
                    btn.textContent = `初次登场：第 ${fs} 阶段`;
                    stageTagWrap.appendChild(btn);
                }
            }
            // 若 role 变了，需重绘整个列表
            if (S.characters[i].role !== _charTab && _charTab !== undefined) {
                niSaveSettings();
                renderCharacters();
                return;
            }
        }
        niSaveSettings();
    }
    window.niSaveChar = niSaveChar;
    
    // 角色 Tab 切换
    function niSwitchCharTab(role) {
        _charTab = role;
        _charDelMode = false;
        _charDelSelected.clear();
        q('#ni-char-tab-row')?.querySelectorAll('.ni-tab').forEach(t => {
            t.classList.toggle('on', t.dataset.role === role);
        });
        renderCharacters();
    }
    window.niSwitchCharTab = niSwitchCharTab;
    
    // ============================================================
    // 刷新「按阶段开/关」抽屉
    // ============================================================
    function niRefreshCharStageSel() {
        const stageRow = q('#ni-char-stage-row');
        const bulkRow  = q('#ni-char-bulk-row');
        const n = S.stageMapN;
        if (n <= 0) {
            if (stageRow) stageRow.style.display = 'none';
            if (bulkRow)  bulkRow.style.display  = '';
            return;
        }
        if (stageRow) stageRow.style.display = '';
        if (bulkRow)  bulkRow.style.display  = 'none';
        niRenderStageDrawer();
    }
    
    // 收集各阶段开启统计
    function niCalcStageOnCount() {
        const stageOnCount = {};
        S.characters.forEach(c => {
            if (c.role === '主角') return;
            const fs = getCharFirstStage(c);
            if (fs == null) return;
            if (!stageOnCount[fs]) stageOnCount[fs] = { on: 0, total: 0 };
            stageOnCount[fs].total++;
            if (c.enabled !== false) stageOnCount[fs].on++;
        });
        return stageOnCount;
    }
    
    // 空阶段是否展开
    let _niShowEmptyStages = false;
    
    // 首次打开面板时完整渲染列表
    function niRenderStageDrawer() {
        const list = q('#ni-drawer-list');
        if (!list) return;
        const n = S.stageMapN > 0 ? S.stageMapN : 0;
        const stageOnCount = niCalcStageOnCount();
        list.innerHTML = Array.from({ length: n }, (_, i) => {
            const idx = i + 1;
            const cnt = stageOnCount[idx];
            const isEmpty = !cnt || cnt.total === 0;
            const hasOn = cnt && cnt.on > 0;
            // 空阶段：折叠时隐藏，展开时灰显禁用
            const hiddenAttr = (isEmpty && !_niShowEmptyStages) ? ' style="display:none"' : '';
            const disabledAttr = isEmpty ? ' disabled' : '';
            const emptyClass = isEmpty ? ' ni-drawer-item-empty' : '';
            return `<div class="ni-drawer-item${emptyClass}" data-drawer-stage="${idx}"${hiddenAttr}>
              <label class="ni-drawer-check-wrap" for="ni-dchk-${idx}" title="选择阶段">
                <input type="checkbox" id="ni-dchk-${idx}" data-drawer-stage="${idx}"${disabledAttr}${hasOn ? ' checked' : ''}>
                <span class="ni-drawer-check-box"><i class="ti ti-check"></i></span>
              </label>
              <label for="ni-dchk-${idx}">第 ${idx} 阶段登场角色${cnt ? `（${cnt.total}人）` : '（无新角色）'}</label>
              <span class="ni-drawer-on-badge" id="ni-dbadge-${idx}"${hasOn ? '' : ' style="display:none"'}>${cnt ? cnt.on : 0} 已开</span>
            </div>`;
        }).join('');
        niUpdateStageDrawerNote();
        niSyncEmptyToggleBtn();
    }
    
    // change 后只更新 note 和 badge，不重建列表
    function niUpdateStageDrawerNote() {
        const note = q('#ni-drawer-note');
        if (!note) return;
        const n = S.stageMapN > 0 ? S.stageMapN : 0;
        const stageOnCount = niCalcStageOnCount();
        const onStages = [];
        for (let i = 1; i <= n; i++) {
            const cnt = stageOnCount[i];
            const badge = q(`#ni-dbadge-${i}`);
            if (cnt && cnt.on > 0) {
                onStages.push(`阶段${i}`);
                if (badge) { badge.textContent = `${cnt.on} 已开`; badge.style.display = ''; }
            } else {
                if (badge) badge.style.display = 'none';
            }
        }
        note.textContent = onStages.length === 0
            ? '当前已开启：—（所有阶段角色均关闭）'
            : `当前已开启：${onStages.join('、')} 的角色人设`;
    }
    
    // 同步"空阶段"开关按钮图标
    function niSyncEmptyToggleBtn() {
        const btn = q('#ni-drawer-toggle-empty');
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (icon) icon.className = _niShowEmptyStages ? 'ti ti-eye' : 'ti ti-eye-off';
        btn.style.color = _niShowEmptyStages ? 'var(--color-text-primary)' : '';
    }
    
    window.niRenderStageDrawer = niRenderStageDrawer;
    window.niUpdateStageDrawerNote = niUpdateStageDrawerNote;
    
    // ============================================================
    // 按阶段批量开/关角色
    // ============================================================
    function getCharFirstStage(c) {
        if (c._firstChunkIdx == null) return null;
        if (S.stageMapN <= 0) return null;
        return niGetFirstStageForChunkIdx(c._firstChunkIdx);
    }
    
    function niStageListFromValue(value) {
        if (value == null) return [];
        if (value instanceof Set) return [...value];
        if (Array.isArray(value)) return value;
        return [value];
    }
    
    function niGetFirstStageForChunkIdx(chunkIdx) {
        if (chunkIdx == null || S.stageMapN <= 0) return null;
        const ci = Number(chunkIdx);
        if (!Number.isFinite(ci)) return null;
        const chunkStages = S.chunkStageMap?.[ci] ?? S.chunkStageMap?.[String(ci)];
        const stages = niStageListFromValue(chunkStages)
            .map(v => parseInt(v, 10))
            .filter(v => Number.isFinite(v) && v > 0)
            .sort((a, b) => a - b);
        if (stages.length) return stages[0];
        return S.stageMap[ci] ?? S.stageMap[String(ci)] ?? null;
    }
    
    function niCharAutoSleepEnabled() {
        const cfg = extension_settings[EXT_NAME] || {};
        return (cfg.charAutoSleepEnabled ?? DEFAULT_SETTINGS.charAutoSleepEnabled) !== false;
    }
    
    function niSyncCharAutoSleepUI() {
        const btn = q('#ni-char-auto-sleep-btn');
        const note = q('#ni-char-auto-sleep-note');
        const enabled = niCharAutoSleepEnabled();
        if (btn) {
            btn.classList.toggle('on', enabled);
            btn.title = enabled
                ? '开启阶段时，自动关闭本阶段正文未出现的非主角人设；主角和代入角色保留'
                : '自动休眠已关闭';
        }
        if (note) note.textContent = '关闭长期未出场角色注入';
    }
    
    function niClearCharAutoSleep(c) {
        if (!c) return;
        delete c._autoSleep;
        delete c._autoSleepStage;
        delete c._autoSleepAt;
    }
    
    function niIsUserSubProtectedChar(c, idx) {
        const cfg = niGetUserSubConfig();
        if (!cfg.userSubEnabled) return false;
        const selectedIdx = parseInt(cfg.userSubCharIdx, 10);
        if (!Number.isNaN(selectedIdx) && selectedIdx === idx) return true;
        const selectedName = niGetSelectedUserSubCharName();
        return !!selectedName && isSameCharacter(c, { name: selectedName });
    }
    
    function niCanUseAliasTextForPresence(alias) {
        const text = String(alias?.text || alias?.name || alias?.alias || alias?.title || '').trim();
        const kind = String(alias?.kind || alias?.type || '').trim().toLowerCase();
        if (!text) return false;
        if (kind === 'title') return false;
        return true;
    }
    
    function niCharPresenceTerms(c) {
        const terms = [];
        const addTerm = (text, kind = '') => {
            const t = String(text || '').trim();
            if (!t || t === '<user>' || /^user$/i.test(t)) return;
            if (t.length < 2) return;
            if ((kind || '').toLowerCase() === 'title') return;
            if (!terms.includes(t)) terms.push(t);
        };
        const addNameTerms = (name, kind = '') => {
            const raw = String(name || '').trim();
            if (!raw) return;
            addTerm(raw, kind);
            const compact = raw.replace(/[\s·・•]/g, '');
            if (compact && compact !== raw) addTerm(compact, kind);
            if (!/^[\u3400-\u9fff]+$/.test(compact)) return;
    
            const twoCharSurnames = ['欧阳', '司马', '上官', '诸葛', '东方', '南宫', '令狐', '皇甫', '尉迟', '公孙', '慕容', '夏侯', '司徒', '端木', '宇文', '长孙', '呼延', '独孤', '第五'];
            const oneCharSurnames = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘斜厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东殴殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';
            const matchedTwo = twoCharSurnames.find(s => compact.startsWith(s));
            if (matchedTwo && compact.length - matchedTwo.length >= 2) {
                addTerm(compact.slice(matchedTwo.length), kind);
            } else if (compact.length >= 3 && oneCharSurnames.includes(compact[0])) {
                addTerm(compact.slice(1), kind);
            }
        };
        addNameTerms(c?.name);
        (Array.isArray(c?.aliases) ? c.aliases : []).forEach(alias => {
            if (niCanUseAliasTextForPresence(alias)) addTerm(alias?.text, alias?.kind);
        });
        return terms.sort((a, b) => b.length - a.length);
    }
    
    function niNormalizePresenceText(text) {
        return String(text || '').toLowerCase().replace(/\s+/g, '');
    }
    
    function niPresenceHasTerm(normalizedText, term) {
        const needle = niNormalizePresenceText(term);
        return !!needle && normalizedText.includes(needle);
    }
    
    function niCharNameMatchesTerm(c, term) {
        const t = String(term || '').trim();
        if (!c?.name || !t) return false;
        if (isSameCharacter(c, { name: t })) return true;
        return (Array.isArray(c.aliases) ? c.aliases : []).some(alias => {
            const aliasText = String(alias?.text || '').trim();
            const ownerName = String(alias?.character_name || '').trim();
            return (aliasText && isSameCharacter({ name: aliasText }, { name: t })) ||
                (ownerName && isSameCharacter({ name: ownerName }, { name: t }));
        });
    }
    
    function niGetStageChunkIdxSet(stageIdx) {
        const chunkIdxSet = new Set();
        if (S.chunkStageMap) {
            Object.entries(S.chunkStageMap).forEach(([rci, stageSet]) => {
                const stages = niStageListFromValue(stageSet).map(v => parseInt(v, 10));
                if (stages.includes(stageIdx)) chunkIdxSet.add(Number(rci));
            });
        }
        if (!chunkIdxSet.size) {
            const nodes = getNodesForStage(stageIdx);
            niMergeStageNodes(nodes).forEach(p => {
                if (p?._chunkIdx != null) chunkIdxSet.add(Number(p._chunkIdx));
            });
        }
        return chunkIdxSet;
    }
    
    function niStageMetaMentionsChar(stageIdx, c) {
        if (!Array.isArray(S.chunkMeta) || !c?.name) return false;
        const chunkIdxSet = niGetStageChunkIdxSet(stageIdx);
        return [...chunkIdxSet].some(ci => {
            const meta = S.chunkMeta?.[ci];
            if (!meta) return false;
            const metaChars = Array.isArray(meta.characters) ? meta.characters : [];
            if (metaChars.some(mc => niCharNameMatchesTerm(c, mc?.name || mc?.character_name))) return true;
            const aliases = Array.isArray(meta.character_aliases)
                ? meta.character_aliases
                : (Array.isArray(meta.aliases) ? meta.aliases : []);
            return aliases.some(alias => {
                const ownerName = String(alias?.character_name || alias?.characterName || alias?.char || '').trim();
                if (ownerName) return niCharNameMatchesTerm(c, ownerName);
                if (!niCanUseAliasTextForPresence(alias)) return false;
                return niCharNameMatchesTerm(c, alias?.text || alias?.name || alias?.alias || alias?.title);
            });
        });
    }
    
    async function niBuildStageTextForCharAutoSleep(stageIdx) {
        const hasRawChunks = Array.isArray(S.chunks) && S.chunks.some(t => String(t || '').trim());
        if (!hasRawChunks && !niHasLoadedChunks()) {
            try { await niEnsureChunksLoaded(); } catch (e) { console.warn('[NI] 自动休眠加载压缩正文失败:', e); }
        }
        const chunkIdxSet = niGetStageChunkIdxSet(stageIdx);
        const parts = [...chunkIdxSet]
            .sort((a, b) => a - b)
            .map(ci => {
                const raw = String(S.chunks?.[ci] || '').trim();
                if (raw) return raw;
                return String(S.chunkResults?.[ci] || '').trim();
            })
            .filter(Boolean);
    
        const nodes = niMergeStageNodes(getNodesForStage(stageIdx));
        const nodeText = nodes
            .map(p => [
                p.title,
                p.time,
                p.location,
                p.body || p.content,
                Array.isArray(p.sub_notes) ? p.sub_notes.join('\n') : '',
                Array.isArray(p.branch_links) ? p.branch_links.join('\n') : '',
            ].filter(Boolean).join('\n'))
            .join('\n');
        return [
            parts.join('\n'),
            S.stageTitles?.[stageIdx] || '',
            S.stageSummaries?.[stageIdx] || '',
            nodeText,
        ].filter(text => String(text || '').trim()).join('\n');
    }
    
    async function niRunCharAutoSleepForStage(stageIdx) {
        if (!niCharAutoSleepEnabled() || !S.characters?.length) return 0;
        const stageText = await niBuildStageTextForCharAutoSleep(stageIdx);
        const normalizedText = niNormalizePresenceText(stageText);
        if (!normalizedText) return 0;
    
        let closed = 0;
        let woke = 0;
        S.characters.forEach((c, idx) => {
            if (!c?.name) return;
            if ((c.role || '其他') === '主角') return;
            if (niIsUserSubProtectedChar(c, idx)) {
                if (c._autoSleep) {
                    c.enabled = true;
                    niClearCharAutoSleep(c);
                    woke++;
                }
                return;
            }
            const terms = niCharPresenceTerms(c);
            if (!terms.length) return;
            const appeared = niStageMetaMentionsChar(stageIdx, c) ||
                terms.some(term => niPresenceHasTerm(normalizedText, term));
            if (appeared) {
                if (c._autoSleep) {
                    c.enabled = true;
                    niClearCharAutoSleep(c);
                    woke++;
                }
                return;
            }
            if (c.enabled === false) return;
            c.enabled = false;
            c._autoSleep = true;
            c._autoSleepStage = stageIdx;
            c._autoSleepAt = Date.now();
            closed++;
        });
    
        if (closed > 0 || woke > 0) {
            niSaveSettings();
            renderCharacters();
            niRenderStageDrawer();
            const msg = [
                closed > 0 ? `自动休眠 ${closed} 个未在第 ${stageIdx} 阶段正文出现的角色` : '',
                woke > 0 ? `唤醒 ${woke} 个本阶段已出现的自动休眠角色` : '',
            ].filter(Boolean).join('，');
            toastr?.info(msg);
        }
        return closed;
    }
    window.niRunCharAutoSleepForStage = niRunCharAutoSleepForStage;
    
    function niCharAiProfileKey(i) {
        const c = S.characters?.[i] || {};
        const name = String(c.name || '').trim() || `角色${i}`;
        const role = String(c.role || '其他').trim();
        const firstStage = getCharFirstStage(c) ?? '';
        return `${name}@@${role}@@${firstStage}`;
    }
    
    function niGetCharAiChatState({ ensure = false } = {}) {
        try {
            const ctx = getContext();
            const root = ctx?.chat?.[0];
            if (!root) return null;
            if (ensure) root.ni_char_ai = root.ni_char_ai || {};
            const state = root.ni_char_ai;
            if (!state || typeof state !== 'object') return ensure ? root.ni_char_ai : null;
            if (ensure) {
                state.profiles = state.profiles && typeof state.profiles === 'object' ? state.profiles : {};
                state.showAi = state.showAi && typeof state.showAi === 'object' ? state.showAi : {};
            }
            return state;
        } catch (_) {
            return null;
        }
    }
    
    async function niSaveCharAiChatState() {
        try {
            const ctx = getContext();
            if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        } catch (e) {
            console.warn('[NI] AI 实时人设聊天状态保存失败:', e);
        }
    }
    
    function niGetCharAiProfile(i) {
        const state = niGetCharAiChatState();
        const key = niCharAiProfileKey(i);
        const profile = state?.profiles?.[key];
        return niCharAiProfileHasContent(profile) ? niNormalizeCharAiProfile(profile) : null;
    }
    
    async function niSetCharAiProfile(i, profile, { saveChat = true } = {}) {
        const state = niGetCharAiChatState({ ensure: true });
        if (!state) return false;
        const key = niCharAiProfileKey(i);
        const next = niNormalizeCharAiProfile(profile);
        if (niCharAiProfileHasContent(next)) {
            state.profiles[key] = next;
        } else {
            delete state.profiles[key];
        }
        if (S.characters?.[i]) delete S.characters[i].aiProfile;
        if (saveChat) await niSaveCharAiChatState();
        return true;
    }
    
    function niGetCharAiShowEnabled(i) {
        const state = niGetCharAiChatState();
        const key = niCharAiProfileKey(i);
        if (state?.showAi && Object.prototype.hasOwnProperty.call(state.showAi, key)) {
            return state.showAi[key] !== false;
        }
        return true;
    }
    
    async function niSetCharAiShowEnabled(i, enabled, { saveChat = true } = {}) {
        const state = niGetCharAiChatState({ ensure: true });
        if (!state) return false;
        state.showAi[niCharAiProfileKey(i)] = !!enabled;
        if (S.characters?.[i]) delete S.characters[i].showAi;
        if (saveChat) await niSaveCharAiChatState();
        return true;
    }
    
    function niToggleCharsByStage(stageIdx, enable) {
        S.characters.forEach(c => {
            if (c.role === '主角') return;            // 主角始终跳过
            if (getCharFirstStage(c) !== stageIdx) return;
            c.enabled = enable;
            niClearCharAutoSleep(c);
        });
        niSaveSettings();
        renderCharacters();
    }
    window.niToggleCharsByStage = niToggleCharsByStage;
    
    // 删除模式切换
    function niToggleCharDel() {
        _charDelMode = !_charDelMode;
        _charDelSelected.clear();
        renderCharacters();
    }
    
    // 确认删除
    function niConfirmCharDel() {
        S.characters = S.characters.filter((_, i) => !_charDelSelected.has(i));
        _charDelMode = false;
        _charDelSelected.clear();
        niSaveSettings();
        renderCharacters();
    }
    
    // ============================================================
    // 阶段构建与渲染
    // ============================================================
    // 更新「关闭向量化注入」按钮的可见性与激活状态
    
    function buildStages() {
        const list = q('#ni-stage-list');
        if (!list) return;
    
        if (!canUseDerivedModules(S)) {
            list.innerHTML = '<div class="ni-empty"><i class="ti ti-layout-list"></i>完成至少一个分段并停止清洗后可进行阶段划分和向量化</div>';
            updateStageLbl();
            niRenderVecStageSelector();
            return;
        }
    
        // 更新「关闭向量化注入」按钮的显示状态
        niUpdateVecOffBtn();
    
        // 未划分阶段时显示空状态提示
        if (S.stageMapN <= 0) { list.innerHTML = '<div class="ni-empty"><i class="ti ti-layout-list"></i>暂无阶段数据</div>'; updateStageLbl(); niRenderVecStageSelector(); return; }
    
        const n = S.stageMapN;
    
        // 清除超出当前 stageN 的旧状态，防止阶段数叠加
        Object.keys(S.stageStates).forEach(k => { if (parseInt(k) > n) delete S.stageStates[k]; });
        Object.keys(S.stageSummaries).forEach(k => { if (parseInt(k) > n) delete S.stageSummaries[k]; });
    
        // 初始化缺失的状态
        for (let i = 1; i <= n; i++) {
            if (S.stageStates[i] === undefined) S.stageStates[i] = (i === 1);
            if (S.stageSummaries[i] === undefined) S.stageSummaries[i] = '';
        }
    
        list.innerHTML = '';
        for (let i = 1; i <= n; i++) {
            const nodes = getNodesForStage(i);
            const pillsHtml = buildNodePills(i, nodes);
            const on = S.stageStates[i];
            const summary = S.stageSummaries[i];
            const title = S.stageTitles[i] || '';
            const stageVec = !!S.stageVecDone[i];
            const vecTag = stageVec
                ? '<span class="ni-vec-status-badge ni-vsb-done">已向量</span>'
                : '<span class="ni-vec-status-badge ni-vsb-none">未向量</span>';
            // 估算 token 数：收集属于本阶段的所有 realChunkIdx，再累加 chunkResults 字符数
            // 方案B：优先用 S.chunkStageMap，含边界 chunk
            const stageChunkIdxSet = new Set();
            if (S.chunkStageMap) {
                Object.entries(S.chunkStageMap).forEach(([rci, stageSet]) => {
                    if (stageSet.has(i)) stageChunkIdxSet.add(Number(rci));
                });
            }
            // fallback：chunkStageMap 不存在时退回 plot._chunkIdx 反推
            if (!stageChunkIdxSet.size) {
                const mainArr2 = S.plots.main || [];
                const pivotArr2 = S.plots.pivot || [];
                mainArr2.forEach((p, mi) => {
                    const si = p.stageIdx ?? S.stageMap[mi] ?? S.stageMap[String(mi)];
                    if (si === i && p._chunkIdx != null) stageChunkIdxSet.add(p._chunkIdx);
                });
                pivotArr2.forEach((p, pi) => {
                    const ci = mainArr2.length + pi;
                    const si = p.stageIdx ?? S.stageMap[ci] ?? S.stageMap[String(ci)];
                    if (si === i && p._chunkIdx != null) stageChunkIdxSet.add(p._chunkIdx);
                });
            }
            const _rawMode = (extension_settings[EXT_NAME]?.rawInjMode) ?? 'nodes';
            let stageChars = 0;
            if (_rawMode === 'compressed') {
                // 压缩原文模式：用 chunkResults
                stageChars = [...stageChunkIdxSet].reduce((acc, ci) => {
                    const text = (S.chunkStatus[ci] === 'done' && S.chunkResults[ci])
                        ? S.chunkResults[ci]
                        : (S.chunks[ci] || '');
                    return acc + text.length;
                }, 0);
            } else {
                // 剧情节点模式：累加本阶段所有节点 body 的字符数
                const allStagePlots = [
                    ...(S.plots.main || []),
                    ...(S.plots.sub || []),
                    ...(S.plots.pivot || []),
                ].filter(p => (p.stageIdx ?? null) === i);
                stageChars = allStagePlots.reduce((acc, p) => acc + (p.title ? p.title.length + 1 : 0) + (p.body ? p.body.length : 0), 0);
            }
            const tokenEst = stageChars > 0 ? `token: ~${Math.round(stageChars / 1.5).toLocaleString()}` : '';
    
            const item = document.createElement('div');
            item.className = 'ni-stage-item';
            item.id = `ni-si-${i}`;
            item.innerHTML = `
              <div class="ni-stage-head">
                <div class="ni-stg-chk ${on ? 'on' : ''}" id="ni-stgchk-${i}" data-stage-idx="${i}">
                  <i class="ti ti-check"></i>
                </div>
                <div class="ni-stage-meta">
                  <div class="ni-stage-title-row">
                    <span class="ni-stage-num ${on ? '' : 'off'}" id="ni-stgnum-${i}">第 ${i} 阶段</span>
                    ${vecTag}
                    ${tokenEst ? `<span class="ni-token-est">${tokenEst}</span>` : ''}
                  </div>
                  <span class="ni-stage-name-txt" id="ni-stgtitle-${i}">${niEscHtml(title || `阶段 ${i}`)}</span>
                  ${pillsHtml ? `<div class="ni-stage-node-pills">${pillsHtml}</div>` : ''}
                </div>
                <button class="ni-stage-expand-btn" data-stage-idx="${i}"><i class="ti ti-pencil" style="font-size:11px"></i>编辑概括</button>
                ${summary
                  ? `<div class="ni-stage-summary" id="ni-stgsumm-${i}">${niEscHtml(summary)}</div>`
                  : `<div class="ni-stage-summary-empty" id="ni-stgsumm-${i}">暂无概括</div>`}
                <div class="ni-pill-inline-nodes" id="ni-pin-${i}" style="display:none"></div>
              </div>
    `;
            list.appendChild(item);
        }
        updateStageLbl();
        niRenderVecStageSelector();
        niRefreshCharStageSel();
    }
    
    // ============================================================
    // API 限速队列：每分钟最多 N 次，超出后自动排队等待
    // ============================================================
    
    let _genCharsRunning = false;
    let _genCharsAbortController = null;
    const NI_CHAR_AI_PROFILE_RETRIES = 3;
    const NI_CHAR_AI_PROFILE_RESPONSE_LENGTH = 2000;
    
    function niCharAiSkipError(reason) {
        const err = new Error(reason || '目标角色没有可更新的人设证据');
        err.code = 'NI_CHAR_AI_SKIP';
        return err;
    }
    
    function niIsCharAiSkipError(err) {
        return err?.code === 'NI_CHAR_AI_SKIP';
    }
    
    function niIsAbortError(err) {
        return err?.name === 'AbortError' ||
            err?.message === 'AbortError' ||
            String(err?.message || err || '').includes('请求已中止');
    }
    
    function niAbortableDelay(ms, signal = null) {
        if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
        if (signal.aborted) return Promise.reject(new Error('请求已中止（超时或用户操作）'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            const onAbort = () => {
                clearTimeout(timer);
                reject(new Error('请求已中止（超时或用户操作）'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }
    
    function niCharAiTextHasTarget(text, terms) {
        const normalized = niNormalizePresenceText(text);
        return (terms || []).some(term => niPresenceHasTerm(normalized, term));
    }
    
    function niCanUseCharAiEvidenceTerm(term) {
        const t = String(term || '').trim();
        if (!t || t.length < 2) return false;
        if (t === '<user>' || /^user$/i.test(t)) return false;
        return true;
    }
    
    function niBuildCharAiBaseProfile(c) {
        const aliases = (Array.isArray(c?.aliases) ? c.aliases : [])
            .filter(alias => niCanUseAliasTextForPresence(alias))
            .map(alias => String(alias?.text || '').trim())
            .filter(niCanUseCharAiEvidenceTerm)
            .filter(Boolean);
        return niBuildCharacterBaseProfile(c, aliases);
    }
    
    function niBuildCharAiProfileContext(c, idx) {
        const baseTerms = niCharPresenceTerms(c).filter(niCanUseCharAiEvidenceTerm);
        const cfg = niGetUserSubConfig();
        const isUserSubTarget = !!(c && cfg.userSubEnabled && niIsUserSubPlayMode(cfg) && niIsUserSubProtectedChar(c, idx));
        const evidenceTerms = [...baseTerms];
        if (isUserSubTarget) {
            ['<user>', 'user', ...niGetActiveUserSubNames()].forEach(term => {
                const t = String(term || '').trim();
                if (t && !evidenceTerms.includes(t)) evidenceTerms.push(t);
            });
        }
    
        const ctx = getContext?.();
        const evidence = niSelectCharacterEvidenceMessages(ctx?.chat || [], evidenceTerms, {
            hasTarget: niCharAiTextHasTarget,
        });
    
        const allNodes = getAllPlotsInStoryOrder(S);
        const novelCtx = allNodes
            .filter(p => niCharAiTextHasTarget([
                p.title,
                p.time,
                p.location,
                p.body,
                Array.isArray(p.sub_notes) ? p.sub_notes.join('\n') : '',
            ].filter(Boolean).join('\n'), baseTerms))
            .slice(0, 30)
            .map(p => `[${p.title}] ${p.body}`)
            .join('\n');
    
        return {
            targetName: c?.name || '',
            baseProfile: niBuildCharAiBaseProfile(c),
            targetTerms: baseTerms.join('、'),
            recentChat: evidence.recentChat,
            novelCtx,
            hasTargetEvidence: evidence.hasTargetEvidence,
            isUserSubTarget,
        };
    }
    
    function niBuildCharAiProfilePrompt(c, charCtx) {
        const userSubRule = charCtx?.isUserSubTarget
            ? '目标角色就是当前用户代入的原著角色；只有当对话明确以 <user> 或目标角色可靠别名描写其状态时，才可作为目标角色证据。'
            : '目标角色不是 <user>。任何 <user>、用户、玩家、我、你 的身份、外貌、性格和关系都不得写入目标角色。';
    
        return `你是角色人设整理师。请只为目标角色【${c.name}】生成当前状态的简短人设摘要。
    
    【目标角色资料】
    ${charCtx?.baseProfile || `姓名：${c.name}`}
    
    【用户代入边界】
    ${userSubRule}
    
    【近期对话中命中目标角色的证据（核心依据）】
    ${charCtx?.recentChat || '（无）'}
    
    【目标角色相关原著节点（只能作固定背景参考）】
    ${charCtx?.novelCtx || '（无）'}
    
    要求：
    - 只记录【${c.name}】本人在近期对话中有直接描写的当前状态；若证据不足，appeared 返回 false，四个人设字段返回空字符串
    - 禁止将发生在其他角色、<user>、叙事视角人物或被称为“我/你”的对象身上的事件推断或转移到【${c.name}】身上
    - 禁止根据"其他角色对【${c.name}】做了某事"来推导【${c.name}】的当前状态，除非对话原文明确描写了【${c.name}】本人的当前状态
    - 原著节点只能补充【${c.name}】的固定基础背景；不能单独证明近期状态，更不能覆盖对话中已体现的新变化
    - 若证据里没有出现【${c.name}】或可靠别名（${charCtx?.targetTerms || c.name}），不得仅凭代词、称谓或无所有者的泛称生成
    - 严格控制字数，按下面结构输出，不输出任何其他文字：
    {"target":"${c.name}","appeared":true,"identity":"身份背景15字内","appearance":"外貌10字内或空字符串","personality":"性格15字内","relations":"关系20字内或空字符串"}
    
    输出前暗中自检一次，不输出自检过程：
    - target 是否仍是【${c.name}】，没有换成 <user> 或其他角色
    - 是否只包含 target、appeared、identity、appearance、personality、relations 六个字段
    - 所有字段是否均为字符串，信息不足时是否输出空字符串
    - 是否只记录【${c.name}】本人在对话中明确成立的信息
    - 是否没有 Markdown、代码块或结构外文本`;
    }
    
    function niParseCharAiProfile(raw, c) {
        return niParseCharacterAiProfileResponse(raw, c, {
            matchesTarget: (candidate, target) => niCharNameMatchesTerm(candidate, target) || isSameCharacter(candidate, { name: target }),
        });
    }
    
    async function niGenerateCharAiProfileWithRetry(i, charCtx, onRetry = null, { signal = null, noEvidenceMode = 'skip' } = {}) {
        const c = S.characters[i];
        if (!c) throw new Error('角色不存在');
        if (niIsUserSubReplaceSelectedChar(i)) throw new Error('当前角色已由“用户代入角色”替换，不发送原角色人设给 AI');
    
        if (!charCtx?.hasTargetEvidence) {
            if (noEvidenceMode === 'clear') return niEmptyCharAiProfile({ _noEvidence: true });
            throw niCharAiSkipError(`近期对话没有直接出现「${c.name}」或可靠别名`);
        }
    
        let lastErr = null;
        for (let attempt = 0; attempt <= NI_CHAR_AI_PROFILE_RETRIES; attempt++) {
            if (signal?.aborted) throw new Error('请求已中止（超时或用户操作）');
            try {
                const raw = await callApiSeq([{
                    role: 'user',
                    content: niBuildCharAiProfilePrompt(c, charCtx),
                }], { responseLength: NI_CHAR_AI_PROFILE_RESPONSE_LENGTH, signal });
                const parsed = niParseCharAiProfile(raw, c);
                if (parsed._noEvidence || !niCharAiProfileHasContent(parsed)) {
                    if (noEvidenceMode === 'clear') return niEmptyCharAiProfile({ _noEvidence: true });
                    throw niCharAiSkipError(`「${c.name}」没有可更新的人设证据`);
                }
                return niNormalizeCharAiProfile(parsed);
            } catch (e) {
                if (signal?.aborted || niIsAbortError(e)) throw e;
                if (niIsCharAiSkipError(e)) throw e;
                lastErr = e;
                if (attempt < NI_CHAR_AI_PROFILE_RETRIES) {
                    onRetry?.(attempt + 1, e);
                    await niAbortableDelay(250, signal);
                }
            }
        }
    
        throw new Error(`已重试 ${NI_CHAR_AI_PROFILE_RETRIES} 次仍失败：${lastErr?.message || lastErr || '未知错误'}`);
    }
    
    async function niApplyCharAiProfile(i, profile, { saveChat = true } = {}) {
        const c2 = S.characters[i];
        if (!c2) return;
    
        const aiProfile = niNormalizeCharAiProfile(profile);
        const hasContent = niCharAiProfileHasContent(aiProfile);
        await niSetCharAiProfile(i, aiProfile, { saveChat });
    
        const detailEl = q(`#ni-cbio-${i}`);
        if (detailEl) {
            detailEl.innerHTML = niRenderRawDetail(c2, i);
        }
    
        let aipEl = q(`#ni-caip-${i}`);
        if (!aipEl) {
            const card = q(`#ni-cc-${i}`);
            if (card) {
                aipEl = document.createElement('div');
                aipEl.className = `ni-char-ai-profile${aiEyeOn ? '' : ' ni-char-ai-profile-off'}`;
                aipEl.id = `ni-caip-${i}`;
                card.querySelector('.ni-char-detail')?.after(aipEl);
            }
        }
        if (aipEl) {
            if (hasContent) {
                const aiEyeOn = niGetCharAiShowEnabled(i);
                aipEl.className = 'ni-char-ai-profile';
                aipEl.style.display = '';
                aipEl.innerHTML = `
                  <div class="ni-char-ai-profile-hdr">
                    <span class="ni-char-ai-profile-lbl"><i class="ti ti-sparkles"></i>AI 实时人设</span>
                    <button class="ni-char-eye ni-char-eye-ai${aiEyeOn ? ' on' : ''}" data-char-idx="${i}" title="AI人设注入开/关"><i class="ti ${aiEyeOn ? 'ti-eye' : 'ti-eye-off'}"></i></button>
                  </div>
                  <div class="ni-char-ai-body">${aiEyeOn ? niRenderAiFields(aiProfile) : '<span class="ni-char-ai-off-text">（AI 实时人设已关闭注入）</span>'}</div>`;
            } else {
                aipEl.remove();
            }
        }
    
        ['identity', 'appearance', 'personality', 'relations'].forEach(key => {
            const el = q(`#ni-cta-ai-${key}-${i}`);
            if (el) el.value = aiProfile[key] || '';
        });
        const aiArea = q(`#ni-cef-ai-${i}`);
        if (aiArea) aiArea.style.display = hasContent ? 'block' : 'none';
    }
    
    async function niGenCharsManual(silent = false, skipIndices = null) {
        if (!canUseDerivedModules(S) || !S.characters.length) {
            if (!silent) alert('请先完成清洗，生成角色数据后再更新人设');
            return;
        }
        if (_genCharsRunning) {
            if (_genCharsAbortController) {
                _genCharsAbortController.abort();
                const btn = q('#ni-btn-gen-chars');
                const note = q('#ni-char-title-note');
                if (btn) {
                    btn.innerHTML = '<i class="ti ti-loader"></i>取消中…';
                    btn.title = '正在取消 AI 人设更新';
                }
                if (note) note.textContent = '正在取消更新…';
            } else if (!silent) {
                alert('AI 人设正在更新中，请稍后再试');
            }
            return;
        }
        _genCharsRunning = true;
        const controller = new AbortController();
        _genCharsAbortController = controller;
    
        const btn  = q('#ni-btn-gen-chars');
        const prog = q('#ni-char-title-prog');
        const bar  = q('#ni-char-title-bar');
        const note = q('#ni-char-title-note');
        const card = q('#ni-char-card-title')?.closest('.ni-card');
        if (btn)  {
            btn.disabled = false;
            btn.classList.add('loading');
            btn.innerHTML = '<i class="ti ti-player-stop"></i>取消更新';
            btn.title = '再次点击取消 AI 人设更新';
        }
        if (prog) prog.style.display = 'flex';
        if (card) card.classList.add('ni-has-prog');
    
        const userSubCfg = niGetUserSubConfig();
        const enabledIndices = niSelectCharacterGenerationIndices(S.characters, {
            skipIndices,
            isExcluded: i => niIsUserSubReplaceSelectedChar(i, userSubCfg),
        });
        const total = enabledIndices.length;
        const failures = [];
        let skipped = 0;
        let cleared = 0;
        let done = 0;
        let processed = 0;
        let cancelled = false;

        const workerCount = niGenerationConcurrency(
            extension_settings[EXT_NAME] || {},
            DEFAULT_SETTINGS,
            total,
        );
        await niRunGenerationPool(enabledIndices, workerCount, async (i, ei) => {
            if (controller.signal.aborted) { cancelled = true; return; }
            const c = S.characters[i];
            if (note) note.textContent = `并发 ${workerCount} · 角色 ${ei + 1}/${total}：${c.name}`;
            try {
                const charCtx = niBuildCharAiProfileContext(c, i);
                const profile = await niGenerateCharAiProfileWithRetry(i, charCtx, (retryNo, err) => {
                    if (note) note.textContent = `并发 ${workerCount} · ${c.name}（重试 ${retryNo}/${NI_CHAR_AI_PROFILE_RETRIES}）`;
                    console.warn(`[NI] 角色 ${c.name} 人设第 ${retryNo} 次重试：`, err);
                }, { signal: controller.signal, noEvidenceMode: silent ? 'skip' : 'clear' });
                if (controller.signal.aborted) { cancelled = true; return; }
                await niApplyCharAiProfile(i, profile, { saveChat: false });
                if (profile._noEvidence) cleared++;
                else done++;
            } catch (e) {
                if (controller.signal.aborted || niIsAbortError(e)) {
                    cancelled = true;
                    return;
                }
                if (niIsCharAiSkipError(e)) skipped++;
                else {
                    console.warn(`[NI] 角色 ${c.name} 人设更新失败:`, e);
                    failures.push(`${c.name}：${e.message || e}`);
                }
            } finally {
                processed++;
                if (bar && total) bar.style.width = `${Math.round((processed / total) * 92)}%`;
                if (note && !cancelled) note.textContent = `并发 ${workerCount} · 已处理 ${processed}/${total} 位角色`;
            }
        }, { signal: controller.signal });

        if (done || cleared) await niSaveCharAiChatState();
    
        if (bar)  {
            bar.style.width = cancelled && total ? `${Math.round((done / total) * 100)}%` : '100%';
            if (!cancelled) bar.classList.add('g');
        }
        if (note) {
            if (cancelled) {
                note.textContent = `已取消，已更新 ${done}/${total} 位角色`;
            } else {
                const parts = [];
                if (done) parts.push(`更新 ${done} 位`);
                if (cleared) parts.push(`清空 ${cleared} 位无近期证据`);
                if (skipped) parts.push(`跳过 ${skipped} 位无近期证据`);
                if (failures.length) parts.push(`失败 ${failures.length} 位`);
                note.textContent = parts.length ? parts.join('，') : '没有可更新的人设';
            }
            note.classList.add(cancelled || failures.length ? 'bad' : 'g');
        }
        setTimeout(() => {
            if (prog) prog.style.display = 'none';
            if (bar)  { bar.style.width = '0%'; bar.classList.remove('g'); }
            if (note) { note.textContent = ''; note.classList.remove('g', 'bad'); }
            if (card) card.classList.remove('ni-has-prog');
        }, 2500);
    
        niSaveSettings();
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.innerHTML = '<i class="ti ti-sparkles"></i>AI 更新人设';
            btn.title = '调用 AI 更新角色人设（注入原著+当前对话）';
        }
        if (_genCharsAbortController === controller) _genCharsAbortController = null;
        _genCharsRunning = false;
    
        if (failures.length && !silent && !cancelled) {
            alert(`AI 实时人设更新失败：\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? `\n……另有 ${failures.length - 5} 位失败` : ''}`);
        }
    }
    window.niGenCharsManual = niGenCharsManual;
    
    async function niGenOneCharManual(i) {
        if (!canUseDerivedModules(S) || !S.characters.length) {
            alert('请先完成清洗，生成角色数据后再更新人设');
            return;
        }
        if (!S.characters[i]) {
            alert('角色不存在，无法更新人设');
            return;
        }
        if (_genCharsRunning) {
            alert('AI 人设正在更新中，请稍后再试');
            return;
        }
    
        _genCharsRunning = true;
        const c = S.characters[i];
        if (niIsUserSubReplaceSelectedChar(i)) {
            alert('当前角色已被“用户代入角色”替换，不会作为独立原著角色发送给 AI 更新人设。');
            _genCharsRunning = false;
            return;
        }
        const btn = q(`.ni-char-ai-one-btn[data-char-idx="${i}"]`);
        const oldHtml = btn?.innerHTML;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('loading');
            btn.innerHTML = '<i class="ti ti-loader"></i>';
        }
    
        try {
            const charCtx = niBuildCharAiProfileContext(c, i);
            const profile = await niGenerateCharAiProfileWithRetry(i, charCtx, (retryNo, err) => {
                console.warn(`[NI] 角色 ${c.name} 人设第 ${retryNo} 次重试：`, err);
            }, { noEvidenceMode: 'skip' });
            await niApplyCharAiProfile(i, profile);
            niSaveSettings();
        } catch (e) {
            console.warn(`[NI] 角色 ${c.name} 人设更新失败:`, e);
            if (niIsCharAiSkipError(e)) {
                alert(`近期对话没有直接出现「${c.name}」或可靠别名，已保留现有 AI 人设。`);
            } else {
                alert(`角色「${c.name}」AI 实时人设更新失败：${e.message || e}`);
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.innerHTML = oldHtml || '<i class="ti ti-sparkles" aria-hidden="true"></i>';
            }
            _genCharsRunning = false;
        }
    }
    window.niGenOneCharManual = niGenOneCharManual;
    
    // ============================================================
    // 手动触发：阶段标题 & 概括
    // ============================================================
    let _genStagesRunning = false;
    async function niGenStagesManual(skipExisting = false) {
        if (!canUseDerivedModules(S)) { alert('请先完成至少一个分段并停止清洗，再调用 AI 生成阶段概括'); return; }
        if (S.stageMapN <= 0) { alert('请先在剧情页完成阶段划分，再生成阶段概括'); return; }
        if (_genStagesRunning) return;
        _genStagesRunning = true;
    
        const btn      = q('#ni-btn-gen-stages');
        const btnEmpty = q('#ni-btn-gen-stages-empty');
        const prog = q('#ni-stage-title-prog');
        const bar  = q('#ni-stage-title-bar');
        const note = q('#ni-stage-title-note');
        const card = q('#ni-stage-card-title')?.closest('.ni-card');
        const genBtns = q('.ni-stage-gen-btns');
        if (btn)      { btn.disabled = true;      btn.innerHTML      = '<i class="ti ti-loader"></i>生成中…'; }
        if (btnEmpty) { btnEmpty.disabled = true; btnEmpty.innerHTML = '<i class="ti ti-loader"></i>生成中…'; }
        if (!skipExisting && btnEmpty) btnEmpty.style.display = 'none';
        if (skipExisting && btn) btn.style.display = 'none';
        if (prog) prog.style.display = 'flex';
        if (genBtns) genBtns.classList.add('ni-generating');
        if (card) card.classList.add('ni-has-prog');
    
        // 进入前强制用 stageMap 重新同步所有 plot 的 stageIdx
        if (S.stageMapN > 0 && Object.keys(S.stageMap).length > 0) {
            const _m = S.plots.main || [];
            const _pv = S.plots.pivot || [];
            _m.forEach((plot, i) => {
                const mapped = S.stageMap[i] ?? S.stageMap[String(i)];
                if (mapped !== undefined && plot.stageIdx == null) plot.stageIdx = mapped;
            });
            _pv.forEach((plot, i) => {
                const ci = _m.length + i;
                const mapped = S.stageMap[ci] ?? S.stageMap[String(ci)];
                if (mapped !== undefined && plot.stageIdx == null) plot.stageIdx = mapped;
            });
            (S.plots.sub || []).forEach(plot => {
                const mainIdx = _m.findIndex(p => p._chunkIdx === plot._chunkIdx);
                if (mainIdx === -1) return;
                const mapped = S.stageMap[mainIdx] ?? S.stageMap[String(mainIdx)];
                if (mapped !== undefined && plot.stageIdx == null) plot.stageIdx = mapped;
            });
        }
    
        const n = S.stageMapN;
        let done = 0;
        let processed = 0;
        const failures = [];
        const stageIndices = Array.from({ length: n }, (_, index) => index + 1);
        const workerCount = niGenerationConcurrency(
            extension_settings[EXT_NAME] || {},
            DEFAULT_SETTINGS,
            stageIndices.length,
        );
        await niRunGenerationPool(stageIndices, workerCount, async (i) => {
            if (note) note.textContent = `并发 ${workerCount} · 正在生成第 ${i}/${n} 阶段`;
    
            // 当前阶段标记为生成中
            const summEl = q(`#ni-stgsumm-${i}`);
            if (skipExisting && S.stageSummaries[i]) {
                done++;
                processed++;
                if (bar) bar.style.width = `${Math.round((processed / n) * 92)}%`;
                return;
            }
            if (summEl && !S.stageSummaries[i]) { summEl.textContent = '生成中…'; }
    
            const nodes = getNodesForStage(i);
            const allNodes = niMergeStageNodes(nodes);
            if (!allNodes.length) {
                if (summEl && !S.stageSummaries[i]) { summEl.textContent = '暂无概括（无节点）'; }
                done++;
                processed++;
                if (bar) bar.style.width = `${Math.round((processed / n) * 92)}%`;
                return;
            }
            const { messages } = niBuildStageGenerationInput(allNodes, nodeText => `以下是小说某阶段的剧情节点摘要：\n${nodeText}\n\n请严格按下面结构输出，不要输出任何其他文字：\n{"title":"不超过10字的阶段标题","summary":"不超过20字的阶段概括"}\n\n输出前暗中自检一次，不输出自检过程：\n- 是否只包含 title、summary 两个字段\n- title 是否不超过10字，summary 是否不超过20字\n- 是否准确概括本阶段核心冲突或转折\n- 是否没有 Markdown、代码块或结构外文本`);
    
            try {
                const raw = await callApiSeq(messages);
                const parsed = niParseStageGenerationResponse(raw);
                if (parsed.title) {
                    S.stageTitles[i] = parsed.title;
                    const el = q(`#ni-stgtitle-${i}`);
                    if (el) el.textContent = parsed.title;
                }
                if (parsed.summary) {
                    S.stageSummaries[i] = parsed.summary;
                    const el = q(`#ni-stgsumm-${i}`);
                    if (el) { el.textContent = parsed.summary; el.className = 'ni-stage-summary'; }
    
                }
                done++;
            } catch (e) {
                console.warn(`[NI] 第 ${i} 阶段生成失败:`, e);
                failures.push(i);
                const el = q(`#ni-stgsumm-${i}`);
                if (el) { el.textContent = `生成失败：${e.message}`; el.className = 'ni-stage-summary-empty'; }
            } finally {
                processed++;
                if (bar) bar.style.width = `${Math.round((processed / n) * 92)}%`;
                if (note) note.textContent = `并发 ${workerCount} · 已处理 ${processed}/${n} 个阶段`;
            }
        });

        niSaveSettings();
    
        if (bar)  { bar.style.width = '100%'; bar.classList.add('g'); }
        if (note) {
            note.textContent = failures.length ? `完成 ${done}/${n} 个阶段，失败 ${failures.length} 个` : `全部 ${n} 个阶段已完成`;
            note.classList.add(failures.length ? 'bad' : 'g');
        }
        setTimeout(() => {
            if (prog) prog.style.display = 'none';
            if (bar)  { bar.style.width = '0%'; bar.classList.remove('g'); }
            if (note) { note.textContent = ''; note.classList.remove('g', 'bad'); }
            if (card) card.classList.remove('ni-has-prog');
        }, 2500);
    
        if (btn)      { btn.disabled = false;      btn.innerHTML = '<i class="ti ti-sparkles"></i>全部生成'; btn.style.display = ''; }
        if (btnEmpty) { btnEmpty.disabled = false; btnEmpty.innerHTML = '<i class="ti ti-sparkles"></i>补全空白'; btnEmpty.style.display = ''; }
        if (genBtns) genBtns.classList.remove('ni-generating');
        _genStagesRunning = false;
    }
    window.niGenStagesManual = niGenStagesManual;
    
    function getNodesForStage(idx) {
        const mainArr  = S.plots.main  || [];
        const subArr   = S.plots.sub   || [];
        const pivotArr = S.plots.pivot || [];
    
        if (Object.keys(S.stageMap).length > 0) {
            const seen = new Set();
            const keep = (type, plot, fallbackKey = '') => {
                const id = niEnsurePlotNodeId(plot, type, fallbackKey);
                if (seen.has(`${type}:${id}`)) return false;
                seen.add(`${type}:${id}`);
                return true;
            };
            const mainResult = mainArr.filter((p, i) =>
                (p.stageIdx === idx || (p.stageIdx == null && (S.stageMap[i] === idx || S.stageMap[String(i)] === idx))) &&
                keep('main', p, i)
            );
            const pivotResult = pivotArr.filter((_, i) => {
                const ci = mainArr.length + i;
                const p = pivotArr[i];
                return (p.stageIdx === idx || (p.stageIdx == null && (S.stageMap[ci] === idx || S.stageMap[String(ci)] === idx))) &&
                    keep('pivot', p, i);
            });
            const subResult = subArr.filter((p, i) => {
                let mapped = p.stageIdx;
                if (mapped == null) mapped = niResolveSubPlotStageIdx(p);
                return mapped === idx && keep('sub', p, i);
            });
            return {
                main: niSortPlotsByStoryOrder(mainResult),
                sub: niSortPlotsByStoryOrder(subResult),
                pivot: niSortPlotsByStoryOrder(pivotResult),
            };
        }
        // 降级：stageMap 为空时用 stageIdx 字段
        return {
            main:  niSortPlotsByStoryOrder(mainArr.filter(p => p.stageIdx === idx)),
            sub:   niSortPlotsByStoryOrder(subArr.filter(p => p.stageIdx === idx)),
            pivot: niSortPlotsByStoryOrder(pivotArr.filter(p => p.stageIdx === idx)),
        };
    }
    
    function buildNodePills(stageIdx, nodes) {
        const parts = [];
        if (nodes.main.length)  parts.push(`<button class="ni-node-pill ni-np-main"  data-plot-type="main"  data-stage-idx="${stageIdx}">主线 ${nodes.main.length}</button>`);
        if (nodes.sub.length)   parts.push(`<button class="ni-node-pill ni-np-sub"   data-plot-type="sub"   data-stage-idx="${stageIdx}">支线 ${nodes.sub.length}</button>`);
        if (nodes.pivot.length) parts.push(`<button class="ni-node-pill ni-np-pivot" data-plot-type="pivot" data-stage-idx="${stageIdx}">转折 ${nodes.pivot.length}</button>`);
        return parts.join('');
    }
    
    function niToggleStage(i) {
        S.stageStates[i] = !S.stageStates[i];
        const chk = q(`#ni-stgchk-${i}`);
        const num = q(`#ni-stgnum-${i}`);
        chk?.classList.toggle('on', S.stageStates[i]);
        if (num) num.className = `ni-stage-num${S.stageStates[i] ? '' : ' off'}`;
        // 阶段开启时，自动开启该阶段初次登场的角色；关闭时不影响角色状态
        if (S.stageStates[i]) {
            S.characters.forEach(c => {
                if (c.role === '主角') return;
                if (getCharFirstStage(c) !== i) return;
                c.enabled = true;
                niClearCharAutoSleep(c);
            });
            renderCharacters();
            niRenderStageDrawer();
            Promise.resolve(niRunCharAutoSleepForStage(i))
                .catch(e => console.warn('[NI] 自动休眠角色失败:', e))
                .finally(() => {
                    // 自动触发一次 AI 实时更新人设
                    // 初次登场的角色直接排除，不参与本次 AI 更新
                    const firstAppearIdxSet = new Set(
                        S.characters
                            .map((c, idx) => ({ c, idx }))
                            .filter(({ c }) => getCharFirstStage(c) === i)
                            .map(({ idx }) => idx)
                    );
                    const hasNonFirstChar = S.characters.some(
                        (c, idx) => c.enabled && !firstAppearIdxSet.has(idx)
                    );
                    if (hasNonFirstChar) niGenCharsManual(true, firstAppearIdxSet);
                });
        }
        // 仅更新开关本身；不要重建整个阶段列表，以免收起用户正在查看的节点并造成页面跳动。
        // 向量状态由向量流程结束、页面重新进入等真正的数据刷新点统一重绘。
        updateStageLbl();
        niUpdateVecOffBtn();
        niRenderUserSubUI();
        niSyncRoleplayToDepth();
        niSaveSettings();
    }
    window.niToggleStage = niToggleStage;
    
    // 点"编辑概括"：标题和概括原地变成可编辑控件
    function niToggleStageBody(i) {
        const titleEl = q(`#ni-stgtitle-${i}`);
        const summEl  = q(`#ni-stgsumm-${i}`);
        const btn     = q(`#ni-si-${i}`)?.querySelector('.ni-stage-expand-btn');
        if (!titleEl || !summEl) return;
    
        const isEditing = titleEl.dataset.editing === '1';
        if (isEditing) {
            // 已在编辑 → 保存并退出
            niSaveStage(i);
            return;
        }
    
        // 进入编辑模式：标题 → input，概括 → textarea
        // 有用户真正自定义过的值才预填，否则只显示 placeholder
        const defaultTitle = `阶段 ${i}`;
        const rawTitle     = S.stageTitles[i] || '';
        const savedTitle   = (rawTitle && rawTitle !== defaultTitle) ? rawTitle : '';
        const savedSummary = S.stageSummaries[i] || '';
    
        titleEl.dataset.editing = '1';
        titleEl.innerHTML = `<input class="ni-stage-inline-input" id="ni-stgtitle-input-${i}"
            value="${niEscAttr(savedTitle)}" placeholder="${niEscAttr(defaultTitle)}">`;
    
        summEl.className = 'ni-stage-summary ni-stage-inline-edit';
        summEl.innerHTML = `<textarea class="ni-stage-inline-textarea" id="ni-stgsumm-ta-${i}"
            placeholder="输入本阶段概括…">${niEscHtml(savedSummary)}</textarea>`;
    
        if (btn) {
            const group = document.createElement('div');
            group.className = 'ni-stage-expand-btn-group';
            group.dataset.stageIdx = i;
            group.style.cssText = 'display:flex !important; flex-direction:column !important; gap:4px; flex-shrink:0; align-self:flex-start;';
            const saveBtn = document.createElement('button');
            saveBtn.className = 'ni-stage-save-btn';
            saveBtn.dataset.stageIdx = i;
            saveBtn.style.cssText = 'display:flex !important; width:100%; justify-content:center; outline:none; border:none; background:transparent; color:var(--ni-primary, #A0445E);';
            saveBtn.innerHTML = '<i class="ti ti-check" style="font-size:11px"></i>保存';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'ni-stage-cancel-btn';
            cancelBtn.dataset.stageIdx = i;
            cancelBtn.style.cssText = 'display:flex !important; width:100%; justify-content:center; outline:none; border:none; background:transparent;';
            cancelBtn.innerHTML = '<i class="ti ti-arrow-back-up" style="font-size:11px"></i>取消编辑';
            group.appendChild(saveBtn);
            group.appendChild(cancelBtn);
            btn.replaceWith(group);
        }
    
    
        // 自动聚焦标题
        q(`#ni-stgtitle-input-${i}`)?.focus();
    }
    window.niToggleStageBody = niToggleStageBody;
    
    function niCancelStageEdit(i) {
        const titleEl = q(`#ni-stgtitle-${i}`);
        const summEl  = q(`#ni-stgsumm-${i}`);
        const btnGroup = q(`#ni-si-${i}`)?.querySelector('.ni-stage-expand-btn-group');
        if (!titleEl) return;
    
        delete titleEl.dataset.editing;
        const title = S.stageTitles[i] || `阶段 ${i}`;
        titleEl.textContent = title;
    
        const summary = S.stageSummaries[i] || '';
        summEl.className = summary ? 'ni-stage-summary' : 'ni-stage-summary-empty';
        summEl.textContent = summary || '暂无概括';
    
        if (btnGroup) { btnGroup.outerHTML = `<button class="ni-stage-expand-btn" data-stage-idx="${i}"><i class="ti ti-pencil" style="font-size:11px"></i>编辑概括</button>`; }
    }
    window.niCancelStageEdit = niCancelStageEdit;
    
    function niSaveStage(i) {
        const titleInput = q(`#ni-stgtitle-input-${i}`);
        const summTa     = q(`#ni-stgsumm-ta-${i}`);
        const titleEl    = q(`#ni-stgtitle-${i}`);
        const summEl     = q(`#ni-stgsumm-${i}`);
        const btnGroup   = q(`#ni-si-${i}`)?.querySelector('.ni-stage-expand-btn-group');
    
        // 元素不存在时保留原值，防止误清空
        const newTitle   = titleInput ? (titleInput.value.trim() || S.stageTitles[i] || '') : (S.stageTitles[i] || '');
        const newSummary = summTa     ? (summTa.value.trim()     || S.stageSummaries[i] || '') : (S.stageSummaries[i] || '');
    
        S.stageTitles[i]    = newTitle;
        S.stageSummaries[i] = newSummary;
    
        // 退出编辑模式，恢复显示
        if (titleEl) {
            delete titleEl.dataset.editing;
            titleEl.textContent = newTitle || `阶段 ${i}`;
        }
        if (summEl) {
            summEl.className = newSummary ? 'ni-stage-summary' : 'ni-stage-summary-empty';
            summEl.textContent = newSummary || '暂无概括';
        }
        if (btnGroup) { btnGroup.outerHTML = `<button class="ni-stage-expand-btn" data-stage-idx="${i}"><i class="ti ti-pencil" style="font-size:11px"></i>编辑概括</button>`; }
    
        niSaveSettings();
    }
    window.niSaveStage = niSaveStage;
    
    function updateStageLbl() {
        const keys = Object.keys(S.stageStates);
        if (!keys.length) { q('#ni-stage-active-lbl').textContent = '—'; return; }
        const on = keys.filter(k => S.stageStates[k]).length;
        q('#ni-stage-active-lbl').textContent = `${on} / ${keys.length} 已启用`;
    }
    
    function niGoPlot(type, stageIdx, itemIdx, nodeId = '') {
        const btn = q('.ni-nav-btn:nth-child(2)');
        niSwitchPage('plot', btn);
        setTimeout(() => {
            const tabMap = { main: 1, sub: 2, pivot: 3 };
            const plotTabRow = q('#ni-pg-plot .ni-tab-row');
            const tabs = plotTabRow ? plotTabRow.querySelectorAll('.ni-tab') : qa('.ni-tab');
            tabs.forEach(b => b.classList.remove('on'));
            tabs[tabMap[type]]?.classList.add('on');
            qa('.ni-tp').forEach(p => p.classList.remove('on'));
            q(`#ni-tp-${type}`)?.classList.add('on');
            const container = q(`#ni-tp-${type}`);
            if (!container) return;
            const items = container.querySelectorAll('.ni-plot-item');
            const plotList = S.plots[type] || [];
            // Close all first
            items.forEach(el => el.classList.remove('open'));
            // Find the exact item to open
            let targetEl = null;
            if (nodeId) {
                items.forEach(el => {
                    if (!targetEl && String(el.dataset.nodeId || '') === String(nodeId)) targetEl = el;
                });
            }
            if (!targetEl && itemIdx !== undefined) {
                // itemIdx is relative to this stage — map to absolute plot list index
                let stageCount = -1;
                items.forEach(el => {
                    const idx = parseInt(el.dataset.plotIdx, 10);
                    if (plotList[idx]?.stageIdx === stageIdx) {
                        stageCount++;
                        if (stageCount === itemIdx) targetEl = el;
                    }
                });
            }
            if (!targetEl) {
                // fallback: open first matching item in the stage
                items.forEach(el => {
                    const idx = parseInt(el.dataset.plotIdx, 10);
                    if (!targetEl && plotList[idx]?.stageIdx === stageIdx) targetEl = el;
                });
            }
            if (targetEl) {
                targetEl.classList.add('open');
                setTimeout(() => targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
            }
        }, 80);
    }
    window.niGoPlot = niGoPlot;
    
    let _stageSlots = {};   // { [slotId]: { label, assignedChunks: Set } }
    let _slotCounter = 0;
    
    function niOpenStagePanel() {
        if (!canUseDerivedModules(S)) { alert('请先完成至少一个分段并停止清洗，再进行阶段划分'); return; }
        const panel = q('#ni-stage-panel');
        if (!panel) return;
        const isOpen = panel.style.display !== 'none';
        if (isOpen) { niCloseStagePanel(); return; }
    
        // 从现有 stageMapN 恢复，或初始化空白
        _stageSlots = {};
        _slotCounter = 0;
        if (S.stageMapN > 0) {
            // 恢复已有划分
            // ci 的有效范围是 [0, main.length + pivot.length)，超出范围的是 _chunkIdx 辅助映射，跳过
            const mainLen  = (S.plots.main  || []).length;
            const pivotLen = (S.plots.pivot || []).length;
            const maxCi    = mainLen + pivotLen;
            const slotMap = {};
            Object.entries(S.stageMap).forEach(([ci, si]) => {
                const ciNum = parseInt(ci);
                if (isNaN(ciNum) || ciNum < 0 || ciNum >= maxCi) return; // 跳过 _chunkIdx 辅助映射
                if (!slotMap[si]) slotMap[si] = new Set();
                slotMap[si].add(ciNum);
            });
            const sortedIdx = Object.keys(slotMap).map(Number).sort((a,b)=>a-b);
            sortedIdx.forEach(si => {
                const sid = ++_slotCounter;
                _stageSlots[sid] = { label: S.stageTitles[si] || `阶段 ${si}`, assignedChunks: slotMap[si] };
            });
        }
        // 会话内保留用户展开/收起状态；刷新页面后 window 状态自然重置。
        if (!window._slotOpenStates) window._slotOpenStates = {};
        panel.style.display = 'block';
        niRenderStageSlots();
    }
    
    function niCloseStagePanel() {
        const panel = q('#ni-stage-panel');
        if (panel) panel.style.display = 'none';
    }
    window.niCloseStagePanel = niCloseStagePanel;
    
    function niAddStageSlot() {
        const sid = ++_slotCounter;
        _stageSlots[sid] = { label: `阶段 ${sid}`, assignedChunks: new Set() };
        niRenderStageSlots();
    }
    window.niAddStageSlot = niAddStageSlot;
    
    function niRemoveStageSlot(sid) {
        delete _stageSlots[sid];
        niRenderStageSlots();
    }
    window.niRemoveStageSlot = niRemoveStageSlot;
    
    function niToggleChunkInSlot(sid, chunkIdx) {
        const slot = _stageSlots[sid];
        if (!slot) return;
        // 若已在本 slot 中选中，则取消选中
        if (slot.assignedChunks.has(chunkIdx)) {
            slot.assignedChunks.delete(chunkIdx);
        } else {
            // 从所有 slot 中移除该 chunk，确保互斥，再加入目标 slot
            Object.values(_stageSlots).forEach(s => s.assignedChunks.delete(chunkIdx));
            slot.assignedChunks.add(chunkIdx);
        }
        niRenderStageSlots();
    }
    window.niToggleChunkInSlot = niToggleChunkInSlot;
    
    function niRenderStageSlots() {
        const container = q('#ni-stage-slots');
        if (!container) return;
        const slots = Object.entries(_stageSlots);
    
        if (!slots.length) {
            container.innerHTML = '<div class="ni-sp-empty">还没有阶段，点击"新建阶段"或使用 AI 自动划分</div>';
            niRenderUnassigned({}, []);
            niUpdateSpHint();
            return;
        }
    
        // 收集所有 chunk 的已分配情况
        const assignedMap = {};  // chunkIdx -> slotId
        slots.forEach(([sid, slot]) => {
            slot.assignedChunks.forEach(ci => { assignedMap[ci] = parseInt(sid); });
        });
    
        const main = S.plots.main || [];
        const pivot = S.plots.pivot || [];
        const allNodes = niOrderedPlotEntries([
            { type: 'main', items: main },
            { type: 'pivot', items: pivot },
        ]).map(entry => ({
            plot: entry._plotRef || entry,
            ci: entry._type === 'main' ? entry._sourceIdx : main.length + entry._sourceIdx,
            chunkIdx: entry._chunkIdx ?? entry._sourceIdx ?? 0,
            isPivot: entry._type === 'pivot',
        }));
    
        // 展开状态管理
        if (!window._slotOpenStates) window._slotOpenStates = {};
        Object.keys(window._slotOpenStates).forEach(k => {
            if (!slots.find(([sid]) => String(sid) === k)) delete window._slotOpenStates[k];
        });
        slots.forEach(([sid]) => {
            if (window._slotOpenStates[String(sid)] === undefined) {
                window._slotOpenStates[String(sid)] = true;
            }
        });
    
        container.innerHTML = slots.map(([sid, slot], slotIdx) => {
            const isOpen = !!window._slotOpenStates[String(sid)];
            const fixedLabel = `阶段 ${slotIdx + 1}`;
            slot.label = fixedLabel;
    
            // Fix②: 每个阶段只渲染「已归入本阶段」的节点，未分配节点不混入
            const nodeRows = allNodes.map(({ plot, ci, chunkIdx, isPivot }) => {
                if (assignedMap[ci] !== parseInt(sid)) return '';  // 未分配或属于其他阶段 → 不渲染
                return `<div class="ni-sp-node-row" data-slot-id="${sid}" data-chunk-idx="${ci}">
                  <div class="ni-sp-check on"><i class="ti ti-check" style="font-size:10px;color:var(--ni-checkbox-on, #fff)"></i></div>
                  <div class="ni-sp-node-info">
                    <span class="ni-sp-node-title">${niEscHtml(plot.title)}</span>
                    <span class="ni-sp-node-meta">第 ${chunkIdx+1} 段${plot.time ? ' · '+niEscHtml(plot.time) : ''}</span>
                    ${isPivot ? '<span class="ni-sp-pivot-badge">转折</span>' : ''}
                  </div>
                </div>`;
            }).filter(Boolean).join('');
    
            // 未分配节点在阶段展开时可点击加入
            const addableRows = allNodes.map(({ plot, ci, chunkIdx, isPivot }) => {
                if (assignedMap[ci] !== undefined) return '';  // 已分配到某阶段 → 跳过
                return `<div class="ni-sp-node-row" data-slot-id="${sid}" data-chunk-idx="${ci}" style="opacity:.55">
                  <div class="ni-sp-check"><i class="ti ti-plus" style="font-size:10px;color:var(--color-text-tertiary)"></i></div>
                  <div class="ni-sp-node-info">
                    <span class="ni-sp-node-title" style="color:var(--color-text-secondary)">${niEscHtml(plot.title)}</span>
                    <span class="ni-sp-node-meta">第 ${chunkIdx+1} 段${plot.time ? ' · '+niEscHtml(plot.time) : ''}</span>
                    ${isPivot ? '<span class="ni-sp-pivot-badge">转折</span>' : ''}
                  </div>
                </div>`;
            }).filter(Boolean);
    
            const assignedHtml = nodeRows.trim()
                ? nodeRows
                : '<div class="ni-sp-empty" style="padding:8px 0">暂无已选节点</div>';
            let nodesHtml = assignedHtml;
            if (addableRows.length) {
                nodesHtml += `<div style="font-size:10px;color:var(--color-text-tertiary);padding:4px 10px 2px;border-top:0.5px solid var(--color-border-tertiary);margin-top:2px">未分配节点（点击加入本阶段）</div>`;
                nodesHtml += addableRows.join('');
            }
    
            return `<div class="ni-slot-card" id="ni-slot-card-${sid}">
              <div class="ni-slot-head ni-slot-toggle" data-slot-id="${sid}" style="cursor:pointer">
                <div class="ni-slot-dot" style="background:${niSlotColor(parseInt(sid))}"></div>
                <span class="ni-slot-name-input">${fixedLabel}</span>
                <span class="ni-slot-count">${slot.assignedChunks.size} 节点</span>
                <i class="ti ti-chevron-${isOpen ? 'up' : 'down'}" style="font-size:13px;color:var(--color-text-tertiary);margin:0 2px"></i>
                <button class="ni-slot-del-btn" data-slot-id="${sid}"><i class="ti ti-x"></i></button>
              </div>
              <div class="ni-slot-nodes" style="display:${isOpen ? 'block' : 'none'}">${nodesHtml}</div>
            </div>`;
        }).join('');
    
        // Fix③: 渲染独立的未分配节点区域
        niRenderUnassigned(assignedMap, allNodes);
        niUpdateSpHint();
    }
    
    function niRenderUnassigned(assignedMap, allNodes) {
        const section = q('#ni-unassigned-section');
        const nodesDiv = q('#ni-unassigned-nodes');
        const countEl = q('#ni-unassigned-count');
        const chevron = q('#ni-unassigned-chevron');
        if (!section || !nodesDiv || !countEl) return;
    
        const unassigned = allNodes.filter(({ ci }) => assignedMap[ci] === undefined);
        countEl.textContent = unassigned.length;
        section.style.display = unassigned.length > 0 ? 'block' : 'none';
    
        if (window._unassignedOpen === undefined) window._unassignedOpen = true;
        if (chevron) chevron.className = `ti ti-chevron-${window._unassignedOpen ? 'up' : 'down'}`;
    
        nodesDiv.style.display = window._unassignedOpen ? 'block' : 'none';
        nodesDiv.innerHTML = unassigned.map(({ plot, ci, chunkIdx, isPivot }) =>
            `<div class="ni-unassigned-row">
              <div class="ni-sp-check" style="border-color:var(--ni-primary-alpha-30, rgba(160, 68, 94, .3))"></div>
              <div class="ni-sp-node-info">
                <span class="ni-sp-node-title">${niEscHtml(plot.title)} <span style="font-size:10px;color:#BA7517">→ 请分配到某阶段</span></span>
                <span class="ni-sp-node-meta">第 ${(chunkIdx ?? ci)+1} 段${plot.time ? ' · '+niEscHtml(plot.time) : ''}</span>
                ${isPivot ? '<span class="ni-sp-pivot-badge">转折</span>' : ''}
              </div>
            </div>`
        ).join('');
    }
    
    function niSlotRename(sid, val) {
        if (_stageSlots[sid]) _stageSlots[sid].label = val;
    }
    window.niSlotRename = niSlotRename;
    
    function niSlotColor(idx) {
        const colors = ['#E91E8C','var(--ni-success, #1D9E75)','#378ADD','#BA7517','#7F77DD','#D85A30','var(--ni-success-text, #639922)'];
        return colors[(idx - 1) % colors.length];
    }
    
    function niUpdateSpHint() {
        const hint = q('#ni-sp-hint');
        if (!hint) return;
        const slots = Object.values(_stageSlots);
        const total = slots.reduce((a,s) => a + s.assignedChunks.size, 0);
        const mainTotal = (S.plots.main || []).length + (S.plots.pivot || []).length;
        if (!slots.length) {
            hint.textContent = '请先建立阶段，再勾选节点归入';
            hint.style.color = 'var(--color-text-tertiary)';
        } else if (total < mainTotal) {
            hint.textContent = `还有 ${mainTotal - total} 个节点未分配`;
            hint.style.color = 'var(--color-text-warning, #BA7517)';
        } else {
            hint.textContent = `✓ 全部 ${mainTotal} 个节点已分配`;
            hint.style.color = 'var(--color-text-success, var(--ni-success, #1D9E75))';
        }
    }
    
    async function niAutoStageByPivot() {
        if (!canUseDerivedModules(S)) { alert('请先完成至少一个分段并停止清洗，再进行阶段划分'); return; }
        const main = S.plots.main || [];
        const pivot = S.plots.pivot || [];
        if (!main.length) { alert('请先完成清洗，生成剧情节点后再划分'); return; }
    
        const btn = q('#ni-sp-ai-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i>划分中…'; }
    
        // 合并 main + pivot，沿用剧情页的统一顺序；同一分段内尊重 _chunkOrder/手动排序。
        const allNodes = niOrderedPlotEntries([
            { type: 'main', items: main },
            { type: 'pivot', items: pivot },
        ]).map(entry => ({
            isPivot: entry._type === 'pivot',
            ci: entry._type === 'main' ? entry._sourceIdx : main.length + entry._sourceIdx,
            chunkIdx: niPlotChunkIdx(entry, entry._sourceIdx ?? 0),
        }));
    
        // 按新逻辑划分：遍历时间轴，遇到 pivot 就封闭当前阶段，之后开新阶段
        _stageSlots = {};
        _slotCounter = 0;
        let currentChunks = new Set();
    
        const flushStage = () => {
            if (currentChunks.size === 0) return;
            const sid = ++_slotCounter;
            _stageSlots[sid] = { label: `阶段 ${_slotCounter}`, assignedChunks: new Set(currentChunks) };
            currentChunks = new Set();
        };
    
        if (pivot.length === 0) {
            // 没有转折点：全部归第 1 阶段
            const sid = ++_slotCounter;
            _stageSlots[sid] = {
                label: '阶段 1',
                assignedChunks: new Set([
                    ...main.map((_, i) => i),
                    ...pivot.map((_, pi) => main.length + pi),
                ]),
            };
        } else {
            for (const node of allNodes) {
                currentChunks.add(node.ci);
                if (node.isPivot) flushStage(); // 转折点是本阶段最后一个节点，封闭阶段
            }
            flushStage(); // 最后一批（末尾无转折点的节点）归入最后阶段
        }
    
        niRenderStageSlots();
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-sparkles"></i>按转折点自动划分'; }
    }
    window.niAutoStageByPivot = niAutoStageByPivot;
    
    function niConfirmStageMap() {
        const slots = Object.entries(_stageSlots);
        if (!slots.length) { niCloseStagePanel(); return; }
    
        const mainArr = S.plots.main || [];
        const pivotArr = S.plots.pivot || [];
        const stageMapping = buildStageMapping({
            slots,
            mainPlots: mainArr,
            pivotPlots: pivotArr,
            chunkStatus: S.chunkStatus,
            oldStageMap: S.stageMap,
            oldChunkStageMap: S.chunkStageMap,
        });
        const { sortedSlots, newMap, chunkStageMap, changedStages } = stageMapping;
    
        // 将 chunkStageMap 挂到 S 上，注入时使用
        S.chunkStageMap = chunkStageMap;
    
        S.stageMap = newMap;
        S.stageMapN = slots.length;
    
        changedStages.forEach(si => {
            delete S.stageSummaries[si];
            delete S.stageTitles[si];
            delete S.stageVecDone[si];
        });
    
        // 清除超出当前阶段数的旧状态，新阶段按默认规则初始化
        // 重新划分时已有阶段的开关状态保持不变，不进行重置
        Object.keys(S.stageStates).forEach(k => { if (parseInt(k) > slots.length) delete S.stageStates[k]; });
        for (let i = 1; i <= slots.length; i++) {
            if (S.stageStates[i] === undefined) S.stageStates[i] = (i === 1);
        }
    
        // 同步更新所有 plots 的 stageIdx
        mainArr.forEach((plot, i) => {
            const mapped = newMap[i] ?? newMap[String(i)];
            if (mapped !== undefined) {
                plot.stageIdx = mapped;
                plot.stageLabel = `第 ${mapped} 阶段`;
            }
        });
        pivotArr.forEach((plot, i) => {
            const ci = mainArr.length + i;
            const mapped = newMap[ci] ?? newMap[String(ci)];
            if (mapped !== undefined) {
                plot.stageIdx = mapped;
                plot.stageLabel = `第 ${mapped} 阶段`;
            }
        });
        // sub 节点优先跟随 branch_links 关联的主线/转折；无关联时再按同正文块邻近节点推断。
        niSyncSubPlotStageAssignments();
    
        // 更新阶段标题
        sortedSlots.forEach(([, slot], i) => {
            S.stageTitles[i+1] = slot.label;
        });
    
        // 阶段一开启时，自动开启该阶段初次登场的角色，与 niToggleStage 行为一致
        S.characters.forEach(c => {
            if (c.role === '主角') return;
            if (getCharFirstStage(c) !== 1) return;
            c.enabled = true;
        });
    
        niCloseStagePanel();
        renderPlots();
        renderCharacters();
        buildStages();
        niRenderStageDrawer();
        // 确认划分后收起阶段1的展开体
        setTimeout(() => { q('#ni-si-1')?.classList.remove('open'); }, 0);
        niSaveSettings();
    }
    window.niConfirmStageMap = niConfirmStageMap;
    
    window.niOpenStagePanel = niOpenStagePanel;

    function niSetCurrentPlotTab(tab) { _currentPlotTab = tab; return _currentPlotTab; }
    function niGetCurrentPlotTab() { return _currentPlotTab; }
    function niIsPlotInteractionModeActive() { return !!(_plotEditMode || _plotDelMode); }
    function niTogglePlotDeleteSelection(key) {
        if (_plotDelSelected.has(key)) { _plotDelSelected.delete(key); return false; }
        _plotDelSelected.add(key); return true;
    }
    function niGetCurrentCharTab() { return _charTab; }
    function niToggleCharDeleteSelection(index) {
        if (_charDelSelected.has(index)) { _charDelSelected.delete(index); return false; }
        _charDelSelected.add(index); return true;
    }
    function niToggleShowEmptyStages() { _niShowEmptyStages = !_niShowEmptyStages; return _niShowEmptyStages; }
    function niGetShowEmptyStages() { return _niShowEmptyStages; }

    return {
        niApplyManualPlotOrderForType,
        niMovePlotByDisplayPosition,
        niSyncPlotActionButtons,
        renderPlots,
        renderTimeline,
        renderPlotList,
        niTogglePlot,
        niBindPlotDrag,
        niJumpToStage,
        niRepairBranchLinks,
        niPlotStageNumber,
        niGetPrimaryPlotEntries,
        niGetSubParentPlotEntries,
        niPickNearestStageFromPlots,
        niGetSingleChunkStage,
        niResolveSubPlotStageIdx,
        niSyncSubPlotStageAssignments,
        niFindMainParentForSubTitle,
        niRefreshPlotParentField,
        niSetSubParentLink,
        niFindPreviousMainKeyForPivot,
        niRefreshPivotAfterMainField,
        niTogglePivotMainPicker,
        niClosePivotMainPicker,
        niFilterPivotMainPicker,
        niSelectPivotMain,
        niPlacePivotAfterMain,
        niRefreshPlotInsertField,
        niOpenPlotModal,
        niClosePlotModal,
        niSavePlotModal,
        niTogglePlotDel,
        niTogglePlotEdit,
        niConfirmPlotDel,
        niRenderAiFields,
        niCharRawEyeButton,
        renderCharacters,
        niEditChar,
        niRenderRawDetail,
        niSaveChar,
        niSwitchCharTab,
        niRefreshCharStageSel,
        niCalcStageOnCount,
        niRenderStageDrawer,
        niUpdateStageDrawerNote,
        niSyncEmptyToggleBtn,
        getCharFirstStage,
        niStageListFromValue,
        niGetFirstStageForChunkIdx,
        niCharAutoSleepEnabled,
        niSyncCharAutoSleepUI,
        niClearCharAutoSleep,
        niIsUserSubProtectedChar,
        niCanUseAliasTextForPresence,
        niCharPresenceTerms,
        niNormalizePresenceText,
        niPresenceHasTerm,
        niCharNameMatchesTerm,
        niGetStageChunkIdxSet,
        niStageMetaMentionsChar,
        niBuildStageTextForCharAutoSleep,
        niRunCharAutoSleepForStage,
        niCharAiProfileKey,
        niGetCharAiChatState,
        niSaveCharAiChatState,
        niGetCharAiProfile,
        niSetCharAiProfile,
        niGetCharAiShowEnabled,
        niSetCharAiShowEnabled,
        niToggleCharsByStage,
        niToggleCharDel,
        niConfirmCharDel,
        buildStages,
        niCharAiSkipError,
        niIsCharAiSkipError,
        niIsAbortError,
        niAbortableDelay,
        niCharAiTextHasTarget,
        niCanUseCharAiEvidenceTerm,
        niBuildCharAiBaseProfile,
        niBuildCharAiProfileContext,
        niBuildCharAiProfilePrompt,
        niParseCharAiProfile,
        niGenerateCharAiProfileWithRetry,
        niApplyCharAiProfile,
        niGenCharsManual,
        niGenOneCharManual,
        niGenStagesManual,
        getNodesForStage,
        buildNodePills,
        niToggleStage,
        niToggleStageBody,
        niCancelStageEdit,
        niSaveStage,
        updateStageLbl,
        niGoPlot,
        niOpenStagePanel,
        niCloseStagePanel,
        niAddStageSlot,
        niRemoveStageSlot,
        niToggleChunkInSlot,
        niRenderStageSlots,
        niRenderUnassigned,
        niSlotRename,
        niSlotColor,
        niUpdateSpHint,
        niAutoStageByPivot,
        niConfirmStageMap,
        niSetCurrentPlotTab, niGetCurrentPlotTab, niIsPlotInteractionModeActive,
        niTogglePlotDeleteSelection, niGetCurrentCharTab, niToggleCharDeleteSelection,
        niToggleShowEmptyStages, niGetShowEmptyStages,
    };
}
