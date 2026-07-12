// 穿书模式状态、节点边界与阶段锁定。

export const NI_TRANSBOOK_TYPE_LABELS = Object.freeze({
    main: '主线',
    sub: '支线',
    pivot: '关键转折',
});

export function niNormalizeTransbookFrontierStage(value) {
    return Math.max(1, parseInt(value, 10) || 1);
}

export function niAdvanceTransbookFrontier(frontierStageIdx, stageIdx) {
    const current = niNormalizeTransbookFrontierStage(frontierStageIdx);
    const next = parseInt(stageIdx, 10);
    if (!Number.isFinite(next) || next <= 0) return current;
    return Math.max(current, next);
}

export function niNormalizeTransbookSavedState(saved) {
    return {
        nodeDone: saved?.nodeDone ? { ...saved.nodeDone } : {},
        curIdx: saved?.curIdx ?? 0,
        curNodeId: saved?.curNodeId || '',
        frontierStageIdx: niNormalizeTransbookFrontierStage(saved?.frontierStageIdx),
        paused: !!saved?.paused,
    };
}

export function niNormalizeTransbookNode(plot, nodeDone = {}, {
    typeLabels = NI_TRANSBOOK_TYPE_LABELS,
    resolveNodeId = (_plot, type, sourceIndex) => `${type}_${sourceIndex}`,
} = {}) {
    const type = plot?._type || plot?.type || 'main';
    const sourceIndex = plot?._sourceIdx ?? plot?._originalIdx ?? 0;
    const legacyId = `${type}_${sourceIndex}`;
    const id = resolveNodeId(plot?._plotRef || plot, type, plot?._sourceIdx ?? 0);
    const done = nodeDone?.[id] !== undefined ? !!nodeDone[id] : !!nodeDone?.[legacyId];
    return {
        id,
        legacyId,
        type,
        typeLabel: typeLabels[type] || type,
        title: plot?.title || '（未命名）',
        body: plot?.body || '',
        time: plot?.time || '',
        location: plot?.location || '',
        sub_notes: plot?.sub_notes || [],
        branch_links: plot?.branch_links || [],
        stageIdx: plot?.stageIdx ?? 0,
        done,
        locked: false,
        _origIdx: sourceIndex,
        _chunkIdx: plot?._chunkIdx ?? 0,
        _chunkOrder: plot?._chunkOrder ?? 0,
        _manualOrder: plot?._manualOrder,
    };
}

export function niGetTransbookStageCompletion(nodes) {
    const stageHasUndone = {};
    for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!node?.done) stageHasUndone[node?.stageIdx] = true;
    }
    return stageHasUndone;
}

export function niIsTransbookStageLocked(stageIdx, stageHasUndone, frontierStageIdx) {
    if (!Number.isFinite(Number(stageIdx))) return false;
    const frontier = niNormalizeTransbookFrontierStage(frontierStageIdx);
    if (stageIdx <= frontier) return false;
    for (let index = frontier; index < stageIdx; index++) {
        if (stageHasUndone?.[index]) return true;
    }
    return false;
}

export function niApplyTransbookStageLocks(nodes, frontierStageIdx) {
    const list = (Array.isArray(nodes) ? nodes : []).map(node => ({ ...node, locked: false }));
    const stageHasUndone = niGetTransbookStageCompletion(list);
    for (const node of list) {
        node.locked = niIsTransbookStageLocked(node.stageIdx, stageHasUndone, frontierStageIdx);
    }
    return list;
}

export function niBuildTransbookNodes(plots, nodeDone = {}, {
    typeLabels = NI_TRANSBOOK_TYPE_LABELS,
    resolveNodeId,
    comparePlotOrder = () => 0,
    frontierStageIdx = 1,
} = {}) {
    const nodes = (Array.isArray(plots) ? plots : [])
        .map(plot => niNormalizeTransbookNode(plot, nodeDone, { typeLabels, resolveNodeId }))
        .sort((a, b) => a.stageIdx !== b.stageIdx ? a.stageIdx - b.stageIdx : comparePlotOrder(a, b));
    return niApplyTransbookStageLocks(nodes, frontierStageIdx);
}

export function niBuildTransbookStages(nodes, stageCount, stageStates = {}, stageTitles = {}) {
    const stages = [];
    const count = Math.max(0, parseInt(stageCount, 10) || 0);
    for (let stageIdx = 1; stageIdx <= count; stageIdx++) {
        if (stageStates?.[stageIdx] === false) continue;
        stages.push({
            stageIdx,
            title: stageTitles?.[stageIdx] || `第 ${stageIdx} 阶段`,
            nodes: (Array.isArray(nodes) ? nodes : []).filter(node => node.stageIdx === stageIdx),
        });
    }
    return stages;
}

export function niReconcileTransbookCurrentNode(nodes, {
    curIdx = 0,
    curNodeId = '',
    frontierStageIdx = 1,
} = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) {
        return { curIdx: 0, curNodeId: '', frontierStageIdx: niNormalizeTransbookFrontierStage(frontierStageIdx) };
    }

    let index = -1;
    if (curNodeId) {
        index = list.findIndex(node => node.id === curNodeId || node.legacyId === curNodeId);
    }
    if (index < 0 && Number.isFinite(Number(curIdx))) {
        index = Math.max(0, Math.min(list.length - 1, Number(curIdx)));
    }
    const nextIndex = index >= 0 ? index : 0;
    return {
        curIdx: nextIndex,
        curNodeId: list[nextIndex]?.id || '',
        frontierStageIdx: niAdvanceTransbookFrontier(frontierStageIdx, list[nextIndex]?.stageIdx),
    };
}

export function niSetTransbookCurrentIndex(nodes, index, frontierStageIdx = 1) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) {
        return { curIdx: 0, curNodeId: '', frontierStageIdx: niNormalizeTransbookFrontierStage(frontierStageIdx) };
    }
    const nextIndex = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    return {
        curIdx: nextIndex,
        curNodeId: list[nextIndex]?.id || '',
        frontierStageIdx: niAdvanceTransbookFrontier(frontierStageIdx, list[nextIndex]?.stageIdx),
    };
}

export function niGetTransbookStageView(nodes, currentIndex) {
    const list = Array.isArray(nodes) ? nodes : [];
    const currentNode = list[currentIndex] || list[0];
    if (!currentNode) return { nodes: [], curIdx: 0, stageIdx: null };
    const stageNodes = list
        .map((node, index) => ({ ...node, _globalIdx: index }))
        .filter(node => node.stageIdx === currentNode.stageIdx);
    const localIndex = Math.max(0, stageNodes.findIndex(node => node.id === currentNode.id));
    return { nodes: stageNodes, curIdx: localIndex, stageIdx: currentNode.stageIdx };
}

export function niGetTransbookProgress(nodes, currentNodeId = '') {
    const list = Array.isArray(nodes) ? nodes : [];
    const activeNode = list.find(node => node.id === currentNodeId || node.legacyId === currentNodeId) || null;
    const doneNodes = list.filter(node => node.done);
    const todoNodes = list.filter(node => !node.done && node.id !== activeNode?.id);
    return {
        total: list.length,
        done: doneNodes.length,
        undone: list.length - doneNodes.length,
        allDone: list.length > 0 && doneNodes.length === list.length,
        activeNode,
        doneNodes,
        todoNodes,
    };
}

export function niFindNextTransbookNode(nodes, currentNode, { sameStage = true } = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    const currentIndex = list.findIndex(node => node.id === currentNode?.id);
    return list.find((node, index) =>
        index > currentIndex &&
        (!sameStage || node.stageIdx === currentNode?.stageIdx) &&
        !node.done
    ) || null;
}

export function niFindFirstActionableTransbookNode(nodes) {
    return (Array.isArray(nodes) ? nodes : []).find(node => !node.done && !node.locked) || null;
}

export function createTransbookController(deps = {}) {
    const S = deps.state || {};
    const DEFAULT_SETTINGS = deps.defaultSettings || {};
    const extension_settings = deps.extensionSettings || {};
    const EXT_NAME = deps.extensionName || '';
    const document = deps.document || globalThis.document;
    const window = deps.globalWindow || globalThis.window || {};
    const console = deps.logger || globalThis.console || { log() {}, warn() {}, error() {} };
    const $ = deps.dollar ?? globalThis.$;
    const getContext = deps.getContext || (() => null);
    const getAllPlotsInStoryOrder = deps.getAllPlotsInStoryOrder || (() => []);
    const niEnsurePlotNodeId = deps.ensurePlotNodeId || ((_plot, type, sourceIdx) => String(type) + '_' + sourceIdx);
    const niComparePlotOrder = deps.comparePlotOrder || (() => 0);
    const saveSettingsDebounced = deps.saveSettingsDebounced || (() => {});
    const callCleanApi = deps.callCleanApi;
    const niApplyStatusbarTheme = deps.applyStatusbarTheme || (() => {});
    const niApplyUserSubstitution = deps.applyUserSubstitution || (value => String(value ?? ''));
    const niGetUserSubConfig = deps.getUserSubConfig || (() => ({}));
    const niIsUserSubReplaceSelectedChar = deps.isUserSubReplaceSelectedChar || (() => false);
    const niIsUserSubSelectedChar = deps.isUserSubSelectedChar || (() => false);
    const niIsUserSubPlayMode = deps.isUserSubPlayMode || (() => false);
    const niGetCharAiShowEnabled = deps.getCharAiShowEnabled || (() => false);
    const niGetCharAiProfile = deps.getCharAiProfile || (() => null);
    const niTogglePanel = deps.togglePanel || (() => {});
    const niPopSetVisible = deps.popSetVisible;
    const niPopSyncVisibility = deps.popSyncVisibility;
    const niSetTransBookMode = deps.setTransBookMode || (() => {});
    const niSyncTransBookToggleUI = deps.syncTransBookToggleUI || (() => {});
    const setTimeout = deps.setTimeout || globalThis.setTimeout;
    const requestAnimationFrame = deps.requestAnimationFrame || globalThis.requestAnimationFrame || (callback => callback());
    const Event = deps.Event || globalThis.Event;
    const TB_DEFAULT_ADVANCE_PROMPT = deps.defaultAdvancePrompt || '';
    const TB_DEFAULT_INFER_PROMPT = deps.defaultInferPrompt || '';
    const TB_DEFAULT_OPENING_PROMPT = deps.defaultOpeningPrompt || '';
    const TB_DEFAULT_ONGOING_PROMPT = deps.defaultOngoingPrompt || '';
    const TB_DEFAULT_IMMERSION_PROMPT = deps.defaultImmersionPrompt || '';
    const TB_LEGACY_ADVANCE_PROMPT = deps.legacyAdvancePrompt || '';
    const TB_LEGACY_OPENING_PROMPT = deps.legacyOpeningPrompt || '';
    const TB_LEGACY_ONGOING_PROMPT = deps.legacyOngoingPrompt || '';

    S.tbNodeDone   = {};   // {[nodeId]: boolean}  — 节点完成状态（从 chat[0] 读写）
    S.tbPaused     = false; // 暂停推进（保存到当前聊天首条消息 ni_tb.paused）
    S.tbCurIdx     = 0;    // 当前轮播中心节点下标（在 niGetTbNodes() 返回数组中的下标）
    S.tbCurNodeId  = '';   // 当前节点稳定 id，避免刷新后因列表重排导致索引漂移
    S.tbFrontierStageIdx = 1; // 用户已经手动推进到的最远阶段，用于跳过旧阶段剩余节点的锁定
    S.tbInferring  = false; // 推演中
    S.tbSectionOpen = { done: false, active: true, todo: false };
    
    function niTbSyncPauseUI() {
        const paused = !!S.tbPaused;
    
        const barBtn  = document.getElementById('ni-tb-btn-pause');
        const barIcon = document.getElementById('ni-tb-pause-icon');
        const barText = document.getElementById('ni-tb-pause-text');
        barBtn?.classList.toggle('paused', paused);
        if (barIcon) barIcon.className = paused ? 'ti ti-player-play' : 'ti ti-player-pause';
        if (barText) barText.textContent = paused ? '继续' : '暂停';
    
        const popBtn = document.getElementById('ni-pop-btn-pause');
        const popTxt = document.getElementById('ni-pop-pause-txt');
        popBtn?.classList.toggle('paused', paused);
        if (popTxt) popTxt.textContent = paused ? '恢复' : '暂停';
    }
    window.niTbSyncPauseUI = niTbSyncPauseUI;
    
    function niTbSetPaused(paused) {
        S.tbPaused = !!paused;
        niTbSyncPauseUI();
        niTbSaveState().catch(e => console.warn('[NI-TB] 保存暂停状态失败:', e));
    }
    window.niTbSetPaused = niTbSetPaused;
    
    function niTbTogglePaused() {
        niTbSetPaused(!S.tbPaused);
    }
    window.niTbTogglePaused = niTbTogglePaused;
    
    // ── 数据字段追加到 DEFAULT_SETTINGS ─────────────────────────
    
    DEFAULT_SETTINGS.transBookMode    = false;
    DEFAULT_SETTINGS.tbAdvancePrompt  = TB_DEFAULT_ADVANCE_PROMPT;
    DEFAULT_SETTINGS.tbInferPrompt    = TB_DEFAULT_INFER_PROMPT;
    DEFAULT_SETTINGS.tbOpeningPrompt  = TB_DEFAULT_OPENING_PROMPT;
    DEFAULT_SETTINGS.tbOngoingPrompt  = TB_DEFAULT_ONGOING_PROMPT;
    DEFAULT_SETTINGS.tbLightRecallMode = false;
    DEFAULT_SETTINGS.tbImmersionMode  = false;
    DEFAULT_SETTINGS.tbImmersionPrompt = TB_DEFAULT_IMMERSION_PROMPT;
    
    function niUpgradeLegacyTbDefaultPrompts(cfg = extension_settings[EXT_NAME] || {}) {
        if (!cfg || typeof cfg !== 'object') return false;
        let changed = false;
        const norm = value => String(value ?? '').replace(/\r\n/g, '\n');
        const isOlderAdvanceDefault = value => {
            const text = norm(value);
            return text.startsWith('[穿书模式·当前叙事阶段]')
                && text.includes('▌叙事目标（持续追踪）')
                && text.includes('目标：{B_BODY}')
                && text.includes('完成信号：[由用户手动确认，AI不得自行宣布完成]')
                && text.includes('每次回复前，隐式评估：目标达成了吗？还缺什么？')
                && text.includes('不是必须重演的脚本场景')
                && text.trim().endsWith('[/穿书模式·当前叙事阶段]')
                && !text.includes('剧情节点不是任务目标');
        };
        const isOlderOngoingDefault = value => {
            const text = norm(value);
            return text === norm(`[穿书模式·进行中]
    当前阶段「{B_TITLE}」持续中，核心走向：{B_BODY}
    跟随用户行动自然推进，用户无操作时仅推进当下场景，不强行跳转节点。
    阶段完成由用户确认。
    [/穿书模式·进行中]`);
        };
        const upgrade = (key, legacyValue, nextValue) => {
            if (norm(cfg[key]) !== norm(legacyValue)) return;
            cfg[key] = nextValue;
            changed = true;
        };
        upgrade('tbAdvancePrompt', TB_LEGACY_ADVANCE_PROMPT, TB_DEFAULT_ADVANCE_PROMPT);
        upgrade('tbOpeningPrompt', TB_LEGACY_OPENING_PROMPT, TB_DEFAULT_OPENING_PROMPT);
        upgrade('tbOngoingPrompt', TB_LEGACY_ONGOING_PROMPT, TB_DEFAULT_ONGOING_PROMPT);
        if (isOlderAdvanceDefault(cfg.tbAdvancePrompt)) {
            cfg.tbAdvancePrompt = TB_DEFAULT_ADVANCE_PROMPT;
            changed = true;
        }
        if (isOlderAdvanceDefault(cfg.tbOpeningPrompt)) {
            cfg.tbOpeningPrompt = TB_DEFAULT_OPENING_PROMPT;
            changed = true;
        }
        if (isOlderOngoingDefault(cfg.tbOngoingPrompt)) {
            cfg.tbOngoingPrompt = TB_DEFAULT_ONGOING_PROMPT;
            changed = true;
        }
        return changed;
    }
    
    function niTbGetImmersionAppend(cfg) {
        if (!cfg?.tbImmersionMode) return '';
        const prompt = (cfg.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT).trim();
        return prompt ? `\n${prompt}` : '';
    }
    
    function niTbFrontierStage() {
        return niNormalizeTransbookFrontierStage(S.tbFrontierStageIdx);
    }
    
    function niTbAdvanceFrontier(stageIdx) {
        S.tbFrontierStageIdx = niAdvanceTransbookFrontier(S.tbFrontierStageIdx, stageIdx);
        return S.tbFrontierStageIdx;
    }
    
    // ── 数据桥接 ─────────────────────────────────────────────────
    
    /**
     * 返回所有节点，合并 main+sub+pivot，按 stageIdx 升序，同阶段内按故事/人工顺序。
     * 每个节点：{ id, type, typeLabel, title, body, time, location, stageIdx, done, locked }
     */
    function niGetTbNodes() {
        return niBuildTransbookNodes(getAllPlotsInStoryOrder(S), S.tbNodeDone, {
            resolveNodeId: (plot, type, sourceIdx) => niEnsurePlotNodeId(plot, type, sourceIdx),
            comparePlotOrder: niComparePlotOrder,
            frontierStageIdx: niTbFrontierStage(),
        });
    }
    
    /**
     * 返回已启用阶段列表 [{stageIdx, title, nodes[]}]
     */
    function niGetTbStages() {
        return niBuildTransbookStages(niGetTbNodes(), S.stageMapN, S.stageStates, S.stageTitles);
    }
    
    function niTbReconcileCurrentNode(nodes = niGetTbNodes()) {
        const reconciled = niReconcileTransbookCurrentNode(nodes, {
            curIdx: S.tbCurIdx,
            curNodeId: S.tbCurNodeId,
            frontierStageIdx: S.tbFrontierStageIdx,
        });
        S.tbCurIdx = reconciled.curIdx;
        S.tbCurNodeId = reconciled.curNodeId;
        S.tbFrontierStageIdx = reconciled.frontierStageIdx;
    }
    
    function niTbSetCurrentIdx(idx, nodes = niGetTbNodes(), { persist = false } = {}) {
        const next = niSetTransbookCurrentIndex(nodes, idx, S.tbFrontierStageIdx);
        S.tbCurIdx = next.curIdx;
        S.tbCurNodeId = next.curNodeId;
        S.tbFrontierStageIdx = next.frontierStageIdx;
        if (persist) niTbSaveState().catch(e => console.warn('[NI-TB] 保存当前节点失败:', e));
        return S.tbCurIdx;
    }
    window.niTbSetCurrentIdx = niTbSetCurrentIdx;
    
    function niTbStageView(nodes, curIdx) {
        return niGetTransbookStageView(nodes, curIdx);
    }
    window.niTbStageView = niTbStageView;
    
    // ── 持久化 ────────────────────────────────────────────────────
    
    async function niTbSaveState() {
        try {
            const ctx = getContext();
            if (!ctx?.chat?.[0]) return;
            const nodes = niGetTbNodes();
            if (nodes.length) niTbReconcileCurrentNode(nodes);
            ctx.chat[0].ni_tb = ctx.chat[0].ni_tb || {};
            ctx.chat[0].ni_tb.nodeDone = { ...S.tbNodeDone };
            ctx.chat[0].ni_tb.curIdx   = S.tbCurIdx;
            ctx.chat[0].ni_tb.curNodeId = S.tbCurNodeId || nodes[S.tbCurIdx]?.id || '';
            ctx.chat[0].ni_tb.frontierStageIdx = niTbFrontierStage();
            ctx.chat[0].ni_tb.paused   = !!S.tbPaused;
            await ctx.saveChat();
        } catch (e) {
            console.warn('[NI-TB] saveState 失败:', e);
        }
    }
    
    function niTbLoadState() {
        try {
            const ctx = getContext();
            const saved = ctx?.chat?.[0]?.ni_tb;
            S.tbNodeDone = saved?.nodeDone ? { ...saved.nodeDone } : {};
            S.tbCurIdx   = saved?.curIdx   ?? 0;
            S.tbCurNodeId = saved?.curNodeId || '';
            S.tbFrontierStageIdx = Math.max(1, parseInt(saved?.frontierStageIdx, 10) || 1);
            S.tbPaused   = !!saved?.paused;
        } catch (e) {
            S.tbNodeDone = {};
            S.tbCurIdx   = 0;
            S.tbCurNodeId = '';
            S.tbFrontierStageIdx = 1;
            S.tbPaused   = false;
        }
    }
    
    // ── 状态栏 HTML 构建 ──────────────────────────────────────────
    
    function niGetTbStoryBarHtml() {
        const cfg = extension_settings[EXT_NAME] || {};
        const nodes  = niGetTbNodes();
        const stages = niGetTbStages();
        if (!nodes.length) return '';
    
        // 用稳定节点 id 恢复当前节点，再钳制 curIdx
        niTbReconcileCurrentNode(nodes);
        const curNode = nodes[S.tbCurIdx] || nodes[0];
        const curStage = stages.find(s => s.stageIdx === curNode.stageIdx) || stages[0];
        const stageView = niTbStageView(nodes, S.tbCurIdx);
    
        const doneCount = nodes.filter(n => n.done).length;
        const statusLabel = doneCount === nodes.length ? '全部完成' : '进行中';
        const themeFollowClass = cfg.themeStatusbarFollow ? ' ni-tb-theme-follow' : '';
    
        return `<div class="ni-tb-shell${themeFollowClass}" id="ni-storybar">
      <div class="ni-tb-bar" id="ni-tb-bar">
        <div class="ni-tb-pin"></div>
        <div class="ni-tb-status">${statusLabel}</div>
        <div class="ni-tb-curtitle" id="ni-tb-curtitle">${niEsc(curNode.title)}</div>
        <div class="ni-tb-meta" id="ni-tb-meta">节点 ${stageView.curIdx + 1} / ${stageView.nodes.length}</div>
        <i class="ti ti-chevron-down ni-tb-chevron" id="ni-tb-chevron"></i>
      </div>
      <div class="ni-tb-body" id="ni-tb-body-wrap">
        <div class="ni-tb-selrow">
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-stage-btn" title="切换阶段">
            <i class="ti ti-layout-list"></i>
          </div>
          <div class="ni-tb-sel-sep">/</div>
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-node-btn" title="切换节点">
            <i class="ti ti-flag-2"></i>
          </div>
          <div class="ni-tb-sel-spacer"></div>
          <div class="ni-tb-btn-free" id="ni-tb-btn-free">
            <i class="ti ti-chart-line" id="ni-tb-free-icon"></i>
            <span id="ni-tb-free-label">推演</span>
          </div>
          <div class="ni-tb-btn-pause${S.tbPaused ? ' paused' : ''}" id="ni-tb-btn-pause">
            <i class="${S.tbPaused ? 'ti ti-player-play' : 'ti ti-player-pause'}" id="ni-tb-pause-icon"></i>
            <span id="ni-tb-pause-text">${S.tbPaused ? '继续' : '暂停'}</span>
          </div>
        </div>
    
        <!-- 阶段下拉 -->
        <div class="ni-tb-drop-panel" id="ni-tb-stage-panel">
          <span class="ni-tb-sp-label">已开启阶段</span>
          <div class="ni-tb-sp-list" id="ni-tb-stage-list">${niTbBuildStageListHtml(stages, curStage?.stageIdx)}</div>
        </div>
    
        <!-- 节点下拉 -->
        <div class="ni-tb-drop-panel" id="ni-tb-node-panel">
          ${niTbBuildNodePanelHtml(stageView.nodes, S.tbCurIdx)}
        </div>
    
        <!-- 轮播 -->
        <div class="ni-tb-carousel-wrap" id="ni-tb-wrap">
          <div class="ni-tb-track" id="ni-tb-track"></div>
        </div>
    
        <!-- 推演结果 -->
        <div class="ni-tb-infer-block" id="ni-tb-infer-block">
          <div class="ni-tb-infer-toggle expanded" id="ni-tb-infer-toggle">
            <span class="ni-tb-infer-toggle-label">以下为下一步行动选项，点击填入输入框</span>
            <i class="ti ti-chevron-up ni-tb-infer-toggle-icon expanded" id="ni-tb-infer-toggle-icon"></i>
          </div>
          <div class="ni-tb-infer-list vis" id="ni-tb-infer-list"></div>
        </div>
      </div>
    </div>`;
    }
    
    function niEsc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    
    function niTbBuildStageListHtml(stages, activeStageIdx) {
        return stages.map(s =>
            `<div class="ni-tb-sp-row${s.stageIdx === activeStageIdx ? ' active-stage' : ''}" data-si="${s.stageIdx}">
               <div class="ni-tb-sp-dot"></div>
               <span class="ni-tb-sp-name">${niEsc(s.title)}</span>
             </div>`
        ).join('');
    }
    
    function niTbBuildNodePanelHtml(nodes, curIdx) {
        const activeNode  = nodes.find(n => n._globalIdx === curIdx) || nodes[curIdx];
        const activeId    = activeNode?.id;
        const doneNodes   = nodes.filter(n => n.done);
        const todoNodes   = nodes.filter(n => !n.done && n.id !== activeId);
        const sOp = S.tbSectionOpen;
    
        const mkRow = (n, i, cls, dotCls) =>
            `<div class="ni-tb-np-row ${cls}" data-ni="${n._globalIdx ?? i}">
               <div class="ni-tb-np-dot ${dotCls}"></div>
               <span class="ni-tb-np-title">${niEsc(n.title)}</span>
               <span class="ni-tb-np-type ${n.type}">${niEsc(n.typeLabel)}</span>
             </div>`;
    
        return `
          <div class="ni-tb-section-hd" data-sec="done">
            <i class="ti ti-chevron-right ni-tb-section-icon${sOp.done ? ' open' : ''}" id="ni-tb-sec-icon-done"></i>
            <span class="ni-tb-section-label">已归档</span>
            <span class="ni-tb-section-count done-count" id="ni-tb-sec-count-done">${doneNodes.length}</span>
          </div>
          <div class="ni-tb-np-list${sOp.done ? ' vis' : ''}" id="ni-tb-sec-list-done">
            ${doneNodes.map((n, i) => mkRow(n, i, 'done-row', 'done')).join('')}
          </div>
          <div class="ni-tb-section-hd" data-sec="active" style="background:var(--ni-warning-alpha-03, rgba(208,100,110,.03))">
            <i class="ti ti-chevron-right ni-tb-section-icon open" id="ni-tb-sec-icon-active"></i>
            <span class="ni-tb-section-label" style="color:var(--color-text-primary);font-weight:500">进行中</span>
            <span class="ni-tb-section-count done-count">当前</span>
          </div>
          <div class="ni-tb-np-list vis" id="ni-tb-sec-list-active">
            ${activeNode ? mkRow(activeNode, activeNode._globalIdx ?? curIdx, 'active', 'active-dot') : ''}
          </div>
          <div class="ni-tb-section-hd" data-sec="todo">
            <i class="ti ti-chevron-right ni-tb-section-icon${sOp.todo ? ' open' : ''}" id="ni-tb-sec-icon-todo"></i>
            <span class="ni-tb-section-label" style="opacity:.5">待解锁 / 未完成</span>
            <span class="ni-tb-section-count" id="ni-tb-sec-count-todo">${todoNodes.length}</span>
          </div>
          <div class="ni-tb-np-list${sOp.todo ? ' vis' : ''}" id="ni-tb-sec-list-todo">
            ${todoNodes.map((n, i) => mkRow(n, i, n.locked ? '' : '', n.locked ? 'todo' : 'todo')).join('')}
          </div>`;
    }
    
    // ── 轮播渲染 ─────────────────────────────────────────────────
    
    const TB_AW = 214, TB_SW = 150, TB_GAP = 10;
    
    function niTbGetSlots(nodes, cur) {
        const s = [];
        if (cur > 0) s.push({ idx: cur - 1, role: 'prev' });
        s.push({ idx: cur, role: 'active' });
        if (cur < nodes.length - 1) s.push({ idx: cur + 1, role: 'next' });
        return s;
    }
    
    function niTbCalcPos(slots, W) {
        const ws  = slots.map(s => s.role === 'active' ? TB_AW : TB_SW);
        const ai  = slots.findIndex(s => s.role === 'active');
        const pos = [];
        pos[ai] = W / 2 - TB_AW / 2;
        let rx = pos[ai];
        for (let i = ai - 1; i >= 0; i--) { rx -= TB_GAP + ws[i]; pos[i] = rx; }
        let lx = pos[ai] + TB_AW;
        for (let i = ai + 1; i < slots.length; i++) { pos[i] = lx + TB_GAP; lx = pos[i] + ws[i]; }
        return pos;
    }
    
    function niTbCardHTML(node, idx, displayIdx = idx) {
        const typeCls = node.type;
        const descText = node.locked ? '（待解锁）' : (node.body || '（暂无描述）');
        const metaParts = [node.time, node.location]
            .map(v => String(v || '').trim())
            .filter(Boolean);
        const metaHtml = metaParts.length
            ? `<span class="ni-tb-sc-num-meta">${niEsc(metaParts.join(' · '))}</span>`
            : '';
    
        // 事件列表
        const subNotes = (!node.locked && Array.isArray(node.sub_notes) && node.sub_notes.length)
            ? node.sub_notes : [];
        // 伏笔列表
        const foreshadows = (!node.locked && Array.isArray(node.branch_links))
            ? node.branch_links
                .filter(l => l.startsWith('【伏笔】'))
                .map(l => l.replace('【伏笔】', '').trim())
            : [];
    
        const subHtml = subNotes.length
            ? `<div class="ni-tb-sc-extras">${subNotes.map(s =>
                `<span class="ni-tb-sc-event"><i class="ti ti-circle-dot"></i>${niEsc(s)}</span>`
              ).join('')}</div>`
            : '';
        const foreHtml = foreshadows.length
            ? `<div class="ni-tb-sc-extras">${foreshadows.map(f =>
                `<span class="ni-tb-sc-fore"><i class="ti ti-bookmark"></i>${niEsc(f)}</span>`
              ).join('')}</div>`
            : '';
    
        return `<div class="ni-tb-sc-num">节点 ${displayIdx + 1}${metaHtml}</div>
    <span class="ni-tb-sc-type ${typeCls}">${niEsc(node.typeLabel)}</span>
    <div class="ni-tb-sc-check${node.done ? ' checked' : ''}" id="ni-tb-chk${idx}"><i class="ti ti-check"></i></div>
    <div class="ni-tb-sc-title">${niEsc(node.title)}</div>
    <div class="ni-tb-sc-desc">${niEsc(descText)}</div>
    ${subHtml}${foreHtml}
    <div class="ni-tb-scard-overlay" id="ni-tb-overlay${idx}">
      <div class="ni-tb-done-badge">已归档</div>
      <div class="ni-tb-unarchive-hint">点击取消归档</div>
    </div>`;
    }
    
    function niTbBuildTrack() {
        const track = document.getElementById('ni-tb-track');
        if (!track) return;
        track.innerHTML = '';
        const wrap = document.getElementById('ni-tb-wrap');
        const W    = wrap ? wrap.offsetWidth : 600;
        const nodes = niGetTbNodes();
        if (!nodes.length) return;
        const view  = niTbStageView(nodes, S.tbCurIdx);
        if (!view.nodes.length) return;
        const slots = niTbGetSlots(view.nodes, view.curIdx);
        const pos   = niTbCalcPos(slots, W);
    
        slots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            const el = document.createElement('div');
            el.id        = `ni-tb-card${gi}`;
            el.className = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
            el.style.left  = pos[i] + 'px';
            el.style.width = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
            el.innerHTML   = niTbCardHTML(n, gi, s.idx);
            el.onclick     = (e) => niTbCardClick(e, gi, niGetTbNodes());
            track.appendChild(el);
        });
        niRefreshStorybarTheme();
    }
    
    function niTbAnimateTo(newCur, nodes) {
        const wrap  = document.getElementById('ni-tb-wrap');
        const track = document.getElementById('ni-tb-track');
        if (!wrap || !track) return;
        const W = wrap.offsetWidth || 600;
    
        const view = niTbStageView(nodes, newCur);
        if (!view.nodes.length) return;
        const needed  = new Set();
        const localNeeded = new Set();
        if (view.curIdx > 0) localNeeded.add(view.curIdx - 1);
        localNeeded.add(view.curIdx);
        if (view.curIdx < view.nodes.length - 1) localNeeded.add(view.curIdx + 1);
        localNeeded.forEach(li => needed.add(view.nodes[li]._globalIdx ?? li));
    
        const existing  = new Set([...track.querySelectorAll('.ni-tb-scard')].map(el => +el.id.replace('ni-tb-card', '')));
        const newSlots  = niTbGetSlots(view.nodes, view.curIdx);
        const newPos    = niTbCalcPos(newSlots, W);
    
        // 移除不再需要的卡片
        existing.forEach(idx => {
            if (!needed.has(idx)) {
                const el = document.getElementById(`ni-tb-card${idx}`);
                if (!el) return;
                el.style.opacity = '0'; el.style.transform = 'scale(.92)';
                setTimeout(() => el.remove(), 400);
            }
        });
    
        // 新增卡片
        newSlots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            if (!existing.has(gi)) {
                const el = document.createElement('div');
                el.id        = `ni-tb-card${gi}`;
                el.className = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
                el.style.transition = 'none';
                el.style.left    = (newPos[i] + (gi < newCur ? -70 : 70)) + 'px';
                el.style.width   = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
                el.style.opacity = '0'; el.style.transform = 'scale(.94)';
                el.innerHTML     = niTbCardHTML(n, gi, s.idx);
                el.onclick       = (e) => niTbCardClick(e, gi, niGetTbNodes());
                track.appendChild(el);
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    el.style.transition = '';
                    el.style.left = newPos[i] + 'px';
                    el.style.opacity = ''; el.style.transform = '';
                }));
            }
        });
    
        // 更新已有卡片位置/角色
        newSlots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            if (existing.has(gi)) {
                const el = document.getElementById(`ni-tb-card${gi}`);
                if (!el) return;
                el.className   = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
                el.style.left  = newPos[i] + 'px';
                el.style.width = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
                el.style.opacity = ''; el.style.transform = '';
            }
        });
        niRefreshStorybarTheme();
    }
    
    function niTbCardClick(e, idx, nodes) {
        if (idx !== S.tbCurIdx) {
            niTbSetCurrentIdx(idx, nodes, { persist: true });
            niTbAnimateTo(idx, nodes);
            niTbSyncMeta(nodes);
            niTbRefreshNodePanel(nodes);
            return;
        }
        // active 卡：判断点击区域
        const overlay = document.getElementById(`ni-tb-overlay${idx}`);
        const chk     = document.getElementById(`ni-tb-chk${idx}`);
        if (overlay && overlay.contains(e.target)) {
            niTbUnarchive(idx);
        } else if (chk && chk.contains(e.target)) {
            niTbToggleCheck(idx);
        }
    }
    
    // ── 节点操作 ─────────────────────────────────────────────────
    
    function niTbSyncMeta(nodes) {
        const n = nodes[S.tbCurIdx];
        if (!n) return;
        const stages = niGetTbStages();
        const st     = stages.find(s => s.stageIdx === n.stageIdx);
        const view   = niTbStageView(nodes, S.tbCurIdx);
        const el = (id) => document.getElementById(id);
        if (el('ni-tb-curtitle')) el('ni-tb-curtitle').textContent = n.title;
        if (el('ni-tb-meta'))     el('ni-tb-meta').textContent     = `节点 ${view.curIdx + 1} / ${view.nodes.length}`;
        niRefreshStorybarTheme();
    }
    
    function niTbRefreshNodePanel(nodes) {
        const panel = document.getElementById('ni-tb-node-panel');
        if (!panel) return;
        const view = niTbStageView(nodes, S.tbCurIdx);
        panel.innerHTML = niTbBuildNodePanelHtml(view.nodes, S.tbCurIdx);
        niTbBindNodePanelEvents();
        niRefreshStorybarTheme();
    }
    
    async function niTbToggleCheck(idx) {
        const nodes = niGetTbNodes();
        const node  = nodes[idx];
        if (!node) return;
        if (node.locked) return; // 锁定节点不可操作
    
        const newDone = !node.done;
        S.tbNodeDone[node.id] = newDone;
        if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
        if (!newDone) {
            for (const key of _tbAdvanceSent) {
                if (key.startsWith(`${node.id}->`)) _tbAdvanceSent.delete(key);
            }
        }
    
        // 更新 DOM 立即反馈
        document.getElementById(`ni-tb-chk${idx}`)?.classList.toggle('checked', newDone);
        document.getElementById(`ni-tb-card${idx}`)?.classList.toggle('done', newDone);
        niTbRefreshNodePanel(niGetTbNodes());
    
        await niTbSaveState();
    
        // 节点完成后：若未暂停，注入推进提示词
        if (newDone && !S.tbPaused) {
            const freshNodes = niGetTbNodes();
            const nextNode   = freshNodes.find((n, i) =>
                i > freshNodes.findIndex(x => x.id === node.id) &&
                n.stageIdx === node.stageIdx && !n.done
            );
            if (nextNode) {
                niTbWriteAdvancePrompt(node, nextNode);
            } else {
                // 本阶段全部完成，显示完成标记
                niTbShowStageDone(node.stageIdx);
            }
        }
    }
    
    async function niTbUnarchive(idx) {
        const nodes = niGetTbNodes();
        const node  = nodes[idx];
        if (!node) return;
        S.tbNodeDone[node.id] = false;
        if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
        // 取消归档：清除以该节点为起点的已发送记录，下次完成时重新发首次提示词
        for (const key of _tbAdvanceSent) {
            if (key.startsWith(`${node.id}->`)) _tbAdvanceSent.delete(key);
        }
        document.getElementById(`ni-tb-chk${idx}`)?.classList.remove('checked');
        document.getElementById(`ni-tb-card${idx}`)?.classList.remove('done');
        niTbRefreshNodePanel(niGetTbNodes());
        await niTbSaveState();
    }
    
    function niTbShowStageDone(stageIdx) {
        const track = document.getElementById('ni-tb-track');
        if (!track) return;
        const stages   = niGetTbStages();
        const st       = stages.find(s => s.stageIdx === stageIdx);
        const existing = document.getElementById('ni-tb-stage-done-badge');
        if (existing) existing.remove();
        const badge = document.createElement('div');
        badge.id        = 'ni-tb-stage-done-badge';
        badge.className = 'ni-tb-stage-done-badge';
        badge.innerHTML = `<i class="ti ti-circle-check" style="color:var(--ni-warning, #c05a62)"></i> 「${niEsc(st ? st.title : `第 ${stageIdx} 阶段`)}」本阶段已全部完成`;
        track.parentElement.insertAdjacentElement('afterend', badge);
    }
    
    // ── AI 推进提示词注入 ────────────────────────────────────────
    
    // 待注入的推进提示词
    let _tbPendingAdvancePrompt = '';
    // 已发送过首次激活提示词的节点对 key 集合
    const _tbAdvanceSent = new Set();
    
    function niTbWriteAdvancePrompt(nodeA, nodeB) {
        const sentKey = `${nodeA.id}->${nodeB.id}`;
        if (_tbAdvanceSent.has(sentKey)) {
            console.log('[NI-TB] 推进提示词已发送过，跳过重复注入');
            return;
        }
        _tbAdvanceSent.add(sentKey);
        const cfg = extension_settings[EXT_NAME];
        const tpl = (cfg.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT).trim();
        _tbPendingAdvancePrompt = tpl
            .replace(/{A_TITLE}/g,    nodeA.title)
            .replace(/{B_TITLE}/g,    nodeB.title)
            .replace(/{B_BODY}/g,     nodeB.body      || '（暂无描述）')
            .replace(/{B_TIME}/g,     nodeB.time      || '不限')
            .replace(/{B_LOCATION}/g, nodeB.location  || '不限');
        console.log('[NI-TB] 推进提示词已就绪，等待下次发送生效');
    }
    
    // 开场提示词：故事最开始时注入
    function niTbWriteOpeningPrompt() {
        if (_tbAdvanceSent.has('__opening__')) return;
        _tbAdvanceSent.add('__opening__');
        const cfg = extension_settings[EXT_NAME];
        const nodes = niGetTbNodes();
        const firstNode = nodes.find(n => !n.done && !n.locked);
        if (!firstNode) return;
        const tpl = (cfg.tbOpeningPrompt || TB_DEFAULT_OPENING_PROMPT).trim();
        _tbPendingAdvancePrompt = tpl
            .replace(/{B_TITLE}/g,    firstNode.title)
            .replace(/{B_BODY}/g,     firstNode.body      || '（暂无描述）')
            .replace(/{B_TIME}/g,     firstNode.time      || '不限')
            .replace(/{B_LOCATION}/g, firstNode.location  || '不限');
        console.log('[NI-TB] 开场提示词已就绪，等待下次发送生效');
    }
    
    // ── 自由推演 ─────────────────────────────────────────────────
    
    async function niTbGenerateInfer() {
        if (S.tbInferring) return;
        S.tbInferring = true;
    
        const btn       = document.getElementById('ni-tb-btn-free');
        const icon      = document.getElementById('ni-tb-free-icon');
        const label     = document.getElementById('ni-tb-free-label');
        const inferBlock = document.getElementById('ni-tb-infer-block');
        const inferList  = document.getElementById('ni-tb-infer-list');
    
        if (btn)  { btn.classList.add('loading'); btn.classList.remove('has-result'); }
        if (icon) icon.className = 'ti ti-loader ni-tb-spin';
        if (label) label.textContent = '推演中';
        if (inferBlock) inferBlock.classList.remove('vis');
        if (inferList)  { inferList.classList.remove('vis'); inferList.innerHTML = ''; }
    
        try {
            const cfg   = extension_settings[EXT_NAME];
            const nodes = niGetTbNodes();
            const ctx   = getContext();
            niTbReconcileCurrentNode(nodes);
    
            // 当前节点
            const curNode = nodes[S.tbCurIdx] || nodes[0] || { title: '（未知）', body: '' };
    
            // 角色人设
            const userSubCfg = niGetUserSubConfig();
            const charLines = (S.characters || [])
                .map((c, idx) => ({ c, idx }))
                .filter(({ c, idx }) => c.enabled !== false && c.name && !niIsUserSubReplaceSelectedChar(idx, userSubCfg))
                .slice(0, 8)
                .map(({ c, idx }) => {
                    const isUserSubPlayChar = niIsUserSubSelectedChar(idx, userSubCfg) && niIsUserSubPlayMode(userSubCfg);
                    const parts = [isUserSubPlayChar
                        ? `【<user>（原著角色：${c.name}；${c.role || '其他'}）】`
                        : `【${c.name}（${c.role || '其他'}）】`];
                    const p = niGetCharAiShowEnabled(idx) ? niGetCharAiProfile(idx) : null;
                    if (p && typeof p === 'object') {
                        if (p.identity)    parts.push(`身份：${p.identity}`);
                        if (p.personality) parts.push(`性格：${p.personality}`);
                        if (p.relations)   parts.push(`关系：${p.relations}`);
                    } else {
                        if (c.identity)    parts.push(`身份：${c.identity}`);
                        if (c.personality) parts.push(`性格：${c.personality}`);
                        if (c.relations)   parts.push(`关系：${c.relations}`);
                    }
                    return parts.join('\n');
                });
            const charProfiles = charLines.length
                ? charLines.join('\n\n')
                : '（暂无角色人设数据，请在角色页配置）';
    
            // 最近对话
            const recentMsgs = (ctx?.chat || [])
                .filter(m => m.mes && m.mes.trim())
                .slice(-8)
                .map(m => `${m.is_user ? '[用户]' : '[AI]'} ${m.mes.trim()}`)
                .join('\n');
            const recentChat = recentMsgs || '（暂无对话记录）';
    
            const tpl = (cfg.tbInferPrompt || TB_DEFAULT_INFER_PROMPT).trim();
            const prompt = tpl
                .replace('{CUR_NODE_TITLE}', curNode.title)
                .replace('{CUR_NODE_BODY}',  curNode.body || '（暂无描述）')
                .replace('{CHAR_PROFILES}',  charProfiles)
                .replace('{RECENT_CHAT}',    recentChat)
                .replace('{MSG_COUNT}',      String(recentMsgs.split('\n').length))
                + niTbGetImmersionAppend(cfg);
    
            const raw = await callCleanApi([{ role: 'user', content: niApplyUserSubstitution(prompt) }]);
    
            // 解析 JSON，兼容带 ```json 包裹的情况
            let data;
            try {
                const cleaned = raw.replace(/```json|```/gi, '').trim();
                data = JSON.parse(cleaned);
            } catch (pe) {
                throw new Error('推演结果解析失败：' + pe.message);
            }
    
            if (!Array.isArray(data)) throw new Error('返回格式不是数组');
            data = data.map(item => ({
                ...item,
                title: niApplyUserSubstitution(item.title || ''),
                desc: niApplyUserSubstitution(item.desc || item.description || ''),
                description: niApplyUserSubstitution(item.description || item.desc || ''),
            }));
    
            // 保存结果供弹窗读取
            S.tbLastInfer = data;
    
            if (inferList) {
                inferList.innerHTML = '';
                data.forEach((d, i) => {
                    const item = document.createElement('div');
                    item.className = 'ni-tb-infer-item ni-tb-fade-in';
                    item.dataset.desc = d.desc || d.description || '';
                    item.innerHTML = `
                      <div class="ni-tb-infer-num">${i + 1}</div>
                      <div class="ni-tb-infer-content">
                        <span class="ni-tb-infer-tag ni-tb-tag-${niEsc(d.tag || 'canon')}">${niEsc(d.tagLabel || d.tag)}</span>
                        <div class="ni-tb-infer-title">${niEsc(d.title)}</div>
                        <div class="ni-tb-infer-desc">${niEsc(d.desc)}</div>
                      </div>`;
                    inferList.appendChild(item);
                });
                inferList.classList.add('vis');
            }
    
            if (inferBlock) inferBlock.classList.add('vis');
            if (btn)  { btn.classList.remove('loading'); btn.classList.add('has-result'); }
            if (icon) icon.className = 'ti ti-refresh';
            if (label) label.textContent = '推演';
    
        } catch (err) {
            console.error('[NI-TB] 推演失败:', err);
            if (inferList) {
                inferList.innerHTML = `<div style="padding:14px 16px;font-size:12px;color:var(--color-text-tertiary)">推演失败：${niEsc(err.message)}</div>`;
                inferList.classList.add('vis');
            }
            if (inferBlock) inferBlock.classList.add('vis');
            if (btn)  btn.classList.remove('loading');
            if (icon) icon.className = 'ti ti-chart-line';
            if (label) label.textContent = '推演';
        } finally {
            S.tbInferring = false;
        }
    }
    
    // ── 状态栏挂载 / 卸载 ────────────────────────────────────────
    
    // ── 将状态栏 CSS 注入到 document.head──────────
    function niTbInjectCSS() {
        if (document.getElementById('ni-tb-injected-css')) return;
        const style = document.createElement('style');
        style.id = 'ni-tb-injected-css';
        style.textContent = `.ni-tb-shell{background:var(--color-background-secondary,#f7f7f8);border-radius:16px;overflow:hidden;border:0.5px solid var(--color-border-tertiary,#e8e8ec);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;user-select:none;margin:8px 0}
    .ni-tb-bar{display:flex;align-items:center;gap:6px;padding:9px 14px;cursor:pointer;background:var(--color-background-primary,#fff);border-bottom:0.5px solid transparent;transition:border-color .25s}
    .ni-tb-bar.open{border-bottom-color:var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-pin{width:6px;height:6px;border-radius:50%;background:#e8848a;flex-shrink:0}
    .ni-tb-status{font-size:10px;font-weight:500;padding:1px 6px;border-radius:20px;background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62);flex-shrink:0;white-space:nowrap}
    .ni-tb-curtitle{font-size:13px;font-weight:500;color:var(--color-text-primary,#1a1a1a);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ni-tb-meta{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);white-space:nowrap;flex-shrink:0}
    .ni-tb-chevron{font-size:14px;color:var(--color-text-tertiary,#9a9aaa);transition:transform .35s cubic-bezier(.34,1.56,.64,1);margin-left:2px;flex-shrink:0}
    .ni-tb-chevron.open{transform:rotate(180deg)}
    .ni-tb-body{max-height:0;overflow:hidden;transition:max-height .52s cubic-bezier(.4,0,.2,1)}
    .ni-tb-body.open{max-height:1400px}
    .ni-tb-selrow{display:flex;align-items:center;gap:8px;padding:0 16px;height:35px;box-sizing:border-box;background:var(--color-background-primary,#fff);flex-wrap:nowrap}
    .ni-tb-sel-btn{display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--color-border-secondary,#d8d8de);background:var(--color-background-secondary,#f7f7f8);font-size:11px;color:var(--color-text-secondary,#5a5a6a);cursor:pointer;transition:background .15s;white-space:nowrap;flex-shrink:0}
    .ni-tb-sel-btn:hover{background:var(--color-background-tertiary,#eeeeef)}
    .ni-tb-sel-sep{font-size:14px;color:var(--color-border-secondary,#d8d8de);flex-shrink:0}
    .ni-tb-sel-spacer{flex:1}
    .ni-tb-btn-free{display:flex;align-items:center;gap:4px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--color-border-secondary,#d8d8de);background:var(--color-background-secondary,#f7f7f8);font-size:11px;color:var(--color-text-secondary,#5a5a6a);cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0}
    .ni-tb-btn-free:hover:not(.loading){background:var(--color-background-tertiary,#eeeeef)}
    .ni-tb-btn-free.loading{opacity:.6;pointer-events:none}
    .ni-tb-btn-free.has-result{border-color:var(--ni-warning-alpha-30, rgba(208,100,110,.3));background:var(--ni-warning-alpha-06, rgba(208,100,110,.06));color:var(--ni-warning, #c05a62)}
    .ni-tb-btn-free.has-result:hover{background:var(--ni-warning-alpha-12, rgba(208,100,110,.12))}
    .ni-tb-btn-pause{display:flex;align-items:center;gap:4px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--ni-warning-alpha-25, rgba(208,100,110,.25));background:var(--ni-warning-alpha-06, rgba(208,100,110,.06));font-size:11px;color:var(--ni-warning, #c05a62);cursor:pointer;transition:background .15s;white-space:nowrap;flex-shrink:0}
    .ni-tb-btn-pause:hover{background:var(--ni-warning-alpha-12, rgba(208,100,110,.12))}
    .ni-tb-btn-pause.paused{background:var(--ni-warning-alpha-14, rgba(208,100,110,.14));border-color:var(--ni-warning-alpha-40, rgba(208,100,110,.4))}
    .ni-tb-drop-panel{display:none;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-drop-panel.vis{display:block}
    .ni-tb-sp-label{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);letter-spacing:.06em;padding:8px 16px 4px;display:block}
    .ni-tb-sp-list{display:flex;flex-direction:column;padding-bottom:6px}
    .ni-tb-sp-row{display:flex;align-items:center;gap:8px;padding:7px 16px;cursor:pointer;transition:background .15s}
    .ni-tb-sp-row:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-sp-row.active-stage .ni-tb-sp-name{color:var(--ni-warning, #c05a62);font-weight:500}
    .ni-tb-sp-row.active-stage .ni-tb-sp-dot{background:#e8848a}
    .ni-tb-sp-dot{width:5px;height:5px;border-radius:50%;background:var(--color-border-secondary,#d8d8de);flex-shrink:0}
    .ni-tb-sp-name{font-size:12px;color:var(--color-text-secondary,#5a5a6a)}
    .ni-tb-section-hd{display:flex;align-items:center;gap:7px;padding:8px 16px;cursor:pointer;transition:background .15s;border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-section-hd:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-section-icon{font-size:12px;color:var(--color-text-tertiary,#9a9aaa);transition:transform .2s;flex-shrink:0}
    .ni-tb-section-icon.open{transform:rotate(90deg)}
    .ni-tb-section-label{font-size:11px;font-weight:500;color:var(--color-text-secondary,#5a5a6a);flex:1}
    .ni-tb-section-count{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);background:var(--color-background-secondary,#f7f7f8);padding:1px 7px;border-radius:20px;border:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-section-count.done-count{background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62);border-color:var(--ni-warning-alpha-20, rgba(208,100,110,.2))}
    .ni-tb-np-list{display:none;flex-direction:column;padding:4px 0}
    .ni-tb-np-list.vis{display:flex}
    .ni-tb-np-row{display:flex;align-items:center;gap:10px;padding:7px 16px 7px 32px;cursor:pointer;transition:background .15s}
    .ni-tb-np-row:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-np-row.active{background:var(--ni-warning-soft-2, #fff5f6)}
    .ni-tb-np-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
    .ni-tb-np-dot.done{background:#e8848a}
    .ni-tb-np-dot.active-dot{background:#e8848a;box-shadow:0 0 0 3px rgba(232,132,138,.2)}
    .ni-tb-np-dot.todo{background:var(--color-border-secondary,#d8d8de)}
    .ni-tb-np-title{font-size:11px;color:var(--color-text-secondary,#5a5a6a);flex:1}
    .ni-tb-np-row.active .ni-tb-np-title{color:var(--color-text-primary,#1a1a1a);font-weight:500}
    .ni-tb-np-row.done-row .ni-tb-np-title{text-decoration:line-through;opacity:.45}
    .ni-tb-np-type{font-size:9px;padding:1px 5px;border-radius:8px;flex-shrink:0}
    .ni-tb-np-type.main{background:var(--ni-primary-soft, #F5E6EC);color:var(--ni-primary-soft-text, #8B3A50)}
    .ni-tb-np-type.sub{background:var(--ni-success-soft, #E1F5EE);color:var(--ni-success-text, #0F6E56)}
    .ni-tb-np-type.pivot{background:var(--ni-pivot-soft, #FCF7FB);color:var(--ni-pivot-text, #7C5071)}
    .ni-tb-carousel-wrap{padding:14px 0;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec);position:relative;overflow:hidden;height:200px}
    .ni-tb-track{position:absolute;top:0;left:0;height:100%;width:100%}
    .ni-tb-scard{position:absolute;top:14px;height:160px;border-radius:12px;border:0.5px solid var(--color-border-tertiary,#e8e8ec);background:var(--color-background-primary,#fff);padding:13px 14px;overflow:hidden;cursor:pointer;transition:left .4s cubic-bezier(.4,0,.2,1),width .4s cubic-bezier(.4,0,.2,1),opacity .4s ease,box-shadow .3s,border-color .3s,background .3s}
    .ni-tb-scard.active{border-color:var(--ni-warning-alpha-35, rgba(208,100,110,.35));background:var(--ni-warning-soft-2, #fff9f9);box-shadow:0 6px 24px var(--ni-warning-alpha-14, rgba(208,100,110,.14));z-index:2;cursor:default;padding-top:3px;padding-bottom:3px;height:auto;min-height:166px}
    .ni-tb-scard.side-prev,.ni-tb-scard.side-next{opacity:.52;background:var(--color-background-secondary,#f7f7f8);z-index:1}
    .ni-tb-scard.far{opacity:.15;background:var(--color-background-secondary,#f7f7f8);z-index:0;pointer-events:none}
    .ni-tb-scard-overlay{display:none;position:absolute;inset:0;border-radius:12px;cursor:pointer;background:rgba(248,235,237,.72);flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:background .2s}
    .ni-tb-scard.done .ni-tb-scard-overlay{display:flex}
    .ni-tb-scard-overlay:hover{background:rgba(242,218,220,.9)}
    .ni-tb-done-badge{font-size:10px;font-weight:500;color:var(--ni-warning, #c05a62);background:var(--ni-warning-soft, #fde8ea);padding:3px 10px;border-radius:20px;border:0.5px solid var(--ni-warning-alpha-30, rgba(208,100,110,.3));pointer-events:none;transition:opacity .2s}
    .ni-tb-unarchive-hint{font-size:9px;color:rgba(192,90,98,.65);opacity:0;transition:opacity .2s;pointer-events:none}
    .ni-tb-scard-overlay:hover .ni-tb-done-badge{opacity:.5}
    .ni-tb-scard-overlay:hover .ni-tb-unarchive-hint{opacity:1}
    .ni-tb-scard:not(.active) .ni-tb-sc-check{pointer-events:none;opacity:0}
    .ni-tb-scard:not(.active) .ni-tb-scard-overlay:hover{background:rgba(248,235,237,.72)}
    .ni-tb-sc-num{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);margin-bottom:3px;display:flex;align-items:center;gap:4px;min-width:0;padding-right:28px;white-space:nowrap}
    .ni-tb-sc-num-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--color-text-secondary,#5a5a6a)}
    .ni-tb-sc-type{display:inline-block;font-size:9px;font-weight:500;padding:1px 6px;border-radius:10px;margin-bottom:8px}
    .ni-tb-sc-type.main{background:var(--ni-primary-soft, #F5E6EC);color:var(--ni-primary-soft-text, #8B3A50)}
    .ni-tb-sc-type.sub{background:var(--ni-success-soft, #E1F5EE);color:var(--ni-success-text, #0F6E56)}
    .ni-tb-sc-type.pivot{background:var(--ni-pivot-soft, #FCF7FB);color:var(--ni-pivot-text, #7C5071)}
    .ni-tb-sc-title{font-size:12px;font-weight:500;color:var(--color-text-primary,#1a1a1a);line-height:1.4;margin-bottom:5px}
    .ni-tb-sc-desc{font-size:10px;color:var(--color-text-secondary,#5a5a6a);line-height:1.4;overflow:hidden}.ni-tb-sc-extras{display:flex;flex-direction:column;gap:1px;margin-top:3px;overflow:hidden}.ni-tb-sc-event,.ni-tb-sc-fore{display:flex;align-items:center;gap:2px;font-size:10px;line-height:1.35;color:var(--color-text-tertiary,#9a9aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ni-tb-sc-event i{font-size:9px;color:var(--ni-warning-alpha-50, rgba(208,100,110,.5));flex-shrink:0}.ni-tb-sc-fore i{font-size:9px;color:rgba(120,100,200,.5);flex-shrink:0}
    .ni-tb-sc-check{position:absolute;top:10px;right:10px;width:15px;height:15px;border-radius:50%;border:0.5px solid rgba(160,68,94,.3);background:var(--color-background-secondary,#f7f7f8);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;z-index:3}
    .ni-tb-sc-check.checked{background:var(--ni-warning-soft, #fde8ea);border-color:var(--ni-warning-alpha-50, rgba(208,100,110,.5))}
    .ni-tb-sc-check i{font-size:9px;color:transparent;transition:color .2s}
    .ni-tb-sc-check.checked i{color:var(--ni-primary, #A0445E)!important;text-shadow:none!important}
    .ni-tb-stage-done-badge{display:flex;align-items:center;justify-content:center;gap:5px;padding:10px 16px;font-size:11px;color:var(--ni-warning, #c05a62);background:var(--ni-warning-soft-2, #fff5f6);border-top:0.5px solid var(--ni-warning-alpha-15, rgba(208,100,110,.15))}
    .ni-tb-infer-block{display:none;flex-direction:column;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-infer-block.vis{display:flex}
    .ni-tb-infer-toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;transition:background .15s;border-bottom:0.5px solid transparent}
    .ni-tb-infer-toggle.expanded{border-bottom-color:var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-infer-toggle:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-infer-toggle-label{font-size:11px;color:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-infer-toggle-icon{font-size:14px;color:var(--color-text-tertiary,#9a9aaa);opacity:.5;transition:transform .25s cubic-bezier(.34,1.56,.64,1)}
    .ni-tb-infer-toggle-icon.expanded{transform:rotate(180deg)}
    .ni-tb-infer-list{display:none;flex-direction:column}
    .ni-tb-infer-list.vis{display:flex}
    .ni-tb-infer-item{display:flex;align-items:flex-start;gap:12px;padding:13px 16px;border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec);transition:background .15s;cursor:pointer}
    .ni-tb-infer-item:last-child{border-bottom:none}
    .ni-tb-infer-item:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-infer-num{flex-shrink:0;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;background:var(--color-background-secondary,#f7f7f8);border:0.5px solid var(--color-border-secondary,#d8d8de);color:var(--color-text-tertiary,#9a9aaa);margin-top:1px}
    .ni-tb-infer-content{flex:1;min-width:0}
    .ni-tb-infer-tag{display:inline-block;font-size:9px;font-weight:500;padding:1px 7px;border-radius:10px;margin-bottom:5px}
    .ni-tb-tag-canon{background:#eef5ff;color:#185fa5}
    .ni-tb-tag-diverge{background:#fff8e6;color:#854f0b}
    .ni-tb-tag-break{background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62)}
    .ni-tb-infer-title{font-size:12px;font-weight:500;color:var(--color-text-primary,#1a1a1a);margin-bottom:4px;line-height:1.4}
    .ni-tb-infer-desc{font-size:11px;color:var(--color-text-secondary,#5a5a6a);line-height:1.6}
    .ni-tb-icon-only{padding:5px 10px !important;min-width:32px;justify-content:center}
    @keyframes ni-tb-spin{to{transform:rotate(360deg)}}
    .ni-tb-spin{animation:ni-tb-spin .8s linear infinite}
    @keyframes ni-tb-fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    .ni-tb-fade-in{animation:ni-tb-fadeUp .32s ease both}
    .ni-tb-fade-in:nth-child(1){animation-delay:.04s}
    .ni-tb-fade-in:nth-child(2){animation-delay:.14s}
    .ni-tb-fade-in:nth-child(3){animation-delay:.24s}`;
        document.head.appendChild(style);
    }
    
    function niTbRenderStoryBar() {
        niTbInjectCSS(); // 确保样式已注入到 document.head
        const cfg = extension_settings[EXT_NAME];
        if (!cfg?.transBookMode) return;
        if (!S.stageMapN || S.stageMapN <= 0) return;
        // 如果状态栏显示未开启，移除旧实例并退出
        if (!cfg?.tbDisplayStatusbar) {
            document.getElementById('ni-storybar')?.remove();
            return;
        }
    
        // 移除旧实例
        document.getElementById('ni-storybar')?.remove();
    
        // 找最后一条 AI 消息的.mes_text
        const allMes = document.querySelectorAll('.mes');
        let lastAiMes = null;
        for (let i = allMes.length - 1; i >= 0; i--) {
            const m = allMes[i];
            if (m.getAttribute('is_user') === 'false' || m.classList.contains('assistant')) {
                lastAiMes = m; break;
            }
        }
        if (!lastAiMes) {
            // fallback：挂到 #chat 底部
            const chat = document.getElementById('chat');
            if (chat) chat.insertAdjacentHTML('beforeend', niGetTbStoryBarHtml());
        } else {
            const mesText = lastAiMes.querySelector('.mes_text');
            if (mesText) {
                mesText.insertAdjacentHTML('afterend', niGetTbStoryBarHtml());
            }
        }
    
        niTbBindEvents();
        niTbBuildTrack();
        niRefreshStorybarTheme();
        niTbSyncPauseUI();
    }
    
    function niRefreshStorybarTheme(themeDraft = null) {
        const cfg = extension_settings[EXT_NAME] || {};
        niApplyStatusbarTheme(themeDraft ? { ...cfg, ...themeDraft } : cfg);
    }
    
    // ── 事件绑定 ─────────────────────────────────────────────────
    
    function niTbBindEvents() {
        niTbBindBarEvents();
        niTbBindNodePanelEvents();
    }
    
    function niTbBindBarEvents() {
        const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    
        // 顶栏展开/收起
        on('ni-tb-bar', 'click', () => {
            const bar  = document.getElementById('ni-tb-bar');
            const body = document.getElementById('ni-tb-body-wrap');
            const chev = document.getElementById('ni-tb-chevron');
            const isOpen = body?.classList.toggle('open');
            bar?.classList.toggle('open', isOpen);
            chev?.classList.toggle('open', isOpen);
            if (isOpen) {
                setTimeout(() => {
                    niTbBuildTrack();
                    niTbRefreshNodePanel(niGetTbNodes());
                    niTbRebuildStageList();
                }, 60);
            } else {
                document.getElementById('ni-tb-stage-panel')?.classList.remove('vis');
                document.getElementById('ni-tb-node-panel')?.classList.remove('vis');
            }
        });
    
        // 阶段按钮
        on('ni-tb-stage-btn', 'click', (e) => {
            e.stopPropagation();
            // 状态栏打开期间阶段配置可能已变化，展开前同步最新列表。
            niTbRebuildStageList();
            niTbToggleDropPanel('ni-tb-stage-panel', 'ni-tb-node-panel');
        });
    
        // 节点按钮
        on('ni-tb-node-btn', 'click', (e) => {
            e.stopPropagation();
            // 节点面板默认隐藏，切换阶段后首次展开也必须读取当前阶段。
            niTbRefreshNodePanel(niGetTbNodes());
            niTbToggleDropPanel('ni-tb-node-panel', 'ni-tb-stage-panel');
        });
    
        // 推演按钮
        on('ni-tb-btn-free', 'click', (e) => {
            e.stopPropagation();
            niTbGenerateInfer();
        });
    
        // 暂停/恢复按钮
        on('ni-tb-btn-pause', 'click', (e) => {
            e.stopPropagation();
            niTbTogglePaused();
        });
    
        // 推演折叠
        on('ni-tb-infer-toggle', 'click', () => {
            const list    = document.getElementById('ni-tb-infer-list');
            const toggle  = document.getElementById('ni-tb-infer-toggle');
            const togIcon = document.getElementById('ni-tb-infer-toggle-icon');
            const expanded = list?.classList.toggle('vis');
            toggle?.classList.toggle('expanded', expanded);
            togIcon?.classList.toggle('expanded', expanded);
        });
    
        // 推演选项：点击整条填入输入框
        document.getElementById('ni-tb-infer-list')?.addEventListener('click', (e) => {
            const item = e.target.closest('.ni-tb-infer-item');
            if (!item) return;
            const desc = niApplyUserSubstitution(item.dataset.desc || '');
            const ta   = document.getElementById('send_textarea') || document.querySelector('#send_textarea');
            if (ta) {
                ta.value = desc;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.focus();
            }
        });
    
        // 阶段列表点击
        document.getElementById('ni-tb-stage-panel')?.addEventListener('click', (e) => {
            const row = e.target.closest('.ni-tb-sp-row');
            if (!row) return;
            const si    = parseInt(row.dataset.si);
            const nodes = niGetTbNodes();
            const firstIdx = nodes.findIndex(n => n.stageIdx === si);
            if (firstIdx >= 0) {
                niTbSetCurrentIdx(firstIdx, nodes, { persist: true });
                // 跨阶段立即重建，避免旧动画的延迟移除误删新阶段卡片。
                niTbBuildTrack();
                niTbSyncMeta(nodes);
                niTbRefreshNodePanel(nodes);
            }
            niTbRebuildStageList();
            document.getElementById('ni-tb-stage-panel')?.classList.remove('vis');
        });
    }
    
    function niTbBindNodePanelEvents() {
        const panel = document.getElementById('ni-tb-node-panel');
        if (!panel) return;
    
        // 折叠区域标题
        panel.querySelectorAll('.ni-tb-section-hd').forEach(hd => {
            hd.addEventListener('click', () => {
                const sec  = hd.dataset.sec;
                S.tbSectionOpen[sec] = !S.tbSectionOpen[sec];
                const list = document.getElementById(`ni-tb-sec-list-${sec}`);
                const icon = document.getElementById(`ni-tb-sec-icon-${sec}`);
                list?.classList.toggle('vis', S.tbSectionOpen[sec]);
                icon?.classList.toggle('open', S.tbSectionOpen[sec]);
            });
        });
    
        // 节点行点击
        panel.querySelectorAll('.ni-tb-np-row').forEach(row => {
            row.addEventListener('click', () => {
                const ni    = parseInt(row.dataset.ni);
                const nodes = niGetTbNodes();
                if (isNaN(ni) || ni < 0 || ni >= nodes.length) return;
                niTbSetCurrentIdx(ni, nodes, { persist: true });
                niTbAnimateTo(ni, nodes);
                niTbSyncMeta(nodes);
                niTbRefreshNodePanel(nodes);
                document.getElementById('ni-tb-node-panel')?.classList.remove('vis');
            });
        });
    }
    
    function niTbToggleDropPanel(showId, hideId) {
        const show = document.getElementById(showId);
        const hide = document.getElementById(hideId);
        hide?.classList.remove('vis');
        show?.classList.toggle('vis');
    }
    
    function niTbRebuildStageList() {
        const nodes  = niGetTbNodes();
        const stages = niGetTbStages();
        const curNode = nodes[S.tbCurIdx];
        const list   = document.getElementById('ni-tb-stage-list');
        if (!list) return;
        list.innerHTML = niTbBuildStageListHtml(stages, curNode?.stageIdx);
        // 重新绑定点击
        niRefreshStorybarTheme();
    }
    
    // ── Settings 页 UI 绑定 ───────────────────────────────────────
    
    // 防止多次打开设置页时重复绑定事件监听器
    let _niTbUIBound = false;
    
    function niTbInitSettingsUI() {
        const cfg = extension_settings[EXT_NAME];
        if (niUpgradeLegacyTbDefaultPrompts(cfg)) saveSettingsDebounced();
    
        // 穿书模式 UI 绑定
        if (!_niTbUIBound) {
            // 设置面板按钮 & 提示词面板按钮
            const $appTb = typeof $ !== 'undefined' ? $(document.getElementById('ni-app') || document) : null;
            if ($appTb) {
                $appTb.on('click', '#ni-tb-cfg-btn', () => niTogglePanel('ni-tb-cfg-panel', 'ni-tb-cfg-btn'));
                $appTb.on('click', '#ni-tb-prompt-btn', () => niTogglePanel('ni-tb-pb', 'ni-tb-prompt-btn'));
            } else {
                document.addEventListener('click', e => {
                    if (e.target.closest('#ni-tb-cfg-btn'))    niTogglePanel('ni-tb-cfg-panel', 'ni-tb-cfg-btn');
                    if (e.target.closest('#ni-tb-prompt-btn')) niTogglePanel('ni-tb-pb', 'ni-tb-prompt-btn');
                });
            }
    
            // 设置项：状态栏
            document.getElementById('ni-tb-display-statusbar')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbDisplayStatusbar = this.checked;
                if (this.checked) {
                    // 关闭弹窗选项
                    extension_settings[EXT_NAME].tbDisplayPopup = false;
                    const popupChk = document.getElementById('ni-tb-display-popup');
                    if (popupChk) popupChk.checked = false;
                    if (typeof niPopSetVisible === 'function') niPopSetVisible(false);
                }
                // 根据新设置重新渲染状态栏
                if (this.checked) {
                    niTbRenderStoryBar();
                } else {
                    document.getElementById('ni-storybar')?.remove();
                }
                saveSettingsDebounced();
            });
    
            // 设置项：弹窗
            document.getElementById('ni-tb-display-popup')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbDisplayPopup = this.checked;
                if (this.checked) {
                    // 关闭状态栏选项，并移除状态栏
                    extension_settings[EXT_NAME].tbDisplayStatusbar = false;
                    const statusbarChk = document.getElementById('ni-tb-display-statusbar');
                    if (statusbarChk) statusbarChk.checked = false;
                    document.getElementById('ni-storybar')?.remove();
                }
                if (typeof niPopSyncVisibility === 'function') niPopSyncVisibility();
                saveSettingsDebounced();
            });
    
            // 穿书开关：监听 checkbox change 事件
            const tbChk = document.getElementById('ni-tb-chk');
            if (tbChk) {
                tbChk.addEventListener('change', function () {
                    extension_settings[EXT_NAME].tbRestoreAfterPluginEnable = false;
                    niSetTransBookMode(this.checked);
                    saveSettingsDebounced();
                });
            }
    
            // 推进提示词
            const advEl = document.getElementById('ni-tb-advance-prompt');
            if (advEl) {
                advEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbAdvancePrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-advance-reset')?.addEventListener('click', () => {
                const _advEl = document.getElementById('ni-tb-advance-prompt');
                if (_advEl) _advEl.value = TB_DEFAULT_ADVANCE_PROMPT;
                extension_settings[EXT_NAME].tbAdvancePrompt = TB_DEFAULT_ADVANCE_PROMPT;
                saveSettingsDebounced();
            });
    
            // 持续提示词
            const ongoingEl = document.getElementById('ni-tb-ongoing-prompt');
            if (ongoingEl) {
                ongoingEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbOngoingPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-ongoing-reset')?.addEventListener('click', () => {
                const _ongoingEl = document.getElementById('ni-tb-ongoing-prompt');
                if (_ongoingEl) _ongoingEl.value = TB_DEFAULT_ONGOING_PROMPT;
                extension_settings[EXT_NAME].tbOngoingPrompt = TB_DEFAULT_ONGOING_PROMPT;
                saveSettingsDebounced();
            });
    
            // 推演提示词
            const inferEl = document.getElementById('ni-tb-infer-prompt');
            if (inferEl) {
                inferEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbInferPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-infer-reset')?.addEventListener('click', () => {
                const _inferEl = document.getElementById('ni-tb-infer-prompt');
                if (_inferEl) _inferEl.value = TB_DEFAULT_INFER_PROMPT;
                extension_settings[EXT_NAME].tbInferPrompt = TB_DEFAULT_INFER_PROMPT;
                saveSettingsDebounced();
            });
    
            // 沉浸提示词
            const immersionEl = document.getElementById('ni-tb-immersion-prompt');
            if (immersionEl) {
                immersionEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbImmersionPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-immersion-reset')?.addEventListener('click', () => {
                const _immersionEl = document.getElementById('ni-tb-immersion-prompt');
                if (_immersionEl) _immersionEl.value = TB_DEFAULT_IMMERSION_PROMPT;
                extension_settings[EXT_NAME].tbImmersionPrompt = TB_DEFAULT_IMMERSION_PROMPT;
                saveSettingsDebounced();
            });
    
            document.getElementById('ni-tb-light-recall-mode')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbLightRecallMode = this.checked;
                saveSettingsDebounced();
            });
    
            document.getElementById('ni-tb-immersion-mode')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbImmersionMode = this.checked;
                saveSettingsDebounced();
            });
    
            _niTbUIBound = true;
        } // end if
    
        // ── 每次打开设置页都需要同步的 UI 值 ──────────────────────
        const chk = document.getElementById('ni-tb-chk');
        if (chk) niSyncTransBookToggleUI();
        const advElSync = document.getElementById('ni-tb-advance-prompt');
        if (advElSync) advElSync.value = cfg?.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT;
        const inferElSync = document.getElementById('ni-tb-infer-prompt');
        if (inferElSync) inferElSync.value = cfg?.tbInferPrompt || TB_DEFAULT_INFER_PROMPT;
        const ongoingElSync = document.getElementById('ni-tb-ongoing-prompt');
        if (ongoingElSync) ongoingElSync.value = cfg?.tbOngoingPrompt || TB_DEFAULT_ONGOING_PROMPT;
        const lightRecallModeChk = document.getElementById('ni-tb-light-recall-mode');
        if (lightRecallModeChk) lightRecallModeChk.checked = !!cfg?.tbLightRecallMode;
        const immersionElSync = document.getElementById('ni-tb-immersion-prompt');
        if (immersionElSync) immersionElSync.value = cfg?.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT;
        const statusbarChk = document.getElementById('ni-tb-display-statusbar');
        if (statusbarChk) statusbarChk.checked = !!cfg?.tbDisplayStatusbar;
        const popupChk = document.getElementById('ni-tb-display-popup');
        if (popupChk) popupChk.checked = !!cfg?.tbDisplayPopup;
        const immersionModeChk = document.getElementById('ni-tb-immersion-mode');
        if (immersionModeChk) immersionModeChk.checked = !!cfg?.tbImmersionMode;
    }

    function niTbPeekPendingAdvancePrompt() {
        return _tbPendingAdvancePrompt;
    }

    function niTbConsumePendingAdvancePrompt() {
        const prompt = _tbPendingAdvancePrompt;
        _tbPendingAdvancePrompt = '';
        return prompt;
    }

    function niTbResetPromptRuntimeState() {
        _tbPendingAdvancePrompt = '';
        _tbAdvanceSent.clear();
        S.tbSectionOpen = { done: false, active: true, todo: false };
    }

    Object.assign(window, {
        _niS: S,
        niGetTbNodes,
        niGetTbStages,
        niTbToggleCheck,
        niTbGenerateInfer,
    });

    return {
        niTbSyncPauseUI,
        niTbSetPaused,
        niTbTogglePaused,
        niUpgradeLegacyTbDefaultPrompts,
        niTbGetImmersionAppend,
        niTbFrontierStage,
        niTbAdvanceFrontier,
        niGetTbNodes,
        niGetTbStages,
        niTbReconcileCurrentNode,
        niTbSetCurrentIdx,
        niTbStageView,
        niTbSaveState,
        niTbLoadState,
        niGetTbStoryBarHtml,
        niEsc,
        niTbBuildStageListHtml,
        niTbBuildNodePanelHtml,
        niTbGetSlots,
        niTbCalcPos,
        niTbCardHTML,
        niTbBuildTrack,
        niTbAnimateTo,
        niTbCardClick,
        niTbSyncMeta,
        niTbRefreshNodePanel,
        niTbToggleCheck,
        niTbUnarchive,
        niTbShowStageDone,
        niTbWriteAdvancePrompt,
        niTbWriteOpeningPrompt,
        niTbGenerateInfer,
        niTbInjectCSS,
        niTbRenderStoryBar,
        niRefreshStorybarTheme,
        niTbBindEvents,
        niTbBindBarEvents,
        niTbBindNodePanelEvents,
        niTbToggleDropPanel,
        niTbRebuildStageList,
        niTbInitSettingsUI,
        niTbPeekPendingAdvancePrompt,
        niTbConsumePendingAdvancePrompt,
        niTbResetPromptRuntimeState,
    };
}
