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
