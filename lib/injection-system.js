export const NI_RAW_INJECTION_MAX_TOKENS_DEFAULT = 32000;
export const NI_RAW_INJECTION_CHARS_PER_TOKEN = 1.5;

export function niNormalizeRawInjectionMaxTokens(value, fallback = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT) {
    const fallbackValue = Math.max(256, Math.min(200000, parseInt(fallback, 10) || NI_RAW_INJECTION_MAX_TOKENS_DEFAULT));
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(256, Math.min(200000, parsed));
}

export function niPrioritizeStageIndices(stageIndices = [], currentStageIdx = null) {
    const stages = [...new Set((Array.isArray(stageIndices) ? stageIndices : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    if (!stages.length) return [];
    const explicitCurrent = Number(currentStageIdx);
    const anchor = Number.isFinite(explicitCurrent) && explicitCurrent > 0
        ? explicitCurrent
        : Math.max(...stages);
    return stages.sort((a, b) => {
        const distanceDiff = Math.abs(anchor - a) - Math.abs(anchor - b);
        return distanceDiff || b - a;
    });
}

export function niBuildBoundedStageInjection({
    stageIndices = [],
    currentStageIdx = null,
    maxTokens = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    charsPerToken = NI_RAW_INJECTION_CHARS_PER_TOKEN,
    getDetailText = () => '',
    getSummaryText = () => '',
} = {}) {
    const normalizedCharsPerToken = Number(charsPerToken) > 0 ? Number(charsPerToken) : NI_RAW_INJECTION_CHARS_PER_TOKEN;
    const tokenBudget = niNormalizeRawInjectionMaxTokens(maxTokens);
    const charBudget = Math.max(1, Math.floor(tokenBudget * normalizedCharsPerToken));
    const priorityStages = niPrioritizeStageIndices(stageIndices, currentStageIdx);
    const anchor = Number.isFinite(Number(currentStageIdx)) && Number(currentStageIdx) > 0
        ? Number(currentStageIdx)
        : (priorityStages[0] ?? null);
    const selected = [];
    const omittedStages = [];
    const emptyStages = [];
    let usedChars = 0;
    let truncated = false;

    const append = (stageIdx, kind, rawText, allowTruncate = false) => {
        const text = String(rawText || '').trim();
        if (!text) return false;
        const separatorChars = selected.length ? 2 : 0;
        const available = charBudget - usedChars - separatorChars;
        if (available <= 0) return false;
        if (text.length <= available) {
            selected.push({ stageIdx, kind, text });
            usedChars += separatorChars + text.length;
            return true;
        }
        if (!allowTruncate) return false;
        const marker = '\n……（已达到未向量阶段单轮注入上限）';
        if (available <= marker.length + 20) return false;
        selected.push({
            stageIdx,
            kind: `${kind}-truncated`,
            text: `${text.slice(0, available - marker.length)}${marker}`,
        });
        usedChars += separatorChars + available;
        truncated = true;
        return true;
    };

    priorityStages.forEach(stageIdx => {
        if (usedChars >= charBudget) {
            omittedStages.push(stageIdx);
            return;
        }
        const detailText = String(getDetailText(stageIdx) || '').trim();
        const isPrimary = stageIdx === anchor || selected.length === 0;
        if (detailText && append(stageIdx, 'detail', detailText, isPrimary)) return;
        const summaryText = String(getSummaryText(stageIdx) || '').trim();
        if (summaryText && append(stageIdx, 'summary', summaryText, false)) return;
        if (!detailText && !summaryText) emptyStages.push(stageIdx);
        else omittedStages.push(stageIdx);
    });

    const chronological = selected.slice().sort((a, b) => a.stageIdx - b.stageIdx);
    const text = chronological.map(item => item.text).join('\n\n');
    return {
        text,
        selected: chronological,
        detailStages: chronological.filter(item => item.kind.startsWith('detail')).map(item => item.stageIdx),
        summaryStages: chronological.filter(item => item.kind === 'summary').map(item => item.stageIdx),
        omittedStages,
        emptyStages,
        truncated,
        maxTokens: tokenBudget,
        estimatedTokens: text ? Math.ceil(text.length / normalizedCharsPerToken) : 0,
        usedChars: text.length,
        charBudget,
    };
}

export function niBuildStageInjectionPayload({
    stageIndices = [],
    currentStageIdx = null,
    maxTokens = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    charsPerToken = NI_RAW_INJECTION_CHARS_PER_TOKEN,
    rawMode = 'nodes',
    contentTokenReserve = 32,
    getDetailText = () => '',
    getSummaryText = () => '',
} = {}) {
    const mode = rawMode === 'compressed' ? 'compressed' : 'nodes';
    const normalizedMaxTokens = niNormalizeRawInjectionMaxTokens(maxTokens);
    const reserve = Math.max(0, parseInt(contentTokenReserve, 10) || 0);
    const normalizedCharsPerToken = Number(charsPerToken) > 0
        ? Number(charsPerToken)
        : NI_RAW_INJECTION_CHARS_PER_TOKEN;
    const result = niBuildBoundedStageInjection({
        stageIndices,
        currentStageIdx,
        maxTokens: Math.max(256, normalizedMaxTokens - reserve),
        charsPerToken: normalizedCharsPerToken,
        getDetailText,
        getSummaryText,
    });
    const tag = mode === 'compressed' ? '小说压缩原文' : '小说剧情节点';
    const content = result.text ? `[${tag}]\n${result.text}\n[/${tag}]` : '';

    return {
        ...result,
        rawMode: mode,
        tag,
        content,
        configuredMaxTokens: normalizedMaxTokens,
        estimatedTokens: content ? Math.ceil(content.length / normalizedCharsPerToken) : 0,
    };
}

export function niIsVectorInjectionDisabledByUser(settings = {}) {
    return settings?.vecInjDisabled === true && settings?.vecInjDisabledByUser === true;
}

export function niNormalizeVectorInjectionPreference(settings = {}) {
    const disabled = niIsVectorInjectionDisabledByUser(settings);
    const changed = settings.vecInjDisabled !== disabled
        || settings.vecInjDisabledByUser !== disabled;
    settings.vecInjDisabled = disabled;
    settings.vecInjDisabledByUser = disabled;
    return changed;
}

export function niSetVectorInjectionDisabledByUser(settings = {}, disabled = false) {
    const value = disabled === true;
    settings.vecInjDisabled = value;
    settings.vecInjDisabledByUser = value;
    return value;
}

export function niResolveStageInjectionPlan({
    enabledStages = [],
    stageVecDone = {},
    settings = {},
} = {}) {
    const stages = [...new Set((Array.isArray(enabledStages) ? enabledStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    const vectorInjectionDisabled = niIsVectorInjectionDisabledByUser(settings);
    const stageHasVector = stageIdx => !!stageVecDone?.[stageIdx];
    const vectorStages = vectorInjectionDisabled
        ? []
        : stages.filter(stageHasVector);
    const rawStages = vectorInjectionDisabled
        ? stages.slice()
        : stages.filter(stageIdx => !stageHasVector(stageIdx));

    return {
        vectorInjectionDisabled,
        vectorStages,
        rawStages,
    };
}

export function niResolveDirectStageInjectionStages({
    rawStages = [],
    transBookMode = false,
    currentStageIdx = null,
    paused = false,
} = {}) {
    const stages = [...new Set((Array.isArray(rawStages) ? rawStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    if (!transBookMode) return stages;
    if (paused) return [];

    const current = Number(currentStageIdx);
    if (!Number.isFinite(current) || current <= 0) return [];
    return stages.includes(current) ? [current] : [];
}

/**
 * 穿书模式下阶段直注的取文范围：只发「当前正在进行的节点」，而不是整个当前阶段。
 * 阶段里排在当前节点之后的节点还没演到，整阶段发出去等于提前向模型剧透。
 *
 * nodes 模式取该节点本身；compressed 模式取它所在的那一段清洗原文
 * （节点的 _chunkIdx 指向原始分段的全局索引，由 niNormalizeTransbookNode 写入）。
 * 返回 null 表示无法收紧，由调用方退回整阶段逻辑——不能让注入直接变空。
 */
export function niBuildTransbookStageDetailText(stageIdx, curTbNode, {
    rawMode = 'nodes',
    getCompressedChunkText = () => '',
} = {}) {
    if (!curTbNode) return null;
    const nodeStageIdx = Number(curTbNode.stageIdx);
    // 锚点节点不属于本阶段时不替换取文，否则会把别的阶段内容挂到这个阶段名下。
    if (Number.isFinite(nodeStageIdx) && nodeStageIdx > 0 && nodeStageIdx !== Number(stageIdx)) return null;

    if (rawMode === 'compressed') {
        const chunkIdx = Number(curTbNode._chunkIdx);
        if (!Number.isFinite(chunkIdx) || chunkIdx < 0) return null;
        const text = String(getCompressedChunkText(chunkIdx) || '').trim();
        return text ? `【第 ${stageIdx} 阶段当前节点原文】\n${text}` : null;
    }

    const title = String(curTbNode.title || '').trim() || '未命名节点';
    const body = String(curTbNode.body || curTbNode.content || '').trim();
    return `【第 ${stageIdx} 阶段当前节点】\n· ${title}：${body}`;
}

export function niResolvePausedTransbookPromptSlots({
    paused = false,
    immersionContent = '',
} = {}) {
    if (!paused) return null;
    return {
        advanceContent: '',
        ongoingContent: String(immersionContent ?? '').trim(),
    };
}

/**
 * 演绎提示词借用酒馆角色卡的「角色备注」（#depth_prompt_prompt）送入上下文。
 * 这个文本框属于酒馆的角色编辑表单：写入并派发 input 后，酒馆会把整张表单保存成角色卡
 * （saveCharacterDebounced → createOrEditCharacter → POST /api/characters/edit）。
 *
 * 表单只在选中角色时才重新填充。删除角色、进入群聊、回到欢迎页之后，表单里留着上一个
 * 角色的旧数据；切换角色的加载间隙里，选中的角色已经换了，表单却还没跟上。这些时候触发
 * 保存，写回去的是表单里那张旧卡——角色刚被删除的话，就等于把它连同默认头像重新创建出来。
 *
 * 所以只有表单确实绑定着当前选中的角色、且内容真的有变化时才写入。
 * formAvatar 是表单里的 avatar_url，即这次保存会写入的角色卡文件名；
 * 取不到这个字段（null）时无从比对，只按其余条件判断，不因此停用整个功能。
 */
export function niShouldSyncRoleplayDepth({
    characterId = null,
    characters = [],
    formAction = '',
    formAvatar = null,
    currentText = '',
    nextText = '',
} = {}) {
    // 没有选中角色：欢迎页、群聊，或角色刚被删除。
    if (characterId === null || characterId === undefined || characterId === '') return false;
    const avatar = characters?.[characterId]?.avatar;
    if (typeof avatar !== 'string' || !avatar) return false;
    // 「新建角色」表单是尚未落盘的草稿，不是当前角色的卡。
    if (formAction === 'createcharacter') return false;
    // 表单还绑着别的角色（或从未绑定过）。
    if (formAvatar !== null && formAvatar !== undefined && String(formAvatar) !== avatar) return false;

    // 换行风格与首尾空白不影响注入结果；内容没变就不必重写文本框、多保存一次角色卡。
    const normalize = text => String(text ?? '').replace(/\r\n?/g, '\n').trim();
    return normalize(currentText) !== normalize(nextText);
}
