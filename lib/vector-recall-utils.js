import { NI_PLOT_CHUNK_ORDER_STEP, niFiniteNumber } from './plot-order-utils.js';

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
