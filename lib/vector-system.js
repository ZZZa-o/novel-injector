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

export function isVectorRowCompatible(row) {
    // 指纹只用于诊断。跨设备导入或本机切换模型后，都继续使用已有向量。
    return !!row;
}

function vectorRowDimension(row) {
    const explicit = Number(row?.dimension);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    const length = Number(row?.vector?.length);
    return Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
}

export function isVectorDimensionCompatible(row, queryDimensions) {
    const expected = Math.max(0, parseInt(queryDimensions, 10) || 0);
    return expected > 0 && vectorRowDimension(row) === expected;
}

export function summarizeVectorCompatibility(rows = [], {
    currentFingerprint = '',
    queryDimensions = 0,
} = {}) {
    const dimensionCounts = {};
    const fingerprintCounts = {};
    let unknownFingerprintCount = 0;
    let invalidDimensionCount = 0;

    (rows || []).filter(Boolean).forEach(row => {
        const dimension = vectorRowDimension(row);
        if (dimension > 0) dimensionCounts[dimension] = (dimensionCounts[dimension] || 0) + 1;
        else invalidDimensionCount++;

        const fingerprint = String(row?.fingerprint || '').trim().toLowerCase();
        if (fingerprint) fingerprintCounts[fingerprint] = (fingerprintCounts[fingerprint] || 0) + 1;
        else unknownFingerprintCount++;
    });

    const dimensions = Object.keys(dimensionCounts).map(Number).sort((a, b) => a - b);
    const fingerprints = Object.keys(fingerprintCounts).sort();
    const normalizedCurrentFingerprint = String(currentFingerprint || '').trim().toLowerCase();
    const normalizedQueryDimensions = Math.max(0, parseInt(queryDimensions, 10) || 0);
    const queryMismatchCount = normalizedQueryDimensions > 0
        ? (rows || []).filter(row => {
            const dimension = vectorRowDimension(row);
            return dimension > 0 && dimension !== normalizedQueryDimensions;
        }).length
        : 0;

    return {
        rowCount: (rows || []).filter(Boolean).length,
        dimensions,
        dimensionCounts,
        fingerprints,
        fingerprintCounts,
        unknownFingerprintCount,
        invalidDimensionCount,
        mixedDimensions: dimensions.length > 1,
        mixedSources: fingerprints.length > 1,
        currentSourceMismatch: !!normalizedCurrentFingerprint
            && fingerprints.length > 0
            && !fingerprints.includes(normalizedCurrentFingerprint),
        queryDimensions: normalizedQueryDimensions,
        queryMismatchCount,
    };
}

export function findVectorStageSourceMismatches(rows = [], currentFingerprint = '') {
    const current = String(currentFingerprint || '').trim().toLowerCase();
    const result = {};
    if (!current) return result;

    (rows || []).filter(Boolean).forEach(row => {
        const stageIdx = Number(row?.stageIdx);
        const fingerprint = String(row?.fingerprint || '').trim().toLowerCase();
        if (!Number.isFinite(stageIdx) || stageIdx <= 0 || !fingerprint) return;
        if (fingerprint !== current) result[stageIdx] = true;
    });
    return result;
}

export function getVectorCompatibilityHint({ stored = null, query = null } = {}) {
    const normal = {
        level: 'normal',
        icon: 'ti-info-circle',
        text: '各阶段独立索引，阶段页开关控制检索。',
        title: '各阶段独立索引，阶段页开关控制检索。',
    };

    if (query?.queryDimensions > 0 && query.queryMismatchCount > 0) {
        const dimensions = query.dimensions.length ? query.dimensions.join('/') : '未知';
        return {
            level: 'warning',
            icon: 'ti-alert-triangle',
            text: `当前模型为 ${query.queryDimensions} 维，${query.queryMismatchCount} 个已有向量维度不符，无法召回。`,
            title: `当前查询向量为 ${query.queryDimensions} 维；不匹配的已有向量维度为 ${dimensions} 维，这些块不会参与本次召回。`,
        };
    }

    if (stored?.mixedDimensions) {
        const dimensions = stored.dimensions.join('/');
        return {
            level: 'warning',
            icon: 'ti-alert-triangle',
            text: `检测到 ${dimensions} 维混合向量，召回时仅使用维度匹配部分。`,
            title: `数据库中同时存在 ${dimensions} 维向量。插件不会清空数据，但维度不匹配的块无法参与当前查询。`,
        };
    }

    if (stored?.mixedSources) {
        return {
            level: 'warning',
            icon: 'ti-alert-triangle',
            text: '检测到多种向量来源，仍会使用；召回可能不稳定。',
            title: `数据库中检测到 ${stored.fingerprints.length} 种向量来源。指纹只作诊断，不会阻止已有向量使用。`,
        };
    }

    if (stored?.currentSourceMismatch) {
        return {
            level: 'warning',
            icon: 'ti-alert-triangle',
            text: '当前模型与已有向量来源不同，仍会使用；召回可能不稳定。',
            title: '当前向量配置指纹与已有向量不同。插件不会清空或停用旧向量；若实际模型不同，相似度可能不可靠。',
        };
    }

    return normal;
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
} = {}) {
    const grouped = {};
    rows
        .filter(isVectorRowCompatible)
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

export function findVectorStagesMissingExpected(rows = [], expectedByStage = {}) {
    const stages = new Set();
    (rows || [])
        .filter(isVectorRowCompatible)
        .forEach(row => {
            const stageIdx = Number(row?.stageIdx);
            if (!Number.isFinite(stageIdx)) return;
            const expected = Math.max(0, parseInt(expectedByStage?.[stageIdx], 10) || 0);
            if (expected <= 0) stages.add(stageIdx);
        });
    return stages;
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
    nodeWeight = 2,
} = {}) {
    const messages = Array.isArray(recentMessages) ? recentMessages : [];
    const queries = messages.map((message, index) => {
        const text = String(message).slice(0, maxTextLength);
        const weight = Math.pow(decay, messages.length - 1 - index);
        return { text, weight };
    }).filter(query => query.text.trim());

    const nodeText = String(nodeContext || '').trim();
    if (nodeText) {
        queries.push({
            text: nodeText.slice(0, maxTextLength),
            weight: Math.max(0.1, Number(nodeWeight) || 2),
        });
    }
    return queries;
}

function niNormalizeRecallStageIndices(stages) {
    const values = Array.isArray(stages)
        ? stages
        : (stages instanceof Set ? [...stages] : []);
    return [...new Set(values
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))]
        .sort((a, b) => a - b);
}

/**
 * 将用户当前开启的阶段划分为「当前窗口」与「原著前情」。
 *
 * 普通模式没有明确的当前节点，因此把最高开启阶段向前的连续开启区间
 * 视为当前窗口（例如 1、4、5 开启时，4～5 是当前窗口，1～3 是前情）。
 * 穿书模式传入 currentStageIdx 后只把当前节点所在阶段视为当前，避免把
 * 当前节点之后的阶段误当成可召回内容。历史池只接收已经完成向量化的更早阶段。
 */
export function niResolveVectorRecallStageScopes({
    enabledStages = [],
    stageVecDone = {},
    currentStageIdx = null,
} = {}) {
    const enabled = niNormalizeRecallStageIndices(enabledStages);
    const enabledSet = new Set(enabled);
    const vectorized = Object.entries(stageVecDone || {})
        .filter(([, done]) => !!done)
        .map(([stageIdx]) => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0)
        .sort((a, b) => a - b);
    const vectorizedSet = new Set(vectorized);

    const explicitCurrent = Number(currentStageIdx);
    const hasExplicitCurrent = Number.isFinite(explicitCurrent) && explicitCurrent > 0;
    const boundaryStageIdx = hasExplicitCurrent
        ? explicitCurrent
        : (enabled.length ? enabled[enabled.length - 1] : null);

    let currentWindowStart = boundaryStageIdx;
    if (!hasExplicitCurrent && boundaryStageIdx != null) {
        currentWindowStart = boundaryStageIdx;
        while (currentWindowStart > 1 && enabledSet.has(currentWindowStart - 1)) {
            currentWindowStart--;
        }
    }
    const historicalBoundary = hasExplicitCurrent ? boundaryStageIdx : currentWindowStart;
    const currentWindow = hasExplicitCurrent && boundaryStageIdx != null
        ? [boundaryStageIdx]
        : (currentWindowStart == null || boundaryStageIdx == null
            ? []
            : Array.from({ length: boundaryStageIdx - currentWindowStart + 1 }, (_, index) => currentWindowStart + index));

    const currentSet = new Set(currentWindow);
    const currentStages = currentWindow
        .filter(stageIdx => enabledSet.has(stageIdx) && vectorizedSet.has(stageIdx));
    const historicalStages = historicalBoundary == null
        ? []
        : vectorized.filter(stageIdx => stageIdx < historicalBoundary && !currentSet.has(stageIdx));
    const futureStages = boundaryStageIdx == null
        ? []
        : vectorized.filter(stageIdx => stageIdx > boundaryStageIdx);

    return {
        enabledStages: enabled,
        vectorizedStages: vectorized,
        boundaryStageIdx,
        currentWindowStart,
        currentStages,
        historicalStages,
        futureStages,
    };
}

/**
 * 将当前阶段剧情节点压缩成查询引子。节点只用于构造查询，不会作为召回
 * 结果写入向量库；从尾部取最近节点，避免早期节点把当前语义挤出查询长度。
 */
export function niBuildStageNodeVectorQuery(nodes, {
    maxNodes = 8,
    maxTextLength = 2600,
} = {}) {
    const list = (Array.isArray(nodes) ? nodes : [])
        .filter(Boolean)
        .slice(-Math.max(1, parseInt(maxNodes, 10) || 8));
    if (!list.length) return '';

    const lines = ['【当前阶段剧情节点引子】'];
    list.forEach(node => {
        const stageIdx = Number(node?.stageIdx);
        const stageLabel = Number.isFinite(stageIdx) && stageIdx > 0 ? `第${stageIdx}阶段·` : '';
        const title = String(node?.title || '').trim();
        const time = String(node?.time || '').trim();
        const location = String(node?.location || '').trim();
        const body = String(node?.body || node?.content || node?.desc || node?.description || '').trim();
        const parts = [`${stageLabel}${title || '未命名节点'}`];
        if (time) parts.push(`时间：${time}`);
        if (location) parts.push(`地点：${location}`);
        if (body) parts.push(`事件：${body}`);
        const appendList = (label, items) => {
            if (!Array.isArray(items)) return;
            const text = items.map(item => typeof item === 'string'
                ? item.trim()
                : String(item?.title || item?.body || item?.desc || item?.description || '').trim())
                .filter(Boolean)
                .join('；');
            if (text) parts.push(`${label}：${text}`);
        };
        appendList('关联线索', node?.branch_links);
        appendList('节点事件', node?.sub_notes);
        lines.push(parts.join('，'));
    });

    const text = lines.join('\n');
    if (text.length <= maxTextLength) return text;
    return text.slice(Math.max(0, text.length - Math.max(200, maxTextLength)));
}

export function niNormalizeRecallKeywordTerms(terms, { maxTerms = 24 } = {}) {
    const seen = new Set();
    return (Array.isArray(terms) ? terms : [])
        .map(term => String(term || '').trim().toLowerCase().replace(/\s+/g, ''))
        .filter(term => term.length >= 2 && term.length <= 40)
        .sort((a, b) => b.length - a.length)
        .filter(term => {
            if (seen.has(term)) return false;
            seen.add(term);
            return true;
        })
        .slice(0, Math.max(0, parseInt(maxTerms, 10) || 24));
}

export function niRecallKeywordBonus(text, keywordTerms = []) {
    const normalizedText = String(text || '').toLowerCase().replace(/\s+/g, '');
    if (!normalizedText) return 0;
    const terms = niNormalizeRecallKeywordTerms(keywordTerms);
    const hitCount = terms.reduce((count, term) => normalizedText.includes(term) ? count + 1 : count, 0);
    // 只作小幅辅助，不能让关键词完全取代语义相似度。
    return Math.min(0.12, hitCount * 0.06);
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

export function niBuildTbNodeVectorQuery(curNode) {
    if (!curNode) return '';
    const lines = [];
    const title = String(curNode.title || '').trim();
    const time = String(curNode.time || '').trim();
    const location = String(curNode.location || '').trim();
    const body = String(curNode.body || curNode.desc || curNode.description || '').trim();

    if (title) lines.push(`【当前剧情节点】${title}`);
    if (time) lines.push(`时间：${time}`);
    if (location) lines.push(`地点：${location}`);
    if (body) lines.push(`节点概括：${body}`);

    const appendList = (label, items) => {
        if (!Array.isArray(items)) return;
        const texts = items.map(item => {
            if (typeof item === 'string') return item.trim();
            return String(item?.title || item?.body || item?.desc || item?.description || '').trim();
        }).filter(Boolean);
        if (texts.length) lines.push(`${label}：${texts.join('；')}`);
    };
    appendList('节点事件', curNode.sub_notes);
    appendList('关联线索', curNode.branch_links);
    return lines.join('\n');
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

/**
 * 返回一个向量块在本轮召回中的稳定去重键。
 *
 * sourceChunkIdx 是原始小说分段的全局索引，同一原文分段被多个阶段
 * 关联时，数据库里会有多行向量，但注入时只能保留同一子块的一份。旧的
 * 去重键把 stageIdx 拼进去，导致当前池与前情池之间无法互相排除；只按
 * sourceChunkIdx 去重又会误删同一分段切出的其他子块。因此有源索引时将
 * 源索引与子块正文绑定，没有源索引的旧数据再用阶段/块索引兜底。
 */
export function niGetRecallChunkDedupKeys(chunk) {
    const keys = [];
    const sourceChunkIdx = niGetVectorSourceChunkIdx(chunk);
    const normalizedText = String(chunk?.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    if (sourceChunkIdx != null && normalizedText) {
        // 同一源分段的不同子块正文不同，不能只按 sourceChunkIdx 合并。
        keys.push(`source:${sourceChunkIdx}:text:${normalizedText}`);
    } else if (sourceChunkIdx != null) {
        keys.push(`source:${sourceChunkIdx}`);
    } else {
        const stageIdx = Number(chunk?.stageIdx);
        const chunkIdx = Number(chunk?.chunkIdx);
        if (Number.isFinite(stageIdx) && Number.isFinite(chunkIdx)) {
            keys.push(`stage:${stageIdx}:chunk:${chunkIdx}`);
        }
    }

    if (normalizedText.length >= 32) {
        keys.push(`text:${normalizedText}`);
    }
    return keys;
}

function niRecallChunkOverlapsKeys(chunk, keys) {
    return niGetRecallChunkDedupKeys(chunk).some(key => keys.has(key));
}

export function niSelectSemanticRecallCandidates(candidates, topK, { minScore = 0 } = {}) {
    const limit = Math.max(1, parseInt(topK, 10) || 1);
    const threshold = Number(minScore) || 0;
    const ranked = (Array.isArray(candidates) ? candidates : [])
        .slice()
        .filter(chunk => niFiniteNumber(chunk?.score, 0) >= threshold)
        .sort((a, b) => b.score - a.score || b.semanticScore - a.semanticScore);
    const unique = [];
    const seenKeys = new Set();
    for (const chunk of ranked) {
        const keys = niGetRecallChunkDedupKeys(chunk);
        if (keys.some(key => seenKeys.has(key))) continue;
        keys.forEach(key => seenKeys.add(key));
        unique.push(chunk);
    }
    return unique.slice(0, limit)
        .sort(niCompareRecallStoryOrder);
}

export function niRecallNodeDistance(chunk, nodeCtx) {
    const sourceChunkIdx = niGetVectorSourceChunkIdx(chunk);
    const anchorChunkIdx = Number(nodeCtx?.anchorChunkIdx);
    if (sourceChunkIdx == null || !Number.isFinite(anchorChunkIdx)) return null;
    return Math.abs(sourceChunkIdx - anchorChunkIdx);
}

export function niNodeAwareRecallScore(chunk, nodeCtx) {
    const semanticScore = niFiniteNumber(chunk?.score, 0);
    const distance = niRecallNodeDistance(chunk, nodeCtx);
    if (distance == null) return semanticScore;

    // 当前节点附近的块获得明确优势；距离较远的旧剧情逐步降权，但不做绝对硬裁切。
    const proximityBonus = 0.14 * Math.exp(-distance / 1.5);
    const distancePenalty = Math.min(0.2, Math.max(0, distance - 2) * 0.02);
    return semanticScore + proximityBonus - distancePenalty;
}

export function niSelectNodeAwareRecallCandidates(candidates, topK, nodeCtx, {
    minScore = 0,
    relativeWindow = 0.08,
} = {}) {
    const limit = Math.max(1, parseInt(topK, 10) || 1);
    const ranked = candidates.map(chunk => ({
        ...chunk,
        semanticScore: niFiniteNumber(chunk?.score, 0),
        score: niNodeAwareRecallScore(chunk, nodeCtx),
    })).sort((a, b) => b.score - a.score || b.semanticScore - a.semanticScore);

    const unique = [];
    const seenKeys = new Set();
    for (const chunk of ranked) {
        const keys = niGetRecallChunkDedupKeys(chunk);
        if (keys.some(key => seenKeys.has(key))) continue;
        keys.forEach(key => seenKeys.add(key));
        unique.push(chunk);
    }

    if (!unique.length) return [];
    const relativeCutoff = unique[0].score - Math.max(0, Number(relativeWindow) || 0);
    const cutoff = Math.max(Number(minScore) || 0, relativeCutoff);
    return unique
        .filter(chunk => chunk.score >= cutoff)
        .slice(0, limit)
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
    cosineSim,
    isVectorRowCompatible,
    embeddingClient,
    onVectorQueryCompared,
    logger = console,
} = {}) {
    const { niRequestEmbeddings, embedText } = embeddingClient;

    function getEnabledStages(stageList) {
        if (stageList !== undefined && stageList !== null) {
            return new Set(niNormalizeRecallStageIndices(stageList));
        }
        const state = getState();
        return new Set(Object.entries(state?.stageStates || {})
            .filter(([, on]) => on)
            .map(([key]) => Number(key))
            .filter(stageIdx => state?.stageVecDone?.[stageIdx]));
    }

    function chunkStageIdx(chunk) {
        const stageIdx = Number(chunk?.stageIdx);
        return Number.isFinite(stageIdx) && stageIdx > 0 ? stageIdx : null;
    }

    function formatRecallText({ currentText = '', historicalText = '' } = {}, opts = {}) {
        const current = String(currentText || '').trim();
        const historical = String(historicalText || '').trim();
        const splitSections = opts.splitSections === true ||
            (Array.isArray(opts.historicalStages) && opts.historicalStages.length > 0);
        if (!splitSections) return current || historical;
        const sections = [];
        if (current) sections.push(`【当前阶段原著片段】\n${current}`);
        if (historical) sections.push(`【原著前情片段】\n${historical}`);
        return sections.join('\n\n');
    }

    function selectRecallTexts(allChunks, queryVector, {
        currentStages = [],
        historicalStages = [],
        topK,
        historyTopK,
        thresh,
        lightCtx = null,
        nodeCtx = null,
        keywordTerms = [],
    } = {}) {
        const currentSet = new Set(niNormalizeRecallStageIndices(currentStages));
        const historicalSet = new Set(niNormalizeRecallStageIndices(historicalStages));
        currentSet.forEach(stageIdx => historicalSet.delete(stageIdx));
        const searchableStages = new Set([...currentSet, ...historicalSet]);
        const compatibleChunks = (Array.isArray(allChunks) ? allChunks : [])
            .filter(isVectorRowCompatible)
            .filter(chunk => searchableStages.has(chunkStageIdx(chunk)));

        const scoreChunk = (chunk, applyLightCut = false) => {
            const semanticScore = cosineSim(queryVector, chunk.vector);
            const keywordBonus = niRecallKeywordBonus(chunk.text, keywordTerms);
            const scored = {
                ...chunk,
                semanticScore,
                keywordBonus,
                score: semanticScore + keywordBonus,
            };
            if (applyLightCut && !niTbLightRecallCandidateAllowed(scored, lightCtx)) return null;
            return scored;
        };

        const currentCandidates = compatibleChunks
            .filter(chunk => currentSet.has(chunkStageIdx(chunk)))
            .filter(chunk => isVectorDimensionCompatible(chunk, queryVector.length))
            .map(chunk => scoreChunk(chunk, true))
            .filter(Boolean)
            .filter(chunk => chunk.score >= thresh);
        const historicalCandidates = compatibleChunks
            .filter(chunk => historicalSet.has(chunkStageIdx(chunk)))
            .filter(chunk => isVectorDimensionCompatible(chunk, queryVector.length))
            .map(chunk => scoreChunk(chunk, false))
            .filter(Boolean)
            .filter(chunk => chunk.score >= thresh);

        const currentLimit = Math.max(1, parseInt(topK, 10) || 1);
        const historyLimit = Math.max(1, parseInt(historyTopK, 10) || Math.min(2, currentLimit));
        const currentSelected = nodeCtx
            ? niSelectNodeAwareRecallCandidates(currentCandidates, currentLimit, nodeCtx, { minScore: thresh })
            : niSelectSemanticRecallCandidates(currentCandidates, currentLimit, { minScore: thresh });
        // 当前池先占用其选中的原文块，历史池不能再把同一源块补进来。
        // 这样既保留双池独立名额，又避免同一段原文在两个区块重复注入。
        const currentDedupKeys = new Set();
        currentSelected.forEach(chunk => {
            niGetRecallChunkDedupKeys(chunk).forEach(key => currentDedupKeys.add(key));
        });
        const distinctHistoricalCandidates = historicalCandidates
            .filter(chunk => !niRecallChunkOverlapsKeys(chunk, currentDedupKeys));
        const historicalSelected = niSelectSemanticRecallCandidates(
            distinctHistoricalCandidates,
            historyLimit,
            { minScore: thresh },
        );

        const join = selected => selected.map(chunk => chunk.text).join('\n\n---\n\n');
        return {
            compatibleChunks,
            currentText: niApplyTbLightRecallCut(join(currentSelected), lightCtx),
            historicalText: join(historicalSelected),
        };
    }

    async function loadAndSelectRecall(queryVector, stageList, opts = {}) {
        const cfg = getSettings?.() || {};
        const novelKey = String(getState()?.novelKey || '');
        const currentStages = getEnabledStages(stageList);
        const historicalStages = niNormalizeRecallStageIndices(opts.historicalStages);
        const searchableStages = new Set([
            ...currentStages,
            ...historicalStages,
        ]);
        if (!searchableStages.size || !queryVector?.length) return null;

        let allChunks;
        try {
            allChunks = await dbLoadByNovel();
        } catch (error) {
            logger.warn('[NI] 加载向量失败:', error);
            return null;
        }

        const compatibleRows = (Array.isArray(allChunks) ? allChunks : [])
            .filter(isVectorRowCompatible)
            .filter(chunk => searchableStages.has(chunkStageIdx(chunk)));
        try {
            onVectorQueryCompared?.(compatibleRows, queryVector.length, { novelKey });
        } catch (error) {
            logger.warn('[NI] 更新向量兼容提示失败:', error);
        }

        return selectRecallTexts(compatibleRows, queryVector, {
            currentStages,
            historicalStages,
            topK: opts.topK ?? cfg.recallTopK ?? defaultSettings.recallTopK,
            historyTopK: opts.historyTopK,
            thresh: opts.thresh ?? cfg.recallThresh ?? defaultSettings.recallThresh,
            lightCtx: opts.lightRecallContext || null,
            nodeCtx: opts.nodeRecallContext || opts.lightRecallContext || null,
            keywordTerms: opts.keywordTerms,
        });
    }

    async function recallRelevantWeighted(weightedQueries, stageList, opts = {}) {
        const queries = (Array.isArray(weightedQueries) ? weightedQueries : [])
            .map(query => ({
                text: String(query?.text || '').trim(),
                weight: Number(query?.weight) || 0,
            }))
            .filter(query => query.text && query.weight > 0);
        if (!queries.length) return '';

        const currentStages = getEnabledStages(stageList);
        const historicalStages = niNormalizeRecallStageIndices(opts.historicalStages);
        if (!currentStages.size && !historicalStages.length) return '';

        const inputs = queries.map(query => VECTOR_QUERY_INSTRUCTION + query.text);
        let vectors;
        try {
            // 所有引子在一轮批量请求中完成，只产生一次 Embedding API 调用。
            vectors = await niRequestEmbeddings(inputs);
        } catch (error) {
            logger.warn('[NI] 加权查询向量化失败:', error);
            return '';
        }
        if (!Array.isArray(vectors) || vectors.length !== queries.length || !vectors[0]?.length) return '';

        const combined = niCombineWeightedQueryVectors(vectors, queries);
        const selection = await loadAndSelectRecall(combined, [...currentStages], {
            ...opts,
            historicalStages,
        });
        if (!selection) return '';
        return formatRecallText(selection, { ...opts, historicalStages });
    }

    async function recallRelevant(queryText, stageList, opts = {}) {
        const currentStages = getEnabledStages(stageList);
        const historicalStages = niNormalizeRecallStageIndices(opts.historicalStages);
        if (!currentStages.size && !historicalStages.length) return '';

        let queryVector;
        try {
            queryVector = await embedText(VECTOR_QUERY_INSTRUCTION + String(queryText || ''));
        } catch (error) {
            logger.warn('[NI] 查询向量化失败:', error);
            return '';
        }

        const selection = await loadAndSelectRecall(queryVector, [...currentStages], {
            ...opts,
            historicalStages,
        });
        if (!selection) return '';
        return formatRecallText(selection, { ...opts, historicalStages });
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

export function restoreSelectedVectorStages(checkElements = [], selectedStages = new Set()) {
    checkElements.forEach(element => {
        element.checked = selectedStages.has(parseInt(element.value));
    });
}

export function reconcileVectorStageSelection(session = {}, stageCount = 0, stageVecDone = {}) {
    const count = Math.max(0, parseInt(stageCount, 10) || 0);
    session.selected = session.selected instanceof Set ? session.selected : new Set();
    session.knownStages = session.knownStages instanceof Set ? session.knownStages : new Set();
    session.userModified = !!session.userModified;

    if (!session.userModified) {
        session.selected.clear();
        session.knownStages.clear();
        for (let stageIdx = 1; stageIdx <= count; stageIdx++) {
            session.knownStages.add(stageIdx);
            if (!stageVecDone?.[stageIdx]) session.selected.add(stageIdx);
        }
        return session;
    }

    [...session.knownStages].forEach(stageIdx => {
        if (stageIdx > count) {
            session.knownStages.delete(stageIdx);
            session.selected.delete(stageIdx);
        }
    });
    for (let stageIdx = 1; stageIdx <= count; stageIdx++) {
        if (session.knownStages.has(stageIdx)) continue;
        session.knownStages.add(stageIdx);
        if (!stageVecDone?.[stageIdx]) session.selected.add(stageIdx);
    }
    return session;
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
    niRequestEmbeddings,
    buildStages,
    saveSettings,
    escapeHtml,
    togglePanel,
    onVectorRowsChanged,
} = {}) {
    const console = logger;
    const vectorStageSelections = new Map();
    let renderedVectorSelectionKey = '';

    function niVectorSelectionKey() {
        return String(S.novelKey || S.fileFingerprint || '__unsaved__');
    }

    function niGetVectorStageSelection(key, stageCount) {
        let session = vectorStageSelections.get(key);
        if (!session) {
            session = { selected: new Set(), knownStages: new Set(), userModified: false };
            vectorStageSelections.set(key, session);
        }
        return reconcileVectorStageSelection(session, stageCount, S.stageVecDone);
    }

    function niCaptureVecStageSelection(key = renderedVectorSelectionKey) {
        if (!key) return;
        const checkboxes = qa('#ni-vec-stage-selector .ni-vec-stage-chk');
        if (!checkboxes.length) return;
        const session = niGetVectorStageSelection(key, checkboxes.length);
        if (!session.userModified) return;
        session.selected = collectSelectedVectorStages(checkboxes);
        session.knownStages = new Set(
            Array.from(checkboxes, element => parseInt(element.value)).filter(Number.isFinite),
        );
    }

    function niBindVecStageSelectionTracking() {
        qa('#ni-vec-stage-selector .ni-vec-stage-chk').forEach(element => {
            if (element.dataset.niVecSelectionBound === '1') return;
            element.dataset.niVecSelectionBound = '1';
            element.addEventListener('change', () => {
                const session = niGetVectorStageSelection(renderedVectorSelectionKey, qa('#ni-vec-stage-selector .ni-vec-stage-chk').length);
                session.userModified = true;
                niCaptureVecStageSelection();
            });
        });
        ['#ni-vsp-all', '#ni-vsp-none', '#ni-vsp-pending'].forEach(selector => {
            const button = q(selector);
            if (!button || button.dataset.niVecSelectionBound === '1') return;
            button.dataset.niVecSelectionBound = '1';
            // 批量按钮的实际勾选逻辑由外层委托事件执行；事件冒泡结束后再读取最终状态。
            button.addEventListener('click', () => Promise.resolve().then(() => {
                const session = niGetVectorStageSelection(renderedVectorSelectionKey, qa('#ni-vec-stage-selector .ni-vec-stage-chk').length);
                session.userModified = true;
                niCaptureVecStageSelection();
            }));
        });
    }
    // ============================================================
    // IndexedDB 封装
    // ============================================================
    
    // 指纹只记录向量来源，供导出和诊断使用；不参与兼容性拦截。
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

    async function niNotifyVectorRowsChanged(rows = null, novelKey = S.novelKey) {
        if (typeof onVectorRowsChanged !== 'function') return;
        try {
            const currentRows = rows ?? (novelKey ? await dbLoadByNovel() : []);
            await onVectorRowsChanged(currentRows, { novelKey: String(novelKey || '') });
        } catch (e) {
            console.warn('[NI] 更新向量来源提示失败:', e);
        }
    }
    
    async function dbClearNovel(targetKey) {
        await dbOpen();
        const key = targetKey || S.novelKey;
        if (!key) return;
        await new Promise((resolve, reject) => {
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
        if (S.novelKey === key) await niNotifyVectorRowsChanged([], key);
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
    
    function persistVecState() {
        const cfg = getSettings();
        cfg._vecDone       = S.vecDone;
        cfg._stageVecDone  = S.stageVecDone;
        cfg._stageVecExpected = S.stageVecExpected;
        persistSettingsDebounced();
    }

    async function niBackfillStageVecExpected(rows, novelKey) {
        if (!novelKey || S.novelKey !== novelKey) return false;
        const missingStages = findVectorStagesMissingExpected(
            rows,
            S.stageVecExpected,
        );
        if (!missingStages.size) return false;

        // 旧版本或中断任务可能已经写入向量块，却还没来得及保存预期块数。
        // 只有能从当前小说的压缩正文重建完整分桶时才回填，避免把残缺向量误判为完成。
        if ((!Array.isArray(S.chunkStatus) || S.chunkStatus.length === 0) && typeof serverLoadHeavy === 'function') {
            try {
                await serverLoadHeavy(novelKey, S.heavyFileKey, { chunks: false });
            } catch (e) {
                console.warn('[NI] 修复向量预期块数时加载分段状态失败:', e);
            }
        }
        if (S.novelKey !== novelKey) return false;
        if (typeof canUseDerivedModules !== 'function' || !canUseDerivedModules(S)) return false;
        if (typeof hasLoadedChunks !== 'function' || !hasLoadedChunks()) {
            if (typeof ensureChunksLoaded !== 'function' || !(await ensureChunksLoaded())) return false;
        }
        if (S.novelKey !== novelKey) return false;

        const stageBuckets = buildVectorStageBuckets(S, missingStages);
        const { expectedByStage } = calculateVectorizationPlan(stageBuckets, missingStages);
        let changed = false;
        Object.entries(expectedByStage).forEach(([stageKey, expected]) => {
            const stageIdx = Number(stageKey);
            if (expected > 0 && S.stageVecExpected[stageIdx] !== expected) {
                S.stageVecExpected[stageIdx] = expected;
                changed = true;
            }
        });
        return changed;
    }
    
    async function niReconcileVecStateFromDb({ persist = true } = {}) {
        if (!S.novelKey) {
            S.vecDone = false;
            S.stageVecDone = {};
            S.stageVecExpected = {};
            if (persist) persistVecState();
            await niNotifyVectorRowsChanged([], '');
            return false;
        }
        try {
            const novelKey = S.novelKey;
            const rows = await dbLoadByNovel();
            if (S.novelKey !== novelKey) return false;
            await niNotifyVectorRowsChanged(rows, novelKey);
            await niBackfillStageVecExpected(rows, novelKey);
            if (S.novelKey !== novelKey) return false;
            const rebuilt = rebuildStageVectorCompletion({
                rows,
                expectedByStage: S.stageVecExpected,
                oldDone: S.stageVecDone,
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

    function niVectorBatchSize() {
        const configured = parseInt(getSettings()?.vecBatchSize ?? defaultSettings.vecBatchSize, 10);
        return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 100) : 16;
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

    async function niRunVectorBatches(items, worker) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return;
        const batchSize = niVectorBatchSize();
        const batches = [];
        for (let start = 0; start < list.length; start += batchSize) {
            batches.push({ items: list.slice(start, start + batchSize), start });
        }
        await niRunVectorItems(batches, worker);
    }
    
    async function niStartVec() {
        if (!canUseDerivedModules(S)) { alert('请先完成至少一个分段并停止清洗，再进行向量化'); return; }
        const cfg = getSettings();
        const stageN = S.stageMapN > 0 ? S.stageMapN : 1;
    
        // 读取用户勾选的阶段
        niCaptureVecStageSelection();
        const selectedStages = collectSelectedVectorStages(qa('.ni-vec-stage-chk'));
        // 没有勾选任何阶段时提示
        if (!selectedStages.size) { alert('请先勾选要向量化的阶段'); return; }
    
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
        // 旧向量已经清除，立即保存新的预期块数并撤销旧完成标记。
        // 后续每完成一个阶段都会再次保存，避免长任务中断后留下“有块但无已向量标记”。
        selectedStages.forEach(si => delete S.stageVecDone[Number(si)]);
        S.vecDone = Object.values(S.stageVecDone).some(Boolean);
        persistVecState();
        if (totalChunks <= 0) {
            S._vecRunning = false;
            persistVecState();
            if (titleBar2) { titleBar2.style.width = '0%'; titleBar2.classList.remove('g'); }
            if (titleNote2) { titleNote2.textContent = '没有可向量化的文本'; titleNote2.classList.remove('g'); }
            setBtn('#ni-btn-vec', false, '<i class="ti ti-database"></i>开始向量化');
            await niNotifyVectorRowsChanged();
            return;
        }
        // 记录各阶段是否有失败的 chunk，失败则不标记 vecDone
        const stageFailCount = {};
    
        for (const si of stageIdxList) {
            if (titleNote2) titleNote2.textContent = `正在向量化第 ${si}/${stageN} 阶段…`;
            const items = stageBuckets[si];
            await niRunVectorBatches(items, async ({ items: rawItems, start }) => {
                const batchItems = rawItems.map((rawItem, offset) => (
                    typeof rawItem === 'string'
                        ? { text: rawItem, sourceChunkIdx: start + offset }
                        : rawItem
                ));
                try {
                    const vectors = await niRequestEmbeddings(batchItems.map(item => item.text));
                    for (let offset = 0; offset < batchItems.length; offset++) {
                        const item = batchItems[offset];
                        const ci = start + offset;
                        try {
                            await dbSaveChunk(si, ci, vectors[offset], item.text, { sourceChunkIdx: item.sourceChunkIdx });
                        } catch (e) {
                            console.error(`[NI] 保存向量失败 stage=${si} chunk=${ci}:`, e);
                            stageFailCount[si] = (stageFailCount[si] || 0) + 1;
                        }
                    }
                } catch (e) {
                    console.error(`[NI] 批量向量化失败 stage=${si} chunks=${start}-${start + batchItems.length - 1}:`, e);
                    stageFailCount[si] = (stageFailCount[si] || 0) + batchItems.length;
                }
                totalDone += batchItems.length;
                if (titleBar2) titleBar2.style.width = `${Math.round((totalDone / totalChunks) * 95)}%`;
            });
            if (items.length > 0 && !(stageFailCount[si] > 0)) {
                S.stageVecDone[Number(si)] = true;
            } else {
                delete S.stageVecDone[Number(si)];
            }
            S.vecDone = Object.values(S.stageVecDone).some(Boolean);
            persistVecState();
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
        if (completion.hasFailures) {
            restoreSelectedVectorStages(qa('.ni-vec-stage-chk'), selectedStages);
            niCaptureVecStageSelection();
        }
        persistVecState();
        saveSettings();
        await niNotifyVectorRowsChanged();
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
    
        await niRunVectorBatches(missingChunks, async ({ items: batchItems }) => {
            try {
                const vectors = await niRequestEmbeddings(batchItems.map(item => item.text));
                for (let offset = 0; offset < batchItems.length; offset++) {
                    const item = batchItems[offset];
                    try {
                        await dbSaveChunk(item.si, item.ci, vectors[offset], item.text, { sourceChunkIdx: item.sourceChunkIdx ?? item.ci });
                    } catch (e) {
                        console.error(`[NI] 补全保存失败 stage=${item.si} chunk=${item.ci}:`, e);
                        stillFailed.push(item);
                        stageFailCount2[item.si] = (stageFailCount2[item.si] || 0) + 1;
                    }
                }
            } catch (e) {
                console.error('[NI] 批量补全向量失败:', e);
                batchItems.forEach(item => {
                    stillFailed.push(item);
                    stageFailCount2[item.si] = (stageFailCount2[item.si] || 0) + 1;
                });
            }
            done += batchItems.length;
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
        await niNotifyVectorRowsChanged();
    }
    
    // 渲染向量化阶段选择器
    function niRenderVecStageSelector() {
        // 同时更新 card 内与 modal 内列表
        const targets = [q('#ni-vec-stage-selector')].filter(Boolean);
        niCaptureVecStageSelection();
        const n = S.stageMapN;
        if (!canUseDerivedModules(S) || n <= 0) {
            targets.forEach(w => { w.style.display = 'none'; });
            return;
        }
        const selectionKey = niVectorSelectionKey();
        const session = niGetVectorStageSelection(selectionKey, n);
        const html = Array.from({length: n}, (_, i) => {
            const idx = i + 1;
            const title = S.stageTitles[idx] || `阶段 ${idx}`;
            const done = S.stageVecDone[idx];
            const sourceMismatch = !!S.stageVecSourceMismatch?.[idx];
            const badge = done
                ? (sourceMismatch
                    ? '<span class="ni-vec-done-badge ni-vec-source-warning" title="已向量，但来源与当前向量配置不同；仍可使用">异源向量</span>'
                    : '<span class="ni-vec-done-badge">已向量</span>')
                : '';
            return `<label class="ni-vec-stage-label">
              <input type="checkbox" class="ni-vec-stage-chk" value="${idx}"${session.selected.has(idx) ? ' checked' : ''}>
              <span class="ni-vec-stage-box"><i class="ti ti-check"></i></span>
              <span class="ni-vec-stage-name">第 ${idx} 阶段 · ${escapeHtml(title)}</span>
              ${badge}
            </label>`;
        }).join('');
        targets.forEach(w => { w.style.display = ''; w.innerHTML = html; });
        renderedVectorSelectionKey = selectionKey;
        niBindVecStageSelectionTracking();
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
        persistVecState,
        niReconcileVecStateFromDb,
        niVectorConcurrencyLimit,
        niRunVectorItems,
        niVectorBatchSize,
        niRunVectorBatches,
        niCaptureVecStageSelection,
        niStartVec,
        niVecFillMissing,
        niRenderVecStageSelector,
        niToggleStagePanel,
    };
}
