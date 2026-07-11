import {
    getAssignedStagesForChunk,
    NI_PLOT_CHUNK_ORDER_STEP,
    niFiniteNumber,
} from './story-data.js';

// ============================================================
// Vector storage and math
// ============================================================

export function vecToBuffer(arr) {
    const f32 = new Float32Array(arr);
    return f32.buffer.slice(f32.byteOffset, f32.byteOffset + f32.byteLength);
}

export function bufferToVec(buf) {
    if (!buf) return [];
    if (Array.isArray(buf)) return buf;
    try { return Array.from(new Float32Array(buf)); } catch (_) { return []; }
}

export function splitText(text, charLimit) {
    if (!text || !text.trim()) return [];
    const result = [];
    const paras = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    let buf = '';
    for (const para of paras) {
        if (!buf) {
            buf = para;
        } else if (buf.length + 1 + para.length <= charLimit) {
            buf += '\n\n' + para;
        } else {
            if (buf.length > charLimit) {
                const lines = buf.split(/\n/).map(l => l.trim()).filter(Boolean);
                let lineBuf = '';
                for (const line of lines) {
                    if (!lineBuf) {
                        lineBuf = line;
                    } else if (lineBuf.length + 1 + line.length <= charLimit) {
                        lineBuf += '\n' + line;
                    } else {
                        if (lineBuf.length > charLimit) {
                            for (let i = 0; i < lineBuf.length; i += charLimit) result.push(lineBuf.slice(i, i + charLimit));
                        } else {
                            result.push(lineBuf);
                        }
                        lineBuf = line;
                    }
                }
                if (lineBuf) {
                    if (lineBuf.length > charLimit) {
                        for (let i = 0; i < lineBuf.length; i += charLimit) result.push(lineBuf.slice(i, i + charLimit));
                    } else {
                        result.push(lineBuf);
                    }
                }
            } else {
                result.push(buf);
            }
            buf = para;
        }
    }
    if (buf) {
        if (buf.length > charLimit) {
            for (let i = 0; i < buf.length; i += charLimit) result.push(buf.slice(i, i + charLimit));
        } else {
            result.push(buf);
        }
    }
    return result.length ? result : [text.slice(0, charLimit)];
}

export function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

export function vecToBytes(vectors, dims) {
    if (!vectors.length) return new Uint8Array(0);
    const buf = new ArrayBuffer(vectors.length * dims * 4);
    const view = new Float32Array(buf);
    let off = 0;
    for (const v of vectors) {
        for (let i = 0; i < dims; i++) view[off++] = v[i] || 0;
    }
    return new Uint8Array(buf);
}

export function bytesToVecs(bytes, dims) {
    if (!bytes || bytes.length === 0) return [];
    const view = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const result = [];
    for (let i = 0; i < view.length; i += dims) result.push(Array.from(view.slice(i, i + dims)));
    return result;
}

// ============================================================
// Vector state
// ============================================================

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

// ============================================================
// Embedding client
// ============================================================

export function createEmbeddingClient({
    getSettings,
    acquireRateSlot,
    runWithSemaphore,
    semaphore,
    defaultSettings = {},
    fetch: fetchFn = globalThis.fetch,
    AbortController: AbortControllerClass = globalThis.AbortController,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timerId => clearTimeout(timerId),
} = {}) {
    async function niRequestEmbeddings(inputs) {
        const cfg = getSettings?.() || {};
        const base = (cfg.vecUrl || '').replace(/\/+$/, '').replace(/\/embeddings$/, '');
        const endpoint = `${base}/embeddings`;

        await acquireRateSlot();
        return runWithSemaphore(semaphore, async () => {
            const controller = new AbortControllerClass();
            const timeoutMs = Math.max(1, Number(cfg.apiTimeoutMin) || defaultSettings.apiTimeoutMin) * 60 * 1000;
            const timeoutId = setTimer(() => controller.abort(), timeoutMs);
            let resp;
            try {
                resp = await fetchFn(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${cfg.vecKey}`,
                    },
                    body: JSON.stringify({ model: cfg.vecModel, input: inputs }),
                    signal: controller.signal,
                });
            } catch (e) {
                if (e?.name === 'AbortError') throw new Error(`Embedding 请求超过 ${Math.ceil(timeoutMs / 60000)} 分钟，已自动中止`);
                throw e;
            } finally {
                clearTimer(timeoutId);
            }

            if (!resp.ok) {
                const txt = await resp.text().catch(() => '');
                throw new Error(`Embedding API ${resp.status}: ${txt.slice(0, 200)}`);
            }

            const json = await resp.json();
            const vectors = json?.data?.map(item => item?.embedding);
            if (!Array.isArray(vectors) || vectors.length !== inputs.length || vectors.some(v => !Array.isArray(v))) {
                throw new Error('Embedding API 返回格式异常');
            }
            return vectors;
        });
    }

    async function embedText(text) {
        return (await niRequestEmbeddings([text]))[0];
    }

    return {
        niRequestEmbeddings,
        embedText,
    };
}

// ============================================================
// Query preparation
// ============================================================

export function niExtractVectorTagBlocks(text, tag) {
    const name = String(tag || '').trim();
    if (!/^[\w:-]+$/.test(name)) return [];
    const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi');
    const matches = [];
    let match;
    while ((match = re.exec(String(text || ''))) !== null) {
        const inner = match[1].trim();
        if (inner) matches.push(inner);
    }
    return matches;
}

export function niExtractVectorMessageText(message, tag) {
    const raw = String(message || '');
    const tags = String(tag || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    if (!tags.length) return raw;

    const extracted = [];
    tags.forEach(value => extracted.push(...niExtractVectorTagBlocks(raw, value)));

    const unique = [...new Set(extracted.map(value => value.trim()).filter(Boolean))];
    return unique.length ? unique.join('\n') : raw;
}

export function niSelectRecentVectorMessageTexts(messages, messageCount, tag = '') {
    const list = Array.isArray(messages) ? messages : [];
    return list.slice(-messageCount)
        .map(message => niExtractVectorMessageText(message?.mes || '', tag))
        .filter(text => text.trim());
}

export function niBuildWeightedVectorQueries(recentMessages, {
    nodeContext = '',
    decay = 0.5,
    maxTextLength = 2000,
} = {}) {
    const messages = Array.isArray(recentMessages) ? recentMessages : [];
    return messages.map((message, index) => {
        const isNewest = index === messages.length - 1;
        const text = isNewest
            ? (String(nodeContext || '') + message).slice(0, maxTextLength)
            : String(message).slice(0, maxTextLength);
        const weight = Math.pow(decay, messages.length - 1 - index);
        return { text, weight };
    }).filter(query => query.text.trim());
}

export function niCombineWeightedQueryVectors(vectors, weightedQueries) {
    const totalWeight = weightedQueries.reduce((sum, query) => sum + query.weight, 0);
    const dimension = vectors[0].length;
    const combined = new Array(dimension).fill(0);
    for (let index = 0; index < vectors.length; index++) {
        const normalizedWeight = weightedQueries[index].weight / totalWeight;
        for (let dimensionIndex = 0; dimensionIndex < dimension; dimensionIndex++) {
            combined[dimensionIndex] += vectors[index][dimensionIndex] * normalizedWeight;
        }
    }
    return combined;
}

// ============================================================
// Recall ordering and light-recall filtering
// ============================================================

export function niNormalizeRecallText(text) {
    return String(text || '').replace(/\r\n/g, '\n').trim();
}

export function niBuildTbLightRecallContext(curNode) {
    if (!curNode) return null;
    const anchorChunkIdx = Number.isFinite(Number(curNode._chunkIdx)) ? Number(curNode._chunkIdx) : null;
    return {
        anchorChunkIdx,
        stageIdx: Number(curNode.stageIdx) || null,
        title: (curNode.title || '').trim(),
        time: (curNode.time || '').trim(),
        location: (curNode.location || '').trim(),
    };
}

export function niGetVectorSourceChunkIdx(chunk) {
    const value = Number(chunk?.sourceChunkIdx);
    return Number.isFinite(value) ? value : null;
}

export function niRecallStoryOrder(chunk) {
    const sourceChunkIdx = niGetVectorSourceChunkIdx(chunk);
    if (sourceChunkIdx != null) return sourceChunkIdx;
    const stageIdx = niFiniteNumber(chunk?.stageIdx, 0);
    const chunkIdx = niFiniteNumber(chunk?.chunkIdx, 0);
    return stageIdx * NI_PLOT_CHUNK_ORDER_STEP + chunkIdx;
}

export function niCompareRecallStoryOrder(a, b) {
    return niRecallStoryOrder(a) - niRecallStoryOrder(b) ||
        niFiniteNumber(a?.stageIdx, 0) - niFiniteNumber(b?.stageIdx, 0) ||
        niFiniteNumber(a?.chunkIdx, 0) - niFiniteNumber(b?.chunkIdx, 0) ||
        niFiniteNumber(b?.score, 0) - niFiniteNumber(a?.score, 0);
}

export function niSelectRecallCandidatesInStoryOrder(candidates, topK) {
    return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .sort(niCompareRecallStoryOrder);
}

export function niTbLightRecallCandidateAllowed(chunk, lightCtx) {
    if (!lightCtx) return true;
    const sourceChunkIdx = niGetVectorSourceChunkIdx(chunk);
    if (sourceChunkIdx == null || lightCtx.anchorChunkIdx == null) return true;
    return sourceChunkIdx <= lightCtx.anchorChunkIdx;
}

export function niSplitRecallSections(text) {
    return niNormalizeRecallText(text)
        .split(/\n\s*---\s*\n/g)
        .map(section => section.trim())
        .filter(Boolean);
}

export function niFindTbLightRecallAnchor(text, lightCtx) {
    const anchors = [lightCtx?.time, lightCtx?.title]
        .map(value => String(value || '').trim())
        .filter(value => value.length >= 2);
    for (const anchor of anchors) {
        const idx = text.indexOf(anchor);
        if (idx >= 0) return { idx, length: anchor.length };
    }
    return null;
}

export function niTbCutSectionAtFutureTime(section, lightCtx) {
    const text = niNormalizeRecallText(section);
    const anchor = niFindTbLightRecallAnchor(text, lightCtx);
    if (!anchor) return text;

    const afterAnchor = text.slice(anchor.idx + anchor.length);
    const futureTimeMatch = afterAnchor.match(/\n\s*(?:时间[:：]\s*)?(?:第[一二三四五六七八九十百千万\d]+[章节回幕]|[一二三四五六七八九十〇零\d]+年(?:[一二三四五六七八九十〇零\d]+月)?(?:[一二三四五六七八九十〇零\d]+日)?|[一二三四五六七八九十〇零\d]+月[一二三四五六七八九十〇零\d]+日|翌日|次日|同日|当日|当夜|入夜|清晨|黄昏|午后|傍晚|深夜|第二天|第三天|数日后|几日后|不久后)[^\n]{0,40}/);
    if (!futureTimeMatch || futureTimeMatch.index == null) return text;
    const cutAt = anchor.idx + anchor.length + futureTimeMatch.index;
    return text.slice(0, cutAt).trim();
}

export function niApplyTbLightRecallCut(text, lightCtx) {
    if (!lightCtx) return text;
    const sections = niSplitRecallSections(text)
        .map(section => niTbCutSectionAtFutureTime(section, lightCtx))
        .filter(Boolean);
    return sections.join('\n\n---\n\n');
}

// ============================================================
// Recall service
// ============================================================

const VECTOR_QUERY_INSTRUCTION = 'Instruct: 根据以下文本内容，找出向量块中与当前场景、人物、事件最相关的片段\nQuery: ';

export function createVectorRecallService({
    getSettings,
    getState,
    defaultSettings,
    dbLoadByNovel,
    getVectorFingerprint,
    cosineSim,
    isVectorRowCompatible,
    embeddingClient,
    logger = console,
} = {}) {
    const { niRequestEmbeddings, embedText } = embeddingClient;

    function getEnabledStages(stageList) {
        if (stageList) return new Set(stageList);
        const state = getState();
        return new Set(Object.entries(state.stageStates)
            .filter(([, on]) => on)
            .map(([key]) => Number(key))
            .filter(stageIdx => state.stageVecDone[stageIdx]));
    }

    async function recallRelevantWeighted(weightedQueries, stageList, opts = {}) {
        const cfg = getSettings();
        const topK = cfg.recallTopK ?? defaultSettings.recallTopK;
        const thresh = cfg.recallThresh ?? defaultSettings.recallThresh;
        const lightCtx = opts.lightRecallContext || null;
        const enabledStages = getEnabledStages(stageList);

        if (!enabledStages.size) return '';

        const inputs = weightedQueries.map(query => VECTOR_QUERY_INSTRUCTION + query.text);
        let vectors;
        try {
            vectors = await niRequestEmbeddings(inputs);
        } catch (error) {
            logger.warn('[NI] 加权查询向量化失败:', error);
            return '';
        }

        const combined = niCombineWeightedQueryVectors(vectors, weightedQueries);

        let allChunks;
        try {
            allChunks = await dbLoadByNovel();
        } catch (error) {
            logger.warn('[NI] 加载向量失败:', error);
            return '';
        }

        const candidates = allChunks
            .filter(row => isVectorRowCompatible(row, getVectorFingerprint()))
            .filter(chunk => enabledStages.has(chunk.stageIdx))
            .filter(chunk => niTbLightRecallCandidateAllowed(chunk, lightCtx))
            .map(chunk => ({ ...chunk, score: cosineSim(combined, chunk.vector) }))
            .filter(chunk => chunk.score >= thresh);

        if (!candidates.length) return '';
        const orderedCandidates = niSelectRecallCandidatesInStoryOrder(candidates, topK);
        return niApplyTbLightRecallCut(orderedCandidates.map(chunk => chunk.text).join('\n\n---\n\n'), lightCtx);
    }

    async function recallRelevant(queryText, stageList) {
        const cfg = getSettings();
        const topK = cfg.recallTopK ?? defaultSettings.recallTopK;
        const thresh = cfg.recallThresh ?? defaultSettings.recallThresh;
        const enabledStages = getEnabledStages(stageList);

        if (!enabledStages.size) return '';

        let queryVector;
        try {
            queryVector = await embedText(VECTOR_QUERY_INSTRUCTION + queryText);
        } catch (error) {
            logger.warn('[NI] 查询向量化失败:', error);
            return '';
        }

        let allChunks;
        try {
            allChunks = await dbLoadByNovel();
        } catch (error) {
            logger.warn('[NI] 加载向量失败:', error);
            return '';
        }

        const candidates = allChunks
            .filter(row => isVectorRowCompatible(row, getVectorFingerprint()))
            .filter(chunk => enabledStages.has(chunk.stageIdx))
            .map(chunk => ({ ...chunk, score: cosineSim(queryVector, chunk.vector) }))
            .filter(chunk => chunk.score >= thresh);

        if (!candidates.length) return '';
        const orderedCandidates = niSelectRecallCandidatesInStoryOrder(candidates, topK);
        return orderedCandidates.map(chunk => chunk.text).join('\n\n---\n\n');
    }

    return {
        recallRelevantWeighted,
        recallRelevant,
    };
}

// ============================================================
// Vectorization preparation and completion
// ============================================================

export function collectSelectedVectorStages(checkElements = []) {
    const selectedStages = new Set();
    checkElements.forEach(element => {
        if (element.checked) selectedStages.add(parseInt(element.value));
    });
    return selectedStages;
}

export function vectorSourceTextForChunk(state, chunkIdx) {
    return (state.chunkResults[chunkIdx] && state.chunkResults[chunkIdx].trim())
        ? state.chunkResults[chunkIdx]
        : (state.chunks[chunkIdx] || '');
}

export function mapVectorTextSubChunks(text, sourceChunkIdx, {
    splitTextFn = splitText,
    charLimit = 500,
} = {}) {
    return splitTextFn(text, charLimit).map(subChunkText => ({
        text: subChunkText,
        sourceChunkIdx,
    }));
}

export function buildVectorStageBuckets(state, selectedStages, {
    splitTextFn = splitText,
    getAssignedStagesForChunkFn = getAssignedStagesForChunk,
    charLimit = 500,
} = {}) {
    const stageBuckets = {};
    for (let chunkIdx = 0; chunkIdx < state.chunkStatus.length; chunkIdx++) {
        if (state.chunkStatus[chunkIdx] !== 'done') continue;
        const vectorText = vectorSourceTextForChunk(state, chunkIdx);
        if (!vectorText.trim()) continue;

        const assignedStages = getAssignedStagesForChunkFn(state, chunkIdx);
        if (!assignedStages.length) continue;

        for (const stageIdx of assignedStages) {
            if (!selectedStages.has(stageIdx)) continue;
            if (!stageBuckets[stageIdx]) stageBuckets[stageIdx] = [];
            stageBuckets[stageIdx].push(...mapVectorTextSubChunks(vectorText, chunkIdx, {
                splitTextFn,
                charLimit,
            }));
        }
    }
    return stageBuckets;
}

export function calculateVectorizationPlan(stageBuckets, selectedStages) {
    const stageIdxList = Object.keys(stageBuckets).map(Number);
    const totalChunks = stageIdxList.reduce((total, stageIdx) => total + stageBuckets[stageIdx].length, 0);
    const expectedByStage = {};
    const stagesWithoutExpected = [];

    selectedStages.forEach(stageIdx => {
        const expected = stageBuckets[stageIdx]?.length || 0;
        if (expected > 0) expectedByStage[Number(stageIdx)] = expected;
        else stagesWithoutExpected.push(Number(stageIdx));
    });

    return {
        stageIdxList,
        totalChunks,
        expectedByStage,
        stagesWithoutExpected,
    };
}

export function calculateVectorizationCompletion(stageBuckets, selectedStages, stageFailCount = {}) {
    const failedStages = Object.keys(stageFailCount).map(Number);
    const failedChunkCount = failedStages.reduce((total, stageIdx) => total + stageFailCount[stageIdx], 0);
    const stageResults = {};

    selectedStages.forEach(stageIdx => {
        const numericStageIdx = Number(stageIdx);
        const total = stageBuckets[stageIdx]?.length || 0;
        const failed = stageFailCount[stageIdx] || 0;
        stageResults[numericStageIdx] = {
            total,
            failed,
            done: total > 0 && failed === 0,
            status: total <= 0 ? 'empty' : (failed > 0 ? 'failed' : 'done'),
        };
    });

    return {
        failedStages,
        failedChunkCount,
        completedStageCount: selectedStages.size - failedStages.length,
        hasFailures: failedStages.length > 0,
        stageResults,
    };
}


// ============================================================
// IndexedDB and vectorization controller
// ============================================================

export function createVectorController({
    state: S,
    getSettings,
    defaultSettings,
    indexedDB: indexedDb = globalThis.indexedDB,
    dbName,
    dbVersion,
    dbStore,
    persistSettingsDebounced,
    q,
    qa,
    alert,
    confirm,
    logger = console,
    canUseDerivedModules,
    hasLoadedChunks,
    ensureChunksLoaded,
    serverLoadHeavy,
    concurrencyLimit,
    setBtn,
    embedText,
    buildStages,
    saveSettings,
    escapeHtml,
    togglePanel,
} = {}) {
    const console = logger;
    // ============================================================
    // IndexedDB 封装
    // ============================================================
    
    // --- fingerprint：标识当前 embedding 引擎，换模型时自动失效旧向量 ---
    function getVectorFingerprint() {
        const cfg = getSettings() || {};
        const url   = (cfg.vecUrl   || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = (cfg.vecModel || 'text-embedding-3-large').trim();
        return `${url}|${model}`;
    }
    
    async function dbOpen() {
        if (S.db) {
            try { S.db.transaction(dbStore, 'readonly'); return S.db; } catch (_) {
                try { S.db.close(); } catch (__) {}
                S.db = null;
            }
        }
        return new Promise((resolve, reject) => {
            const req = indexedDb.open(dbName, dbVersion);
            req.onupgradeneeded = (ev) => {
                const db = req.result;
                if (!db.objectStoreNames.contains(dbStore)) {
                    const store = db.createObjectStore(dbStore, { keyPath: 'key' });
                    store.createIndex('novelKey', 'novelKey', { unique: false });
                }
                // v2：添加 fingerprint 索引
                if (ev.oldVersion < 2) {
                    const store = req.transaction.objectStore(dbStore);
                    if (!store.indexNames.contains('fingerprint')) {
                        store.createIndex('fingerprint', 'fingerprint', { unique: false });
                    }
                }
            };
            req.onsuccess = () => {
                S.db = req.result;
                S.db.onversionchange = () => { S.db.close(); S.db = null; };
                S.db.onclose = () => { S.db = null; };
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }
    
    // 写入时将 vector 转为 ArrayBuffer 二进制，同时记录 fingerprint
    async function dbSaveChunk(stageIdx, chunkIdx, vector, text, meta = {}) {
        await dbOpen();
        const key = `${S.novelKey}_s${stageIdx}_c${chunkIdx}`;
        const fingerprint = getVectorFingerprint();
        return new Promise((resolve, reject) => {
            const tx = S.db.transaction(dbStore, 'readwrite');
            tx.objectStore(dbStore).put({
                key,
                novelKey: S.novelKey,
                stageIdx,
                chunkIdx,
                sourceChunkIdx: meta.sourceChunkIdx ?? chunkIdx,
                vector: vecToBuffer(vector),   // ← 二进制存储
                text,
                fingerprint,
            });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }
    
    // 读出时将 ArrayBuffer 还原为 number[]，兼容旧版 JSON 数组格式
    async function dbLoadByNovel() {
        await dbOpen();
        return new Promise((resolve, reject) => {
            const tx = S.db.transaction(dbStore, 'readonly');
            const idx = tx.objectStore(dbStore).index('novelKey');
            const req = idx.getAll(S.novelKey);
            req.onsuccess = () => {
                const rows = (req.result || []).map(r => ({ ...r, vector: bufferToVec(r.vector) }));
                resolve(rows);
            };
            req.onerror = () => reject(req.error);
        });
    }
    
    async function dbClearNovel(targetKey) {
        await dbOpen();
        const key = targetKey || S.novelKey;
        if (!key) return;
        return new Promise((resolve, reject) => {
            const tx = S.db.transaction(dbStore, 'readwrite');
            const store = tx.objectStore(dbStore);
            const idx = store.index('novelKey');
            const req = idx.openCursor(key);
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) { cursor.delete(); cursor.continue(); }
            };
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }
    
    async function dbCloneNovelKey(fromKey, toKey) {
        if (!fromKey || !toKey || fromKey === toKey) return 0;
        await dbOpen();
        return new Promise((resolve, reject) => {
            const tx = S.db.transaction(dbStore, 'readwrite');
            const store = tx.objectStore(dbStore);
            const idx = store.index('novelKey');
            const req = idx.openCursor(fromKey);
            let count = 0;
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return;
                const row = cursor.value || {};
                const stageIdx = Number(row.stageIdx);
                const chunkIdx = Number(row.chunkIdx);
                store.put({
                    ...row,
                    key: `${toKey}_s${stageIdx}_c${chunkIdx}`,
                    novelKey: toKey,
                    stageIdx,
                    chunkIdx,
                });
                count++;
                cursor.continue();
            };
            tx.oncomplete = () => resolve(count);
            tx.onerror = () => reject(tx.error);
        });
    }
    
    // 检查 DB 内现有向量的 fingerprint 是否与当前配置一致
    // 返回 true=匹配或无旧数据，false=不匹配
    async function dbCheckFingerprint() {
        try {
            const rows = await dbLoadByNovel();
            const fingerprint = getVectorFingerprint();
            return rows.every(row => isVectorRowCompatible(row, fingerprint));
        } catch (_) {
            return true;
        }
    }
    
    function persistVecState() {
        const cfg = getSettings();
        cfg._vecDone       = S.vecDone;
        cfg._stageVecDone  = S.stageVecDone;
        cfg._stageVecExpected = S.stageVecExpected;
        persistSettingsDebounced();
    }
    
    async function niReconcileVecStateFromDb({ persist = true } = {}) {
        if (!S.novelKey) {
            S.vecDone = false;
            S.stageVecDone = {};
            S.stageVecExpected = {};
            if (persist) persistVecState();
            return false;
        }
        try {
            const rebuilt = rebuildStageVectorCompletion({
                rows: await dbLoadByNovel(),
                expectedByStage: S.stageVecExpected,
                oldDone: S.stageVecDone,
                fingerprint: getVectorFingerprint(),
            });
            S.stageVecDone = rebuilt.stageVecDone;
            S.vecDone = rebuilt.vecDone;
            if (persist) persistVecState();
            return S.vecDone;
        } catch (e) {
            console.warn('[NI] 向量状态校准失败:', e);
            S.vecDone = Object.values(S.stageVecDone || {}).some(Boolean);
            if (persist) persistVecState();
            return S.vecDone;
        }
    }
    
    function niVectorConcurrencyLimit() {
        return concurrencyLimit(getSettings()?.vecConcurrency, defaultSettings.vecConcurrency);
    }
    
    async function niRunVectorItems(items, worker) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return;
        const workerCount = Math.min(niVectorConcurrencyLimit(), list.length);
        let next = 0;
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (next < list.length) {
                const index = next++;
                await worker(list[index], index);
            }
        }));
    }
    
    async function niStartVec() {
        if (!canUseDerivedModules(S)) { alert('请先完成至少一个分段并停止清洗，再进行向量化'); return; }
        const cfg = getSettings();
        const stageN = S.stageMapN > 0 ? S.stageMapN : 1;
    
        // 读取用户勾选的阶段
        const selectedStages = collectSelectedVectorStages(qa('.ni-vec-stage-chk'));
        // 没有勾选任何阶段时提示
        if (!selectedStages.size) { alert('请先勾选要向量化的阶段'); return; }
    
        // --- fingerprint 检查：换了模型则提示并清空旧向量 ---
        const fpMatch = await dbCheckFingerprint();
        if (!fpMatch) {
            const yes = confirm(
                '检测到 Embedding 模型已变更（当前：' + getVectorFingerprint() + '）。\n' +
                '旧向量与新模型不兼容，需要清空并重新向量化。\n\n确认继续？'
            );
            if (!yes) return;
            try { await dbClearNovel(); } catch (e) { console.warn('[NI] 清空旧向量失败:', e); }
            S.vecDone = false;
            S.stageVecDone = {};
            persistVecState();
        }
    
        S._vecRunning = true;
        S._vecFillVisible = false;
        setBtn('#ni-btn-vec', true, '<i class="ti ti-loader"></i>向量化中…');
        { const fb = q('#ni-btn-vec-fill'); if (fb) fb.style.display = 'none'; }
    
        // 标题行进度条
        const titleProg2 = q('#ni-vp-title-prog');
        const titleBar2  = q('#ni-vp-title-bar');
        const titleNote2 = q('#ni-vp-title-note');
        const vpCard     = q('#ni-vp-card');
    
        // 向量化需要压缩正文；chunks 默认懒加载，使用前再读取。
        if (canUseDerivedModules(S) && (!S.chunkStatus || S.chunkStatus.length === 0 || !hasLoadedChunks())) {
            if (S.novelKey) {
                if (titleNote2) titleNote2.textContent = '正在加载文本数据…';
                try {
                    if (!S.chunkStatus || S.chunkStatus.length === 0) {
                        await serverLoadHeavy(S.novelKey, S.heavyFileKey, { chunks: false });
                    }
                    const ok = await ensureChunksLoaded();
                    if (!ok || !S.chunkStatus || S.chunkStatus.length === 0) {
                        alert('无法加载清洗数据，请先重新清洗后再向量化。');
                        S._vecRunning = false;
                        S._vecFillVisible = false;
                        setBtn('#ni-btn-vec', false);
                        return;
                    }
                } catch (e) {
                    alert('加载清洗数据失败：' + e.message);
                    S._vecRunning = false;
                    S._vecFillVisible = false;
                    setBtn('#ni-btn-vec', false);
                    return;
                }
            }
        }
    
        if (titleProg2) titleProg2.style.display = 'flex';
        if (vpCard) vpCard.classList.add('ni-has-prog');
    
        // 仅清除选中阶段的旧向量
        try {
            const existing = await dbLoadByNovel();
            const toDelete = existing.filter(c => selectedStages.has(c.stageIdx));
            await dbOpen();
            for (const c of toDelete) {
                await new Promise((res, rej) => {
                    const tx = S.db.transaction(dbStore, 'readwrite');
                    tx.objectStore(dbStore).delete(c.key);
                    tx.oncomplete = res; tx.onerror = rej;
                });
            }
        } catch (e) { console.warn('[NI] 清除旧向量失败:', e); }
    
        // 将压缩稿按阶段分组
        // 方案B：优先用 chunkStageMap，
        // 保证边界 chunk 被同时放入相邻两个阶段；若未生成则退回旧逻辑。
        const stageBuckets = buildVectorStageBuckets(S, selectedStages);
    
        let totalDone = 0;
        const { stageIdxList, totalChunks, expectedByStage, stagesWithoutExpected } = calculateVectorizationPlan(stageBuckets, selectedStages);
        Object.assign(S.stageVecExpected, expectedByStage);
        stagesWithoutExpected.forEach(si => delete S.stageVecExpected[si]);
        if (totalChunks <= 0) {
            selectedStages.forEach(si => delete S.stageVecDone[Number(si)]);
            S._vecRunning = false;
            S.vecDone = Object.values(S.stageVecDone).some(v => v);
            persistVecState();
            if (titleBar2) { titleBar2.style.width = '0%'; titleBar2.classList.remove('g'); }
            if (titleNote2) { titleNote2.textContent = '没有可向量化的文本'; titleNote2.classList.remove('g'); }
            setBtn('#ni-btn-vec', false, '<i class="ti ti-database"></i>开始向量化');
            return;
        }
        // 记录各阶段是否有失败的 chunk，失败则不标记 vecDone
        const stageFailCount = {};
    
        for (const si of stageIdxList) {
            if (titleNote2) titleNote2.textContent = `正在向量化第 ${si}/${stageN} 阶段…`;
            const items = stageBuckets[si];
            await niRunVectorItems(items, async (rawItem, ci) => {
                try {
                    const item = typeof rawItem === 'string' ? { text: rawItem, sourceChunkIdx: ci } : rawItem;
                    const vec = await embedText(item.text);
                    await dbSaveChunk(si, ci, vec, item.text, { sourceChunkIdx: item.sourceChunkIdx });
                } catch (e) {
                    console.error(`[NI] 向量化失败 stage=${si} chunk=${ci}:`, e);
                    stageFailCount[si] = (stageFailCount[si] || 0) + 1;
                }
                totalDone++;
                if (titleBar2) titleBar2.style.width = `${Math.round((totalDone / totalChunks) * 95)}%`;
            });
        }
    
        if (titleBar2) { titleBar2.style.width = '100%'; titleBar2.classList.add('g'); }
        const completion = calculateVectorizationCompletion(stageBuckets, selectedStages, stageFailCount);
        if (completion.hasFailures) {
            if (titleNote2) {
                titleNote2.textContent = `${completion.completedStageCount} 段完成，${completion.failedChunkCount} 个块失败`;
                titleNote2.classList.remove('g');
            }
            setBtn('#ni-btn-vec', false, '<i class="ti ti-alert-triangle"></i>向量化未完成');
            S._vecFillVisible = true;
            const fillBtn = q('#ni-btn-vec-fill');
            if (fillBtn) fillBtn.style.display = 'flex';
        } else {
            if (titleNote2) { titleNote2.textContent = `${selectedStages.size} 个阶段向量化完成`; titleNote2.classList.add('g'); }
            setBtn('#ni-btn-vec', false, '<i class="ti ti-check"></i>向量化完成');
            S._vecFillVisible = false;
            const fillBtn = q('#ni-btn-vec-fill');
            if (fillBtn) fillBtn.style.display = 'none';
        }
    
        // 标记已向量：该阶段必须实际处理了 chunk，且所有 chunk 均成功
        for (const si of selectedStages) {
            const { total, failed, status } = completion.stageResults[Number(si)];
            if (status === 'done') {
                S.stageVecDone[Number(si)] = true;
            } else if (status === 'empty') {
                // 没有可向量化的文本，主动清除可能存在的脏标记
                delete S.stageVecDone[Number(si)];
                console.warn(`[NI] 阶段 ${si} 没有可向量化的文本，已清除向量标记`);
            } else {
                // 任意 chunk 失败都不能标记为完整已向量，交给「补全缺失」处理
                delete S.stageVecDone[Number(si)];
                console.warn(`[NI] 阶段 ${si} 有 ${failed}/${total} 个 chunk 向量化失败，已清除向量完成标记`);
            }
        }
    
        S._vecRunning = false;
        S.vecDone = Object.values(S.stageVecDone).some(v => v);
        buildStages();
        persistVecState();
        saveSettings();
    }
    
    // 补全缺失向量块：对比 IndexedDB 已有记录与应有的完整列表，只补跑缺失的 chunk
    async function niVecFillMissing() {
        if (!canUseDerivedModules(S)) { alert('请先完成至少一个分段并停止清洗，再补全向量'); return; }
    
        const fillBtn = q('#ni-btn-vec-fill');
        if (fillBtn) fillBtn.style.display = 'none';
    
        const titleProg2 = q('#ni-vp-title-prog');
        const titleBar2  = q('#ni-vp-title-bar');
        const titleNote2 = q('#ni-vp-title-note');
        const vpCard     = q('#ni-vp-card');
        if (titleProg2) titleProg2.style.display = 'flex';
        if (vpCard) vpCard.classList.add('ni-has-prog');
        if (titleBar2) { titleBar2.style.width = '0%'; titleBar2.classList.remove('g'); }
        if (titleNote2) { titleNote2.textContent = '正在对比缺失块…'; titleNote2.classList.remove('g'); }
        setBtn('#ni-btn-vec', true, '<i class="ti ti-loader"></i>向量化中…');
    
        if (!hasLoadedChunks()) {
            const ok = await ensureChunksLoaded();
            if (!ok) {
                alert('无法加载压缩正文，不能补全缺失向量。');
                setBtn('#ni-btn-vec', false);
                return;
            }
        }
    
        // 1. 从 IndexedDB 读出该小说所有已存 chunk，建立 "s{si}_c{ci}" 集合
        let existingKeys = new Set();
        try {
            const existing = await dbLoadByNovel();
            existing.forEach(c => existingKeys.add(`s${c.stageIdx}_c${c.chunkIdx}`));
        } catch(e) {
            console.warn('[NI] 读取 IndexedDB 失败:', e);
        }
    
        // 2. 重建完整的 stageBuckets
        const allStages = new Set();
        for (let si = 1; si <= (S.stageMapN > 0 ? S.stageMapN : 1); si++) allStages.add(si);
    
        const stageBuckets = {};
        for (let i = 0; i < S.chunkStatus.length; i++) {
            if (S.chunkStatus[i] !== 'done') continue;
            const vecText = (S.chunkResults[i] && S.chunkResults[i].trim())
                ? S.chunkResults[i] : (S.chunks[i] || '');
            if (!vecText.trim()) continue;
    
            const assignedStages = getAssignedStagesForChunk(S, i);
            if (!assignedStages.length) continue;
            for (const si of assignedStages) {
                if (!stageBuckets[si]) stageBuckets[si] = [];
                const subChunks = splitText(vecText, 500);
                stageBuckets[si].push(...subChunks.map(text => ({ text, sourceChunkIdx: i })));
            }
        }
    
        // 3. 对比：找出 IndexedDB 里没有的 chunk
        const missingChunks = []; // { si, ci, text, sourceChunkIdx }
        for (const [siStr, items] of Object.entries(stageBuckets)) {
            const si = Number(siStr);
            S.stageVecExpected[si] = items.length;
            for (let ci = 0; ci < items.length; ci++) {
                if (!existingKeys.has(`s${si}_c${ci}`)) {
                    const item = typeof items[ci] === 'string' ? { text: items[ci], sourceChunkIdx: ci } : items[ci];
                    missingChunks.push({ si, ci, text: item.text, sourceChunkIdx: item.sourceChunkIdx });
                }
            }
        }
    
        if (missingChunks.length === 0) {
            await niReconcileVecStateFromDb({ persist: false });
            buildStages();
            persistVecState();
            if (titleNote2) { titleNote2.textContent = '无缺失块，向量化已完整'; titleNote2.classList.add('g'); }
            if (titleBar2) { titleBar2.style.width = '100%'; titleBar2.classList.add('g'); }
            setBtn('#ni-btn-vec', false, '<i class="ti ti-check"></i>向量化完成');
            S._vecFillVisible = false;
            return;
        }
    
        if (titleNote2) titleNote2.textContent = `发现 ${missingChunks.length} 个缺失块，补全中…`;
    
        // 4. 只向量化缺失的 chunk
        let done = 0;
        const stillFailed = [];
        const stageFailCount2 = {};
    
        await niRunVectorItems(missingChunks, async ({ si, ci, text, sourceChunkIdx }) => {
            try {
                const vec = await embedText(text);
                await dbSaveChunk(si, ci, vec, text, { sourceChunkIdx: sourceChunkIdx ?? ci });
            } catch (e) {
                console.error(`[NI] 补全失败 stage=${si} chunk=${ci}:`, e);
                stillFailed.push({ si, ci, text, sourceChunkIdx });
                stageFailCount2[si] = (stageFailCount2[si] || 0) + 1;
            }
            done++;
            if (titleBar2) titleBar2.style.width = `${Math.round((done / missingChunks.length) * 95)}%`;
        });
    
        if (titleBar2) { titleBar2.style.width = '100%'; titleBar2.classList.add('g'); }
        if (stillFailed.length > 0) {
            if (titleNote2) { titleNote2.textContent = `补全完成，仍有 ${stillFailed.length} 个块失败`; titleNote2.classList.remove('g'); }
            setBtn('#ni-btn-vec', false, '<i class="ti ti-check"></i>向量化完成');
            S._vecFillVisible = true;
            if (fillBtn) fillBtn.style.display = 'flex';
        } else {
            if (titleNote2) { titleNote2.textContent = `已补全 ${missingChunks.length} 个缺失块`; titleNote2.classList.add('g'); }
            setBtn('#ni-btn-vec', false, '<i class="ti ti-check"></i>向量化完成');
            S._vecFillVisible = false;
            if (fillBtn) fillBtn.style.display = 'none';
        }
    
        // 5. 重新评估各阶段 vecDone
        for (const [siStr, texts] of Object.entries(stageBuckets)) {
            const si = Number(siStr);
            const failed = stageFailCount2[si] || 0;
            if (failed === 0) {
                S.stageVecDone[si] = true;
            } else {
                delete S.stageVecDone[si];
            }
        }
        S.vecDone = Object.values(S.stageVecDone).some(v => v);
        buildStages();
        persistVecState();
        saveSettings();
    }
    
    // 渲染向量化阶段选择器
    function niRenderVecStageSelector() {
        // 同时更新 card 内与 modal 内列表
        const targets = [q('#ni-vec-stage-selector')].filter(Boolean);
        const n = S.stageMapN;
        if (!canUseDerivedModules(S) || n <= 0) {
            targets.forEach(w => { w.style.display = 'none'; });
            return;
        }
        const html = Array.from({length: n}, (_, i) => {
            const idx = i + 1;
            const title = S.stageTitles[idx] || `阶段 ${idx}`;
            const done = S.stageVecDone[idx];
            return `<label class="ni-vec-stage-label">
              <input type="checkbox" class="ni-vec-stage-chk" value="${idx}"${!done ? ' checked' : ''}>
              <span class="ni-vec-stage-box"><i class="ti ti-check"></i></span>
              <span class="ni-vec-stage-name">第 ${idx} 阶段 · ${escapeHtml(title)}</span>
              ${done ? '<span class="ni-vec-done-badge">已向量</span>' : ''}
            </label>`;
        }).join('');
        targets.forEach(w => { w.style.display = ''; w.innerHTML = html; });
    }
    
    function niToggleStagePanel() {
        if (!canUseDerivedModules(S)) { alert('请先完成至少一个分段并停止清洗，再进行向量化'); return; }
        if (S.stageMapN <= 0) { alert('请先完成阶段划分再向量化'); return; }
        niRenderVecStageSelector();
        togglePanel('ni-vec-stage-panel', 'ni-vec-stage-btn');
    }
    

    return {
        getVectorFingerprint,
        dbOpen,
        dbSaveChunk,
        dbLoadByNovel,
        dbClearNovel,
        dbCloneNovelKey,
        dbCheckFingerprint,
        persistVecState,
        niReconcileVecStateFromDb,
        niVectorConcurrencyLimit,
        niRunVectorItems,
        niStartVec,
        niVecFillMissing,
        niRenderVecStageSelector,
        niToggleStagePanel,
    };
}
