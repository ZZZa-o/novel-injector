// 清洗流程、分段布局与小说文件解析。

const NI_SHA256_CONSTANTS = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function niRotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
}

function niSha256HexFallback(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.length] = 0x80;

    const bitLength = input.length * 8;
    const paddedView = new DataView(padded.buffer);
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

    const hash = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let i = 0; i < 16; i++) words[i] = paddedView.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = words[i - 15];
            const y = words[i - 2];
            const sigma0 = niRotateRight(x, 7) ^ niRotateRight(x, 18) ^ (x >>> 3);
            const sigma1 = niRotateRight(y, 17) ^ niRotateRight(y, 19) ^ (y >>> 10);
            words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = hash;
        for (let i = 0; i < 64; i++) {
            const sum1 = niRotateRight(e, 6) ^ niRotateRight(e, 11) ^ niRotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 = (h + sum1 + choose + NI_SHA256_CONSTANTS[i] + words[i]) >>> 0;
            const sum0 = niRotateRight(a, 2) ^ niRotateRight(a, 13) ^ niRotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
}

export async function fingerprintArrayBuffer(buffer, subtle = globalThis.crypto?.subtle) {
    const bytes = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (typeof subtle?.digest === 'function') {
        try {
            const digest = await subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.warn('[NI] 浏览器 SHA-256 不可用，改用兼容实现:', error);
        }
    }
    return niSha256HexFallback(new Uint8Array(bytes));
}

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

function stripMarkdownFence(text) {
    return String(text || '').trim()
        .replace(/^```json\s*/, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '');
}

export function parseCleanResponse(raw, _chunkIndex = null, warn = (...args) => console.warn(...args)) {
    const source = String(raw || '');
    let meta = null;
    let compressed = source;

    const metaMatch = source.match(/<ni_meta>([\s\S]*?)<\/ni_meta>/);
    if (metaMatch) {
        compressed = source.replace(/<ni_meta>[\s\S]*?<\/ni_meta>/, '').trim();
        try {
            meta = JSON.parse(stripMarkdownFence(metaMatch[1]));
        } catch (error) {
            warn('[NI] ni_meta JSON 解析失败（格式错误，已跳过元数据）:', error);
        }
    } else {
        const fallbackMatch = source.match(/\{[\s\S]*"plots"[\s\S]*\}/);
        if (fallbackMatch) {
            try {
                meta = JSON.parse(stripMarkdownFence(fallbackMatch[0]));
                compressed = source.replace(fallbackMatch[0], '').trim() || source.trim();
                warn('[NI] 未找到 ni_meta 标签，但从正文抢救到裸 JSON，已使用。');
            } catch (error) {
                warn('[NI] 裸 JSON 抢救失败:', error);
            }
        }
        if (!meta) {
            warn('[NI] 未找到 ni_meta 块且抢救失败，全文作为压缩稿，将触发重试。');
            compressed = source.trim();
        }
    }

    return { compressed, meta };
}

export function detectEncoding(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return 'utf-8';
    if (b[0] === 0xFF && b[1] === 0xFE) return 'utf-16le';
    if (b[0] === 0xFE && b[1] === 0xFF) return 'utf-16be';
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buf);
        return 'utf-8';
    } catch (_) {
        return 'gb18030';
    }
}

export function niNovelFileExt(fileName = '') {
    const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? `.${match[1]}` : '';
}

export function niIsSupportedNovelFile(file) {
    return ['.txt', '.mobi'].includes(niNovelFileExt(file?.name || ''));
}

export function niReadAscii(u8, start, len) {
    let text = '';
    for (let i = 0; i < len && start + i < u8.length; i++) text += String.fromCharCode(u8[start + i]);
    return text;
}

export function niConcatBytes(parts, limit = 0) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const outLen = limit > 0 ? Math.min(limit, total) : total;
    const out = new Uint8Array(outLen);
    let pos = 0;
    for (const part of parts) {
        if (pos >= outLen) break;
        out.set(part.slice(0, outLen - pos), pos);
        pos += Math.min(part.length, outLen - pos);
    }
    return out;
}

export function niPalmDocDecompress(input, opts = {}) {
    const out = [];
    for (let i = 0; i < input.length;) {
        const c = input[i++];
        if (c === 0) {
            out.push(0);
        } else if (c <= 8) {
            for (let j = 0; j < c && i < input.length; j++) out.push(input[i++]);
        } else if (c <= 0x7f) {
            out.push(c);
        } else if (c <= 0xbf) {
            if (i >= input.length) break;
            const c2 = input[i++];
            const pair = ((c & 0x3f) << 8) | c2;
            const distance = pair >> 3;
            const length = (c2 & 0x07) + 3;
            if (distance <= 0 || distance > out.length) {
                if (!opts.tolerant) throw new Error('MOBI 解压失败：压缩引用无效');
                continue;
            }
            for (let j = 0; j < length; j++) out.push(out[out.length - distance]);
        } else {
            out.push(0x20, c ^ 0x80);
        }
    }
    return new Uint8Array(out);
}

export function niMobiTrailingEntrySize(u8, end) {
    let pos = end;
    let value = 0;
    let shift = 0;
    while (pos > 0 && shift < 28) {
        const byte = u8[--pos];
        value |= (byte & 0x7f) << shift;
        shift += 7;
        if (byte & 0x80) return Math.min(value, end);
    }
    return 0;
}

export function niStripMobiTrailingData(u8, extraFlags = 0) {
    let end = u8.length;
    let flags = extraFlags >> 1;
    while (flags && end > 0) {
        if (flags & 1) {
            const size = niMobiTrailingEntrySize(u8, end);
            if (!size || size > end) break;
            end -= size;
        }
        flags >>= 1;
    }
    if ((extraFlags & 1) && end > 0) {
        const overlap = u8[end - 1] & 0x03;
        if (overlap <= end) end -= overlap;
    }
    return end < u8.length ? u8.slice(0, end) : u8;
}

export function niMobiTextEncoding(code) {
    if (code === 65001) return 'utf-8';
    if (code === 1252) return 'windows-1252';
    if (code === 932) return 'shift_jis';
    if (code === 936) return 'gb18030';
    if (code === 949) return 'euc-kr';
    if (code === 950) return 'big5';
    if (code === 1200) return 'utf-16le';
    if (code === 54936) return 'gb18030';
    return 'utf-8';
}

export function niMobiCompressionName(code) {
    if (code === 1) return '无压缩';
    if (code === 2) return 'PalmDOC';
    if (code === 17480) return 'Huff/CDIC';
    return `未知类型 ${code}`;
}

export function niDecodeHtmlEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
}

export function niMobiHtmlToText(html) {
    const text = String(html || '')
        .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '\n')
        .replace(/<!--[\s\S]*?-->/g, '\n')
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\s*\/\s*(p|div|h[1-6]|li|blockquote|section|article|tr)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, '');
    return niDecodeHtmlEntities(text)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function niExtractMobiText(buf) {
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    if (u8.length < 86) throw new Error('MOBI 文件过小或格式不完整');

    const recordCount = view.getUint16(76, false);
    if (!recordCount || 78 + recordCount * 8 > u8.length) throw new Error('MOBI 记录表损坏');

    const records = [];
    for (let i = 0; i < recordCount; i++) {
        const pos = 78 + i * 8;
        const start = view.getUint32(pos, false);
        const end = i + 1 < recordCount ? view.getUint32(pos + 8, false) : u8.length;
        if (start >= u8.length || end > u8.length || end < start) throw new Error('MOBI 记录偏移异常');
        records.push({ start, end });
    }

    const header = records[0];
    if (header.end - header.start < 32) throw new Error('MOBI 头部不完整');

    const compression = view.getUint16(header.start, false);
    const textLength = view.getUint32(header.start + 4, false);
    const textRecords = view.getUint16(header.start + 8, false);
    const encryption = view.getUint16(header.start + 12, false);
    if (encryption) throw new Error('这是加密/DRM MOBI，浏览器插件无法直接读取正文；请先用你有权限的工具导出为 TXT 后再上传。');
    if (compression === 17480) throw new Error('这是 Huff/CDIC 压缩 MOBI，当前浏览器端解析器暂不支持；请先转换为 TXT 后上传。');
    if (compression !== 1 && compression !== 2) throw new Error(`暂不支持此 MOBI 压缩类型：${niMobiCompressionName(compression)}。`);

    const mobiHeader = header.start + 16;
    if (niReadAscii(u8, mobiHeader, 4) !== 'MOBI') throw new Error('未找到 MOBI 头部');
    const mobiHeaderLen = view.getUint32(mobiHeader + 4, false);
    const encodingCode = view.getUint32(mobiHeader + 12, false);
    const encoding = niMobiTextEncoding(encodingCode);
    const extraFlags = mobiHeaderLen >= 244 && mobiHeader + 0xf4 <= header.end
        ? view.getUint16(mobiHeader + 0xf2, false)
        : 0;

    const parts = [];
    const lastTextRecord = Math.min(textRecords, records.length - 1);
    let tolerantUsed = false;
    for (let i = 1; i <= lastTextRecord; i++) {
        const record = records[i];
        const raw = niStripMobiTrailingData(u8.slice(record.start, record.end), extraFlags);
        if (compression === 2) {
            try {
                parts.push(niPalmDocDecompress(raw));
            } catch (error) {
                if (!tolerantUsed) console.warn('[NI] MOBI 严格解压失败，已切换容错提取。');
                tolerantUsed = true;
                parts.push(niPalmDocDecompress(raw, { tolerant: true }));
            }
        } else {
            parts.push(raw);
        }
    }

    const textBytes = niConcatBytes(parts, textLength);
    let html;
    try {
        html = new TextDecoder(encoding).decode(textBytes);
    } catch (_) {
        html = new TextDecoder('utf-8').decode(textBytes);
    }

    const text = niMobiHtmlToText(html);
    if (!text) throw new Error('MOBI 中没有提取到可用正文');
    return { text, sourceBytes: textBytes.length };
}

export function niExtractNovelText(buf, fileName) {
    const ext = niNovelFileExt(fileName);
    if (ext === '.mobi') return niExtractMobiText(buf);

    const encoding = detectEncoding(buf);
    const text = new TextDecoder(encoding).decode(buf);
    return { text, sourceBytes: new Uint8Array(buf).length };
}


// ============================================================
// Cleaning controller
// ============================================================

export function createCleaningController({
    state: S,
    getSettings,
    defaultSettings,
    cleanPrompt,
    q,
    sv,
    alert,
    toastr = globalThis.toastr,
    logger = console,
    FileReader: FileReaderClass = globalThis.FileReader,
    AbortController: AbortControllerClass = globalThis.AbortController,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timerId => clearTimeout(timerId),
    now = () => Date.now(),
    fingerprintArrayBuffer: niFingerprintArrayBuffer,
    resetNovelWorkspace: niResetNovelWorkspace,
    serverLoadHeavy: niServerLoadHeavy,
    rechunkPreservingCompleted: niRechunkPreservingCompleted,
    remapVectorSourceChunkIndices: dbRemapSourceChunkIndices,
    resetChunkDerivedState: niResetChunkDerivedState,
    populateStyleChunkSelector: niStylePopulateChunkSel,
    saveSettings: niSaveSettings,
    ensureChunksLoaded: niEnsureChunksLoaded,
    hasLoadedChunks: niHasLoadedChunks,
    concurrencyLimit,
    mergeCharacters,
    mergeCharacterAliases,
    mergePlots,
    restorePlotCheckpointMemory,
    restoreCharacterMemory,
    sortPlotsByStoryOrder: niSortPlotsByStoryOrder,
    rebuildStageMapFromPlotStageIdx,
    syncSubPlotStageAssignments: niSyncSubPlotStageAssignments,
    callCleanApi,
    capturePlotCheckpointMemory,
    captureCharacterMemory,
    renderPlots,
    renderCharacters,
    buildStages,
    clearNovelVectors: dbClearNovel,
    onNovelFileLoaded = () => {},
} = {}) {
    const console = logger;
    const setTimeout = setTimer;
    const clearTimeout = clearTimer;
    function niOnDrop(e) {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f && niIsSupportedNovelFile(f)) niApplyFile(f);
        else if (f) alert('仅支持 .txt / .mobi 小说文件。');
    }
    
    function niOnFile(inp) {
        const f = inp?.files?.[0];
        if (f && niIsSupportedNovelFile(f)) niApplyFile(f);
        else if (f) alert('仅支持 .txt / .mobi 小说文件。');
    }
    
    function niApplyFile(f) {
        const reader = new FileReaderClass();
        reader.onload = async ev => {
            try {
                const buf = ev.target.result;
                const fingerprint = await niFingerprintArrayBuffer(buf);
                const extracted = niExtractNovelText(buf, f.name);
                const cfg = getSettings() || {};
                const kb = getCfgKb();
                const previousFingerprint = S.fileFingerprint || cfg._fileFingerprint || '';
                const previousKb = Number(S.chunkKbUsed || cfg._chunkKbUsed) || 0;
                const sameContent = !!previousFingerprint && previousFingerprint === fingerprint;
                const sameChunkConfig = sameContent && previousKb === kb;
                const existingKey = S.novelKey || cfg._novelKey || '';
                const existingHeavyFileKey = S.heavyFileKey || cfg._heavyFileKey || '';
                const oldChunks = [...(S.chunks || [])];
                const oldStatus = [...(S.chunkStatus || [])];
                const oldResults = [...(S.chunkResults || [])];
                const oldMeta = [...(S.chunkMeta || [])];
                let appliedKb = kb;
    
                if (!sameContent) {
                    niResetNovelWorkspace();
                    const safeName = f.name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40) || 'novel';
                    S.novelKey = `${safeName}_${fingerprint.slice(0, 12)}_${now().toString(36)}`;
                } else {
                    S.novelKey = existingKey || `novel_${fingerprint.slice(0, 12)}_${now().toString(36)}`;
                    S.heavyFileKey = existingHeavyFileKey;
                }
    
                S.rawText = extracted.text;
                S.rawFileSize = f.size;
                S.fileFingerprint = fingerprint;
    
                // 动态系数：实际字符数 / 文件字节数，兼容任意编码
                S._charsPerByte = S.rawText.length / Math.max(1, extracted.sourceBytes || f.size);
    
                if (sameChunkConfig) {
                    S.chunks = splitNovelText(S.rawText, kb, S._charsPerByte || 0.5);
                    S.chunkStatus = S.chunks.map((_, i) => S.chunkStatus[i] || 'pending');
                    S.chunkResults = S.chunks.map((_, i) => S.chunkResults[i] || '');
                    S.chunkMeta = S.chunks.map((_, i) => S.chunkMeta[i] || null);
                } else if (sameContent) {
                    S.chunks = oldChunks.length ? oldChunks : splitNovelText(S.rawText, previousKb || kb, S._charsPerByte || 0.5);
                    S.chunkStatus = S.chunks.map((_, i) => oldStatus[i] || 'pending');
                    S.chunkResults = S.chunks.map((_, i) => oldResults[i] || '');
                    S.chunkMeta = S.chunks.map((_, i) => oldMeta[i] || null);
    
                    let missingCompletedData = S.chunkStatus.some((status, i) => status === 'done'
                        && (!String(S.chunkResults[i] || '').trim() || !S.chunkMeta[i]));
                    if (missingCompletedData) {
                        try {
                            await niServerLoadHeavy(S.novelKey, S.heavyFileKey, { core: true, chunks: true });
                        } catch (e) {
                            console.warn('[NI] 重新分段前恢复完成分段失败:', e);
                        }
                        missingCompletedData = S.chunkStatus.some((status, i) => status === 'done'
                            && (!String(S.chunkResults[i] || '').trim() || !S.chunkMeta[i]));
                    }
                    if (missingCompletedData) {
                        appliedKb = previousKb || kb;
                        sv('#ni-chunk-kb', appliedKb);
                        alert('无法完整恢复已完成分段，已保留原分段大小，避免丢失清洗进度。');
                    } else {
                        const rechunked = niRechunkPreservingCompleted(kb);
                        await dbRemapSourceChunkIndices(rechunked.oldToNewChunkIdx).catch(e => {
                            console.warn('[NI] 重新分段后更新向量正文顺序失败:', e);
                        });
                        if (rechunked.preserved > 0) {
                            toastr?.success(`已保留 ${rechunked.preserved} 个完成分段，其余正文按 ${kb} KB 重新分段`);
                        }
                    }
                } else {
                    S.chunks = splitNovelText(S.rawText, kb, S._charsPerByte || 0.5);
                    niResetChunkDerivedState();
                }
                S.chunkKbUsed = appliedKb;
                S.fileLoaded = true;
                onNovelFileLoaded(f.name);
    
                // UI
                q('#ni-uz')?.classList.add('loaded');
                q('#ni-u-label').textContent = f.name;
                q('#ni-u-hint').textContent = `${Math.round(f.size / 1024)} KB · 共 ${S.chunks.length} 段（${appliedKb} KB/段）`;
                const ok = q('#ni-u-ok');
                if (ok) ok.style.display = 'flex';
                q('#ni-u-fname').textContent = `${f.name} 已上传`;
                const ci = q('#ni-chunk-info');
                if (ci) ci.style.display = 'block';
                q('#ni-st-chunks').textContent = S.chunks.length;
                q('#ni-st-size').textContent = `${Math.round(f.size / 1024)} KB`;
    
                renderChunkList();
                niStylePopulateChunkSel();
                if (!sameContent) {
                    // 新小说必须立即刷新所有派生界面，不能继续展示上一本小说的卡片。
                    renderPlots?.();
                    renderCharacters?.();
                    buildStages?.();
                    const styleResult = q('#ni-style-result');
                    if (styleResult) styleResult.value = '';
                    const styleResultWrap = q('#ni-style-result-wrap');
                    if (styleResultWrap) styleResultWrap.style.display = 'none';
                }
                niSyncCleanButtonState();
                niSaveSettings();
            } catch (e) {
                console.error('[NI] 文件解析失败:', e);
                alert(`文件解析失败：${e.message || e}`);
            }
        };
        reader.onerror = () => alert('读取文件失败，请重新选择文件。');
        reader.readAsArrayBuffer(f);
    }
    
    function getCfgKb() {
        return Math.max(10, parseInt(q('#ni-chunk-kb')?.value) || 100);
    }
    
    function niOnKbChange() {
        if (!S.fileLoaded) return;
        clearTimeout(S.kbTimer);
        S.kbTimer = setTimeout(async () => {
            const kb = getCfgKb();
            if (kb === S.chunkKbUsed) return;
            if (S.cleanRunning) {
                sv('#ni-chunk-kb', S.chunkKbUsed || defaultSettings.chunkKb);
                alert('清洗运行中不能调整分段大小，请先暂停。');
                return;
            }
            const hasCompleted = S.chunkStatus.some(status => status === 'done');
            const missingCompletedText = S.chunkStatus.some((status, i) => status === 'done' && !String(S.chunkResults[i] || '').trim());
            if (hasCompleted && missingCompletedText) {
                const loaded = await niEnsureChunksLoaded();
                const stillMissing = S.chunkStatus.some((status, i) => status === 'done' && !String(S.chunkResults[i] || '').trim());
                if (!loaded || stillMissing) {
                    sv('#ni-chunk-kb', S.chunkKbUsed || defaultSettings.chunkKb);
                    alert('无法加载已完成分段的压缩结果，已取消重新分段，避免丢失进度。');
                    return;
                }
            }
            const rechunked = niRechunkPreservingCompleted(kb);
            await dbRemapSourceChunkIndices(rechunked.oldToNewChunkIdx).catch(e => {
                console.warn('[NI] 重新分段后更新向量正文顺序失败:', e);
            });
            S.chunkKbUsed = kb;
            q('#ni-u-hint').textContent = `${Math.round(S.rawFileSize / 1024)} KB · 共 ${S.chunks.length} 段（${kb} KB/段）`;
            q('#ni-st-chunks').textContent = S.chunks.length;
            renderChunkList();
            niStylePopulateChunkSel();
            niSyncCleanButtonState();
            niSaveSettings();
            if (rechunked.preserved > 0) {
                toastr?.success(`已保留 ${rechunked.preserved} 个完成分段，其余正文按 ${kb} KB 重新分段`);
            }
        }, 400);
    }
    
    function renderChunkList() {
        const list = q('#ni-chunk-list');
        if (!list) return;
        list.innerHTML = S.chunks.map((c, i) => {
            const charsPerByte = S._charsPerByte || 0.5;
            const kb = Math.round(c.length / (charsPerByte * 1024));
            const st = S.chunkStatus[i] || 'pending';
            const { cls, txt } = chunkStatStyle(st);
            return `<div class="ni-chunk-row">
              <span class="ni-chunk-idx">${i + 1}</span>
              <span class="ni-chunk-info">第 ${i + 1} 段 · ${kb} KB</span>
              <span class="ni-chunk-stat ${cls}" id="ni-cs-${i}">${txt}</span>
              <button class="ni-chunk-run-btn" data-chunk-idx="${i}" title="单独清洗此段">生成此段</button>
            </div>`;
        }).join('');
    }
    
    function chunkStatStyle(st) {
        return {
            pending: { cls: 'ni-cs-w', txt: '待处理' },
            running: { cls: 'ni-cs-r', txt: '处理中…' },
            done:    { cls: 'ni-cs-d', txt: '已完成' },
            error:   { cls: 'ni-cs-e', txt: '失败' },
        }[st] || { cls: 'ni-cs-w', txt: '待处理' };
    }
    
    function setChunkStat(i, st) {
        S.chunkStatus[i] = st;
        const el = q(`#ni-cs-${i}`);
        if (!el) return;
        const { cls, txt } = chunkStatStyle(st);
        el.className = `ni-chunk-stat ${cls}`;
        el.textContent = txt;
    }
    
    function niCleanConcurrencyLimit() {
        return concurrencyLimit(getSettings()?.apiConcurrency, defaultSettings.apiConcurrency);
    }
    
    function niBuildCleanMessages(i) {
        let previousContext = '';
        let previousLabel = '';
        if (i > 0) {
            if (S.chunkStatus[i - 1] === 'done' && S.chunkResults[i - 1]) {
                previousContext = S.chunkResults[i - 1].slice(-800);
                previousLabel = '前段概括';
            } else if (S.chunks[i - 1]) {
                previousContext = S.chunks[i - 1].slice(-800);
                previousLabel = '前段原文末尾';
            }
        }
        return [
            { role: 'system', content: getSettings()?.customPrompt || cleanPrompt },
            {
                role: 'user',
                content: previousContext
                    ? `【${previousLabel}（仅供衔接参考，不要重复压缩）】\n${previousContext}\n\n【本段原文（请压缩并输出 ni_meta）】\n${S.chunks[i]}`
                    : `【本段原文（请压缩并输出 ni_meta）】\n${S.chunks[i]}`,
            },
        ];
    }
    
    function niRebuildStructuredDataFromChunks(plotOrderMemory = null, characterMemory = null) {
        S.characters = [];
        S.plots = { main: [], sub: [], pivot: [] };
        for (let i = 0; i < S.chunkStatus.length; i++) {
            const meta = S.chunkStatus[i] === 'done' ? S.chunkMeta[i] : null;
            if (!meta) continue;
            mergeCharacters(S, meta.characters || [], i);
            mergeCharacterAliases(S, meta.character_aliases || meta.aliases || [], i);
            mergePlots(meta.plots || [], i);
        }
        if (plotOrderMemory) restorePlotCheckpointMemory(S, plotOrderMemory);
        if (characterMemory) restoreCharacterMemory(S, characterMemory);
        ['main', 'sub', 'pivot'].forEach(type => niSortPlotsByStoryOrder(S.plots[type]));
        rebuildStageMapFromPlotStageIdx(S);
        niSyncSubPlotStageAssignments();
    }
    
    async function niProcessCleanChunk(i, titleNote) {
        if (S.stopClean || S.chunkStatus[i] === 'done') return { paused: S.stopClean };
        setChunkStat(i, 'running');
        const messages = niBuildCleanMessages(i);
        const maxRetry = 3;
    
        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            if (S.stopClean) {
                setChunkStat(i, 'pending');
                return { paused: true };
            }
            if (attempt > 1) {
                if (titleNote) titleNote.textContent = `第 ${i + 1} 段重试 ${attempt - 1}…`;
                await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
            }
    
            const controller = new AbortControllerClass();
            S._cleanAbortControllers.set(i, controller);
            try {
                const raw = await callCleanApi(messages, { signal: controller.signal });
                const { compressed, meta } = parseCleanResponse(raw, i);
                if (!meta) throw new Error('响应缺少 ni_meta 块（已重试）');
                S.chunkResults[i] = compressed;
                S.chunkMeta[i] = meta;
                setChunkStat(i, 'done');
                return { done: true };
            } catch (err) {
                if (S.stopClean) {
                    setChunkStat(i, 'pending');
                    return { paused: true };
                }
                if (S._cleanSkippedChunks.has(i)) {
                    S._cleanSkippedChunks.delete(i);
                    setChunkStat(i, 'error');
                    return { skipped: true, error: true };
                }
                console.warn(`[NI] 第 ${i + 1} 段第 ${attempt} 次失败:`, err);
                if (attempt === maxRetry) {
                    console.error(`[NI] 第 ${i + 1} 段已重试 ${maxRetry} 次，标记失败`);
                    setChunkStat(i, 'error');
                    return { error: true };
                }
            } finally {
                if (S._cleanAbortControllers.get(i) === controller) S._cleanAbortControllers.delete(i);
            }
        }
        return { error: true };
    }
    
    async function niStartClean(options = {}) {
        if (!S.fileLoaded || S.cleanRunning) return;
        const restart = options.restart === true;
    
        if (restart) {
            await niResetCleanRuntimeForRestart();
        } else {
            normalizeCleanArraysToChunks(S);
            const beforeStats = getCleanProgressStats(S);
            if (beforeStats.done > 0 && !niHasLoadedChunks()) {
                const ok = await niEnsureChunksLoaded();
                if (!ok || !niHasLoadedChunks()) {
                    alert('无法加载已完成段的压缩正文。请确认服务端数据文件存在，或左键重新清洗。');
                    niSyncCleanButtonState();
                    return;
                }
                normalizeCleanArraysToChunks(S);
            }
        }
    
        S.cleanRunning = true;
        S.stopClean = false;
        S.skipCurrentChunk = false;
        S._cleanAbortControllers = new Map();
        S._cleanSkippedChunks = new Set();
    
        const btn = q('#ni-btn-clean');
        // 清洗中：隐藏主按钮，显示跳过/暂停
        if (btn) btn.style.display = 'none';
        q('#ni-btn-retry').style.display = 'none';
        const skipBtn  = q('#ni-btn-skip');
        const pauseBtn = q('#ni-btn-pause');
        if (skipBtn)  skipBtn.style.display = 'inline-flex';
        if (pauseBtn) { pauseBtn.style.display = 'inline-flex'; pauseBtn.disabled = false; }
    
        // 标题行进度条
        const titleProg = q('#ni-cp-title-prog');
        const titleBar  = q('#ni-cp-title-bar');
        const titleNote = q('#ni-cp-title-note');
        const cpCard    = q('#ni-cp-card');
        if (titleProg) titleProg.style.display = 'flex';
        if (cpCard) cpCard.classList.add('ni-has-prog');
    
        // 并发请求只写各自分段结果，结束后按 chunkIndex 统一重建结构化数据。
        const isResume = !restart && S.chunkStatus.some(s => s === 'done');
        const plotOrderMemory = isResume ? capturePlotCheckpointMemory(S) : null;
        const characterMemory = isResume ? captureCharacterMemory(S) : null;
        if (!isResume) {
            S.chunkMeta = [];
        }
        const pendingIndices = S.chunks.map((_, i) => i).filter(i => S.chunkStatus[i] !== 'done');
        const workerCount = Math.min(niCleanConcurrencyLimit(), Math.max(1, pendingIndices.length));
        let next = 0;
        let completed = S.chunkStatus.filter(status => status === 'done').length;
        if (titleNote) titleNote.textContent = `并发 ${workerCount} · 已完成 ${completed}/${S.chunks.length} 段`;
    
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (!S.stopClean) {
                const queueIndex = next++;
                if (queueIndex >= pendingIndices.length) break;
                const chunkIdx = pendingIndices[queueIndex];
                await niProcessCleanChunk(chunkIdx, titleNote);
                completed++;
                if (titleNote && !S.stopClean) titleNote.textContent = `并发 ${workerCount} · 已处理 ${completed}/${S.chunks.length} 段`;
                if (titleBar) titleBar.style.width = `${Math.round((completed / S.chunks.length) * 92)}%`;
            }
        }));
    
        niRebuildStructuredDataFromChunks(plotOrderMemory, characterMemory);
        const hasError = S.chunkStatus.some(status => status === 'error');
    
        // 清洗结束：恢复主按钮，隐藏跳过/暂停
        if (btn) btn.style.display = '';
        if (skipBtn)  skipBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'none';
    
        const doneCount = S.chunkStatus.filter(s => s === 'done').length;
        const errCount  = S.chunkStatus.filter(s => s === 'error').length;
        if (S.stopClean) {
            if (titleBar) titleBar.classList.remove('g');
            if (titleNote) {
                titleNote.textContent = `已暂停 · ${doneCount}/${S.chunks.length} 段完成`;
                titleNote.classList.remove('g');
            }
        } else {
            if (titleBar) { titleBar.style.width = '100%'; titleBar.classList.add('g'); }
        }
        if (titleNote && !S.stopClean) {
            titleNote.textContent = hasError
                ? `${doneCount} 段完成，${errCount} 段失败`
                : `全部 ${S.chunks.length} 段完成`;
            titleNote.classList.toggle('g', !hasError);
        }
    
        S.cleanDone = S.chunkStatus.length > 0 && doneCount === S.chunkStatus.length;
        S.cleanRunning = false;
        S._cleanAbortControllers?.clear();
        S._cleanSkippedChunks?.clear();
        niSyncCleanButtonState();
    
        // 每轮清洗停止后都形成可用检查点；旧节点/阶段保持，新完成分段追加到时间线。
        ['main', 'sub', 'pivot'].forEach(type => niSortPlotsByStoryOrder(S.plots[type]));
        renderPlots();
        renderCharacters();
        buildStages();
        setBtn('#ni-btn-vec', false);
        // 不再自动调用 AI 生成概括，用户可在角色/阶段页手动点击"AI 生成概括"
    
        niSaveSettings();
    }
    
    // 续跑未完成分段
    async function niRetryFailed() {
        await niHandleCleanButtonClick(false);
    }
    
    // ============================================================
    // 时间解析：将 time 字段转为可排序的数值
    // 支持格式："乾元十三年五月中旬" / "2012年3月" / "次日" / "某夜" 等
    // 无法解析的返回 null
    // ============================================================
    
    // 跳过当前正在处理的段
    function niSkipChunk() {
        if (!S.cleanRunning) return;
        const active = [...(S._cleanAbortControllers?.keys?.() || [])].sort((a, b) => a - b);
        const chunkIdx = active[0];
        if (chunkIdx != null) {
            S._cleanSkippedChunks?.add(chunkIdx);
            S._cleanAbortControllers.get(chunkIdx)?.abort();
        } else {
            S.skipCurrentChunk = true;
            S._currentAbortController?.abort();
        }
        const titleNote = q('#ni-cp-title-note');
        if (titleNote) titleNote.textContent = chunkIdx != null ? `正在跳过第 ${chunkIdx + 1} 段…` : '正在跳过当前段…';
    }
    
    // 单独清洗指定段
    async function niRunSingleChunk(i) {
        if (S.cleanRunning) { alert('清洗正在进行中，请等待完成或暂停后再试'); return; }
        if (!S.fileLoaded || !S.chunks[i]) return;
    
        S.cleanRunning = true;
        setChunkStat(i, 'running');
    
        // 取上一段的压缩结果作为上下文
        let prevSummary = '';
        for (let k = i - 1; k >= 0; k--) {
            if (S.chunkStatus[k] === 'done' && S.chunkResults[k]) {
                prevSummary = S.chunkResults[k].slice(0, 800);
                break;
            }
        }
    
        const messages = [
            { role: 'system', content: getSettings()?.customPrompt || cleanPrompt },
            {
                role: 'user',
                content: prevSummary
                    ? `【前段概括（仅供上下文参考，不要重复压缩）】\n${prevSummary}\n\n【本段原文（请压缩并输出 ni_meta）】\n${S.chunks[i]}`
                    : `【本段原文（请压缩并输出 ni_meta）】\n${S.chunks[i]}`,
            },
        ];
    
        try {
            const raw = await callCleanApi(messages);
            const { compressed, meta } = parseCleanResponse(raw, i);
            if (!meta) {
                // ni_meta 缺失且抢救失败，单独清洗视为失败，提示用户重试
                throw new Error('响应缺少 ni_meta 块，请再次点击"生成此段"重试');
            }
            const plotOrderMemory = capturePlotCheckpointMemory(S);
            const characterMemory = captureCharacterMemory(S);
            S.chunkResults[i] = compressed;
            S.chunkMeta[i] = meta;  // 同步更新 chunkMeta
    
            // 从 plots/characters 中移除该段旧数据，再 merge 新数据
            ['main', 'sub', 'pivot'].forEach(type => {
                S.plots[type] = (S.plots[type] || []).filter(p => p._chunkIdx !== i);
            });
            S.characters = S.characters.filter(c => c._firstChunkIdx !== i);
            S.characters.forEach(c => {
                if (Array.isArray(c.aliases)) c.aliases = c.aliases.filter(a => a._chunkIdx !== i);
            });
    
            mergeCharacters(S, meta.characters || [], i);
            mergeCharacterAliases(S, meta.character_aliases || meta.aliases || [], i);
            mergePlots(meta.plots || [], i);
            restorePlotCheckpointMemory(S, plotOrderMemory);
            restoreCharacterMemory(S, characterMemory);
    
            // merge 后按 _chunkIdx 重新排序，确保节点插入正确位置
            ['main', 'sub', 'pivot'].forEach(type => {
                niSortPlotsByStoryOrder(S.plots[type]);
            });
    
            setChunkStat(i, 'done');
            S.cleanDone = S.chunkStatus.length > 0 && S.chunkStatus.every(status => status === 'done');
            renderPlots();
            renderCharacters();
            buildStages();
            niSaveSettings();
        } catch(err) {
            console.error(`[NI] 第 ${i + 1} 段单独清洗失败:`, err);
            setChunkStat(i, 'error');
        }
        S.cleanRunning = false;
        niSyncCleanButtonState();
    }
    
    // 暂停清洗
    function niPauseClean() {
        if (!S.cleanRunning) return;
        S.stopClean = true;
        S._cleanAbortControllers?.forEach(controller => controller.abort());
        S._currentAbortController?.abort();
        const btn = q('#ni-btn-pause');
        if (btn) btn.disabled = true;
        const titleNote = q('#ni-cp-title-note');
        if (titleNote) titleNote.textContent = '正在中止当前段，即将暂停…';
    }
    
    function setBtn(sel, disabled, html) {
        const el = q(sel);
        if (!el) return;
        el.disabled = disabled;
        if (html !== undefined) el.innerHTML = html;
    }
    
    function niSyncCleanProgressHint(stats = getCleanProgressStats(S)) {
        if (S.cleanRunning) return;
        const titleProg = q('#ni-cp-title-prog');
        const titleBar  = q('#ni-cp-title-bar');
        const titleNote = q('#ni-cp-title-note');
        const cpCard    = q('#ni-cp-card');
        if (!titleProg || !titleBar || !titleNote) return;
    
        titleNote.classList.remove('g');
        titleBar.classList.remove('g');
        if (stats.isPartial) {
            const failedText = stats.error ? `，${stats.error} 段失败` : '';
            titleProg.style.display = 'flex';
            cpCard?.classList.add('ni-has-prog');
            titleNote.textContent = `已完成 ${stats.done}/${stats.total} 段${failedText}，左边重新，右边续跑`;
            titleBar.style.width = `${Math.round((stats.done / stats.total) * 100)}%`;
        } else if (stats.isComplete) {
            titleProg.style.display = 'flex';
            cpCard?.classList.add('ni-has-prog');
            titleNote.textContent = `已完成 ${stats.total}/${stats.total} 段`;
            titleNote.classList.add('g');
            titleBar.style.width = '100%';
            titleBar.classList.add('g');
        } else {
            titleProg.style.display = 'none';
            cpCard?.classList.remove('ni-has-prog');
            titleNote.textContent = '';
            titleBar.style.width = '0%';
        }
    }
    
    function niSyncCleanButtonState() {
        const btn = q('#ni-btn-clean');
        const resumeBtn = q('#ni-btn-retry');
        if (!btn) return;
        const stats = getCleanProgressStats(S);
        const disabled = !S.fileLoaded || S.cleanRunning || stats.total === 0;
    
        if (stats.isPartial) {
            setBtn('#ni-btn-clean', disabled, '<i class="ti ti-refresh"></i>重新清洗');
            btn.title = `已完成 ${stats.done}/${stats.total} 段。左侧按钮重新清洗；右侧按钮续跑清洗。`;
            btn.dataset.niPartialClean = '1';
            if (resumeBtn) {
                resumeBtn.style.display = S.cleanRunning ? 'none' : 'inline-flex';
                resumeBtn.title = `从当前进度继续清洗，已完成段会自动跳过。`;
                setBtn('#ni-btn-retry', disabled, '<i class="ti ti-player-play"></i>续跑清洗');
            }
        } else if (stats.isComplete) {
            setBtn('#ni-btn-clean', disabled, '<i class="ti ti-check"></i>清洗完成');
            btn.title = `已完成 ${stats.total}/${stats.total} 段。`;
            btn.dataset.niPartialClean = '0';
            if (resumeBtn) resumeBtn.style.display = 'none';
        } else {
            setBtn('#ni-btn-clean', disabled, '<i class="ti ti-player-play"></i>开始全自动清洗');
            btn.title = '开始清洗当前小说';
            btn.dataset.niPartialClean = '0';
            if (resumeBtn) resumeBtn.style.display = 'none';
        }
        niSyncCleanProgressHint(stats);
    }
    
    async function niResetCleanRuntimeForRestart() {
        normalizeCleanArraysToChunks(S);
        niResetChunkDerivedState();
        if (S.novelKey) {
            try { await dbClearNovel(S.novelKey); }
            catch (e) { console.warn('[NI] 重新清洗前清理旧向量失败:', e); }
        }
        renderChunkList();
        renderPlots();
        renderCharacters();
        buildStages();
        setBtn('#ni-btn-vec', true, '<i class="ti ti-database"></i>开始向量化');
    }
    
    async function niHandleCleanButtonClick(restartOnPartial = true) {
        if (hasPartialCleanProgress(S) && restartOnPartial) {
            await niStartClean({ restart: true });
            return;
        }
        await niStartClean({ restart: false });
    }
    
    // ============================================================
    // 初始化入口
    // ============================================================
    
    // ============================================================
    // 拉取模型列表

    return {
        niOnDrop, niOnFile, niApplyFile, getCfgKb, niOnKbChange,
        renderChunkList, chunkStatStyle, setChunkStat,
        niCleanConcurrencyLimit, niBuildCleanMessages, niRebuildStructuredDataFromChunks,
        niProcessCleanChunk, niStartClean, niRetryFailed, niSkipChunk, niRunSingleChunk, niPauseClean,
        setBtn, niSyncCleanProgressHint, niSyncCleanButtonState,
        niResetCleanRuntimeForRestart, niHandleCleanButtonClick,
    };
}
