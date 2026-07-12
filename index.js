/**
 * Novel Injector - 小说上下文注入插件
 * 功能：上传小说 → 分段清洗压缩 → 提取剧情/角色 → 向量化 → 按阶段开关动态注入酒馆上下文
*/

import {
    renderExtensionTemplateAsync,
    getContext,
    extension_settings,
} from '/scripts/extensions.js';

import {
    saveSettingsDebounced,
    cleanUpMessage,
    eventSource,
    event_types,
    extractMessageFromData,
    getRequestHeaders,
    messageFormatting,
    name1,
    substituteParams,
} from '/script.js';

import {
    promptManager,
} from '/scripts/openai.js';

import { createStorageController, niEscAttr, niEscHtml } from './lib/storage-system.js';

import {
    bytesToVecs,
    cosineSim,
    createEmbeddingClient,
    createVectorController,
    createVectorRecallService,
    isVectorRowCompatible,
    niBuildTbLightRecallContext,
    niBuildWeightedVectorQueries,
    niSelectRecentVectorMessageTexts,
    splitText,
    vecToBuffer,
    vecToBytes,
} from './lib/vector-system.js';

import {
    NI_DEV_CURRENT_TEXT_LIMIT,
    NI_DEV_RECALL_TEXT_LIMIT,
    captureCharacterMemory,
    capturePlotCheckpointMemory,
    getAllPlotsInStoryOrder,
    getAssignedStagesForChunk,
    mergeCharacterAliases,
    mergeCharacters,
    niComparePlotOrder,
    niBuildDeviationGuideFromSections,
    niBuildDeviationSectionsFromAnalysis,
    niBuildDevChatEntriesText,
    niDevIsCountableMessage,
    niDevMessageFloor,
    niDevMessageMesId,
    niDevMessageRole,
    niDevMessageText,
    niDevRangeLabel,
    niDevRangeProgressLabel,
    niEnsurePlotNodeId,
    niFiniteNumber,
    niHashShort,
    niMergeDeviationSections,
    niMergeDevMessagesByFloor,
    niMergeStageNodes,
    niNormalizeDeviationSections,
    niNormalizeDevRange,
    niNormalizeIncomingPlots,
    niParseDeviationGuideSections,
    niPlotChunkIdx,
    niPlotChunkOrder,
    niPlotManualOrder,
    niSortPlotsByStoryOrder,
    niPlotTypeRank,
    normalizePlotCollections,
    rebuildStageMapFromPlotStageIdx,
    restoreCharacterMemory,
    restorePlotCheckpointMemory,
    createStoryController,
} from './lib/story-data.js';

import {
    buildRechunkLayout,
    canUseDerivedModules,
    createCleaningController,
} from './lib/cleaning-system.js';

import {
    PersistedRateQueue,
    concurrencyLimit,
    createChatCompletionResponseTools,
    createGlobalPromptTools,
    createNovelApiClient,
    createTavernPresetMessageTools,
    DynamicSemaphore,
    niApplyModelListToControls,
    niLoadModelList,
    niNormalizeGlobalPromptSource,
    runWithSemaphore,
} from './lib/api-system.js';

import { createTransbookController } from './lib/transbook-system.js';

import {
    createGenerationController,
    niBuildWorldInjectionText,
} from './lib/world-system.js';

import {
    CLEAN_PROMPT,
    DEV_PROMPT,
    GLOBAL_PROMPT,
    GLOBAL_TAIL_PROMPT,
    ROLEPLAY_PROMPT,
    ROLEPLAY_PROMPT_EVENT_HISTORY_LINE,
    ROLEPLAY_PROMPT_LEGACY_USER_EVENT_RULE,
    ROLEPLAY_PROMPT_USER_ROLE_LINES_TO_REMOVE,
    STYLE_PROMPT,
    TAVERN_TASK_FINAL_OVERRIDE_PROMPT,
    TAVERN_TASK_SWITCH_PROMPT,
    TB_DEFAULT_ADVANCE_PROMPT,
    TB_DEFAULT_IMMERSION_PROMPT,
    TB_DEFAULT_INFER_PROMPT,
    TB_DEFAULT_ONGOING_PROMPT,
    TB_DEFAULT_OPENING_PROMPT,
    TB_LEGACY_ADVANCE_PROMPT,
    TB_LEGACY_ONGOING_PROMPT,
    TB_LEGACY_OPENING_PROMPT,
    USER_SUB_BOUNDARY_PROMPT,
    WORLD_DEFAULT_CATEGORIES,
    WORLD_EXTRACT_PROMPT,
    WORLD_LENGTH_RETRIES,
    WORLD_RESPONSE_LENGTH,
    WORLD_SHRINK_PROMPT,
} from './lib/prompts.js';

import {
    NI_THEME_DEFAULT,
    createThemeEditor,
    niApplyStatusbarTheme,
} from './lib/ui-system.js';

// ============================================================
// 常量
// ============================================================
const EXT_NAME = 'novel-injector';
const NI_UPLOAD_ACCEPT = '.txt,.mobi';
const NI_UPLOAD_LABEL = '点击上传 .txt / .mobi 文件';
const NI_UPLOAD_HINT = '支持 .txt / .mobi，将按设定大小自动分段';
// 通过 Error stack trace 获取当前模块的实际路径
function _detectExtFolder() {
    try {
        const stack = new Error().stack || '';
        // 匹配形如 extensions/third-party/xxx/index.js 的路径
        const m = stack.match(/extensions\/([^/]+\/[^/]+)\/index\.js/);
        if (m) return m[1];
    } catch (_) {}
    return `third-party/${EXT_NAME}`;
}
const EXT_FOLDER = _detectExtFolder();
const DB_NAME = 'NovelInjectorVectors';
const DB_VERSION = 2;
const DB_STORE = 'chunks';
const DEFAULT_SETTINGS = {
    cleanKey: '',
    cleanUrl: 'https://api.openai.com/v1/chat/completions',
    cleanModel: 'gpt-4o',
    cleanStream: false,
    vecKey: '',
    vecUrl: 'https://api.openai.com/v1',
    vecModel: 'text-embedding-3-large',
    // 向量块注入设置
    injDepth: 4,
    vecInjPos: 1,   // 0=主提示后 1=聊天内 2=主提示前
    vecInjRole: 0,  // 0=system 1=user 2=assistant
    recallTopK: 3,
    recallThresh: 0.5,
    vecMsgTag: '',       // 消息内容标签，留空=完整消息，有值则只提取该标签内文字
    vecMsgCount: 3,      // 召回时取近几条消息
    // 角色人设注入设置
    charInjPos: 2,   // 默认主提示前，人设通常放靠前
    charInjDepth: 4,
    charInjRole: 0,
    charAutoSleepEnabled: true, // 开启阶段时自动休眠本阶段正文未出现的角色人设
    // 阶段剧情注入设置
    plotInjPos: 1,   // 默认聊天内
    plotInjDepth: 4,
    plotInjRole: 0,
    // 偏差注入设置
    devPrompt: DEV_PROMPT,
    devInjPos: 2,    // 默认主提示前，作为分支现实约束
    devInjDepth: 0,
    devInjRole: 0,
    devAutoUpdateEnabled: false,
    devAutoUpdateEvery: 10,
    devManualMsgCount: 10,
    rawInjMode: "nodes",  // "nodes"=剧情节点 | "compressed"=压缩原文
    globalPromptSource: 'builtin', // builtin=内置提示词 tavern=跟随酒馆主预设 none=不使用
    globalPrompt: GLOBAL_PROMPT,
    globalTailPrompt: GLOBAL_TAIL_PROMPT,
    globalHeadInjPos: 2,
    globalHeadInjDepth: 0,
    globalHeadInjRole: 0,
    globalTailInjPos: 1,
    globalTailInjDepth: 0,
    globalTailInjRole: 0,
    chunkKb: 100,
    apiTimeoutMin: 15,  // 每段 API 请求超时时间
    apiRateLimit: 3,    // 每分钟最多请求次数
    apiConcurrency: 1,  // 清洗、阶段概括和角色 AI 人设共用的最大并发请求数；0按串行兼容
    vecRateLimit: 3,    // 向量化每分钟最多请求次数
    vecConcurrency: 1,  // 1=串行；>1=最大并发请求数；0按串行兼容
    pluginEnabled: true,  // 插件总开关
    topbarIconVisible: true, // 酒馆顶部栏图标显示开关
    themePreset: 'default',
    themePrimary: NI_THEME_DEFAULT.primary,
    themeSuccess: NI_THEME_DEFAULT.success,
    themePivot: NI_THEME_DEFAULT.pivot,
    themeWarning: NI_THEME_DEFAULT.warning,
    themeSurfaceFollowPreset: true,
    themeBorderless: false,
    themeCardless: false,
    themeStatusbarFollow: false,
    themeIconReplace: false,
    themeBackground: NI_THEME_DEFAULT.background,
    themeText: NI_THEME_DEFAULT.text,
    themeUserPresets: [],
    themePresetOverrides: {},
    themeDeletedPresetIds: [],
    vecInjDisabled: false, // 有向量数据但用户选择不调用向量注入
    tbRestoreAfterPluginEnable: false,
    novelLibrary: [],     // 小说快照库 [{name, key, snapshot}]
    // 世界设定注入设置
    worldInjPos:   2,   // 默认主提示前
    worldInjDepth: 4,
    worldInjRole:  0,
    // 文风注入设置
    styleInjPos:    2,
    styleInjDepth:  4,
    styleInjRole:   0,
    styleSampleLen: 1000,
    styleChunkIdx:  0,
    styleMode:      'sample', // 'sample' | 'manual'
    userSubEnabled: false,
    userSubMode: 'replace', // 'replace'=替换原角人生 | 'play'=扮演原角本人
    userSubCharIdx: '',
    userSubAliases: [],
    userSubPromptReplace: null,
    userSubPromptPlay: null,
    userSubBoundaryPrompt: USER_SUB_BOUNDARY_PROMPT,
};

// ============================================================
// 运行时状态
// ============================================================
const S = {
    // 文件
    rawText: '',
    rawFileSize: 0,
    chunks: [],           // string[]
    chunkStatus: [],      // 'pending' | 'running' | 'done' | 'error'
    chunkResults: [],     // string[] — 清洗后的压缩文本
    chunkMeta: [],        // object[] — 每段原始 meta，用于续跑重建
    fileLoaded: false,
    fileFingerprint: '',  // 文件内容 SHA-256，避免仅凭文件名复用旧数据
    chunkKbUsed: 0,       // 当前清洗/分段数据对应的 KB 配置

    // 清洗
    cleanRunning: false,
    cleanDone: false,
    kbTimer: null,
    skipCurrentChunk: false,   // 用户点击"跳过本段"时置 true
    stopClean: false,          // 用户点击"暂停"时置 true

    // 结构化数据
    characters: [],       // {name, role, bio}[]
    plots: {              // main/sub/pivot
        main: [],
        sub: [],
        pivot: [],
    },

    // 阶段
    stageStates: {},      // {[stageIdx]: boolean} — 是否参与向量召回
    stageSummaries: {},   // {[stageIdx]: string} — 概括
    stageTitles: {},      // {[stageIdx]: string} — 阶段标题
    stageMap: {},         // {[chunkIdx]: stageIdx} 用户手动划分的 chunk->阶段 映射
    stageMapN: 0,         // 用户划分的阶段总数

    // 向量
    vecDone: false,
    stageVecDone: {},     // {[stageIdx]: boolean} — 各阶段是否已向量化
    stageVecExpected: {}, // {[stageIdx]: number} — 各阶段完整向量块数
    db: null,
    novelKey: '',         // IndexedDB 隔离 key，基于文件名
    heavyFileKey: '',     // 服务端重数据文件 key，基于用户快照名

    // 世界设定
    worldCategories: null,  // [{id, label, enabled, content}] — null 表示使用默认

    // 文风
    styleGuide: '',         // 生成的文风执行指南文本
    deviationGuide: '',     // 当前偏差注入文本
    devChangedFacts: '',     // 已改变事实：长期分支事实锚点
    devCurrentConstraint: '',// 当前偏差约束：每次偏差更新后替换
    devPreservedFacts: '',   // 仍保留的原著事实：每次偏差更新后替换
    devRunning: false,
    devAutoLastFloor: null,
    devCoveredFloor: 0,     // 当前偏差已顺序总结到第几楼
    devLastRange: null,     // 最近一次偏差分析范围，供重试复用

    // 注入
};

async function niFingerprintArrayBuffer(buffer) {
    const bytes = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function niResetChunkDerivedState() {
    S.chunkStatus = S.chunks.map(() => 'pending');
    S.chunkResults = S.chunks.map(() => '');
    S.chunkMeta = [];
    S.cleanRunning = false;
    S.cleanDone = false;
    S.stopClean = false;
    S.skipCurrentChunk = false;
    S.characters = [];
    S.plots = { main: [], sub: [], pivot: [] };
    niResetStageVectorState();
}

function niResetStageVectorState() {
    S.stageStates = {};
    S.stageSummaries = {};
    S.stageTitles = {};
    S.stageMap = {};
    S.stageMapN = 0;
    S.chunkStageMap = null;
    S.vecDone = false;
    S.stageVecDone = {};
    S.stageVecExpected = {};
}

function niRechunkPreservingCompleted(kb) {
    const oldChunkStageMap = S.chunkStageMap;
    const layout = buildRechunkLayout({
        chunks: S.chunks,
        status: S.chunkStatus,
        results: S.chunkResults,
        meta: S.chunkMeta,
        kb,
        charsPerByte: S._charsPerByte || 0.5,
    });
    const { chunks, status, results, meta, preserved, pending, oldToNewChunkIdx } = layout;

    S.chunks = chunks;
    S.chunkStatus = status;
    S.chunkResults = results;
    S.chunkMeta = meta;
    S.cleanRunning = false;
    S.cleanDone = status.length > 0 && status.every(value => value === 'done');
    S.stopClean = false;
    S.skipCurrentChunk = false;

    ['main', 'sub', 'pivot'].forEach(type => {
        (S.plots[type] || []).forEach((plot, index) => {
            const oldChunkIdx = niPlotChunkIdx(plot, -1);
            if (!oldToNewChunkIdx.has(oldChunkIdx)) return;
            const oldId = niEnsurePlotNodeId(plot, type, index);
            const newChunkIdx = oldToNewChunkIdx.get(oldChunkIdx);
            const idParts = String(oldId).split(':');
            if (idParts.length >= 4 && Number(idParts[1]) === oldChunkIdx) {
                idParts[1] = String(newChunkIdx);
                plot._nodeId = idParts.join(':');
            }
            plot._chunkIdx = newChunkIdx;
        });
    });
    (S.characters || []).forEach(character => {
        const oldChunkIdx = Number(character?._firstChunkIdx);
        if (Number.isFinite(oldChunkIdx) && oldToNewChunkIdx.has(oldChunkIdx)) {
            character._firstChunkIdx = oldToNewChunkIdx.get(oldChunkIdx);
            delete character._characterId;
        }
        (character?.aliases || []).forEach(alias => {
            const aliasChunkIdx = Number(alias?._chunkIdx);
            if (Number.isFinite(aliasChunkIdx) && oldToNewChunkIdx.has(aliasChunkIdx)) {
                alias._chunkIdx = oldToNewChunkIdx.get(aliasChunkIdx);
            }
        });
    });
    const remappedPlotMemory = capturePlotCheckpointMemory(S);
    const remappedCharacterMemory = captureCharacterMemory(S);

    const remappedChunkStageMap = {};
    if (oldChunkStageMap) {
        Object.entries(oldChunkStageMap).forEach(([oldChunkIdx, stages]) => {
            const oldIdx = Number(oldChunkIdx);
            if (!oldToNewChunkIdx.has(oldIdx)) return;
            const values = stages instanceof Set ? [...stages] : (Array.isArray(stages) ? stages : []);
            remappedChunkStageMap[oldToNewChunkIdx.get(oldIdx)] = new Set(values.map(Number));
        });
    }
    S.chunkStageMap = Object.keys(remappedChunkStageMap).length ? remappedChunkStageMap : null;
    niRebuildStructuredDataFromChunks(remappedPlotMemory, remappedCharacterMemory);
    return {
        preserved,
        pending,
        oldToNewChunkIdx,
    };
}

function niResetNovelWorkspace() {
    S.rawText = '';
    S.rawFileSize = 0;
    S.chunks = [];
    S.fileLoaded = false;
    S.fileFingerprint = '';
    S.chunkKbUsed = 0;
    niResetChunkDerivedState();
    S.novelKey = '';
    S.heavyFileKey = '';
    S.worldCategories = null;
    S.styleGuide = '';
}

// ============================================================
// IndexedDB 封装
// ============================================================

// --- fingerprint：标识当前 embedding 引擎，换模型时自动失效旧向量 ---
function niUpgradeRoleplayPrompt(cfg = extension_settings[EXT_NAME] || {}) {
    if (!cfg || typeof cfg.roleplayPrompt !== 'string') return false;
    let nextPrompt = cfg.roleplayPrompt;
    nextPrompt = nextPrompt.replaceAll(
        ROLEPLAY_PROMPT_LEGACY_USER_EVENT_RULE,
        ROLEPLAY_PROMPT_EVENT_HISTORY_LINE,
    );
    ROLEPLAY_PROMPT_USER_ROLE_LINES_TO_REMOVE.forEach(line => {
        nextPrompt = nextPrompt.replaceAll(line, '').replace(/\n{3,}/g, '\n\n');
    });
    if (nextPrompt === cfg.roleplayPrompt) return false;
    cfg.roleplayPrompt = nextPrompt;
    return true;
}

function niLoadSettings() {
    extension_settings[EXT_NAME] = extension_settings[EXT_NAME] || {};
    const saved = extension_settings[EXT_NAME];
    if (Object.prototype.hasOwnProperty.call(saved, 'styleInjEnabled')) {
        delete saved.styleInjEnabled;
        saveSettingsDebounced();
    }
    Object.keys(DEFAULT_SETTINGS).forEach(k => {
        if (saved[k] === undefined) saved[k] = DEFAULT_SETTINGS[k];
    });
    if (saved._charAutoSleepInitialized !== true) {
        saved.charAutoSleepEnabled = true;
        saved._charAutoSleepInitialized = true;
        saveSettingsDebounced();
    }
    niUpgradeLegacyTbDefaultPrompts(saved);
    if (niUpgradeRoleplayPrompt(saved)) saveSettingsDebounced();

    // 还原轻量索引
    if (saved._stageStates) S.stageStates = saved._stageStates;
    if (saved._stageSummaries) S.stageSummaries = saved._stageSummaries;
    if (saved._stageTitles) S.stageTitles = saved._stageTitles;
    if (saved._novelKey) S.novelKey = saved._novelKey;
    if (saved._heavyFileKey) S.heavyFileKey = saved._heavyFileKey;
    if (saved._fileFingerprint) S.fileFingerprint = saved._fileFingerprint;
    if (saved._chunkKbUsed != null) S.chunkKbUsed = Number(saved._chunkKbUsed) || 0;
    if (saved._vecDone) S.vecDone = saved._vecDone;
    if (saved._stageVecDone) {
        S.stageVecDone = {};
        Object.entries(saved._stageVecDone).forEach(([k, v]) => {
            S.stageVecDone[Number(k)] = v;
        });
    }
    if (saved._stageVecExpected) {
        S.stageVecExpected = {};
        Object.entries(saved._stageVecExpected).forEach(([k, v]) => {
            const count = Math.max(0, parseInt(v, 10) || 0);
            if (count > 0) S.stageVecExpected[Number(k)] = count;
        });
    }
    if (saved._cleanDone != null) S.cleanDone = saved._cleanDone;
    if (saved._stageMap) S.stageMap = saved._stageMap;
    if (saved._stageMapN != null) S.stageMapN = saved._stageMapN;
    if (saved._chunkStageMap) {
        // 反序列化：value 从 Array 还原为 Set
        S.chunkStageMap = {};
        Object.entries(saved._chunkStageMap).forEach(([k, v]) => {
            S.chunkStageMap[k] = new Set(v);
        });
    }
    if (saved._worldCategories) {
        S.worldCategories = saved._worldCategories;
    }
    // 同步插件开关 UI
    niSyncPluginToggleUI();

    // 加载后用 stageMap 重新同步所有 plot 的 stageIdx
    // stageMap key = main/pivot 数组下标
    // 同时补全 _chunkIdx 映射，确保角色 _firstChunkIdx 能命中
    if (S.stageMapN > 0 && Object.keys(S.stageMap).length > 0) {
        const mainArr2 = S.plots.main || [];
        const pivotArr2 = S.plots.pivot || [];
        mainArr2.forEach((plot, i) => {
            const mapped = S.stageMap[i] ?? S.stageMap[String(i)];
            if (mapped !== undefined && plot.stageIdx == null) {
                plot.stageIdx = mapped; plot.stageLabel = `第 ${mapped} 阶段`;
            }
        });
        pivotArr2.forEach((plot, i) => {
            const ci = mainArr2.length + i;
            const mapped = S.stageMap[ci] ?? S.stageMap[String(ci)];
            if (mapped !== undefined && plot.stageIdx == null) {
                plot.stageIdx = mapped; plot.stageLabel = `第 ${mapped} 阶段`;
            }
        });
        const subArr2 = S.plots.sub || [];
        subArr2.forEach(plot => {
            const mapped = niResolveSubPlotStageIdx(plot);
            if (mapped !== null && plot.stageIdx == null) { plot.stageIdx = mapped; plot.stageLabel = `第 ${mapped} 阶段`; }
        });
        niSyncSubPlotStageAssignments();
    }

    syncSettingsToUI();
    niLoadDeviationStateFromChat({ allowLegacyMigration: true, collapsed: true });

    // 启动时从服务端拉取重数据
    if (S.novelKey) {
        niServerLoadHeavy(S.novelKey, S.heavyFileKey, { chunks: false }).then(ok => {
            if (!ok) return;
            // 重数据已还原，刷新需要它的 UI
            if (canUseDerivedModules(S)) {
                if (S.chunkStatus.length) {
                    q('#ni-chunk-info') && (q('#ni-chunk-info').style.display = 'block');
                    q('#ni-st-chunks') && (q('#ni-st-chunks').textContent = S.chunkStatus.length);
                    renderChunkList();
                }
                niSyncCleanButtonState();
                renderPlots(); renderCharacters(); buildStages(); niRenderWorldSettings();
            }
            // Bug修复④：启动拉取重数据后刷新文风 UI
            {
                const resEl = q('#ni-style-result');
                if (resEl) resEl.value = S.styleGuide || '';
                const wrap = q('#ni-style-result-wrap');
                if (wrap) wrap.style.display = S.styleGuide ? 'block' : 'none';
                niSyncDeviationResultUI({ collapsed: true });
            }
        }).catch(e => console.warn('[NI] 启动拉取重数据失败:', e));
    }

    // 从 IndexedDB 反查真实向量状态，避免轻量设置里的 vecDone 与本机向量库不一致
    if (S.novelKey) {
        niReconcileVecStateFromDb().then(changed => {
            if (changed || S.stageMapN > 0) {
                buildStages();
                niSaveSettings();
            }
        }).catch(() => {});
    }
}


// ============================================================
// 服务端文件存储
// 文件名格式：
// ni_<用户快照名拼音>_<随机key>_core.json
// ni_<用户快照名拼音>_<随机key>_chunks.json
// 写：POST /api/files/upload body={name, data}
// 读：GET /user/files/<name>
// 删：POST /api/files/delete body={path:"user/files/<name>"}
// ============================================================

function niSaveSettings() {
    const cfg = extension_settings[EXT_NAME];
    cfg.cleanKey    = q('#ni-clean-key')?.value || cfg.cleanKey;
    cfg.cleanUrl    = q('#ni-clean-url')?.value || cfg.cleanUrl;
    cfg.cleanModel  = q('#ni-clean-model')?.value || cfg.cleanModel;
    cfg.cleanStream = q('#ni-clean-stream')?.checked ?? cfg.cleanStream;
    cfg.vecKey      = q('#ni-vec-key')?.value || cfg.vecKey;
    cfg.vecUrl      = q('#ni-vec-url')?.value || cfg.vecUrl;
    cfg.vecModel    = q('#ni-vec-model')?.value || cfg.vecModel;
    cfg.injDepth    = parseInt(q('#ni-inj-depth')?.value) || DEFAULT_SETTINGS.injDepth;
    cfg.vecInjPos   = parseInt(q('#ni-vec-inj-pos')?.value) ?? DEFAULT_SETTINGS.vecInjPos;
    cfg.vecInjRole  = parseInt(q('#ni-vec-inj-role')?.value) ?? DEFAULT_SETTINGS.vecInjRole;
    cfg.recallTopK  = parseInt(q('#ni-recall-topk')?.value) || DEFAULT_SETTINGS.recallTopK;
    cfg.recallThresh= parseFloat(q('#ni-recall-thresh')?.value) ?? DEFAULT_SETTINGS.recallThresh;
    cfg.vecMsgTag   = (q('#ni-vec-msg-tag')?.value || '').trim();
    cfg.vecMsgCount = parseInt(q('#ni-vec-msg-count')?.value) || DEFAULT_SETTINGS.vecMsgCount;
    cfg.charInjPos  = parseInt(q('#ni-char-inj-pos')?.value) ?? DEFAULT_SETTINGS.charInjPos;
    cfg.charInjDepth= parseInt(q('#ni-char-inj-depth')?.value) ?? DEFAULT_SETTINGS.charInjDepth;
    cfg.charInjRole = parseInt(q('#ni-char-inj-role')?.value) ?? DEFAULT_SETTINGS.charInjRole;
    cfg.charAutoSleepEnabled = q('#ni-char-auto-sleep-btn')
        ? q('#ni-char-auto-sleep-btn').classList.contains('on')
        : (cfg.charAutoSleepEnabled ?? DEFAULT_SETTINGS.charAutoSleepEnabled);
    cfg.plotInjPos  = parseInt(q('#ni-plot-inj-pos')?.value) ?? DEFAULT_SETTINGS.plotInjPos;
    cfg.plotInjDepth= parseInt(q('#ni-plot-inj-depth')?.value) ?? DEFAULT_SETTINGS.plotInjDepth;
    cfg.plotInjRole = parseInt(q('#ni-plot-inj-role')?.value) ?? DEFAULT_SETTINGS.plotInjRole;
    cfg.devPrompt   = q('#ni-dev-pt-content')?.value || cfg.devPrompt || DEFAULT_SETTINGS.devPrompt;
    cfg.devInjPos   = niCfgInt('#ni-dev-inj-pos', DEFAULT_SETTINGS.devInjPos);
    cfg.devInjDepth = niCfgInt('#ni-dev-inj-depth', DEFAULT_SETTINGS.devInjDepth);
    cfg.devInjRole  = niCfgInt('#ni-dev-inj-role', DEFAULT_SETTINGS.devInjRole);
    cfg.devAutoUpdateEnabled = q('#ni-dev-auto-enabled')?.checked ?? (cfg.devAutoUpdateEnabled ?? DEFAULT_SETTINGS.devAutoUpdateEnabled);
    cfg.devAutoUpdateEvery = niCfgBoundInt('#ni-dev-auto-every', DEFAULT_SETTINGS.devAutoUpdateEvery, 1, 9999);
    cfg.devManualMsgCount = niCfgBoundInt('#ni-dev-manual-msg-count', DEFAULT_SETTINGS.devManualMsgCount, 1, 200);
    cfg.rawInjMode  = q('#ni-raw-inj-mode')?.value ?? DEFAULT_SETTINGS.rawInjMode;
    cfg.chunkKb     = parseInt(q('#ni-chunk-kb')?.value) || DEFAULT_SETTINGS.chunkKb;
    cfg.customPrompt    = q('#ni-pt-content')?.value || CLEAN_PROMPT;
    cfg.roleplayPrompt  = q('#ni-stage-pt-content')?.value || extension_settings[EXT_NAME]?.roleplayPrompt || ROLEPLAY_PROMPT;
    cfg.roleplayEnabled = q('#ni-stage-pt-enabled')?.checked ?? (extension_settings[EXT_NAME]?.roleplayEnabled !== false);
    if (q('#ni-global-source-tavern')?.checked) {
        cfg.globalPromptSource = 'tavern';
    } else if (q('#ni-global-source-builtin')?.checked) {
        cfg.globalPromptSource = 'builtin';
    } else if (q('#ni-global-source-none')?.checked) {
        cfg.globalPromptSource = 'none';
    } else {
        cfg.globalPromptSource = niNormalizeGlobalPromptSource(cfg.globalPromptSource);
    }
    const _gp = q('#ni-global-pt-content')?.value;
    cfg.globalPrompt = (_gp && _gp.trim()) ? _gp : (extension_settings[EXT_NAME]?.globalPrompt ?? GLOBAL_PROMPT);
    cfg.globalTailPrompt = q('#ni-global-tail-pt-content')?.value ?? (extension_settings[EXT_NAME]?.globalTailPrompt ?? GLOBAL_TAIL_PROMPT);
    cfg.globalHeadInjPos = niCfgInt('#ni-global-head-inj-pos', DEFAULT_SETTINGS.globalHeadInjPos);
    cfg.globalHeadInjDepth = niCfgInt('#ni-global-head-inj-depth', DEFAULT_SETTINGS.globalHeadInjDepth);
    cfg.globalHeadInjRole = niCfgInt('#ni-global-head-inj-role', DEFAULT_SETTINGS.globalHeadInjRole);
    cfg.globalTailInjPos = niCfgInt('#ni-global-tail-inj-pos', DEFAULT_SETTINGS.globalTailInjPos);
    cfg.globalTailInjDepth = niCfgInt('#ni-global-tail-inj-depth', DEFAULT_SETTINGS.globalTailInjDepth);
    cfg.globalTailInjRole = niCfgInt('#ni-global-tail-inj-role', DEFAULT_SETTINGS.globalTailInjRole);
    cfg.apiTimeoutMin = Math.max(1, parseInt(q('#ni-api-timeout')?.value) || DEFAULT_SETTINGS.apiTimeoutMin);
    cfg.apiRateLimit  = Math.max(0, parseInt(q('#ni-rate-limit')?.value) ?? DEFAULT_SETTINGS.apiRateLimit);
    cfg.apiConcurrency = niCfgBoundInt('#ni-api-concurrency', DEFAULT_SETTINGS.apiConcurrency, 0, 99);
    cfg.vecRateLimit  = Math.max(0, parseInt(q('#ni-vec-rate-limit')?.value) ?? DEFAULT_SETTINGS.vecRateLimit);
    cfg.vecConcurrency = niCfgBoundInt('#ni-vec-concurrency', DEFAULT_SETTINGS.vecConcurrency, 0, 99);
    // 持久化运行时数据
    cfg._stageStates   = S.stageStates;
    cfg._stageSummaries= S.stageSummaries;
    cfg._stageTitles   = S.stageTitles;
    cfg._novelKey      = S.novelKey;
    cfg._heavyFileKey  = S.heavyFileKey;
    cfg._fileFingerprint = S.fileFingerprint;
    cfg._chunkKbUsed   = S.chunkKbUsed;
    cfg._vecDone       = S.vecDone;
    cfg._stageVecDone  = S.stageVecDone;
    cfg._stageVecExpected = S.stageVecExpected;
    cfg._cleanDone     = S.cleanDone;
    cfg._stageMap      = S.stageMap;
    cfg._stageMapN     = S.stageMapN;
    // 序列化 chunkStageMap
    if (S.chunkStageMap) {
        cfg._chunkStageMap = {};
        Object.entries(S.chunkStageMap).forEach(([k, v]) => {
            cfg._chunkStageMap[k] = [...v];
        });
    }
    cfg._worldCategories = niGetWorldCategories();
    niClearLegacyDeviationSettings();
    cfg.worldInjPos   = parseInt(q('#ni-world-inj-pos')?.value)   ?? DEFAULT_SETTINGS.worldInjPos;
    cfg.worldInjDepth = parseInt(q('#ni-world-inj-depth')?.value)  ?? DEFAULT_SETTINGS.worldInjDepth;
    cfg.worldInjRole  = parseInt(q('#ni-world-inj-role')?.value)   ?? DEFAULT_SETTINGS.worldInjRole;

    // 文风设置
    cfg.styleInjPos   = parseInt(q('#ni-style-inj-pos2')?.value)   ?? DEFAULT_SETTINGS.styleInjPos;
    cfg.styleInjDepth = parseInt(q('#ni-style-inj-depth2')?.value)  ?? DEFAULT_SETTINGS.styleInjDepth;
    cfg.styleInjRole  = parseInt(q('#ni-style-inj-role2')?.value)   ?? DEFAULT_SETTINGS.styleInjRole;
    cfg.styleSampleLen= parseInt(q('#ni-style-sample-len')?.value) || DEFAULT_SETTINGS.styleSampleLen;
    cfg.styleChunkIdx = parseInt(q('#ni-style-chunk-sel')?.value)  || 0;
    cfg.styleMode     = q('#ni-style-mode')?.value                 ?? DEFAULT_SETTINGS.styleMode;
    cfg.userSubEnabled = q('#ni-user-sub-chk')?.checked ?? (cfg.userSubEnabled ?? DEFAULT_SETTINGS.userSubEnabled);
    cfg.userSubMode = niNormalizeUserSubMode(q('#ni-user-sub-mode .ni-user-sub-mode-btn.on')?.dataset.userSubMode ?? cfg.userSubMode);
    cfg.userSubCharIdx = q('#ni-user-sub-char')?.value ?? (cfg.userSubCharIdx ?? DEFAULT_SETTINGS.userSubCharIdx);
    if (q('#ni-user-sub-list .ni-user-sub-row')) cfg.userSubAliases = niReadUserSubAliasesFromUI();

    saveSettingsDebounced();
}

function syncSettingsToUI() {
    const cfg = extension_settings[EXT_NAME] || {};
    sv('#ni-clean-key',    cfg.cleanKey    || '');
    sv('#ni-clean-url',    cfg.cleanUrl    || DEFAULT_SETTINGS.cleanUrl);
    sv('#ni-clean-model',  cfg.cleanModel  || DEFAULT_SETTINGS.cleanModel);
    const streamEl = q('#ni-clean-stream');
    if (streamEl) {
        streamEl.checked = cfg.cleanStream ?? DEFAULT_SETTINGS.cleanStream;
        const pill = q('#ni-stream-pill');
        if (pill) pill.textContent = streamEl.checked ? '开' : '关';
    }
    sv('#ni-vec-key',      cfg.vecKey      || '');
    sv('#ni-vec-url',      cfg.vecUrl      || DEFAULT_SETTINGS.vecUrl);
    sv('#ni-vec-model',    cfg.vecModel    || DEFAULT_SETTINGS.vecModel);
    sv('#ni-inj-depth',    cfg.injDepth    ?? DEFAULT_SETTINGS.injDepth);
    sv('#ni-vec-inj-pos',  cfg.vecInjPos   ?? DEFAULT_SETTINGS.vecInjPos);
    sv('#ni-vec-inj-role', cfg.vecInjRole  ?? DEFAULT_SETTINGS.vecInjRole);
    sv('#ni-recall-topk',  cfg.recallTopK  ?? DEFAULT_SETTINGS.recallTopK);
    sv('#ni-recall-thresh',cfg.recallThresh?? DEFAULT_SETTINGS.recallThresh);
    sv('#ni-vec-msg-tag',  cfg.vecMsgTag   ?? DEFAULT_SETTINGS.vecMsgTag);
    sv('#ni-vec-msg-count', cfg.vecMsgCount ?? DEFAULT_SETTINGS.vecMsgCount);
    sv('#ni-char-inj-pos', cfg.charInjPos  ?? DEFAULT_SETTINGS.charInjPos);
    sv('#ni-char-inj-depth',cfg.charInjDepth?? DEFAULT_SETTINGS.charInjDepth);
    sv('#ni-char-inj-role',cfg.charInjRole ?? DEFAULT_SETTINGS.charInjRole);
    niSyncCharAutoSleepUI();
    sv('#ni-plot-inj-pos', cfg.plotInjPos  ?? DEFAULT_SETTINGS.plotInjPos);
    sv('#ni-plot-inj-depth',cfg.plotInjDepth?? DEFAULT_SETTINGS.plotInjDepth);
    sv('#ni-plot-inj-role',cfg.plotInjRole ?? DEFAULT_SETTINGS.plotInjRole);
    sv('#ni-dev-inj-pos', cfg.devInjPos  ?? DEFAULT_SETTINGS.devInjPos);
    sv('#ni-dev-inj-depth',cfg.devInjDepth?? DEFAULT_SETTINGS.devInjDepth);
    sv('#ni-dev-inj-role',cfg.devInjRole ?? DEFAULT_SETTINGS.devInjRole);
    sv('#ni-dev-auto-every', niBoundIntValue(cfg.devAutoUpdateEvery, DEFAULT_SETTINGS.devAutoUpdateEvery, 1, 9999));
    sv('#ni-dev-manual-msg-count', cfg.devManualMsgCount ?? DEFAULT_SETTINGS.devManualMsgCount);
    const devAutoEl = q('#ni-dev-auto-enabled');
    if (devAutoEl) devAutoEl.checked = !!(cfg.devAutoUpdateEnabled ?? DEFAULT_SETTINGS.devAutoUpdateEnabled);
    niSyncDevAutoUI();
    sv('#ni-raw-inj-mode', cfg.rawInjMode  ?? DEFAULT_SETTINGS.rawInjMode);
    sv('#ni-global-head-inj-pos', cfg.globalHeadInjPos ?? DEFAULT_SETTINGS.globalHeadInjPos);
    sv('#ni-global-head-inj-depth', cfg.globalHeadInjDepth ?? DEFAULT_SETTINGS.globalHeadInjDepth);
    sv('#ni-global-head-inj-role', cfg.globalHeadInjRole ?? DEFAULT_SETTINGS.globalHeadInjRole);
    sv('#ni-global-tail-inj-pos', cfg.globalTailInjPos ?? DEFAULT_SETTINGS.globalTailInjPos);
    sv('#ni-global-tail-inj-depth', cfg.globalTailInjDepth ?? DEFAULT_SETTINGS.globalTailInjDepth);
    sv('#ni-global-tail-inj-role', cfg.globalTailInjRole ?? DEFAULT_SETTINGS.globalTailInjRole);
    sv('#ni-world-inj-pos',  cfg.worldInjPos   ?? DEFAULT_SETTINGS.worldInjPos);
    sv('#ni-world-inj-depth',cfg.worldInjDepth ?? DEFAULT_SETTINGS.worldInjDepth);
    sv('#ni-world-inj-role', cfg.worldInjRole  ?? DEFAULT_SETTINGS.worldInjRole);
    // 文风设置
    sv('#ni-style-inj-pos2',  cfg.styleInjPos   ?? DEFAULT_SETTINGS.styleInjPos);
    sv('#ni-style-inj-depth2',cfg.styleInjDepth ?? DEFAULT_SETTINGS.styleInjDepth);
    sv('#ni-style-inj-role2', cfg.styleInjRole  ?? DEFAULT_SETTINGS.styleInjRole);
    sv('#ni-style-sample-len',cfg.styleSampleLen ?? DEFAULT_SETTINGS.styleSampleLen);
    sv('#ni-style-mode',      cfg.styleMode      ?? DEFAULT_SETTINGS.styleMode);
    const stylePtEl = q('#ni-style-pt-content');
    if (stylePtEl) stylePtEl.value = cfg.stylePrompt || STYLE_PROMPT;
    const devPtEl = q('#ni-dev-pt-content');
    if (devPtEl) devPtEl.value = cfg.devPrompt || DEFAULT_SETTINGS.devPrompt;
    niSyncDeviationResultUI({ collapsed: true });
    // Bug修复②③：始终刷新文风结果 UI，有内容则显示，无内容则隐藏
    {
        const resEl = q('#ni-style-result');
        if (resEl) resEl.value = S.styleGuide || '';
        const wrap = q('#ni-style-result-wrap');
        if (wrap) wrap.style.display = S.styleGuide ? 'block' : 'none';
    }
    niStyleSyncMode();
    niRenderUserSubUI();
    sv('#ni-chunk-kb',     cfg.chunkKb     ?? DEFAULT_SETTINGS.chunkKb);
    sv('#ni-api-timeout',  cfg.apiTimeoutMin ?? DEFAULT_SETTINGS.apiTimeoutMin);
    sv('#ni-rate-limit',   cfg.apiRateLimit  ?? DEFAULT_SETTINGS.apiRateLimit);
    sv('#ni-api-concurrency', cfg.apiConcurrency ?? DEFAULT_SETTINGS.apiConcurrency);
    sv('#ni-vec-rate-limit', cfg.vecRateLimit ?? DEFAULT_SETTINGS.vecRateLimit);
    sv('#ni-vec-concurrency', cfg.vecConcurrency ?? DEFAULT_SETTINGS.vecConcurrency);
    niSyncThemeUI();
    niApplyCurrentTheme();
    const ptEl = q('#ni-pt-content');
    if (ptEl) ptEl.value = extension_settings[EXT_NAME]?.customPrompt || CLEAN_PROMPT;
    const globalPtEl = q('#ni-global-pt-content');
    if (globalPtEl) globalPtEl.value = cfg.globalPrompt ?? GLOBAL_PROMPT;
    const globalTailPtEl = q('#ni-global-tail-pt-content');
    if (globalTailPtEl) globalTailPtEl.value = cfg.globalTailPrompt ?? GLOBAL_TAIL_PROMPT;
    niSyncGlobalPromptSourceUI(cfg);
    // 修复：初始化时同步渲染小说库，不依赖导航按钮点击
    niRenderNovelLibrary();
    // 同步穿书模式状态文字
    const _tbChk = q('#ni-tb-chk');
    const _tbStateTxt = q('#ni-tb-state');
    if (_tbChk && _tbStateTxt) {
        _tbChk.checked = !!cfg.transBookMode;
        _tbStateTxt.textContent = _tbChk.checked ? '开' : '关';
    }
}

// ============================================================
// DOM 工具
// ============================================================
const q  = sel => document.querySelector(sel);
const qa = sel => document.querySelectorAll(sel);
const sv = (sel, val) => { const el = q(sel); if (el) el.value = val; };
let _niTopbarIconToggleBound = false;
const niCfgInt = (sel, fallback) => {
    const n = parseInt(q(sel)?.value, 10);
    return Number.isFinite(n) ? n : fallback;
};
const niBoundIntValue = (value, fallback, min = 0, max = 9999) => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return fallback;
    return Math.min(max, n);
};
const niCfgBoundInt = (sel, fallback, min = 0, max = 9999) => {
    return niBoundIntValue(q(sel)?.value, fallback, min, max);
};

function niTopbarIconVisible() {
    const cfg = extension_settings[EXT_NAME] || {};
    return (cfg.topbarIconVisible ?? DEFAULT_SETTINGS.topbarIconVisible) !== false;
}

function niCloseTopbarDrawer() {
    const icon = $('#ni_drawer_icon');
    const content = $('#ni_drawer_content');
    if (icon.length) icon.removeClass('openIcon').addClass('closedIcon');
    if (content.length) {
        content.removeClass('openDrawer').addClass('closedDrawer')
            .attr('data-slide-toggle', 'hidden')
            .css('display', 'none');
    }
}

function niSyncExtensionsMenuTopbarToggle() {
    const enabled = niTopbarIconVisible();
    const item = q('#ni-toggle-topbar-icon');
    const icon = q('#ni-toggle-topbar-icon .extensionsMenuExtensionButton');
    const state = q('#ni-toggle-topbar-icon-state');
    if (item) {
        item.classList.toggle('ni-topbar-icon-off', !enabled);
        item.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        item.title = enabled ? '隐藏顶栏图标' : '显示顶栏图标';
    }
    if (icon) icon.className = `fa-fw fa-solid ${enabled ? 'fa-book-open' : 'fa-book'} extensionsMenuExtensionButton`;
    if (state) state.textContent = enabled ? '开' : '关';
}

function niSyncTopbarIconVisibility() {
    const enabled = niTopbarIconVisible();
    const drawer = q('#ni_drawer');
    if (drawer) {
        if (!enabled) {
            niCloseTopbarDrawer();
        } else {
            q('#ni_drawer_content')?.style.removeProperty('display');
        }
        drawer.style.display = enabled ? '' : 'none';
    }
    niSyncExtensionsMenuTopbarToggle();
}

function niEnsureExtensionsMenuTopbarToggle() {
    const menu = q('#extensionsMenu');
    if (!menu) return false;
    let container = q('#ni_topbar_icon_wand_container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'ni_topbar_icon_wand_container';
        container.className = 'extension_container interactable';
        container.tabIndex = 0;
        container.innerHTML = `
<div id="ni-toggle-topbar-icon" class="list-group-item flex-container flexGap5 interactable" title="隐藏顶栏图标" tabindex="0" role="button" aria-pressed="true">
    <div class="fa-fw fa-solid fa-book-open extensionsMenuExtensionButton" aria-hidden="true"></div>
    <span>顶栏图标</span>
    <span id="ni-toggle-topbar-icon-state" class="ni-ext-menu-state">开</span>
</div>`;
        const quickCss = q('#quick-css-ext-button');
        if (quickCss?.parentElement === menu) {
            menu.insertBefore(container, quickCss);
        } else {
            menu.appendChild(container);
        }
    }
    niSyncExtensionsMenuTopbarToggle();
    return true;
}

function niSetTopbarIconVisible(visible) {
    const cfg = extension_settings[EXT_NAME] || {};
    extension_settings[EXT_NAME] = cfg;
    cfg.topbarIconVisible = visible !== false;
    niSyncTopbarIconVisibility();
    saveSettingsDebounced();
}

function niBindTopbarIconToggleHandlers() {
    if (_niTopbarIconToggleBound) return;
    _niTopbarIconToggleBound = true;
    $(document)
        .on('click.niTopbarIconToggle', '#ni-toggle-topbar-icon', function(e) {
            e.preventDefault();
            e.stopPropagation();
            niSetTopbarIconVisible(!niTopbarIconVisible());
        })
        .on('keydown.niTopbarIconToggle', '#ni-toggle-topbar-icon', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            niSetTopbarIconVisible(!niTopbarIconVisible());
        })
        .on('click.niTopbarIconToggle', '#extensionsMenuButton', function() {
            setTimeout(niEnsureExtensionsMenuTopbarToggle, 0);
            setTimeout(niEnsureExtensionsMenuTopbarToggle, 120);
        });
}

function niSyncDevAutoUI({ syncNote = false } = {}) {
    const input = q('#ni-dev-auto-every');
    const row = input?.closest('.ni-dev-auto-row');
    const enabled = !!q('#ni-dev-auto-enabled')?.checked;
    if (input) input.disabled = false;
    if (row) row.hidden = false;
    const noteEl = q('#ni-dev-note');
    if (!noteEl) return;
    if (syncNote) {
        noteEl.textContent = enabled
            ? '自动更新已开启，达到间隔层数后会自动运行。'
            : '自动更新已关闭，间隔层数可调整但不会自动运行。';
        return;
    }
    if (!enabled && /自动更新已开启|正在检查是否需要补跑偏差分析/.test(noteEl.textContent || '')) {
        noteEl.textContent = '自动更新已关闭，间隔层数可调整但不会自动运行。';
    }
}

// ============================================================
// 页面切换
// ============================================================
function niSwitchPage(name, btn) {
    qa('.ni-page').forEach(p => p.classList.remove('on'));
    q(`#ni-pg-${name}`)?.classList.add('on');
    qa('.ni-nav-btn').forEach(b => b.classList.remove('on'));
    btn?.classList.add('on');
    q('#ni-scroll')?.scrollTo(0, 0);
}
window.niSwitchPage = niSwitchPage;
window.niSaveSettings = niSaveSettings;

// ============================================================
// Tab 切换
// ============================================================
function niSwitchTab(name, btn) {
    const tab = ['timeline', 'main', 'sub', 'pivot'].includes(name) ? name : 'timeline';
    niSetCurrentPlotTab(tab);
    // Only switch tabs within the plot tab row
    const plotTabRow = q('#ni-pg-plot .ni-plot-tab-row');
    if (plotTabRow) {
        plotTabRow.querySelectorAll('.ni-tab[data-tab]').forEach(b => b.classList.remove('on'));
        (btn || plotTabRow.querySelector(`.ni-tab[data-tab="${tab}"]`))?.classList.add('on');
    }
    q('#ni-pg-plot')?.querySelectorAll('.ni-tp').forEach(p => p.classList.remove('on'));
    q(`#ni-tp-${tab}`)?.classList.add('on');
    niSyncPlotActionButtons(true);
}
window.niSwitchTab = niSwitchTab;

// ============================================================
// Panel & Prompt 展开
// ============================================================
function niTogglePanel(id, btnId) {
    const p = q(`#${id}`);
    const b = q(`#${btnId}`);
    b?.classList.toggle('active', p?.classList.toggle('on'));
}
window.niTogglePanel = niTogglePanel;

function niToggleDevCfgPanel() {
    const panel = q('#ni-dev-cfg-panel');
    const btn = q('#ni-dev-cfg-btn');
    if (!panel) return;
    const open = panel.hidden || !panel.classList.contains('on');
    panel.hidden = !open;
    panel.style.display = open ? 'grid' : 'none';
    panel.classList.toggle('on', open);
    btn?.classList.toggle('active', open);
}

function niTogglePrompt() {
    const pb = q('#ni-pb');
    const btn = q('#ni-prompt-btn');
    btn?.classList.toggle('active', pb?.classList.toggle('on'));
}
window.niTogglePrompt = niTogglePrompt;


// ============================================================
// 全局提示词面板
// ============================================================
function niToggleGlobalPrompt() {
    const pb  = q('#ni-global-pb');
    const btn = q('#ni-global-prompt-btn');
    const isOn = pb?.classList.toggle('on');
    btn?.classList.toggle('active', isOn);
    if (isOn) {
        const el = q('#ni-global-pt-content');
        if (el) el.value = extension_settings[EXT_NAME]?.globalPrompt ?? GLOBAL_PROMPT;
        const tailEl = q('#ni-global-tail-pt-content');
        if (tailEl) tailEl.value = extension_settings[EXT_NAME]?.globalTailPrompt ?? GLOBAL_TAIL_PROMPT;
        niSyncGlobalPromptSourceUI(extension_settings[EXT_NAME] || {});
    }
}
window.niToggleGlobalPrompt = niToggleGlobalPrompt;

// ============================================================
// 演绎提示词面板
// ============================================================

// 将当前启用状态同步到 #depth_prompt_prompt
function niSyncRoleplayToDepth() {
    const ta = document.querySelector('#depth_prompt_prompt');
    if (!ta) return;
    const cfg = extension_settings[EXT_NAME] || {};
    const enabled = cfg.pluginEnabled !== false && cfg.roleplayEnabled !== false;
    const promptText = cfg.roleplayPrompt || ROLEPLAY_PROMPT;
    ta.value = enabled ? niApplyUserSubstitution(promptText) : '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function niToggleStagePrompt() {
    const pb  = q('#ni-stage-pb');
    const btn = q('#ni-stage-prompt-btn');
    const isOn = pb?.classList.toggle('on');
    btn?.classList.toggle('active', isOn);
    if (isOn) {
        const cfg = extension_settings[EXT_NAME] || {};
        // 填入已保存的提示词
        const el = q('#ni-stage-pt-content');
        if (el) el.value = cfg.roleplayPrompt || ROLEPLAY_PROMPT;
        // 恢复开关状态
        const cb = q('#ni-stage-pt-enabled');
        if (cb) cb.checked = cfg.roleplayEnabled !== false;
    }
}
window.niToggleStagePrompt = niToggleStagePrompt;


// 并发信号量 — 限制同时进行的 API 请求数，防止触发并发限制
// ============================================================
const ApiSemaphore = new DynamicSemaphore(() =>
    concurrencyLimit(extension_settings[EXT_NAME]?.apiConcurrency, DEFAULT_SETTINGS.apiConcurrency)
);

const VecSemaphore = new DynamicSemaphore(() =>
    concurrencyLimit(extension_settings[EXT_NAME]?.vecConcurrency, DEFAULT_SETTINGS.vecConcurrency)
);

function niUseTavernGlobalPreset(cfg = extension_settings[EXT_NAME] || {}) {
    return niNormalizeGlobalPromptSource(cfg.globalPromptSource) === 'tavern';
}

function niSyncGlobalPromptSourceUI(cfg = extension_settings[EXT_NAME] || {}) {
    const source = niNormalizeGlobalPromptSource(cfg.globalPromptSource);
    const tavernEl = q('#ni-global-source-tavern');
    const builtinEl = q('#ni-global-source-builtin');
    const noneEl = q('#ni-global-source-none');
    if (tavernEl) tavernEl.checked = source === 'tavern';
    if (builtinEl) builtinEl.checked = source === 'builtin';
    if (noneEl) noneEl.checked = source === 'none';
    const builtinBox = q('#ni-global-builtin-box');
    if (builtinBox) builtinBox.style.display = source === 'builtin' ? 'block' : 'none';
}

const {
    niBuildTavernPresetMessages,
} = createTavernPresetMessageTools({
    getPromptManager: () => promptManager,
    getGlobalVariables: () => extension_settings?.variables?.global || {},
    substituteParams,
    taskSwitchPrompt: TAVERN_TASK_SWITCH_PROMPT,
    finalOverridePrompt: TAVERN_TASK_FINAL_OVERRIDE_PROMPT,
});
const {
    niExtractChatCompletionText,
    niHasLengthFinishReason,
    niReadChatCompletionStream,
} = createChatCompletionResponseTools({ extractMessageFromData });
const {
    niApplyGlobalPromptsToMessages,
    niInsertIntoEventChat,
} = createGlobalPromptTools({
    getSettings: () => extension_settings[EXT_NAME] || {},
    defaultSettings: DEFAULT_SETTINGS,
    globalPrompt: GLOBAL_PROMPT,
    globalTailPrompt: GLOBAL_TAIL_PROMPT,
});

// ============================================================
// API 调用 — 清洗
// ============================================================
const {
    callApiSeq,
    callCleanApi,
    niGenerateWithTavernMainPreset,
} = createNovelApiClient({
    getSettings: () => extension_settings[EXT_NAME],
    acquireApiRateSlot: niAcquireApiRateSlot,
    useTavernGlobalPreset: niUseTavernGlobalPreset,
    runWithSemaphore,
    apiSemaphore: ApiSemaphore,
    buildTavernPresetMessages: niBuildTavernPresetMessages,
    applyGlobalPromptsToMessages: niApplyGlobalPromptsToMessages,
    readChatCompletionStream: niReadChatCompletionStream,
    hasLengthFinishReason: niHasLengthFinishReason,
    extractChatCompletionText: niExtractChatCompletionText,
    cleanUpMessage,
    getRequestHeaders,
    getCurrentAbortController: () => S._currentAbortController,
    setCurrentAbortController: controller => { S._currentAbortController = controller; },
    fetch,
});

const { niRequestEmbeddings, embedText } = createEmbeddingClient({
    getSettings: () => extension_settings[EXT_NAME],
    acquireRateSlot: () => _vecQueue.acquire(),
    runWithSemaphore,
    semaphore: VecSemaphore,
    defaultSettings: DEFAULT_SETTINGS,
});

const {
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
} = createVectorController({
    state: S,
    getSettings: () => extension_settings[EXT_NAME] || {},
    defaultSettings: DEFAULT_SETTINGS,
    indexedDB,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    dbStore: DB_STORE,
    persistSettingsDebounced: saveSettingsDebounced,
    q,
    qa,
    alert,
    confirm,
    canUseDerivedModules,
    hasLoadedChunks: (...args) => niHasLoadedChunks(...args),
    ensureChunksLoaded: (...args) => niEnsureChunksLoaded(...args),
    serverLoadHeavy: (...args) => niServerLoadHeavy(...args),
    concurrencyLimit,
    setBtn: (...args) => setBtn(...args),
    embedText: (...args) => embedText(...args),
    buildStages: (...args) => buildStages(...args),
    saveSettings: niSaveSettings,
    escapeHtml: niEscHtml,
    togglePanel: niTogglePanel,
});

const {
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
    niSetCurrentPlotTab,
    niGetCurrentPlotTab,
    niIsPlotInteractionModeActive,
    niTogglePlotDeleteSelection,
    niGetCurrentCharTab,
    niToggleCharDeleteSelection,
    niToggleShowEmptyStages,
    niGetShowEmptyStages,
} = createStoryController({
    state: S,
    query: q,
    queryAll: qa,
    document,
    globalWindow: window,
    logger: console,
    alert: message => alert(message),
    confirm: message => confirm(message),
    prompt: (...args) => prompt(...args),
    toastr: globalThis.toastr,
    extensionSettings: extension_settings,
    extensionName: EXT_NAME,
    defaultSettings: DEFAULT_SETTINGS,
    escapeHtml: niEscHtml,
    escapeAttr: niEscAttr,
    saveSettings: niSaveSettings,
    saveSettingsDebounced,
    canUseDerived: canUseDerivedModules,
    callCleanApi,
    callApiSeq,
    getContext,
    switchPage: niSwitchPage,
    renderVectorStageSelector: niRenderVecStageSelector,
    updateVectorOffButton: niUpdateVecOffBtn,
    ensureChunksLoaded: (...args) => niEnsureChunksLoaded(...args),
    buildStagesWithChunksIfNeeded: (...args) => niBuildStagesWithChunksIfNeeded(...args),
    hasLoadedChunks: (...args) => niHasLoadedChunks(...args),
    renderUserSubUI: niRenderUserSubUI,
    syncRoleplayToDepth: niSyncRoleplayToDepth,
    getUserSubConfig: niGetUserSubConfig,
    isUserSubPlayMode: niIsUserSubPlayMode,
    isUserSubSelectedChar: niIsUserSubSelectedChar,
    isUserSubReplaceSelectedChar: niIsUserSubReplaceSelectedChar,
    getActiveUserSubNames: niGetActiveUserSubNames,
    getSelectedUserSubCharName: niGetSelectedUserSubCharName,
    getUserSubAliasOverride: niGetUserSubAliasOverride,
    userSubAliasKind: niUserSubAliasKind,
    userSubAliasIsActive: niUserSubAliasIsActive,
    userSubStageReached: niUserSubStageReached,
    userSubAliasKey: niUserSubAliasKey,
    setTimeout: (...args) => setTimeout(...args),
    AbortController,
});

const {
    niHeavyPartFileName,
    niHeavyPartFileNames,
    niStripCharAiRuntime,
    niServerUploadJson,
    niServerLoadJsonByNames,
    niApplyHeavyCore,
    niApplyHeavyChunks,
    niHasLoadedChunks,
    niServerSaveHeavy,
    niServerLoadHeavy,
    niEnsureChunksLoaded,
    niBuildStagesWithChunksIfNeeded,
    niServerDeleteHeavy,
    _niStripHeavy,
    niRenderNovelLibrary,
    niSaveNovelSnapshot,
    niUpdateNovelSnapshot,
    niRenameNovelSnapshot,
    niLoadNovelSnapshot,
    niDeleteNovelSnapshot,
    niExportData,
    niImportData,
    niClearVecCache,
    niClearAllData,
} = createStorageController({
    S,
    extension_settings,
    EXT_NAME,
    DEFAULT_SETTINGS,
    DB_STORE,
    NI_UPLOAD_LABEL,
    NI_UPLOAD_HINT,
    q,
    getRequestHeaders,
    normalizePlotCollections,
    niSyncSubPlotStageAssignments,
    niMaybeMigrateLegacyDeviationToChat: (...args) => niMaybeMigrateLegacyDeviationToChat(...args),
    buildStages,
    canUseDerivedModules,
    dbCloneNovelKey,
    niReconcileVecStateFromDb,
    niGetWorldCategories: (...args) => niGetWorldCategories(...args),
    niSaveSettings,
    saveSettingsDebounced,
    niResetNovelWorkspace,
    niLoadDeviationStateFromChat: (...args) => niLoadDeviationStateFromChat(...args),
    niClearLegacyDeviationSettings: (...args) => niClearLegacyDeviationSettings(...args),
    niSyncDeviationResultUI: (...args) => niSyncDeviationResultUI(...args),
    niSaveDeviationChatState: (...args) => niSaveDeviationChatState(...args),
    renderPlots,
    renderCharacters,
    renderChunkList: (...args) => renderChunkList(...args),
    niRenderWorldSettings: (...args) => niRenderWorldSettings(...args),
    niSyncCleanButtonState: (...args) => niSyncCleanButtonState(...args),
    dbLoadByNovel,
    getVectorFingerprint,
    vecToBytes,
    bytesToVecs,
    vecToBuffer,
    dbOpen,
    dbClearNovel,
    setBtn: (...args) => setBtn(...args),
    fetch,
    document,
    Blob,
    URL,
    FileReader,
    alert,
    confirm,
    prompt,
    toastr: globalThis.toastr,
});

const {
    niOnDrop,
    niOnFile,
    niApplyFile,
    getCfgKb,
    niOnKbChange,
    renderChunkList,
    chunkStatStyle,
    setChunkStat,
    niCleanConcurrencyLimit,
    niBuildCleanMessages,
    niRebuildStructuredDataFromChunks,
    niProcessCleanChunk,
    niStartClean,
    niRetryFailed,
    niSkipChunk,
    niRunSingleChunk,
    niPauseClean,
    setBtn,
    niSyncCleanProgressHint,
    niSyncCleanButtonState,
    niResetCleanRuntimeForRestart,
    niHandleCleanButtonClick,
} = createCleaningController({
    state: S,
    getSettings: () => extension_settings[EXT_NAME] || {},
    defaultSettings: DEFAULT_SETTINGS,
    cleanPrompt: CLEAN_PROMPT,
    q,
    sv,
    alert,
    toastr: globalThis.toastr,
    fingerprintArrayBuffer: niFingerprintArrayBuffer,
    resetNovelWorkspace: niResetNovelWorkspace,
    serverLoadHeavy: niServerLoadHeavy,
    rechunkPreservingCompleted: niRechunkPreservingCompleted,
    remapVectorSourceChunkIndices: dbRemapSourceChunkIndices,
    resetChunkDerivedState: niResetChunkDerivedState,
    populateStyleChunkSelector: (...args) => niStylePopulateChunkSel(...args),
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
});

Object.assign(window, {
    niOnDrop,
    niOnFile,
    niOnKbChange,
    niStartClean,
    niRetryFailed,
    niSkipChunk,
    niRunSingleChunk,
    niPauseClean,
    niUpdateNovelSnapshot,
    niRenameNovelSnapshot,
    niExportData,
    niImportData,
    niClearVecCache,
    niClearAllData,
    niStartVec,
    niVecFillMissing,
    niToggleStagePanel,
    niRenderVecStageSelector,
});

const {
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
} = createTransbookController({
    state: S,
    defaultSettings: DEFAULT_SETTINGS,
    extensionSettings: extension_settings,
    extensionName: EXT_NAME,
    document,
    globalWindow: window,
    logger: console,
    dollar: $,
    getContext,
    getAllPlotsInStoryOrder,
    ensurePlotNodeId: niEnsurePlotNodeId,
    comparePlotOrder: niComparePlotOrder,
    saveSettingsDebounced,
    callCleanApi,
    applyStatusbarTheme: niApplyStatusbarTheme,
    applyUserSubstitution: niApplyUserSubstitution,
    getUserSubConfig: niGetUserSubConfig,
    isUserSubReplaceSelectedChar: niIsUserSubReplaceSelectedChar,
    isUserSubSelectedChar: niIsUserSubSelectedChar,
    isUserSubPlayMode: niIsUserSubPlayMode,
    getCharAiShowEnabled: niGetCharAiShowEnabled,
    getCharAiProfile: niGetCharAiProfile,
    togglePanel: niTogglePanel,
    popSetVisible: (...args) => window.niPopSetVisible?.(...args),
    popSyncVisibility: (...args) => window.niPopSyncVisibility?.(...args),
    setTransBookMode: niSetTransBookMode,
    syncTransBookToggleUI: niSyncTransBookToggleUI,
    setTimeout: (...args) => setTimeout(...args),
    requestAnimationFrame: (...args) => requestAnimationFrame(...args),
    Event,
    defaultAdvancePrompt: TB_DEFAULT_ADVANCE_PROMPT,
    defaultInferPrompt: TB_DEFAULT_INFER_PROMPT,
    defaultOpeningPrompt: TB_DEFAULT_OPENING_PROMPT,
    defaultOngoingPrompt: TB_DEFAULT_ONGOING_PROMPT,
    defaultImmersionPrompt: TB_DEFAULT_IMMERSION_PROMPT,
    legacyAdvancePrompt: TB_LEGACY_ADVANCE_PROMPT,
    legacyOpeningPrompt: TB_LEGACY_OPENING_PROMPT,
    legacyOngoingPrompt: TB_LEGACY_ONGOING_PROMPT,
});
// 合并角色数据
// ============================================================

// ============================================================
// 合并剧情数据，计算所属阶段
// ============================================================
async function dbRemapSourceChunkIndices(indexMap) {
    if (!(indexMap instanceof Map) || !indexMap.size || !S.novelKey) return 0;
    await dbOpen();
    return new Promise((resolve, reject) => {
        const tx = S.db.transaction(DB_STORE, 'readwrite');
        const idx = tx.objectStore(DB_STORE).index('novelKey');
        const req = idx.openCursor(S.novelKey);
        let updated = 0;
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            const row = cursor.value || {};
            const oldSource = Number(row.sourceChunkIdx);
            if (indexMap.has(oldSource)) {
                row.sourceChunkIdx = indexMap.get(oldSource);
                cursor.update(row);
                updated++;
            }
            cursor.continue();
        };
        tx.oncomplete = () => resolve(updated);
        tx.onerror = () => reject(tx.error);
    });
}

function mergePlots(incoming, chunkIndex) {
    // stageMap key = main数组下标，不能用 chunkIndex 直接查。
    // 这里只记录 _chunkIdx，stageIdx 由 niConfirmStageMap 事后统一回填。
    // 若阶段已划分且当前节点是续跑补充的，通过已有节点的 _chunkIdx 反查阶段号。
    let stageIdx = null;
    if (S.stageMapN > 0) {
        // 在已有节点中找同 chunkIndex 的节点，借用其 stageIdx
        const ref = [...(S.plots.main || []), ...(S.plots.sub || []), ...(S.plots.pivot || [])]
            .find(p => p._chunkIdx === chunkIndex && p.stageIdx != null);
        if (ref) {
            stageIdx = ref.stageIdx;
        }
    }

    const plots = niNormalizeIncomingPlots(incoming)
        .map((plot, index) => ({ ...(plot || {}), _sourceIdx: index }))
        .sort((a, b) => {
            const ai = niFiniteNumber(a._sourceIdx, 0);
            const bi = niFiniteNumber(b._sourceIdx, 0);
            return niPlotChunkOrder(a, ai) - niPlotChunkOrder(b, bi) ||
                niPlotTypeRank(a) - niPlotTypeRank(b) ||
                ai - bi;
        });
    plots.forEach((p, localIndex) => {
        const bucket = ['main', 'sub', 'pivot'].includes(p.type) ? p.type : 'main';
        const chunkOrder = niPlotChunkOrder(p, p._sourceIdx ?? localIndex);
        const newPlot = {
            _nodeId: p._nodeId || p.node_id || p.nodeId || p.id || `${bucket}:${chunkIndex}:${chunkOrder}:${niHashShort(`${p.title || ''}\n${p.body || ''}`)}`,
            type: bucket,
            title: p.title || '（无标题）',
            body: p.body || '',
            sub_notes: p.sub_notes || [],
            branch_links: p.branch_links || [],
            time: p.time || '',
            location: p.location || '',
            stageIdx,
            stageLabel: stageIdx != null ? `第 ${stageIdx} 阶段` : null,
            _chunkIdx: chunkIndex,
            _chunkOrder: chunkOrder,
        };
        const manualOrder = niPlotManualOrder(p);
        if (manualOrder != null) newPlot._manualOrder = manualOrder;
        niEnsurePlotNodeId(newPlot, bucket, localIndex);
        S.plots[bucket].push({
            ...newPlot,
        });
    });
}

// ============================================================
// 剧情渲染
// ============================================================
function niGetUserSubConfig() {
    const cfg = extension_settings[EXT_NAME] || {};
    cfg.userSubMode = niNormalizeUserSubMode(cfg.userSubMode);
    if (!Array.isArray(cfg.userSubAliases)) cfg.userSubAliases = [];
    return cfg;
}

function niNormalizeUserSubMode(mode) {
    return mode === 'play' ? 'play' : DEFAULT_SETTINGS.userSubMode;
}

function niIsUserSubPlayMode(cfg = niGetUserSubConfig()) {
    return niNormalizeUserSubMode(cfg.userSubMode) === 'play';
}

function niIsUserSubSelectedChar(idx, cfg = niGetUserSubConfig()) {
    if (!cfg.userSubEnabled) return false;
    return parseInt(cfg.userSubCharIdx, 10) === idx;
}

function niIsUserSubReplaceSelectedChar(idx, cfg = niGetUserSubConfig()) {
    return niIsUserSubSelectedChar(idx, cfg) && !niIsUserSubPlayMode(cfg);
}

function niUserSubDefaultAliasesForChar(charIdx) {
    const idx = parseInt(charIdx, 10);
    const c = S.characters[idx];
    if (!c?.name) return [];
    const firstStage = getCharFirstStage(c) || '';
    const out = [{
        text: c.name,
        firstStage,
        kind: 'primary',
    }];
    (Array.isArray(c.aliases) ? c.aliases : []).forEach(alias => {
        const text = (alias?.text || '').trim();
        if (!text || text === c.name) return;
        const kind = String(alias.kind || 'alias').trim() || 'alias';
        const aliasStage = getCharFirstStage({ _firstChunkIdx: alias._chunkIdx }) || firstStage;
        out.push({
            text,
            firstStage: aliasStage,
            kind,
        });
    });
    const seen = new Set();
    return out.filter(alias => {
        const key = `${alias.text}@@${alias.firstStage}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function niUserSubAliasLookupKey(text, kind = '') {
    return `${String(text || '').trim()}@@${String(kind || '').trim().toLowerCase()}`;
}

function niNormalizeUserSubAliasesForSelectedChar(cfg) {
    const idx = parseInt(cfg.userSubCharIdx, 10);
    const c = S.characters[idx];
    if (!c?.name || !Array.isArray(cfg.userSubAliases)) return false;

    const firstStage = getCharFirstStage(c) || '';
    const byTextKind = new Map();
    const byText = new Map();
    const addStage = (text, kind, stage) => {
        const t = String(text || '').trim();
        if (!t) return;
        const k = String(kind || '').trim().toLowerCase();
        const s = String(stage || '');
        if (!s) return;
        byTextKind.set(niUserSubAliasLookupKey(t, k), s);
        if (!byText.has(t)) byText.set(t, s);
    };

    addStage(c.name, 'primary', firstStage);
    (Array.isArray(c.aliases) ? c.aliases : []).forEach(alias => {
        const text = String(alias?.text || '').trim();
        if (!text) return;
        const kind = String(alias?.kind || 'alias').trim() || 'alias';
        const stage = getCharFirstStage({ _firstChunkIdx: alias._chunkIdx }) || firstStage;
        addStage(text, kind, stage);
    });

    let changed = false;
    let states = null;
    let statesChanged = false;
    cfg.userSubAliases.forEach(alias => {
        if (!alias?.text || niUserSubAliasKind(alias) === 'custom') return;
        const stage = byTextKind.get(niUserSubAliasLookupKey(alias.text, alias.kind)) ||
            byText.get(String(alias.text || '').trim());
        if (!stage || String(alias.firstStage || '') === String(stage)) return;

        const oldKey = niUserSubAliasKey(alias);
        alias.firstStage = String(stage);
        changed = true;
        const newKey = niUserSubAliasKey(alias);
        if (oldKey && oldKey !== newKey) {
            states = states || { ...niGetUserSubChatStates() };
            if (Object.prototype.hasOwnProperty.call(states, oldKey)) {
                states[newKey] = states[oldKey];
                delete states[oldKey];
                statesChanged = true;
            }
        }
    });

    if (statesChanged) niSaveUserSubChatStates(states).catch(e => console.warn('[NI] 用户代入称呼阶段迁移失败:', e));
    if (changed) saveSettingsDebounced();
    return changed;
}

function niUserSubStageReached(firstStage) {
    const si = parseInt(firstStage, 10);
    if (!si || si <= 0 || S.stageMapN <= 0) return true;
    for (let i = si; i <= S.stageMapN; i++) {
        if (S.stageStates[i] !== false) return true;
    }
    return false;
}

function niUserSubAliasKey(alias) {
    return `${alias?.text || ''}@@${alias?.firstStage || ''}`;
}

function niGetUserSubChatStates() {
    try {
        const ctx = getContext();
        const states = ctx?.chat?.[0]?.ni_user_sub?.aliasStates;
        return states && typeof states === 'object' ? states : {};
    } catch (_) {
        return {};
    }
}

async function niSaveUserSubChatStates(states) {
    try {
        const ctx = getContext();
        if (!ctx?.chat?.[0]) return;
        ctx.chat[0].ni_user_sub = ctx.chat[0].ni_user_sub || {};
        ctx.chat[0].ni_user_sub.aliasStates = { ...states };
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    } catch (e) {
        console.warn('[NI] 用户代入称呼状态保存失败:', e);
    }
}

function niGetUserSubAliasOverride(alias) {
    const states = niGetUserSubChatStates();
    const key = niUserSubAliasKey(alias);
    if (Object.prototype.hasOwnProperty.call(states, key)) return !!states[key];
    if (alias?.state === 'manual_on') return true;
    if (alias?.state === 'manual_off') return false;
    return null;
}

function niUserSubAliasKind(alias) {
    return String(alias?.kind || 'custom').trim().toLowerCase();
}

function niUserSubAliasIsActive(alias) {
    if (!alias?.text) return false;
    const override = niGetUserSubAliasOverride(alias);
    if (override !== null) return override;
    return niUserSubStageReached(alias.firstStage);
}

function niReadUserSubAliasesFromUI() {
    const rows = [...qa('#ni-user-sub-list .ni-user-sub-row')];
    return rows.map(row => {
        const text = row.querySelector('.ni-user-sub-name')?.value?.trim() || '';
        const firstStage = row.dataset.firstStage || '';
        const kind = row.dataset.aliasKind || 'custom';
        return { text, firstStage, kind };
    }).filter(a => a.text);
}

function niReadUserSubAliasFromRow(row) {
    return {
        text: row?.querySelector('.ni-user-sub-name')?.value?.trim() || '',
        firstStage: row?.dataset.firstStage || '',
    };
}

async function niSaveUserSubRowState(row) {
    const alias = niReadUserSubAliasFromRow(row);
    if (!alias.text) return;
    const states = { ...niGetUserSubChatStates() };
    states[niUserSubAliasKey(alias)] = !!row.querySelector('.ni-user-sub-enabled')?.checked;
    await niSaveUserSubChatStates(states);
}

async function niMigrateUserSubRowState(row) {
    const oldKey = row?.dataset.aliasKey || '';
    const alias = niReadUserSubAliasFromRow(row);
    const newKey = niUserSubAliasKey(alias);
    if (!alias.text || !oldKey || oldKey === newKey) return;
    const states = { ...niGetUserSubChatStates() };
    if (Object.prototype.hasOwnProperty.call(states, oldKey)) {
        states[newKey] = states[oldKey];
        delete states[oldKey];
        await niSaveUserSubChatStates(states);
    }
    row.dataset.aliasKey = newKey;
}

async function niDeleteUserSubRowState(row) {
    const oldKey = row?.dataset.aliasKey || '';
    if (!oldKey) return;
    const states = { ...niGetUserSubChatStates() };
    if (Object.prototype.hasOwnProperty.call(states, oldKey)) {
        delete states[oldKey];
        await niSaveUserSubChatStates(states);
    }
}

function niUserSubStageLabel(firstStage) {
    const si = parseInt(firstStage, 10);
    const cnNums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const n = si > 0 && si <= 10 ? cnNums[si] : String(si || '');
    return si > 0 ? `${n}阶段` : '全程';
}

function niRenderUserSubUI() {
    const cfg = niGetUserSubConfig();
    const chk = q('#ni-user-sub-chk');
    const state = q('#ni-user-sub-state');
    const row = q('#ni-user-sub-switch-row');
    const sel = q('#ni-user-sub-char');
    const list = q('#ni-user-sub-list');
    if (!chk || !state || !sel || !list) return;

    const enabled = !!cfg.userSubEnabled;
    chk.checked = enabled;
    state.textContent = enabled ? '开' : '关';
    row?.classList.toggle('ni-switch-off', !enabled);

    const mode = niNormalizeUserSubMode(cfg.userSubMode);
    q('#ni-user-sub-mode')?.querySelectorAll('.ni-user-sub-mode-btn').forEach(btn => {
        const isOn = btn.dataset.userSubMode === mode;
        btn.classList.toggle('on', isOn);
        btn.setAttribute('aria-pressed', String(isOn));
    });

    const selectedIdx = cfg.userSubCharIdx ?? '';
    sel.innerHTML = '<option value="">选择角色</option>' +
        (S.characters || []).map((c, i) =>
            `<option value="${i}"${String(selectedIdx) === String(i) ? ' selected' : ''}>${niEscHtml(c.name || `角色${i + 1}`)}</option>`
        ).join('');

    niNormalizeUserSubAliasesForSelectedChar(cfg);
    const aliases = (cfg.userSubAliases || []).slice()
        .sort((a, b) => (parseInt(a.firstStage || 0, 10) || 0) - (parseInt(b.firstStage || 0, 10) || 0));
    list.innerHTML = aliases.length
        ? aliases.map((a, i) => {
            const active = niUserSubAliasIsActive(a);
            const aliasKey = niUserSubAliasKey(a);
            const aliasKind = a.kind || 'custom';
            const stageLabel = niUserSubStageLabel(a.firstStage);
            return `<div class="ni-user-sub-row" data-row-idx="${i}" data-alias-key="${niEscAttr(aliasKey)}" data-alias-kind="${niEscAttr(aliasKind)}" data-first-stage="${niEscAttr(a.firstStage || '')}">
              <label class="ni-user-sub-check" title="是否替换为 <user>">
                <input class="ni-user-sub-enabled" type="checkbox"${active ? ' checked' : ''}>
                <span class="ni-user-sub-box"><i class="ti ti-check"></i></span>
              </label>
              <input class="ni-cef-input ni-user-sub-name" value="${niEscAttr(a.text || '')}" placeholder="称呼">
              <span class="ni-user-sub-stage-tag">${niEscHtml(stageLabel)}</span>
              <button class="ni-user-sub-del" title="删除称呼"><i class="ti ti-x"></i></button>
            </div>`;
        }).join('')
        : '<div class="ni-empty" style="padding:8px 0">请选择角色或添加称呼</div>';
    niSyncUserSubPromptPreview();
}

async function niSaveUserSubFromUI({ rerender = false } = {}) {
    const cfg = niGetUserSubConfig();
    const chk = q('#ni-user-sub-chk');
    const sel = q('#ni-user-sub-char');
    if (chk) cfg.userSubEnabled = chk.checked;
    cfg.userSubMode = niNormalizeUserSubMode(q('#ni-user-sub-mode .ni-user-sub-mode-btn.on')?.dataset.userSubMode ?? cfg.userSubMode);
    if (sel) cfg.userSubCharIdx = sel.value;
    if (q('#ni-user-sub-list')) cfg.userSubAliases = niReadUserSubAliasesFromUI();
    saveSettingsDebounced();
    niSyncRoleplayToDepth();
    niSyncUserSubPromptPreview();
    if (rerender) niRenderUserSubUI();
}

function niEscapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function niGetActiveUserSubNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    return (cfg.userSubAliases || [])
        .filter(niUserSubAliasIsActive)
        .map(a => (a.text || '').trim())
        .filter(name => name && name !== '<user>' && !/^user$/i.test(name))
        .sort((a, b) => b.length - a.length)
        .filter(name => {
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
        });
}

function niUserSubAliasText(alias) {
    return String(alias?.text || alias?.name || alias?.alias || alias?.title || '').trim();
}

function niUserSubAliasIsTitle(alias) {
    return String(alias?.kind || alias?.type || '').trim().toLowerCase() === 'title';
}

function niGetActiveUserSubIdentityNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    return (cfg.userSubAliases || [])
        .filter(niUserSubAliasIsActive)
        .filter(alias => !niUserSubAliasIsTitle(alias))
        .map(niUserSubAliasText)
        .filter(name => name && name !== '<user>' && !/^user$/i.test(name))
        .sort((a, b) => b.length - a.length)
        .filter(name => {
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
        });
}

function niGetUserSubTitleNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    const titles = [];
    const add = (name) => {
        const n = String(name || '').trim();
        if (!n || n === '<user>' || /^user$/i.test(n) || seen.has(n)) return;
        seen.add(n);
        titles.push(n);
    };
    const selectedIdx = parseInt(cfg.userSubCharIdx, 10);
    const selectedChar = S.characters?.[selectedIdx];
    (Array.isArray(selectedChar?.aliases) ? selectedChar.aliases : [])
        .filter(niUserSubAliasIsTitle)
        .forEach(alias => add(niUserSubAliasText(alias)));
    (cfg.userSubAliases || [])
        .filter(niUserSubAliasIsActive)
        .filter(niUserSubAliasIsTitle)
        .forEach(alias => add(niUserSubAliasText(alias)));
    return titles.sort((a, b) => b.length - a.length);
}

function niGetUserSubstitutionNames() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return [];
    const seen = new Set();
    const names = [];
    const add = (name) => {
        const n = String(name || '').trim();
        if (!n || n === '<user>' || /^user$/i.test(n) || seen.has(n)) return;
        seen.add(n);
        names.push(n);
    };
    const addWithShortNames = (name) => {
        const n = String(name || '').trim();
        if (!n) return;
        add(n);
        niCharPresenceTerms({ name: n, aliases: [] }).forEach(add);
    };
    const primaryName = niGetSelectedUserSubCharName();
    addWithShortNames(primaryName);
    const selectedIdx = parseInt(cfg.userSubCharIdx, 10);
    const selectedChar = S.characters?.[selectedIdx];
    (Array.isArray(selectedChar?.aliases) ? selectedChar.aliases : []).forEach(alias => {
        if (niUserSubAliasIsTitle(alias)) return;
        const text = niUserSubAliasText(alias);
        if (text.length >= 2) addWithShortNames(text);
    });
    niGetActiveUserSubIdentityNames().forEach(addWithShortNames);
    return names.sort((a, b) => b.length - a.length);
}

function niGetUserSubOutputName() {
    const candidates = [];
    try {
        const ctx = getContext?.();
        candidates.push(ctx?.name1);
    } catch (_) {}
    candidates.push(name1);
    try {
        candidates.push(substituteParams('{{user}}'));
    } catch (_) {}
    const name = candidates
        .map(v => String(v || '').trim())
        .find(v => v && v !== '{{user}}');
    return name || '<user>';
}

function niGetSelectedUserSubCharName() {
    const cfg = niGetUserSubConfig();
    const idx = parseInt(cfg.userSubCharIdx, 10);
    return (S.characters?.[idx]?.name || '').trim();
}

function niGetUserSubPromptState(cfg = niGetUserSubConfig()) {
    if (!cfg.userSubEnabled) return 'boundary';
    return niIsUserSubPlayMode(cfg) ? 'play' : 'replace';
}

function niGetUserSubPromptField(state = niGetUserSubPromptState()) {
    if (state === 'boundary') return 'userSubBoundaryPrompt';
    if (state === 'play') return 'userSubPromptPlay';
    return 'userSubPromptReplace';
}

function niIsLegacyDefaultUserSubPrompt(state, text) {
    if (state !== 'replace') return false;
    const t = String(text || '').trim();
    return /^\[用户代入角色\]\n<user>代表原著角色「[^」]+」。以下称呼只作为同一角色的映射：[\s\S]*。后续正文使用<user>，不要把原名或称呼写成另一个角色。\n\[\/用户代入角色\]$/.test(t);
}

function niGetUserSubCustomPrompt(state = niGetUserSubPromptState(), cfg = niGetUserSubConfig()) {
    const field = niGetUserSubPromptField(state);
    if (typeof cfg[field] !== 'string') return null;
    if (niIsLegacyDefaultUserSubPrompt(state, cfg[field])) return null;
    return cfg[field];
}

function niSaveUserSubPromptFromUI() {
    const ta = q('#ni-user-sub-prompt-preview');
    if (!ta) return;
    const cfg = niGetUserSubConfig();
    cfg[niGetUserSubPromptField(niGetUserSubPromptState(cfg))] = ta.value ?? '';
    saveSettingsDebounced();
}

function niBuildDefaultUserSubIdentityPrompt() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return '';

    const primaryName = niGetSelectedUserSubCharName();
    const outputName = niGetUserSubOutputName();
    const outputLine = outputName && outputName !== '<user>'
        ? `当前用户显示名是「${outputName}」；<user>与「${outputName}」是同一人。正文中提到该代入角色时优先写「${outputName}」。`
        : `<user>就是当前用户。正文中提到该代入角色时使用 <user>。`;
    const names = [];
    [primaryName, ...niGetActiveUserSubIdentityNames()].forEach(name => {
        const n = (name || '').trim();
        if (n && !names.includes(n)) names.push(n);
    });
    const titleNames = niGetUserSubTitleNames();
    const titleLine = titleNames.length
        ? `以下称谓是他人对 <user> 的身份/礼貌称呼，可在对话和叙述中保留：${titleNames.join('、')}；但它们不得指向另一个独立角色。`
        : '';
    if (!names.length) return '';

    const displayName = primaryName || names[0];
    if (niIsUserSubPlayMode(cfg)) {
        const namesLine = names.length > 1
            ? `「${displayName}」及其别称/称呼（${names.join('、')}）均指向 <user>，不得再把「${displayName}」作为独立NPC演绎。`
            : `「${displayName}」指向 <user>，不得再把「${displayName}」作为独立NPC演绎。`;
        return `[用户代入角色]\n<user>正在扮演原著角色「${displayName}」本人。\n${outputLine}\n${namesLine}\n${titleLine ? `${titleLine}\n` : ''}可将当前剧情时间点以前已经成立的身份、关系与经历作为 <user> 的既有事实。\n当前剧情时间点之后的原著选择、行动和结局只作为参考惯性，不得因为原著中「${displayName}」这样做过，就强制让 <user> 复刻。\n[/用户代入角色]`;
    }
    return `[用户代入角色]\n<user>替换原著角色「${displayName}」在原著中的人生位置。\n${outputLine}\n以下身份名称只指向 <user>：${names.join('、')}。\n${titleLine ? `${titleLine}\n` : ''}在当前分支中，不存在一个与 <user> 同时独立行动的「${displayName}」NPC；看到小说原著片段、剧情节点、角色人设里的身份名称时，都按 <user> 的身份、关系、过往和处境理解。\n输出正文时，身份名使用用户显示名或 <user>；身份/礼貌称谓可以保留为称呼。不要让该原角作为独立NPC出场、说话、行动或承接关系。\n当前剧情时间点之后的原著选择、行动和结局只作为参考惯性，不得强迫 <user> 复刻。\n[/用户代入角色]`;
}

function niBuildUserSubRuntimeGuard() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return '';
    const primaryName = niGetSelectedUserSubCharName();
    const names = niGetUserSubstitutionNames();
    if (!primaryName && !names.length) return '';
    const outputName = niGetUserSubOutputName();
    const outputLabel = outputName && outputName !== '<user>' ? `「${outputName}」` : '<user>';
    const sourceNames = names.length ? names.join('、') : primaryName;
    const titleNames = niGetUserSubTitleNames();
    const titleLine = titleNames.length
        ? `以下称谓可作为他人对 ${outputLabel} 的身份/礼貌称呼保留，不需要替换成姓名，但不得指向另一个独立角色：${titleNames.join('、')}。\n`
        : '';
    return `[用户代入强制映射]\n本轮请求中，以下原著身份名称都不是独立角色，而是当前用户 ${outputLabel}：${sourceNames}。\n${titleLine}在阅读聊天历史、角色卡、世界书、小说片段、剧情节点、角色人设和偏差档案时，凡出现这些身份名称，都按 ${outputLabel} 理解。\n输出正文时不得继续使用这些身份名称来指代该用户代入角色；应写 ${outputLabel}。身份/礼貌称谓可按场景保留。除非剧情明确讨论“原著文本中的名字”这个概念，否则不要把这些名称作为可出场 NPC 写出。\n[/用户代入强制映射]`;
}

function niBuildUserSubIdentityPrompt() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) return '';
    const customPrompt = niGetUserSubCustomPrompt(niGetUserSubPromptState(cfg), cfg);
    if (customPrompt !== null) {
        const guard = niBuildUserSubRuntimeGuard();
        return guard ? `${customPrompt.trim()}\n\n${guard}` : customPrompt;
    }
    return niBuildDefaultUserSubIdentityPrompt();
}

function niGetUserSubPromptPreview() {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled) {
        return {
            state: '关闭边界',
            text: niBuildUserRoleBoundaryPrompt(),
        };
    }
    const state = niGetUserSubPromptState(cfg);
    const customPrompt = niGetUserSubCustomPrompt(state, cfg);
    if (customPrompt !== null) {
        return {
            state: niIsUserSubPlayMode(cfg) ? '扮演模式' : '替换模式',
            text: customPrompt,
        };
    }
    const prompt = niBuildUserSubIdentityPrompt();
    if (!prompt) {
        return {
            state: '尚未生效',
            text: '当前已开启“用户代入角色”，但还没有可注入的代入提示词。\n请先选择代入角色，并至少保留一个有效称呼。有效后会在每次请求前作为隐藏系统提示注入。',
        };
    }
    return {
        state: niIsUserSubPlayMode(cfg) ? '扮演模式' : '替换模式',
        text: prompt,
    };
}

function niSyncUserSubPromptPreview() {
    const ta = q('#ni-user-sub-prompt-preview');
    const state = q('#ni-user-sub-prompt-state');
    if (!ta && !state) return;
    const preview = niGetUserSubPromptPreview();
    if (ta) ta.value = preview.text || '';
    if (state) state.textContent = preview.state || '';
}

function niBuildUserRoleBoundaryPrompt() {
    const cfg = niGetUserSubConfig();
    if (cfg.userSubEnabled) return '';
    const customPrompt = niGetUserSubCustomPrompt('boundary', cfg);
    return customPrompt !== null ? customPrompt : USER_SUB_BOUNDARY_PROMPT;
}

function niReplaceOutsideAngleTags(text, pattern, replacement) {
    return String(text).split(/(<[^>\n]*>)/g).map(part => {
        if (part.startsWith('<') && part.endsWith('>')) return part;
        return part.replace(pattern, replacement);
    }).join('');
}

function niApplyUserSubstitution(text, replacement = niGetUserSubOutputName()) {
    if (typeof text !== 'string' || !text) return text;
    const names = niGetUserSubstitutionNames();
    if (!names.length) return text;
    let out = text;
    names.forEach(name => {
        out = niReplaceOutsideAngleTags(out, new RegExp(niEscapeRegExp(name), 'g'), replacement || '<user>');
    });
    return out;
}

function niApplyUserSubstitutionToContent(content) {
    if (typeof content === 'string') return niApplyUserSubstitution(content);
    if (Array.isArray(content)) {
        content.forEach(part => {
            if (!part || typeof part !== 'object') return;
            if (typeof part.text === 'string') part.text = niApplyUserSubstitution(part.text);
            if (typeof part.content === 'string') part.content = niApplyUserSubstitution(part.content);
        });
    }
    return content;
}

function niShouldSkipUserSubRewriteContent(content) {
    const text = typeof content === 'string'
        ? content
        : (Array.isArray(content)
            ? content.map(part => typeof part?.text === 'string' ? part.text : (typeof part?.content === 'string' ? part.content : '')).join('\n')
            : '');
    return /\[(用户代入角色|用户代入强制映射|关于用户角色)\]/.test(text);
}

function niApplyUserSubstitutionToPromptMessages(messages) {
    if (!Array.isArray(messages) || !niGetUserSubstitutionNames().length) return;
    messages.forEach(msg => {
        if (!msg || typeof msg !== 'object') return;
        if (niShouldSkipUserSubRewriteContent(msg.content)) return;
        if (Object.prototype.hasOwnProperty.call(msg, 'content')) {
            msg.content = niApplyUserSubstitutionToContent(msg.content);
        }
        if (typeof msg.mes === 'string') msg.mes = niApplyUserSubstitution(msg.mes);
    });
}

function niFinalUserSubPromptRewrite(eventData) {
    if (eventData?.dryRun) return;
    if (extension_settings[EXT_NAME]?.pluginEnabled === false) return;
    niApplyUserSubstitutionToPromptMessages(eventData?.chat);
}

function niPostprocessUserSubMessage(messageId) {
    const cfg = niGetUserSubConfig();
    if (!cfg.userSubEnabled || !niGetUserSubstitutionNames().length) return;
    const id = Number(messageId);
    if (!Number.isFinite(id) || id < 0) return;
    try {
        const ctx = getContext?.();
        const msg = ctx?.chat?.[id];
        if (!msg || msg.is_user || typeof msg.mes !== 'string') return;
        const before = msg.mes;
        const after = niApplyUserSubstitution(before);
        if (after === before) return;
        msg.mes = after;
        const swipeId = Number.isFinite(Number(msg.swipe_id)) ? Number(msg.swipe_id) : 0;
        if (Array.isArray(msg.swipes) && msg.swipes[swipeId] === before) msg.swipes[swipeId] = after;
        const el = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
        if (el && typeof messageFormatting === 'function') {
            el.innerHTML = messageFormatting(after, msg.name, msg.is_system, msg.is_user, id, {}, false);
        }
        if (typeof ctx?.saveChat === 'function') ctx.saveChat();
    } catch (e) {
        console.warn('[NI] 用户代入回复替换失败:', e);
    }
}

function niUpdateVecOffBtn() {
    const btn = q('#ni-vec-off-btn');
    const modeWrap = q('.ni-stage-inj-mode-wrap');
    const hasVec = S.vecDone && Object.values(S.stageVecDone).some(v => v);
    // 无向量数据时隐藏按钮，始终显示未向量注入模式选择器
    if (!hasVec) {
        if (btn) btn.style.display = 'none';
        if (modeWrap) modeWrap.style.display = '';
        // 也隐藏补全按钮
        const fb = q('#ni-btn-vec-fill');
        if (fb && !S._vecFillVisible) fb.style.display = 'none';
        return;
    }
    if (!btn) {
        if (modeWrap) modeWrap.style.display = '';
        return;
    }
    btn.style.display = '';
    const disabled = !!(extension_settings[EXT_NAME]?.vecInjDisabled);
    btn.classList.toggle('active', disabled);
    btn.title = disabled ? '向量化注入已关闭（点击重新启用）' : '关闭向量化注入（有向量数据但暂不调用）';
    // 有向量且关闭向量注入时显示未向量注入模式选择器；启用向量注入时隐藏
    if (modeWrap) modeWrap.style.display = disabled ? '' : 'none';
    // 有向量数据时，异步检查是否有缺失块，有才显示补全按钮
    if (!S._vecRunning) niCheckFillBtnVisibility();
}

// 异步对比 IndexedDB 与应有块数，决定是否显示补全按钮
async function niCheckFillBtnVisibility() {
    const fillBtn = q('#ni-btn-vec-fill');
    if (!fillBtn || S._vecRunning) return;
    if (!canUseDerivedModules(S)) {
        fillBtn.style.display = 'none';
        return;
    }
    // 避免并发重复检查
    if (S._vecCheckPending) return;
    S._vecCheckPending = true;
    try {
        if (!niHasLoadedChunks()) {
            await niEnsureChunksLoaded();
        }
        // 读 IndexedDB 已有 key 集合
        const existing = await dbLoadByNovel();
        const existingKeys = new Set(existing.map(c => `s${c.stageIdx}_c${c.chunkIdx}`));

        // 重建完整 chunk 列表
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
                stageBuckets[si].push(...subChunks);
            }
        }

        // 有任何缺失就显示按钮，否则隐藏
        let hasMissing = false;
        outer: for (const [siStr, texts] of Object.entries(stageBuckets)) {
            const si = Number(siStr);
            for (let ci = 0; ci < texts.length; ci++) {
                if (!existingKeys.has(`s${si}_c${ci}`)) { hasMissing = true; break outer; }
            }
        }
        const fb = q('#ni-btn-vec-fill');
        S._vecFillVisible = hasMissing;
        if (fb && !S._vecRunning) fb.style.display = hasMissing ? 'flex' : 'none';
    } catch(e) {
        console.warn('[NI] niCheckFillBtnVisibility 失败:', e);
    } finally {
        S._vecCheckPending = false;
    }
}

const _apiQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:api-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.apiRateLimit,
});

// 向量化 API 限速队列
const _vecQueue = new PersistedRateQueue({
    storageKey: `${EXT_NAME}:vec-last-request-at`,
    getLimit: () => extension_settings[EXT_NAME]?.vecRateLimit,
});

// ============================================================
// 自动生成阶段标题和概括
// ============================================================
// 角色/阶段概括与清洗共用每分钟限速；实际并发由 apiConcurrency 和 ApiSemaphore 共同限制
async function niAcquireApiRateSlot(signal = null) {
    if (!signal) {
        await _apiQueue.acquire();
        return;
    }
    if (signal.aborted) throw new Error('请求已中止（超时或用户操作）');
    let onAbort = null;
    const abortPromise = new Promise((_, reject) => {
        onAbort = () => reject(new Error('请求已中止（超时或用户操作）'));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        await Promise.race([_apiQueue.acquire(), abortPromise]);
    } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new Error('请求已中止（超时或用户操作）');
}

// 手动触发：角色概括
// ============================================================
// Embedding API 调用
// ============================================================
const { recallRelevantWeighted, recallRelevant } = createVectorRecallService({
    getSettings: () => extension_settings[EXT_NAME],
    getState: () => S,
    defaultSettings: DEFAULT_SETTINGS,
    dbLoadByNovel,
    getVectorFingerprint,
    cosineSim,
    isVectorRowCompatible,
    embeddingClient: { niRequestEmbeddings, embedText },
});

// ============================================================
// 向量召回
// ============================================================

// ============================================================
// 偏差分析
// ============================================================
// 世界设定模块
// ============================================================
const {
    niGetWorldCategories,
    niSaveWorldCategories,
    niRenderWorldSettings,
    niWorldToggleCat,
    niWorldToggleEdit,
    niWorldCallApi,
    niWorldGenOne,
    niWorldGenAll,
    niWorldAddCat,
    niWorldDeleteCat,
    niWorldSavePrompt,
    niGetDeviationChatRoot,
    niReadDeviationChatState,
    niSetDeviationSections,
    niGetDeviationSections,
    niGetDeviationGuideText,
    niSyncDeviationSectionInputs,
    niUpdateDeviationSectionsFromUI,
    niApplyDeviationState,
    niSaveDeviationChatState,
    niClearLegacyDeviationSettings,
    niReadLegacyDeviationState,
    niLoadDeviationStateFromChat,
    niMaybeMigrateLegacyDeviationToChat,
    niSaveDeviationGuideNow,
    niQueueDeviationGuideSave,
    niSyncDeviationResultUI,
    niDevButtonLabel,
    niDevAutoEvery,
    niDevRecentMessageLimit,
    niGetRenderedChatMessages,
    niGetCurrentChatMessages,
    niBuildChatRangeContext,
    niGetDevRetryRange,
    niSetDevProgress,
    niSetDevButtonState,
    niSetDevRetryButtonState,
    niSyncDevButtonLabel,
    niBuildDeviationPrompt,
    niGetEnabledDevStages,
    niBuildDevStageReference,
    niRunDev,
    niCurrentChatFloorCount,
    niNormalizeDevCoveredFloorToTotal,
    niResetDevAutoCounter,
    niNotifyDevAutoComplete,
    niDevAutoSkipMessage,
    niStyleSyncMode,
    niStylePopulateChunkSel,
    niGenerateStyle,
    niDevCoveredFloorFor,
    niMaybeAutoRunDev,
    niStartDevAutoCatchup,
    niBindDeviationAutoUpdateEvents,
    animateBar,
} = createGenerationController({
    S,
    extension_settings,
    EXT_NAME,
    DEFAULT_SETTINGS,
    q,
    getContext,
    niNormalizeDeviationSections,
    niBuildDeviationGuideFromSections,
    niParseDeviationGuideSections,
    niBuildDeviationSectionsFromAnalysis,
    niMergeDeviationSections,
    niNormalizeDevRange,
    niDevRangeLabel,
    niDevRangeProgressLabel,
    niBuildDevChatEntriesText,
    niDevIsCountableMessage,
    niDevMessageFloor,
    niDevMessageMesId,
    niDevMessageRole,
    niDevMessageText,
    niMergeDevMessagesByFloor,
    niBoundIntValue,
    getNodesForStage,
    niMergeStageNodes,
    recallRelevant,
    callCleanApi,
    niSaveSettings,
    saveSettingsDebounced,
    niServerSaveHeavy,
    eventSource,
    event_types,
    DEV_PROMPT,
    STYLE_PROMPT,
    NI_DEV_CURRENT_TEXT_LIMIT,
    NI_DEV_RECALL_TEXT_LIMIT,
    document,
    alert,
    toastr: globalThis.toastr,
    worldSettings: {
        state: S,
        query: q,
        escapeHtml: niEscHtml,
        saveSettings: niSaveSettings,
        canUseDerived: canUseDerivedModules,
        getAllPlots: getAllPlotsInStoryOrder,
        callApiSeq,
        alert: message => alert(message),
        prompt: (...args) => prompt(...args),
        confirm: message => confirm(message),
        logger: console,
        defaultCategories: WORLD_DEFAULT_CATEGORIES,
        extractPrompt: WORLD_EXTRACT_PROMPT,
        shrinkPrompt: WORLD_SHRINK_PROMPT,
        responseLength: WORLD_RESPONSE_LENGTH,
        lengthRetries: WORLD_LENGTH_RETRIES,
    },
});

Object.assign(window, {
    niRunDev,
    niWorldToggleCat,
    niWorldToggleEdit,
    niWorldGenOne,
    niWorldGenAll,
    niWorldAddCat,
    niWorldDeleteCat,
    niWorldSavePrompt,
});

// ============================================================
// 注入酒馆上下文
// ============================================================
async function onPromptReady(eventData) {
    if (eventData?.dryRun) return;
    // 插件总开关
    if (extension_settings[EXT_NAME]?.pluginEnabled === false) return;

    const cfg = extension_settings[EXT_NAME];

    // 获取 setExtensionPrompt 一次供后续使用
    let setExtensionPrompt;
    try {
        ({ setExtensionPrompt } = await import('/script.js'));
    } catch (e) {
        console.warn('[NI] 无法导入 setExtensionPrompt:', e);
    }

    // 辅助：执行注入，失败则降级到追加 system 消息
    function doInject(key, content, pos, depth, role, opts = {}) {
        if (opts.applyUserSub !== false) content = niApplyUserSubstitution(content);
        if (!content.trim()) return;
        if (eventData?.chat && Array.isArray(eventData.chat)) {
            niInsertIntoEventChat(eventData.chat, content, pos, depth, role);
        } else if (setExtensionPrompt) {
            setExtensionPrompt(key, content, pos, depth, true, role);
        }
    }

    const userSubIdentityPrompt = niBuildUserSubIdentityPrompt();
    if (userSubIdentityPrompt) {
        doInject(`${EXT_NAME}_user_sub`, userSubIdentityPrompt, 0, 0, 0, { applyUserSub: false });
    }
    const userRoleBoundaryPrompt = niBuildUserRoleBoundaryPrompt();
    if (userRoleBoundaryPrompt) {
        doInject(`${EXT_NAME}_user_role_boundary`, userRoleBoundaryPrompt, 0, 0, 0, { applyUserSub: false });
    }

    const ctx = getContext();
    const chat = ctx?.chat || [];
    if (!chat.length) return;
    niLoadDeviationStateFromChat({ allowLegacyMigration: false, collapsed: true, syncUI: false });

    // 已开启的阶段
    const n = S.stageMapN;
    const enabledStages = [];
    for (let i = 1; i <= n; i++) {
        if (S.stageStates[i] !== false) enabledStages.push(i);
    }

    // 读取各自的注入配置
    const vecPos   = cfg.vecInjPos   ?? DEFAULT_SETTINGS.vecInjPos;
    const vecDepth = cfg.injDepth    ?? DEFAULT_SETTINGS.injDepth;
    const vecRole  = cfg.vecInjRole  ?? DEFAULT_SETTINGS.vecInjRole;
    const charPos  = cfg.charInjPos  ?? DEFAULT_SETTINGS.charInjPos;
    const charDepth= cfg.charInjDepth?? DEFAULT_SETTINGS.charInjDepth;
    const charRole = cfg.charInjRole ?? DEFAULT_SETTINGS.charInjRole;
    const plotPos  = cfg.plotInjPos  ?? DEFAULT_SETTINGS.plotInjPos;
    const plotDepth= cfg.plotInjDepth?? DEFAULT_SETTINGS.plotInjDepth;
    const plotRole = cfg.plotInjRole ?? DEFAULT_SETTINGS.plotInjRole;

    // 分离已向量/未向量的开启阶段
    const vecInjDisabled = !!(cfg.vecInjDisabled);
    const vecStages = vecInjDisabled ? [] : enabledStages.filter(si => S.stageVecDone[si]);
    const rawStages = vecInjDisabled
        ? enabledStages.slice()
        : enabledStages.filter(si => !S.stageVecDone[si]);

    // ① 向量块注入
    if (vecStages.length) {
        // 穿书模式下，取当前节点的时间/地点作为语义锚点
        let curTbNode = null;
        if (extension_settings[EXT_NAME]?.transBookMode) {
            const tbNodes = niGetTbNodes();
            niTbReconcileCurrentNode(tbNodes);
            curTbNode = tbNodes[S.tbCurIdx] || null;
        }
        const lightRecallContext = (extension_settings[EXT_NAME]?.transBookMode && extension_settings[EXT_NAME]?.tbLightRecallMode)
            ? niBuildTbLightRecallContext(curTbNode)
            : null;
        const nodeContext = curTbNode
            ? `【当前剧情节点】${curTbNode.title} 时间：${curTbNode.time || '未知'} 地点：${curTbNode.location || '未知'}\n`
            : '';

        // 按用户设置取消息条数；各条消息单独提取后加权召回
        const msgTag    = (extension_settings[EXT_NAME]?.vecMsgTag || '').trim();
        const msgCount  = extension_settings[EXT_NAME]?.vecMsgCount ?? DEFAULT_SETTINGS.vecMsgCount;
        const recentMsgs = niSelectRecentVectorMessageTexts(chat, msgCount, msgTag);

        // 构造加权 queries：最新条权重1.0，每往前一条×0.5
        // nodeContext 拼入最新一条
        const weightedQueries = niBuildWeightedVectorQueries(recentMsgs, { nodeContext });

        if (weightedQueries.length) {
            try {
                const recallText = await recallRelevantWeighted(weightedQueries, vecStages, { lightRecallContext });
                if (recallText.trim()) {
                    const vecContent = `[小说原著相关片段·向量召回]\n${recallText}\n[/小说原著相关片段·向量召回]`;
                    doInject(`${EXT_NAME}_vec`, vecContent, vecPos, vecDepth, vecRole);
                }
            } catch (e) { console.warn('[NI] 向量召回失败:', e); }
        }
    }

    // ② 阶段剧情注入
    if (rawStages.length) {
        const rawMode = cfg.rawInjMode ?? DEFAULT_SETTINGS.rawInjMode;
        const plotLines = [];
        if (rawMode === 'compressed') {
            await niEnsureChunksLoaded();
        }

        // 穿书模式：计算哪些阶段因前序未完成而被锁定，锁定阶段跳过注入
        const tbLockedStages = new Set();
        if (extension_settings[EXT_NAME]?.transBookMode && S.stageMapN > 0) {
            const tbNodes = niGetTbNodes();
            const stageHasUndone = {};
            tbNodes.forEach(nd => { if (!nd.done) stageHasUndone[nd.stageIdx] = true; });
            const frontierStageIdx = niTbFrontierStage();
            for (let si = 1; si <= S.stageMapN; si++) {
                if (si <= frontierStageIdx) continue;
                for (let prev = frontierStageIdx; prev < si; prev++) {
                    if (stageHasUndone[prev]) { tbLockedStages.add(si); break; }
                }
            }
        }

        for (const si of rawStages) {
            if (tbLockedStages.has(si)) continue; // 5.1：前序阶段有未完成节点，跳过注入
            if (rawMode === 'compressed') {
                // 压缩原文模式：
                // 优先用 S.chunkStageMap收集该阶段的 chunk，
                // 保证边界 chunk 被正确归入相邻阶段，不依赖 plot._chunkIdx 反推。
                const chunkIdxSet = new Set();
                if (S.chunkStageMap) {
                    Object.entries(S.chunkStageMap).forEach(([rci, stageSet]) => {
                        if (stageSet.has(si)) chunkIdxSet.add(Number(rci));
                    });
                }
                // fallback：若 chunkStageMap 尚未生成，退回 plot._chunkIdx 反推
                if (!chunkIdxSet.size) {
                    (S.plots.main || []).forEach(p => {
                        if ((p.stageIdx ?? null) === si && p._chunkIdx != null) chunkIdxSet.add(p._chunkIdx);
                    });
                    (S.plots.pivot || []).forEach(p => {
                        if ((p.stageIdx ?? null) === si && p._chunkIdx != null) chunkIdxSet.add(p._chunkIdx);
                    });
                }
                const texts = [...chunkIdxSet].sort((a, b) => a - b).map(ci => {
                    return (S.chunkResults[ci] && S.chunkResults[ci].trim())
                        ? S.chunkResults[ci]
                        : (S.chunks[ci] || '');
                }).filter(t => t.trim());
                if (texts.length) {
                    plotLines.push(`【第 ${si} 阶段压缩原文】`);
                    plotLines.push(...texts);
                }
            } else {
                // 剧情节点模式
                const nodes = getNodesForStage(si);
                const allNodes = niMergeStageNodes(nodes);
                if (allNodes.length) {
                    plotLines.push(`【第 ${si} 阶段剧情节点】`);
                    allNodes.forEach(p => {
                        plotLines.push(`· ${p.title}：${p.body}`);
                    });
                }
            }
        }
        if (plotLines.length) {
            const tag = rawMode === 'compressed' ? '小说压缩原文' : '小说剧情节点';
            const plotContent = `[${tag}]\n${plotLines.join('\n')}\n[/${tag}]`;
            doInject(`${EXT_NAME}_plot`, plotContent, plotPos, plotDepth, plotRole);
        }
    }

    // ③ 角色人设注入
    const charLines = [];
    if (S.characters.length) {
        const userSubCfg = niGetUserSubConfig();
        S.characters.forEach((c, idx) => {
            if (!c.name) return;
            if (c.enabled === false) return;
            if (niIsUserSubReplaceSelectedChar(idx, userSubCfg)) return;
            const isUserSubPlayChar = niIsUserSubSelectedChar(idx, userSubCfg) && niIsUserSubPlayMode(userSubCfg);
            const lines = isUserSubPlayChar
                ? [`[用户扮演原著角色资料：<user>（原著角色：${c.name}；${c.role || '其他'}）]`]
                : [`[原著角色NPC：${c.name}（${c.role || '其他'}）]`];
            const showRaw = c.showRaw !== false;
            const showAi  = niGetCharAiShowEnabled(idx);
            const aiProfile = niGetCharAiProfile(idx);
            if (showAi && aiProfile) {
                if (typeof aiProfile === 'object') {
                    const p = aiProfile;
                    if (p.identity)    lines.push(`身份：${p.identity}`);
                    if (p.appearance)  lines.push(`外貌：${p.appearance}`);
                    if (p.personality) lines.push(`性格：${p.personality}`);
                    if (p.relations)   lines.push(`关系：${p.relations}`);
                } else {
                    lines.push(aiProfile);
                }
            } else if (showRaw) {
                if (c.identity)    lines.push(`身份：${c.identity}`);
                if (c.appearance)  lines.push(`外貌：${c.appearance}`);
                if (c.personality) lines.push(`性格：${c.personality}`);
                if (c.relations)   lines.push(`关系：${c.relations}`);
            }
            if (lines.length > 1) charLines.push(lines.join('\n'));
        });
    }
    if (charLines.length) {
        const userSubCfg = niGetUserSubConfig();
        const charIntro = userSubCfg.userSubEnabled
            ? (niIsUserSubPlayMode(userSubCfg)
                ? '说明：以下为原著角色资料。标记为“用户扮演原著角色资料：<user>”的条目属于 <user> 的既有身份与人物基础，不是独立NPC；其他角色仍作为NPC演绎。'
                : '说明：以下为原著角色NPC资料。已由“用户代入角色”映射到 <user> 的原著角色不会在此处作为独立NPC发送；其他角色仍作为NPC演绎。')
            : '说明：以下原著角色默认作为故事中的独立NPC处理，不默认等同于 <user>；不要把原著角色经历、剧情事件、身份关系或原著角色曾经做出的选择自动映射到 <user>。';
        const charContent = `[原著角色人设]\n${charIntro}\n\n${charLines.join('\n\n')}\n[/原著角色人设]`;
        doInject(`${EXT_NAME}_char`, charContent, charPos, charDepth, charRole);
    }

    // ④ 世界设定注入
    const worldPos   = cfg.worldInjPos   ?? DEFAULT_SETTINGS.worldInjPos;
    const worldDepth = cfg.worldInjDepth ?? DEFAULT_SETTINGS.worldInjDepth;
    const worldRole  = cfg.worldInjRole  ?? DEFAULT_SETTINGS.worldInjRole;
    const worldContent = niBuildWorldInjectionText(niGetWorldCategories());
    if (worldContent) {
        doInject(`${EXT_NAME}_world`, worldContent, worldPos, worldDepth, worldRole);
    }

    // ── 偏差注入 ──
    const deviationGuide = niGetDeviationGuideText({ preferUI: true }).trim();
    if (deviationGuide) {
        S.deviationGuide = deviationGuide;
        const devPos   = cfg.devInjPos   ?? DEFAULT_SETTINGS.devInjPos;
        const devDepth = cfg.devInjDepth ?? DEFAULT_SETTINGS.devInjDepth;
        const devRole  = cfg.devInjRole  ?? DEFAULT_SETTINGS.devInjRole;
        doInject(`${EXT_NAME}_dev`, `[当前剧情偏差约束]\n${deviationGuide}\n[/当前剧情偏差约束]`, devPos, devDepth, devRole);
    }

    // ── 文风注入 ──
    const styleGuide   = (q('#ni-style-result')?.value || S.styleGuide || '').trim();
    if (styleGuide) {
        const stylePos   = cfg.styleInjPos   ?? DEFAULT_SETTINGS.styleInjPos;
        const styleDepth = cfg.styleInjDepth ?? DEFAULT_SETTINGS.styleInjDepth;
        const styleRole  = cfg.styleInjRole  ?? DEFAULT_SETTINGS.styleInjRole;
        doInject(`${EXT_NAME}_style`, `[文风执行指南]\n${styleGuide}\n[/文风执行指南]`, stylePos, styleDepth, styleRole);
    }

}

// 拉取模型列表
// ============================================================
async function fetchModels(urlInputId, keyInputId, selectId, textInputId) {
    const url = q(`#${urlInputId}`)?.value?.trim();
    const key = q(`#${keyInputId}`)?.value?.trim();
    const btn = q(`#${textInputId === 'ni-clean-model' ? 'ni-clean-fetch-models' : 'ni-vec-fetch-models'}`);
    await niLoadModelList({
        url,
        key,
        showAlert: alert,
        setBusy: busy => {
            if (!btn) return;
            btn.disabled = busy;
            btn.querySelector('i').className = busy ? 'ti ti-loader' : 'ti ti-refresh';
        },
        onModels: models => {
            niApplyModelListToControls({
                models,
                selectElement: q(`#${selectId}`),
                textInputElement: q(`#${textInputId}`),
                escapeAttribute: niEscAttr,
                escapeHtml: niEscHtml,
                onSelected: value => {
                    const cfg = extension_settings[EXT_NAME];
                    if (textInputId === 'ni-clean-model') cfg.cleanModel = value;
                    else if (textInputId === 'ni-vec-model') cfg.vecModel = value;
                    niSaveSettings();
                },
            });
        },
    });
}

// ============================================================
// 处理 Tab — 文风模块
// ============================================================

/** 根据模式切换 UI 显隐*/
const niThemeEditor = createThemeEditor({
    EXT_NAME,
    DEFAULT_SETTINGS,
    extension_settings,
    q,
    sv,
    niEscAttr,
    niEscHtml,
    saveSettingsDebounced,
    refreshStatusbar: draft => {
        if (typeof niRefreshStorybarTheme === 'function') niRefreshStorybarTheme(draft);
    },
});

function niApplyCurrentTheme() {
    niThemeEditor.applyCurrentTheme();
}

function niSyncThemeUI() {
    niThemeEditor.syncUI();
}

// ============================================================
// 设置 Tab — 插件总开关
// ============================================================
function niSyncPluginToggleUI() {
    const cfg = extension_settings[EXT_NAME] || {};
    const enabled = cfg.pluginEnabled !== false;
    const chk = q('#ni-plugin-chk');
    const stateLabel = q('#ni-plugin-state');
    const hint = q('#ni-plugin-disabled-hint');
    const row = q('#ni-plugin-switch-row');
    if (chk) chk.checked = enabled;
    if (stateLabel) stateLabel.textContent = enabled ? '开' : '关';
    if (hint) hint.style.display = enabled ? 'none' : 'inline-flex';
    if (row) row.classList.toggle('ni-switch-off', !enabled);
}

function niSyncTransBookToggleUI() {
    const cfg = extension_settings[EXT_NAME] || {};
    const enabled = !!cfg.transBookMode;
    const chk = q('#ni-tb-chk');
    const stateTxt = q('#ni-tb-state');
    if (chk) chk.checked = enabled;
    if (stateTxt) stateTxt.textContent = enabled ? '开' : '关';
}

function niSetTransBookMode(enabled) {
    const cfg = extension_settings[EXT_NAME];
    cfg.transBookMode = !!enabled;
    niSyncTransBookToggleUI();
    if (enabled) {
        setTimeout(() => { niTbLoadState(); niTbRenderStoryBar(); }, 0);
    } else {
        document.getElementById('ni-storybar')?.remove();
    }
    if (typeof window.niPopSyncVisibility === 'function') window.niPopSyncVisibility();
}

function niTogglePlugin() {
    const cfg = extension_settings[EXT_NAME];
    const chk = q('#ni-plugin-chk');
    const enabled = chk ? chk.checked : cfg.pluginEnabled === false;
    cfg.pluginEnabled = enabled;
    if (!enabled) {
        cfg.tbRestoreAfterPluginEnable = !!cfg.transBookMode;
        niSetTransBookMode(false);
    } else if (cfg.tbRestoreAfterPluginEnable) {
        niSetTransBookMode(true);
        cfg.tbRestoreAfterPluginEnable = false;
    }
    niSyncPluginToggleUI();
    niSaveSettings();
    niSyncRoleplayToDepth();
}
window.niTogglePlugin = niTogglePlugin;

jQuery(async () => {

    // ── 动态注入小说库书卡样式─────
    {
        let s = document.getElementById('ni-book-grid-style');
        if (!s) { s = document.createElement('style'); s.id = 'ni-book-grid-style'; document.head.appendChild(s); }
        s.textContent = `
.ni-book-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:4px;align-items:start}
.ni-book-card{border:1.5px solid #aaa !important;border-radius:var(--border-radius-md);background:var(--color-background-secondary);padding:10px 10px 8px;cursor:default;transition:border-color .15s;display:flex;flex-direction:column}
.ni-book-card:hover{border-color:#888 !important}
.ni-book-card-active{border-color:rgba(160,68,94,.8)!important}
.ni-book-card-accent{height:3px;border-radius:2px;margin-bottom:9px;opacity:.56}
.ni-book-card-name-row{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:6px}
.ni-book-card-name{font-size:12px;font-weight:500;color:var(--color-text-primary);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin-bottom:0}
.ni-book-card-footer{display:flex;align-items:center;justify-content:flex-end;padding-top:3px;border-top:none;margin-top:auto}
.ni-book-card-pill{font-size:10px;padding:2px 5px;border-radius:999px;background:var(--ni-primary-alpha-12, rgba(160,68,94,.12));color:var(--ni-primary, #A0445E);font-weight:500;white-space:nowrap;flex-shrink:0}
.ni-book-card-acts{display:flex;gap:2px}
.ni-book-card-btn{width:22px;height:22px;border-radius:4px;border:none;background:transparent;color:var(--color-text-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:background .12s,color .12s}
.ni-book-card-btn:hover{background:var(--color-background-primary);color:var(--color-text-secondary)}
.ni-book-card-del:hover{color:rgba(192,57,43,.9)!important}
        `;
    }

    // ── 动态注入世界设定样式─────────
    {
        let ws = document.getElementById('ni-world-override-style');
        if (!ws) { ws = document.createElement('style'); ws.id = 'ni-world-override-style'; document.head.appendChild(ws); }
        ws.textContent = `
#ni-world-card{border:.5px solid var(--color-border-tertiary)!important;box-shadow:none!important;padding:8px 13px!important}
.ni-world-add-cat{margin-top:10px!important;width:100%!important;background:none!important;border:none!important;box-shadow:none!important;border-radius:0!important;padding:6px 0!important;cursor:pointer!important;color:var(--color-text-tertiary)!important;font-size:11px!important;display:inline-flex!important;align-items:center!important;justify-content:flex-start!important;gap:4px!important;min-height:unset!important;height:auto!important;margin-left:0!important;text-transform:none!important}
.ni-world-add-cat:hover{color:var(--ni-primary, #A0445E)!important;background:none!important}
.ni-world-gen-row{margin-bottom:8px!important;display:flex!important;justify-content:flex-end!important}
.ni-world-gen-all-btn{display:inline-flex!important;align-items:center!important;gap:4px!important;font-size:11px!important;font-weight:500!important;color:var(--ni-primary-focus, #B8336A)!important;border:0.5px solid var(--ni-primary-border-strong, #f4c0d1)!important;border-radius:4px!important;padding:2px 8px!important;background:transparent!important;cursor:pointer!important;white-space:nowrap!important;width:auto!important;min-height:unset!important;height:auto!important;margin:0!important;box-shadow:none!important;text-transform:none!important;letter-spacing:0!important}
.ni-world-gen-all-btn:hover{background:var(--ni-primary-soft-2, #fbeaf0)!important}
.ni-world-gen-all-btn i{font-size:12px!important}
.ni-world-regen,.ni-world-edit{background:none!important;border:none!important;box-shadow:none!important;border-radius:3px!important;padding:2px 5px!important;cursor:pointer!important;color:var(--color-text-tertiary)!important;font-size:11px!important;display:inline-flex!important;align-items:center!important;gap:3px!important;white-space:nowrap!important;width:auto!important;min-height:unset!important;height:auto!important;margin:0!important;font-weight:400!important;text-transform:none!important}
.ni-world-regen:hover,.ni-world-edit:hover{color:var(--ni-primary, #A0445E)!important;background:none!important}
.ni-world-regen:disabled{opacity:.4!important;pointer-events:none!important}
.ni-world-toggle{background:none!important;border:none!important;box-shadow:none!important;border-radius:3px!important;padding:2px 4px!important;cursor:pointer!important;color:var(--color-text-tertiary)!important;font-size:13px!important;line-height:1!important;display:inline-flex!important;align-items:center!important;flex-shrink:0!important;opacity:0.5!important;width:auto!important;min-height:unset!important;height:auto!important;margin:0!important}
.ni-world-toggle.on{color:var(--ni-primary, #A0445E)!important;opacity:1!important}
.ni-world-toggle:hover{opacity:1!important}
        `;
    }

    // ── 顶栏 Drawer───────────
    const settingsHtml = await renderExtensionTemplateAsync(EXT_FOLDER, 'template');

    // 插入顶栏抽屉
    const drawerHtml = `
      <div id="ni_drawer" class="drawer">
        <div class="drawer-toggle">
          <div id="ni_drawer_icon"
               class="drawer-icon fa-solid fa-book-open fa-fw closedIcon interactable"
               title="Novel Injector - 小说注入"
               tabindex="0">
          </div>
        </div>
        <div id="ni_drawer_content" class="drawer-content closedDrawer" style="padding:0;">
          ${settingsHtml}
        </div>
      </div>`;

    // 插入到扩展按钮之前
    const extensionsBtn = document.querySelector('.drawer-icon.fa-solid.fa-cubes');
    const extensionsDrawer = extensionsBtn?.closest('.drawer');
    if (extensionsDrawer) {
        extensionsDrawer.before($(drawerHtml)[0]);
    } else {
        // fallback：跟在已有插件抽屉最后，或扩展按钮后
        const existingDrawers = $('#extensions-settings-button').nextAll('.drawer');
        if (existingDrawers.length) {
            existingDrawers.last().after(drawerHtml);
        } else {
            $('#extensions-settings-button').after(drawerHtml);
        }
    }
    niBindTopbarIconToggleHandlers();

    // ── 在 template 插入 DOM 后，立即将 FAB/popup 挂到 body ──
    if (typeof window.niPopBootstrap === 'function') {
        window.niPopBootstrap();
    }

    // 绑定图标点击
    let _niNavbarClick = null;
    try {
        const scriptModule = await import('/script.js');
        if (scriptModule.doNavbarIconClick) _niNavbarClick = scriptModule.doNavbarIconClick;
    } catch (_) {}

    const niToggle = $('#ni_drawer .drawer-toggle');
    if (typeof _niNavbarClick === 'function') {
        // 新版酒馆：直接把整个 toggle div 的点击交给酒馆处理
        niToggle.on('click', _niNavbarClick);
    } else {
        // 旧版酒馆：手动开关
        $('#ni_drawer_content').attr('data-slide-toggle', 'hidden').css('display', 'none');
        niToggle.on('click', function () {
            const icon    = $('#ni_drawer_icon');
            const content = $('#ni_drawer_content');
            if (icon.hasClass('closedIcon')) {
                // 关闭其他已打开的 drawer
                $('.openDrawer').not('#ni_drawer_content').not('.pinnedOpen')
                    .removeClass('openDrawer').addClass('closedDrawer').hide();
                $('.openIcon').not('#ni_drawer_icon').not('.drawerPinnedOpen')
                    .removeClass('openIcon').addClass('closedIcon');
                icon.removeClass('closedIcon').addClass('openIcon');
                content.removeClass('closedDrawer').addClass('openDrawer').css('display', '');
            } else {
                icon.removeClass('openIcon').addClass('closedIcon');
                content.removeClass('openDrawer').addClass('closedDrawer').css('display', 'none');
            }
        });
    }



    // ── 用 jQuery 事件绑定替代模板中的 inline handlers ──────────
    const $app = $('#ni-app');
    q('#ni-fi')?.setAttribute('accept', NI_UPLOAD_ACCEPT);
    q('#ni-u-label') && (q('#ni-u-label').textContent = NI_UPLOAD_LABEL);
    q('#ni-u-hint') && (q('#ni-u-hint').textContent = NI_UPLOAD_HINT);

    // 上传区点击 / 拖拽
    $app.on('click', '#ni-uz', () => document.getElementById('ni-fi').click());
    $app.on('dragover', '#ni-uz', e => e.preventDefault());
    $app.on('drop', '#ni-uz', e => { e.preventDefault(); niOnDrop(e.originalEvent); });
    $app.on('change', '#ni-fi', function() { niOnFile(this); });

    // 清洗区按钮
    $app.on('click', '#ni-clean-cfg-btn', () => niTogglePanel('ni-clean-api', 'ni-clean-cfg-btn'));
    $app.on('click', '#ni-prompt-btn', () => niTogglePrompt());
    $app.on('click', '#ni-btn-clean', () => niHandleCleanButtonClick(true));
    $app.on('contextmenu', '#ni-btn-clean', e => {
        e.preventDefault();
        niHandleCleanButtonClick(false);
    });
    $app.on('click', '#ni-btn-retry', () => niHandleCleanButtonClick(false));
    $app.on('click', '#ni-btn-skip',  () => niSkipChunk());
    $app.on('click', '#ni-btn-pause', () => niPauseClean());
    $app.on('click', '.ni-chunk-run-btn', function() {
        const i = parseInt(this.dataset.chunkIdx);
        if (!isNaN(i)) niRunSingleChunk(i);
    });
    $app.on('input', '#ni-chunk-kb', () => niOnKbChange());
    $app.on('input', '#ni-api-timeout', () => niSaveSettings());
    $app.on('input', '#ni-rate-limit',   () => niSaveSettings());
    $app.on('input', '#ni-api-concurrency', () => niSaveSettings());
    $app.on('input', '#ni-vec-rate-limit', () => niSaveSettings());
    $app.on('input', '#ni-vec-concurrency', () => niSaveSettings());

    // 流式开关
    $app.on('change', '#ni-clean-stream', function() {
        niSaveSettings();
    });
    $app.on('click', '#ni-stream-btn', function() {
        const cb = q('#ni-clean-stream');
        const pill = q('#ni-stream-pill');
        if (!cb) return;
        cb.checked = !cb.checked;
        if (pill) pill.textContent = cb.checked ? '开' : '关';
        niSaveSettings();
    });

    // 提示词编辑 & 重置
    $app.on('input', '#ni-pt-content', () => niSaveSettings());
    $app.on('click', '#ni-pt-reset', () => {
        const el = q('#ni-pt-content');
        if (el) {
            el.value = CLEAN_PROMPT;
            niSaveSettings();
        }
    });

    // 演绎提示词面板
    $app.on('click', '#ni-stage-prompt-btn', () => niToggleStagePrompt());
    $app.on('click', '#ni-vec-off-btn', () => {
        const cfg = extension_settings[EXT_NAME];
        cfg.vecInjDisabled = !cfg.vecInjDisabled;
        niSaveSettings();
        niUpdateVecOffBtn();
    });

    // 开关：启用/禁用演绎提示词
    $app.on('change', '#ni-stage-pt-enabled', () => {
        const enabled = q('#ni-stage-pt-enabled')?.checked ?? true;
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].roleplayEnabled = enabled;
        niSaveSettings();
        niSyncRoleplayToDepth();
    });

    // 内容变更：自动保存并同步到 depth_prompt_prompt
    $app.on('input', '#ni-stage-pt-content', () => {
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].roleplayPrompt = q('#ni-stage-pt-content')?.value || '';
        niSaveSettings();
        niSyncRoleplayToDepth();
    });

    // 重置默认提示词
    $app.on('click', '#ni-stage-pt-reset', () => {
        const el = q('#ni-stage-pt-content');
        if (el) {
            el.value = ROLEPLAY_PROMPT;
            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
            extension_settings[EXT_NAME].roleplayPrompt = ROLEPLAY_PROMPT;
            niSaveSettings();
            niSyncRoleplayToDepth();
        }
    });

    // 清洗 API 输入框
    $app.on('input', '#ni-clean-key, #ni-clean-url, #ni-clean-model', () => niSaveSettings());
    $app.on('click', '#ni-clean-fetch-models', () =>
        fetchModels('ni-clean-url', 'ni-clean-key', 'ni-clean-model-select', 'ni-clean-model'));
    $app.on('click', '#ni-vec-fetch-models', () =>
        fetchModels('ni-vec-url', 'ni-vec-key', 'ni-vec-model-select', 'ni-vec-model'));

    // 向量化按钮
    $app.on('click', '#ni-vec-cfg-btn', () => niTogglePanel('ni-vec-api', 'ni-vec-cfg-btn'));
    $app.on('click', '#ni-vec-stage-btn', () => niToggleStagePanel());  // 选择阶段 → 展开/收起面板
    $app.on('click', '#ni-btn-vec', () => niStartVec());             // 开始向量化 → 直接用当前勾选
    $app.on('click', '#ni-btn-vec-fill', () => niVecFillMissing());    // 补全缺失向量块

    // 向量化阶段面板内按钮
    $app.on('click', '#ni-vsp-all',     () => { qa('#ni-vec-stage-selector .ni-vec-stage-chk').forEach(c => c.checked = true); });
    $app.on('click', '#ni-vsp-none',    () => { qa('#ni-vec-stage-selector .ni-vec-stage-chk').forEach(c => c.checked = false); });
    $app.on('click', '#ni-vsp-pending', () => {
        qa('#ni-vec-stage-selector .ni-vec-stage-chk').forEach(c => {
            const idx = parseInt(c.value);
            c.checked = !S.stageVecDone[idx];
        });
    });

    $app.on('click', '#ni-vsp-debug', async () => {
        try {
            const chunks = await dbLoadByNovel();
            const stageCount = {};
            chunks.forEach(c => {
                const si = Number(c.stageIdx);
                stageCount[si] = (stageCount[si] || 0) + 1;
            });

            let msg = '=== IndexedDB 诊断 ===\n';
            msg += `novelKey: ${S.novelKey || '(空)'}\n`;
            msg += `总向量块数: ${chunks.length}\n`;
            msg += `stageMapN: ${S.stageMapN}\n`;
            msg += `stageVecDone: ${JSON.stringify(S.stageVecDone)}\n\n`;

            if (chunks.length > 0) {
                msg += '各阶段实际向量块数:\n';
                let hasAnomaly = false;
                Object.entries(stageCount).sort((a,b)=>a[0]-b[0]).forEach(([si, n]) => {
                    msg += `  第${si}阶段: ${n} 块\n`;
                });
                // 检测异常：标记已向量但实际0块
                for (let si = 1; si <= S.stageMapN; si++) {
                    if (S.stageVecDone[si] && !stageCount[si]) {
                        msg += `\n⚠️ 第${si}阶段标记为已向量，但 IndexedDB 中无向量块！\n`;
                        msg += `   可能原因：API 调用失败（Key/地址/模型有误）或限速被截断。\n`;
                        msg += `   建议：检查 API 配置后重新向量化该阶段。\n`;
                        hasAnomaly = true;
                    }
                }
            } else {
                msg += '⚠️ IndexedDB 中没有任何向量数据！\n';
                if (Object.values(S.stageVecDone).some(v => v)) {
                    msg += '   但 stageVecDone 显示已向量——可能是 API 失败被忽略。\n';
                    msg += '   请检查 API 配置后重新向量化。\n';
                }
            }
            alert(msg);
        } catch(e) {
            alert('诊断失败: ' + e.message);
        }
    });

    $app.on('input', '#ni-vec-key, #ni-vec-url, #ni-vec-model', () => niSaveSettings());

    // 注入设置折叠
    $app.on('click', '#ni-inj-toggle', () => {
        const body = document.getElementById('ni-inj-body');
        if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
    });
    $app.on('input change', '#ni-inj-depth, #ni-recall-topk, #ni-recall-thresh, #ni-vec-msg-tag, #ni-vec-msg-count, #ni-vec-inj-pos, #ni-vec-inj-role, #ni-char-inj-pos, #ni-char-inj-depth, #ni-char-inj-role, #ni-plot-inj-pos, #ni-plot-inj-depth, #ni-plot-inj-role, #ni-dev-inj-pos, #ni-dev-inj-depth, #ni-dev-inj-role, #ni-global-head-inj-pos, #ni-global-head-inj-depth, #ni-global-head-inj-role, #ni-global-tail-inj-pos, #ni-global-tail-inj-depth, #ni-global-tail-inj-role', () => niSaveSettings());
    $app.on('change', '#ni-raw-inj-mode', async () => { niSaveSettings(); await niBuildStagesWithChunksIfNeeded(); }); // 切换注入模式时刷新 token 估算

    // 注入设置手风琴切换
    $app.on('click', '.ni-inj-acc-header', function() {
        const header = $(this);
        const key = header.data('ni-acc');
        const panel = q(`#ni-inj-panel-${key}`);
        const isOpen = header.hasClass('open');
        header.toggleClass('open', !isOpen);
        if (panel) panel.classList.toggle('open', !isOpen);
    });

    // 世界设定注入设置 change
    $app.on('input change', '#ni-world-inj-pos, #ni-world-inj-depth, #ni-world-inj-role', () => niSaveSettings());

    // 世界设定模块：展开/收起
    $app.on('click', '#ni-world-toggle-head', () => {
        const body = q('#ni-world-body-wrap');
        const icon = q('#ni-world-chevron');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
    });

    // 世界设定：AI全部生成
    $app.on('click', '#ni-world-gen-all', () => niWorldGenAll());

    // 世界设定：分类生成提示词
    $app.on('click', '#ni-world-prompt-btn', () => niTogglePanel('ni-world-pb', 'ni-world-prompt-btn'));
    $app.on('input change', '.ni-world-prompt-textarea', function() {
        niWorldSavePrompt(this.value);
    });

    // 世界设定：添加大类
    $app.on('click', '.ni-world-add-cat', () => niWorldAddCat());
    $app.on('click', '.ni-world-remove-btn', () => niWorldDeleteCat());

    // 用户代入角色
    $app.on('click', '#ni-user-sub-cfg-btn', () => {
        niTogglePanel('ni-user-sub-panel', 'ni-user-sub-cfg-btn');
        niRenderUserSubUI();
    });
    $app.on('click', '#ni-user-sub-prompt-btn', () => {
        niTogglePanel('ni-user-sub-pb', 'ni-user-sub-prompt-btn');
        niSyncUserSubPromptPreview();
    });
    $app.on('input change', '#ni-user-sub-prompt-preview', () => {
        niSaveUserSubPromptFromUI();
    });
    $app.on('change', '#ni-user-sub-chk', function() {
        extension_settings[EXT_NAME].userSubEnabled = this.checked;
        niSaveUserSubFromUI({ rerender: true });
    });
    $app.on('click', '.ni-user-sub-mode-btn', function() {
        const cfg = niGetUserSubConfig();
        cfg.userSubMode = niNormalizeUserSubMode(this.dataset.userSubMode);
        niRenderUserSubUI();
        saveSettingsDebounced();
        niSyncRoleplayToDepth();
    });
    $app.on('change', '#ni-user-sub-char', async function() {
        const cfg = niGetUserSubConfig();
        cfg.userSubCharIdx = this.value;
        cfg.userSubAliases = niUserSubDefaultAliasesForChar(this.value);
        await niSaveUserSubChatStates({});
        saveSettingsDebounced();
        niSyncRoleplayToDepth();
        niRenderUserSubUI();
    });
    $app.on('click', '#ni-user-sub-add', async function() {
        const cfg = niGetUserSubConfig();
        const c = S.characters[parseInt(cfg.userSubCharIdx, 10)] || null;
        cfg.userSubAliases = niReadUserSubAliasesFromUI();
        cfg.userSubAliases.push({
            text: '',
            firstStage: c ? (getCharFirstStage(c) || '') : '',
            kind: 'custom',
        });
        saveSettingsDebounced();
        niSyncRoleplayToDepth();
        niRenderUserSubUI();
        const last = q('#ni-user-sub-list .ni-user-sub-row:last-child .ni-user-sub-name');
        last?.focus();
    });
    $app.on('click', '#ni-user-sub-reset', async function() {
        await niSaveUserSubChatStates({});
        niRenderUserSubUI();
        niSyncRoleplayToDepth();
    });
    $app.on('change', '.ni-user-sub-enabled', async function() {
        const row = this.closest('.ni-user-sub-row');
        await niSaveUserSubRowState(row);
        saveSettingsDebounced();
        niSyncRoleplayToDepth();
        niSyncUserSubPromptPreview();
    });
    $app.on('input', '.ni-user-sub-name', () => {
        niSaveUserSubFromUI();
    });
    $app.on('change', '.ni-user-sub-name', async function() {
        const row = this.closest('.ni-user-sub-row');
        await niMigrateUserSubRowState(row);
        niSaveUserSubFromUI();
        await niSaveUserSubRowState(row);
        niSyncRoleplayToDepth();
    });
    $app.on('click', '.ni-user-sub-del', async function() {
        const row = this.closest('.ni-user-sub-row');
        await niDeleteUserSubRowState(row);
        row?.remove();
        niSaveUserSubFromUI({ rerender: true });
    });

    // 底栏导航
    $app.on('click', '.ni-nav-btn', function() {
        const page = $(this).data('page');
        if (page) {
            niSwitchPage(page, this);
            // 切换到阶段页时强制刷新，确保向量化状态标签实时更新
            if (page === 'stage') niBuildStagesWithChunksIfNeeded();
        }
    });

    // 剧情 tab
    $app.on('click', '#ni-pg-plot .ni-tab', function() {
        const tab = $(this).data('tab');
        if (tab) niSwitchTab(tab, this);
    });

    // 偏差分析
    $app.on('click', '#ni-btn-dev', async () => {
        const result = await niRunDev();
        if (result?.ok) niResetDevAutoCounter();
    });
    $app.on('click', '#ni-dev-cfg-btn', () => {
        niToggleDevCfgPanel();
    });
    $app.on('click', '#ni-dev-prompt-btn', () => {
        niTogglePanel('ni-dev-pb', 'ni-dev-prompt-btn');
    });
    $app.on('change', '#ni-dev-auto-enabled', async () => {
        niSyncDevAutoUI({ syncNote: true });
        niSaveSettings();
        if (!q('#ni-dev-auto-enabled')?.checked) {
            S.devAutoLastFloor = null;
            return;
        }
        await niStartDevAutoCatchup({ announce: true }).catch(e => {
            console.warn('[NI] 自动偏差分析启动失败:', e);
            const noteEl = q('#ni-dev-note');
            if (noteEl) noteEl.textContent = `自动更新启动失败: ${e.message || e}`;
            return { ok: false, error: e };
        });
    });
    $app.on('input change', '#ni-dev-auto-every, #ni-dev-manual-msg-count', () => {
        niSyncDevAutoUI();
        niSaveSettings();
        niResetDevAutoCounter();
    });
    $app.on('input', '#ni-dev-pt-content', () => niSaveSettings());
    $app.on('click', '#ni-dev-pt-reset', () => {
        const el = q('#ni-dev-pt-content');
        if (el) el.value = DEV_PROMPT;
        niSaveSettings();
    });
    $app.on('input', '#ni-dev-changed-facts, #ni-dev-current-constraint, #ni-dev-preserved-facts', function() {
        const sections = niUpdateDeviationSectionsFromUI();
        if (!niBuildDeviationGuideFromSections(sections).trim()) {
            S.devCoveredFloor = 0;
            S.devLastRange = null;
        }
        niSyncDeviationResultUI({ preserveBody: true });
        niQueueDeviationGuideSave();
    });
    $app.on('blur', '#ni-dev-changed-facts, #ni-dev-current-constraint, #ni-dev-preserved-facts', async function() {
        const sections = niUpdateDeviationSectionsFromUI();
        if (!niBuildDeviationGuideFromSections(sections).trim()) {
            S.devCoveredFloor = 0;
            S.devLastRange = null;
        }
        await niQueueDeviationGuideSave({ immediate: true });
        niSyncDeviationResultUI({ preserveBody: true });
    });
    $app.on('click', '#ni-dev-retry-btn', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await niRunDev({ retry: true });
    });
    $app.on('click', '#ni-dev-result-toggle', (e) => {
        if (e.target?.closest?.('#ni-dev-retry-btn')) return;
        const body = q('#ni-dev-result-body');
        const btn  = q('#ni-dev-result-toggle > i:last-child');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (btn) btn.className = isOpen ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
    });

    // 剧情tab切换时记录当前tab，并根据是否时间轴隐藏删除/编辑按钮
    $app.on('click', '.ni-plot-tab-row .ni-tab[data-tab]', function() {
        niSetCurrentPlotTab($(this).data('tab') || 'timeline');
        niSyncPlotActionButtons(true);
    });

    $app.on('click', '#ni-plot-link-btn', () => niRepairBranchLinks());
    $app.on('click', '#ni-plot-add-btn', () => {
        const currentPlotTab = niGetCurrentPlotTab();
        const type = ['main','sub','pivot'].includes(currentPlotTab) ? currentPlotTab : 'main';
        niOpenPlotModal('add', type, null);
    });
    // 剧情事件 编辑模式
    $app.on('click', '#ni-plot-edit-btn', () => niTogglePlotEdit());
    // 剧情事件 删除模式
    $app.on('click', '#ni-plot-del-btn', () => niTogglePlotDel());
    // 删除确认/取消
    $app.on('click', '#ni-plot-del-cancel', () => niTogglePlotDel());
    $app.on('click', '#ni-plot-del-confirm', () => niConfirmPlotDel());
    // modal 保存/取消
    $app.on('click', '#ni-plot-modal-save', () => niSavePlotModal());
    $app.on('click', '#ni-plot-modal-cancel', () => niClosePlotModal());
    // modal 点背景关闭
    $app.on('click', '#ni-plot-modal', function(e) { if (e.target === this) niClosePlotModal(); });
    // modal 类型按钮
    $app.on('click', '.ni-plot-type-btn', function() {
        qa('.ni-plot-type-btn').forEach(b => b.classList.remove('on'));
        this.classList.add('on');
        const type = $(this).data('ptype');
        niRefreshPlotParentField(type, q('#ni-plot-modal-title-input')?.value.trim() || '');
        niRefreshPlotInsertField(type);
    });
    // 删除模式：点击事件卡选中
    $app.on('click', '.ni-plot-del-mode .ni-plot-item, .ni-plot-del-mode .ni-tl-item', function(e) {
        e.stopPropagation();
        const el = this;
        // 从id反推 type 和 idx
        const id = el.id; // ni-pi-ni-tp-main-0 或 ni-tl-main-0
        let type = null, idx = null;
        const m1 = id.match(/ni-pi-ni-tp-(main|sub|pivot)-(\d+)/);
        const m2 = id.match(/ni-tl-(main|sub|pivot)-(\d+)/);
        const m = m1 || m2;
        if (m) { type = m[1]; idx = parseInt(m[2]); }
        if (!type) return;
        const key = `${type}:${idx}`;
        el.classList.toggle('ni-plot-selected', niTogglePlotDeleteSelection(key));
    });
    // 编辑模式：点击事件卡弹出编辑框
    $app.on('click', '.ni-plot-edit-mode .ni-plot-item, .ni-plot-edit-mode .ni-tl-item', function(e) {
        e.stopPropagation();
        const id = this.id;
        const m1 = id.match(/ni-pi-ni-tp-(main|sub|pivot)-(\d+)/);
        const m2 = id.match(/ni-tl-(main|sub|pivot)-(\d+)/);
        const m = m1 || m2;
        if (!m) return;
        niTogglePlotEdit(); // 退出编辑模式
        niOpenPlotModal('edit', m[1], parseInt(m[2]));
    });

    // 阶段划分面板按钮
    $app.on('click', '#ni-stage-map-btn', () => niOpenStagePanel());
    $app.on('click', '#ni-sp-ai-btn',     () => niAutoStageByPivot());
    $app.on('click', '.ni-sp-add-btn',    () => niAddStageSlot());
    $app.on('click', '.ni-sp-cancel-btn', () => niCloseStagePanel());
    $app.on('click', '#ni-sp-confirm-btn',() => niConfirmStageMap());

    // 阶段/角色 AI 生成按钮
    $app.on('click', '#ni-btn-gen-chars',  () => niGenCharsManual());
    $app.on('click', '.ni-char-ai-one-btn', function(e) {
        e.preventDefault();
        e.stopPropagation();
        niGenOneCharManual(Number(this.dataset.charIdx));
    });
    $app.on('click', '#ni-btn-gen-stages',       () => niGenStagesManual(false));
    $app.on('click', '#ni-btn-gen-stages-empty', () => niGenStagesManual(true));

    // 角色 Tab 切换
    $app.on('click', '#ni-char-tab-row .ni-tab', function() {
        niSwitchCharTab($(this).data('role'));
    });
    // + 添加角色：打开弹窗
    $app.on('click', '#ni-btn-add-char', () => {
        const modal = q('#ni-add-char-modal');
        if (modal) {
            q('#ni-new-char-name').value = '';
            ['identity','appearance','personality','relations'].forEach(k => {
                const el = q(`#ni-new-char-${k}`);
                if (el) el.value = '';
            });
            const genderEl = q('#ni-new-char-gender');
            if (genderEl) genderEl.value = '';
            // 填充登场阶段选项
            const fsEl = q('#ni-new-char-firststage');
            if (fsEl) {
                fsEl.innerHTML = '<option value="">— 不指定 —</option>' +
                    Array.from({length: S.stageMapN}, (_, k) => k + 1)
                        .map(s => `<option value="${s}">第 ${s} 阶段</option>`).join('');
            }
            modal.style.display = 'flex';
        }
    });
    // 弹窗取消
    $app.on('click', '#ni-add-char-cancel', () => {
        const modal = q('#ni-add-char-modal');
        if (modal) modal.style.display = 'none';
    });
    // 弹窗点背景关闭
    $app.on('click', '#ni-add-char-modal', function(e) {
        if (e.target === this) this.style.display = 'none';
    });
    // 弹窗确认添加
    $app.on('click', '#ni-add-char-confirm', () => {
        const name        = q('#ni-new-char-name')?.value?.trim();
        const role        = q('#ni-new-char-role')?.value || '其他';
        const gender      = q('#ni-new-char-gender')?.value?.trim()      || '';
        const identity    = q('#ni-new-char-identity')?.value?.trim()    || '';
        const appearance  = q('#ni-new-char-appearance')?.value?.trim()  || '';
        const personality = q('#ni-new-char-personality')?.value?.trim() || '';
        const relations   = q('#ni-new-char-relations')?.value?.trim()   || '';
        if (!name) { alert('请输入角色姓名'); return; }
        // 登场阶段 → 反查 stageMap 得到 _firstChunkIdx
        const fsVal = q('#ni-new-char-firststage')?.value;
        const fsStage = fsVal ? parseInt(fsVal) : null;
        let firstChunkIdx = null;
        if (fsStage != null && S.stageMapN > 0) {
            const entry = Object.entries(S.stageMap).find(([, si]) => si === fsStage);
            if (entry) firstChunkIdx = Number(entry[0]);
        }
        S.characters.push({ name, role, gender, identity, appearance, personality, relations, enabled: true, _firstChunkIdx: firstChunkIdx });
        niSaveSettings();
        niSwitchCharTab(role);
        const modal = q('#ni-add-char-modal');
        if (modal) modal.style.display = 'none';
    });
    // - 删除模式切换
    $app.on('click', '#ni-btn-del-char', () => niToggleCharDel());
    // 删除模式：点击角色卡选中/取消
    $app.on('click', '.ni-char-card.ni-del-mode', function(e) {
        // 不拦截内部按钮/checkbox等的点击
        if ($(e.target).closest('button, a, input, label').length) return;
        const idx = parseInt($(this).attr('id').replace('ni-cc-', ''));
        if (isNaN(idx)) return;
        $(this).toggleClass('ni-plot-selected', niToggleCharDeleteSelection(idx));
    });
    // 删除模式：取消
    $app.on('click', '#ni-char-del-cancel-btn', () => niToggleCharDel());
    // 删除模式：确认删除
    $app.on('click', '#ni-char-del-confirm-btn', () => niConfirmCharDel());

    // 动态生成元素的事件委托
    $app.on('click', '.ni-plot-head', function(e) {
        if (niIsPlotInteractionModeActive()) {
            e.preventDefault();
            return;
        }
        niTogglePlot($(this).data('plot-id'));
    });
    // Timeline node toggle
    $app.on('click', '.ni-tl-head', function(e) {
        if (niIsPlotInteractionModeActive()) {
            e.preventDefault();
            return;
        }
        const id = $(this).data('tl-id');
        q(`#${id}`)?.classList.toggle('open');
    });
    // Timeline branch link: jump to sub tab and expand that sub plot
    $app.on('click', '.ni-tl-branch-link', function() {
        const subIdx = parseInt($(this).data('sub-idx'));
        const subTabBtn = q('#ni-pg-plot .ni-plot-tab-row .ni-tab[data-tab="sub"]');
        niSwitchTab('sub', subTabBtn);
        setTimeout(() => {
            const items = qa('#ni-tp-sub .ni-plot-item');
            items.forEach(el => el.classList.remove('open'));
            if (items[subIdx]) {
                items[subIdx].classList.add('open');
                items[subIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 60);
    });
    $app.on('click', '.ni-stage-link', function() {
        niJumpToStage(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-char-stage-tag', function() {
        niJumpToStage(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-char-edit-btn', function() {
        niEditChar(parseInt($(this).data('char-idx')));
    });
    $app.on('click', '.ni-char-save-btn', async function() {
        await niSaveChar(parseInt($(this).data('char-idx')));
    });
    $app.on('click', '#ni-char-auto-sleep-btn', function() {
        const cfg = extension_settings[EXT_NAME] || {};
        cfg.charAutoSleepEnabled = !niCharAutoSleepEnabled();
        cfg._charAutoSleepInitialized = true;
        extension_settings[EXT_NAME] = cfg;
        niSyncCharAutoSleepUI();
        saveSettingsDebounced();
    });
    // 单个角色开关
    $app.on('click', '.ni-char-chk', function() {
        const i = parseInt($(this).data('char-idx'));
        if (!S.characters[i]) return;
        const nowOn = !$(this).hasClass('ni-char-chk-on');
        S.characters[i].enabled = nowOn;
        niClearCharAutoSleep(S.characters[i]);
        $(this).toggleClass('ni-char-chk-on', nowOn);
        q(`#ni-cc-${i}`)?.classList.toggle('ni-char-disabled', !nowOn);
        niSaveSettings();
        renderCharacters();
    });
    // 原始人设眼睛
    $app.on('click', '.ni-char-eye-raw', function() {
        const i = parseInt($(this).data('char-idx'));
        if (!S.characters[i]) return;
        S.characters[i].showRaw = S.characters[i].showRaw === false ? true : false;
        niSaveSettings();
        renderCharacters();
    });
    // AI人设眼睛
    $app.on('click', '.ni-char-eye-ai, .ni-char-eye-ai-r', async function() {
        const i = parseInt($(this).data('char-idx'));
        if (!S.characters[i]) return;
        await niSetCharAiShowEnabled(i, !niGetCharAiShowEnabled(i));
        niSaveSettings();
        renderCharacters();
    });
    // 全开当前 tab 角色
    $app.on('click', '#ni-char-enable-all, #ni-char-enable-all-simple', () => {
        const charTab = niGetCurrentCharTab();
        S.characters.forEach(c => { if ((c.role || '其他') === charTab) { c.enabled = true; niClearCharAutoSleep(c); } });
        niSaveSettings(); renderCharacters();
    });
    // 全关当前 tab 角色
    $app.on('click', '#ni-char-disable-all, #ni-char-disable-all-simple', () => {
        const charTab = niGetCurrentCharTab();
        S.characters.forEach(c => { if ((c.role || '其他') === charTab) { c.enabled = false; niClearCharAutoSleep(c); } });
        niSaveSettings(); renderCharacters();
    });
    // 阶段抽屉：触发按钮开关
    $app.on('click', '#ni-drawer-trigger', function(e) {
        e.stopPropagation();
        const panel = q('#ni-drawer-panel');
        const trigger = q('#ni-drawer-trigger');
        if (!panel) return;
        const isOpen = panel.classList.toggle('open');
        trigger.classList.toggle('open', isOpen);
        if (isOpen) niRenderStageDrawer();
    });
    // 阶段抽屉：点击外部关闭
    $(document).on('click.ni-drawer', function(e) {
        const panel = q('#ni-drawer-panel');
        if (!panel || !panel.classList.contains('open')) return;
        const drawer = q('#ni-stage-drawer');
        if (drawer && !drawer.contains(e.target)) {
            panel.classList.remove('open');
            q('#ni-drawer-trigger')?.classList.remove('open');
        }
    });
    // 阶段抽屉：全选
    // 阶段抽屉：显示/隐藏空阶段
    $app.on('click', '#ni-drawer-toggle-empty', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const showEmptyStages = niToggleShowEmptyStages();
        // 切换所有空阶段行的显示状态
        const n = S.stageMapN > 0 ? S.stageMapN : 0;
        const stageOnCount = niCalcStageOnCount();
        for (let i = 1; i <= n; i++) {
            const cnt = stageOnCount[i];
            const isEmpty = !cnt || cnt.total === 0;
            if (!isEmpty) continue;
            const row = q(`.ni-drawer-item[data-drawer-stage="${i}"]`);
            if (row) row.style.display = showEmptyStages ? '' : 'none';
        }
        niSyncEmptyToggleBtn();
    });
    $app.on('click', '#ni-drawer-all', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const n = S.stageMapN;
        for (let i = 1; i <= n; i++) niToggleCharsByStage(i, true);
        // 全选后同步 checkbox 状态并更新 note
        for (let i = 1; i <= n; i++) {
            const cb = q(`#ni-dchk-${i}`);
            if (cb) cb.checked = true;
        }
        niUpdateStageDrawerNote();
    });
    // 阶段抽屉：全不选
    $app.on('click', '#ni-drawer-none', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const n = S.stageMapN;
        for (let i = 1; i <= n; i++) niToggleCharsByStage(i, false);
        // 全不选后同步 checkbox 状态并更新 note
        for (let i = 1; i <= n; i++) {
            const cb = q(`#ni-dchk-${i}`);
            if (cb) cb.checked = false;
        }
        niUpdateStageDrawerNote();
    });
    // 阶段抽屉：单个阶段 checkbox
    $app.on('change', '.ni-drawer-item input[type=checkbox]', function(e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('drawer-stage'));
        if (!isNaN(idx)) {
            niToggleCharsByStage(idx, this.checked);
            niUpdateStageDrawerNote();  // 只更新文字，不重建列表
        }
    });
    // 阶段抽屉：点击 item 行触发
    $app.on('click', '.ni-drawer-item', function(e) {
        e.stopPropagation();
        // checkbox 和 label 内部点击均交由原生行为 + change 事件处理，不重复处理
        if (e.target.type === 'checkbox' || e.target.closest('label')) return;
        const cb = this.querySelector('input[type=checkbox]');
        if (!cb) return;
        if (cb.disabled) return;
        cb.checked = !cb.checked;
        // 手动触发 change 事件，统一走 change 分支
        $(cb).trigger('change');
    });
    $app.on('click', '#ni-stage-enable-all', () => {
        const n = S.stageMapN;
        for (let i = 1; i <= n; i++) {
            if (!S.stageStates[i]) niToggleStage(i);
        }
    });
    $app.on('click', '#ni-stage-disable-all', () => {
        const n = S.stageMapN;
        for (let i = 1; i <= n; i++) {
            if (S.stageStates[i]) niToggleStage(i);
        }
    });
    $app.on('click', '.ni-stg-chk', function() {
        niToggleStage(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-stage-expand-btn', function() {
        niToggleStageBody(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-stage-save-btn', function() {
        niSaveStage(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-stage-cancel-btn', function() {
        niCancelStageEdit(parseInt($(this).data('stage-idx')));
    });
    $app.on('click', '.ni-node-pill', function() {
        const plotType = $(this).data('plot-type');
        const stageIdx = parseInt($(this).data('stage-idx'));
        const container = q(`#ni-pin-${stageIdx}`);
        // If already expanded for this type → collapse; otherwise expand
        if (container && container.style.display !== 'none' && container.dataset.activeType === plotType) {
            container.style.display = 'none';
            container.dataset.activeType = '';
            $(this).removeClass('ni-pill-active');
        } else {
            // Render inline node list
            const nodes = getNodesForStage(stageIdx);
            const typeMap = { main: '主线节点', sub: '支线节点', pivot: '关键转折' };
            const items = nodes[plotType] || [];
            if (!items.length) { niGoPlot(plotType, stageIdx); return; }
            const html = items.map((p, idx) => `<div class="ni-pin-row ni-pin-type-${plotType}" data-plot-type="${plotType}" data-stage-idx="${stageIdx}" data-item-idx="${idx}" data-node-id="${niEscAttr(niEnsurePlotNodeId(p, plotType, idx))}">
              <i class="ti ti-git-branch ni-pin-icon"></i>
              <span class="ni-pin-title">${niEscHtml(p.title || '')}</span>
              ${p.location ? `<span class="ni-pin-loc"><i class="ti ti-map-pin"></i>${niEscHtml(p.location)}</span>` : ''}
            </div>`).join('');
            container.innerHTML = `<div class="ni-pin-label">${typeMap[plotType] || plotType}</div>${html}`;
            container.dataset.activeType = plotType;
            container.style.display = 'block';
            // Highlight active pill, unhighlight others in same stage
            $(this).closest('.ni-stage-node-pills').find('.ni-node-pill').removeClass('ni-pill-active');
            $(this).addClass('ni-pill-active');
        }
    });
    $app.on('click', '.ni-pin-row', function() {
        const plotType = $(this).data('plot-type');
        const stageIdx = parseInt($(this).data('stage-idx'));
        const itemIdx = parseInt($(this).data('item-idx'));
        const nodeId = $(this).data('node-id');
        niGoPlot(plotType, stageIdx, itemIdx, nodeId);
    });
    $app.on('click', '.ni-sp-node-row', function() {
        niToggleChunkInSlot(parseInt($(this).data('slot-id')), parseInt($(this).data('chunk-idx')));
    });
    $app.on('click', '.ni-slot-toggle', function(e) {
        if ($(e.target).closest('.ni-slot-del-btn').length) return;
        const sid = String($(this).data('slot-id'));
        if (!window._slotOpenStates) window._slotOpenStates = {};
        window._slotOpenStates[sid] = !window._slotOpenStates[sid];
        niRenderStageSlots();
    });
    $app.on('click', '.ni-slot-del-btn', function(e) {
        e.stopPropagation();
        niRemoveStageSlot(parseInt($(this).data('slot-id')));
    });
    $app.on('change', '.ni-slot-name-input', function() {
        niSlotRename(parseInt($(this).data('slot-id')), $(this).val());
    });
    // Fix③: 未分配节点区域折叠切换
    $app.on('click', '#ni-unassigned-head', function() {
        window._unassignedOpen = !window._unassignedOpen;
        niRenderStageSlots();
    });

    // 加载设置
    niLoadSettings();
    niSyncTopbarIconVisibility();
    niEnsureExtensionsMenuTopbarToggle();
    niRenderWorldSettings();
    // 设置 Tab 事件绑定
    // 插件总开关
    $app.on('change', '#ni-plugin-chk', () => niTogglePlugin());

    // 外观配色
    $app.on('click', '#ni-theme-toggle-head', () => niThemeEditor.togglePanel());
    $app.on('change', '#ni-theme-preset', function() {
        niThemeEditor.setPreset(this.value);
    });
    $app.on('input change', '.ni-theme-color-input', function() {
        niThemeEditor.setColor(this.dataset.themeColor, this.value);
    });
    $app.on('input', '.ni-theme-code', function() {
        niThemeEditor.setColorFromText(this.dataset.themeColorCode, this.value);
    });
    $app.on('blur', '.ni-theme-code', function() {
        niThemeEditor.restoreColorText(this.dataset.themeColorCode);
    });
    $app.on('change', '#ni-theme-surface-follow', function() {
        niThemeEditor.setSurfaceFollow(this.checked);
    });
    $app.on('change', '#ni-theme-borderless', function() {
        niThemeEditor.setBorderless(this.checked);
    });
    $app.on('change', '#ni-theme-cardless', function() {
        niThemeEditor.setCardless(this.checked);
    });
    $app.on('change', '#ni-theme-statusbar-follow', function() {
        niThemeEditor.setStatusbarFollow(this.checked);
    });
    $app.on('change', '#ni-theme-icon-replace', function() {
        niThemeEditor.setIconReplace(this.checked);
    });
    $app.on('click', '#ni-theme-import', () => q('#ni-theme-import-file')?.click());
    $app.on('change', '#ni-theme-import-file', function() {
        niThemeEditor.importPresetFile(this.files?.[0]);
        this.value = '';
    });
    $app.on('click', '#ni-theme-export', () => niThemeEditor.exportPreset());
    $app.on('click', '#ni-theme-delete', () => niThemeEditor.deletePreset());
    $app.on('click', '#ni-theme-new', () => niThemeEditor.newPreset());
    $app.on('click', '#ni-theme-save', () => niThemeEditor.savePreset());

    // 全局提示词面板
    $app.on('click', '#ni-global-prompt-btn', () => niToggleGlobalPrompt());
    $app.on('change', '#ni-global-source-tavern, #ni-global-source-builtin, #ni-global-source-none', function() {
        if (!this.checked) {
            this.checked = true;
            return;
        }
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].globalPromptSource =
            this.id === 'ni-global-source-tavern' ? 'tavern' :
            this.id === 'ni-global-source-none' ? 'none' :
            'builtin';
        niSyncGlobalPromptSourceUI(extension_settings[EXT_NAME]);
        niSaveSettings();
    });
    $app.on('input', '#ni-global-pt-content', () => {
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].globalPrompt = q('#ni-global-pt-content')?.value ?? GLOBAL_PROMPT;
        niSaveSettings();
    });
    $app.on('input', '#ni-global-tail-pt-content', () => {
        if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
        extension_settings[EXT_NAME].globalTailPrompt = q('#ni-global-tail-pt-content')?.value ?? GLOBAL_TAIL_PROMPT;
        niSaveSettings();
    });
    $app.on('click', '#ni-global-pt-reset', () => {
        const el = q('#ni-global-pt-content');
        if (el) {
            el.value = GLOBAL_PROMPT;
            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
            extension_settings[EXT_NAME].globalPrompt = GLOBAL_PROMPT;
            niSaveSettings();
        }
    });
    $app.on('click', '#ni-global-tail-pt-reset', () => {
        const el = q('#ni-global-tail-pt-content');
        if (el) {
            el.value = GLOBAL_TAIL_PROMPT;
            if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
            extension_settings[EXT_NAME].globalTailPrompt = GLOBAL_TAIL_PROMPT;
            niSaveSettings();
        }
    });

    // 小说库 — 保存快照面板
    $app.on('click', '#ni-lib-save-btn', () => {
        const panel = q('#ni-lib-save-panel');
        if (panel) panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
    $app.on('click', '#ni-lib-save-cancel', () => {
        const panel = q('#ni-lib-save-panel');
        if (panel) panel.style.display = 'none';
    });
    $app.on('click', '#ni-lib-save-confirm', () => {
        const name = q('#ni-lib-save-name')?.value?.trim();
        if (!name) { alert('请输入快照名称'); return; }
        niSaveNovelSnapshot(name);
        const panel = q('#ni-lib-save-panel');
        if (panel) panel.style.display = 'none';
        q('#ni-lib-save-name') && (q('#ni-lib-save-name').value = '');
    });
    // 小说库 — 加载/删除
    $app.on('click', '.ni-lib-load-btn', function() {
        niLoadNovelSnapshot(parseInt($(this).data('lib-idx')));
    });
    $app.on('click', '.ni-lib-del-btn', async function() {
        await niDeleteNovelSnapshot(parseInt($(this).data('lib-idx')));
    });
    $app.on('click', '.ni-lib-update-btn', function() {
        niUpdateNovelSnapshot(parseInt($(this).data('lib-idx')));
    });
    $app.on('click', '.ni-lib-rename-btn', function() {
        niRenameNovelSnapshot(parseInt($(this).data('lib-idx')));
    });

    // 导入/导出
    $app.on('click', '#ni-export-btn', () => niExportData());
    $app.on('click', '#ni-import-btn', () => q('#ni-import-fi')?.click());
    $app.on('change', '#ni-import-fi', function() {
        const f = this.files?.[0];
        if (f) { niImportData(f); this.value = ''; }
    });

    // 清除缓存
    $app.on('click', '#ni-clear-vec-btn', () => niClearVecCache());
    $app.on('click', '#ni-clear-all-btn', () => niClearAllData());

    // ── 文风模块 ──
    // 设置面板开关
    $app.on('click', '#ni-style-cfg-btn', () => {
        niTogglePanel('ni-style-cfg-panel', 'ni-style-cfg-btn');
        // 打开时填充段落下拉
        if (q('#ni-style-cfg-panel')?.classList.contains('on')) niStylePopulateChunkSel();
    });
    // 提示词面板开关
    $app.on('click', '#ni-style-prompt-btn', () => {
        niTogglePanel('ni-style-pb', 'ni-style-prompt-btn');
    });
    // 提示词重置
    $app.on('click', '#ni-style-pt-reset', () => {
        const el = q('#ni-style-pt-content');
        if (el) el.value = STYLE_PROMPT;
        niSaveSettings();
    });
    // 模式切换
    $app.on('change', '#ni-style-mode', () => {
        niStyleSyncMode();
        niSaveSettings();
    });
    // 采样参数变更 → 保存
    $app.on('change', '#ni-style-sample-len, #ni-style-chunk-sel', () => niSaveSettings());
    // 结果手动编辑 → 同步到 S.styleGuide
    $app.on('input', '#ni-style-result', function() {
        S.styleGuide = this.value;
    });
    $app.on('blur', '#ni-style-result', async function() {
        S.styleGuide = this.value;
        niSaveSettings();
        if (S.novelKey) await niServerSaveHeavy(S.novelKey, S.heavyFileKey);
    });
    // 结果区收起/展开
    $app.on('click', '#ni-style-result-toggle', () => {
        const body = q('#ni-style-result-body');
        const btn  = q('#ni-style-result-toggle i:last-child');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (btn) btn.className = isOpen ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
    });
    // 生成文风按钮
    $app.on('click', '#ni-btn-style', () => niGenerateStyle());

    // 切换到设置页时刷新小说库和缓存信息
    $app.on('click', '.ni-nav-btn[data-page="settings"]', () => {
        niRenderNovelLibrary();

    });

    // 恢复 UI 状态
    if (canUseDerivedModules(S)) {
        // 恢复文件状态显示
        if (S.chunkStatus.length) {
            q('#ni-chunk-info').style.display = 'block';
            q('#ni-st-chunks').textContent = S.chunkStatus.length;
            renderChunkList();
        }
        renderPlots();
        renderCharacters();
        buildStages();
        setBtn('#ni-btn-vec', false);
        if (S.vecDone) {
            setBtn('#ni-btn-vec', false, '<i class="ti ti-check"></i>向量化完成');
        }
        niStylePopulateChunkSel();
        niSyncCleanButtonState();
    }

    // 监听酒馆事件：发消息前注入上下文
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
    eventSource.makeLast?.(event_types.CHAT_COMPLETION_PROMPT_READY, niFinalUserSubPromptRewrite);
    eventSource.makeLast?.(event_types.MESSAGE_RECEIVED, niPostprocessUserSubMessage);
    niBindDeviationAutoUpdateEvents();
    niResetDevAutoCounter();
    setTimeout(() => {
        niStartDevAutoCatchup().catch(e => console.warn('[NI] 自动偏差分析启动追赶失败:', e));
    }, 800);

    console.log('[NI] 小说注入插件 加载完成');
});

// ============================================================
// 阶段划分面板
// ============================================================

// 面板内临时状态：{ slotId: { label, chunkSet: Set<chunkIdx> } }
// ── niSaveSettings / syncSettingsToUI 补丁 ───────────────────
// 在插件已有的 niSaveSettings / syncSettingsToUI 之后追加穿书字段同步

const _niSaveSettingsOrig = window.niSaveSettings;
window.niSaveSettings = function () {
    if (typeof _niSaveSettingsOrig === 'function') _niSaveSettingsOrig();
    const cfg = extension_settings[EXT_NAME];
    if (cfg.pluginEnabled !== false) {
        cfg.transBookMode = document.getElementById('ni-tb-chk')?.checked ?? cfg.transBookMode;
    }
    cfg.tbAdvancePrompt  = document.getElementById('ni-tb-advance-prompt')?.value || cfg.tbAdvancePrompt;
    cfg.tbInferPrompt    = document.getElementById('ni-tb-infer-prompt')?.value   || cfg.tbInferPrompt;
    cfg.tbOngoingPrompt  = document.getElementById('ni-tb-ongoing-prompt')?.value || cfg.tbOngoingPrompt;
    cfg.tbDisplayStatusbar = document.getElementById('ni-tb-display-statusbar')?.checked ?? cfg.tbDisplayStatusbar;
    cfg.tbDisplayPopup     = document.getElementById('ni-tb-display-popup')?.checked     ?? cfg.tbDisplayPopup;
    cfg.tbLightRecallMode  = document.getElementById('ni-tb-light-recall-mode')?.checked ?? cfg.tbLightRecallMode;
    cfg.tbImmersionMode    = document.getElementById('ni-tb-immersion-mode')?.checked ?? cfg.tbImmersionMode;
    cfg.tbImmersionPrompt  = document.getElementById('ni-tb-immersion-prompt')?.value || cfg.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT;
};

// syncSettingsToUI 补丁：切换到设置页时将穿书字段同步到 UI
const _niSyncSettingsToUIOrig = window.syncSettingsToUI || syncSettingsToUI;
const _niSyncSettingsToUIPatched = function () {
    if (typeof _niSyncSettingsToUIOrig === 'function') _niSyncSettingsToUIOrig();
    const cfg = extension_settings[EXT_NAME] || {};
    const chk = document.getElementById('ni-tb-chk');
    if (chk) niSyncTransBookToggleUI();
    const advEl = document.getElementById('ni-tb-advance-prompt');
    if (advEl) advEl.value = cfg.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT;
    const inferEl = document.getElementById('ni-tb-infer-prompt');
    if (inferEl) inferEl.value = cfg.tbInferPrompt || TB_DEFAULT_INFER_PROMPT;
    const ongoingEl = document.getElementById('ni-tb-ongoing-prompt');
    if (ongoingEl) ongoingEl.value = cfg.tbOngoingPrompt || TB_DEFAULT_ONGOING_PROMPT;
    const statusbarChkSync = document.getElementById('ni-tb-display-statusbar');
    if (statusbarChkSync) statusbarChkSync.checked = !!cfg.tbDisplayStatusbar;
    const popupChkSync = document.getElementById('ni-tb-display-popup');
    if (popupChkSync) popupChkSync.checked = !!cfg.tbDisplayPopup;
    const lightRecallModeChkSync = document.getElementById('ni-tb-light-recall-mode');
    if (lightRecallModeChkSync) lightRecallModeChkSync.checked = !!cfg.tbLightRecallMode;
    const immersionModeChkSync = document.getElementById('ni-tb-immersion-mode');
    if (immersionModeChkSync) immersionModeChkSync.checked = !!cfg.tbImmersionMode;
    const immersionPromptEl = document.getElementById('ni-tb-immersion-prompt');
    if (immersionPromptEl) immersionPromptEl.value = cfg.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT;
    if (typeof niSyncGlobalPromptSourceUI === 'function') niSyncGlobalPromptSourceUI(cfg);
};
window.syncSettingsToUI = _niSyncSettingsToUIPatched;

// ── onPromptReady 补丁：注入穿书推进提示词 ───────────────────
// 直接在 CHAT_COMPLETION_PROMPT_READY 上追加一个独立监听
// 注意：此处不再重复 import，而是直接追加到 eventData.chat，
// 与 onPromptReady 内 doInject 的 fallback 逻辑一致，避免双重 import 开销。
jQuery(document).ready(function () {
    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (eventData) => {
            if (eventData?.dryRun) return;
            if (extension_settings[EXT_NAME]?.pluginEnabled === false) return;
            if (!extension_settings[EXT_NAME]?.transBookMode) return;
            if (S.tbPaused) return;

            const cfg = extension_settings[EXT_NAME];
            let setExtensionPromptFn = null;
            try {
                const mod = await import('/script.js');
                setExtensionPromptFn = mod.setExtensionPrompt || null;
            } catch (_) {}

            const _inject = (slotKey, content) => {
                content = niApplyUserSubstitution(content);
                if (!content.trim()) return;
                if (eventData?.chat && Array.isArray(eventData.chat)) {
                    niInsertIntoEventChat(eventData.chat, content, 1, 1, 0);
                } else if (setExtensionPromptFn) {
                    setExtensionPromptFn(slotKey, content, 1, 1, true, 0);
                }
            };

            // ── 一次性推进/开场提示词 ──────────────────────────
            // 若没有待推进提示词，检查是否处于"第一节点未完成"状态 → 注入开场提示词
            if (!niTbPeekPendingAdvancePrompt()) {
                const nodes = niGetTbNodes();
                niTbReconcileCurrentNode(nodes);
                if (nodes.length > 0 && !nodes[0].done) {
                    niTbWriteOpeningPrompt();
                }
            }

            const pendingAdvancePrompt = niTbConsumePendingAdvancePrompt();
            if (pendingAdvancePrompt) {
                const content = pendingAdvancePrompt + niTbGetImmersionAppend(cfg);
                _inject(`${EXT_NAME}_tb_advance`, content);
                // 一次性提示词发出后，本次不再叠加持续提示词，避免重复
                return;
            }

            // ── 持续提示词：每条消息都注入 ───────────────────────
            const nodes = niGetTbNodes();
            niTbReconcileCurrentNode(nodes);
            const curNode = nodes[S.tbCurIdx] || nodes[0];
            if (!curNode) return;

            const ongoingTpl = (cfg.tbOngoingPrompt || TB_DEFAULT_ONGOING_PROMPT).trim();
            const ongoingContent = ongoingTpl
                .replace(/{B_TITLE}/g, curNode.title)
                .replace(/{B_BODY}/g,  curNode.body || '（暂无描述）') + niTbGetImmersionAppend(cfg);
            _inject(`${EXT_NAME}_tb_ongoing`, ongoingContent);
        });
        eventSource.makeLast?.(event_types.CHAT_COMPLETION_PROMPT_READY, niFinalUserSubPromptRewrite);
    }
});

// ── ST 事件监听：消息渲染后挂载状态栏 ────────────────────────

jQuery(document).ready(function () {
    if (typeof eventSource === 'undefined' || typeof event_types === 'undefined') return;

    // 消息渲染完成后挂载状态栏
    const onRendered = (messageId) => {
        if (!extension_settings[EXT_NAME]?.transBookMode) return;
        setTimeout(() => niTbRenderStoryBar(), 100);
    };

    eventSource.on(event_types.MESSAGE_RENDERED,            onRendered);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED,  onRendered);

    // 切换对话：重置状态，重新加载
    eventSource.on(event_types.CHAT_CHANGED, () => {
        document.getElementById('ni-storybar')?.remove();
        niTbResetPromptRuntimeState();
        niTbLoadState();
        niTbSyncPauseUI();
        niRenderUserSubUI();
        niSyncRoleplayToDepth();
        // 短暂延迟等对话 DOM 就绪
        setTimeout(() => niTbRenderStoryBar(), 300);
    });

    // 剧情页打开时初始化穿书模式 UI；保留设置页触发兼容旧布局
    const $app = typeof $ !== 'undefined' ? $(document.getElementById('ni-app') || document) : null;
    if ($app) {
        $app.on('click', '.ni-nav-btn[data-page="plot"], .ni-nav-btn[data-page="settings"]', () => {
            setTimeout(() => niTbInitSettingsUI(), 50);
        });
    }
    setTimeout(() => niTbInitSettingsUI(), 100);

    // niConfirmStageMap 后刷新状态栏
    const _origConfirm = window.niConfirmStageMap;
    if (typeof _origConfirm === 'function') {
        window.niConfirmStageMap = function () {
            _origConfirm.apply(this, arguments);
            setTimeout(() => niTbRenderStoryBar(), 200);
        };
    }

    // 初次加载：如果已有对话且穿书模式开启，挂载状态栏
    niTbLoadState();
    setTimeout(() => niTbRenderStoryBar(), 500);

});

console.log('[NI-TB] 穿书模式模块已加载');

// ══════════════════════════════════════════════════════════════
// 穿书弹窗控制逻辑
// ══════════════════════════════════════════════════════════════
(function niPopupInit() {
    'use strict';

    // ── 工具函数 ──
    // 注意：bootstrap 后 FAB/popup 已移到父页面 document，所以优先在父页面查找
    function q(id) {
        // _niPopDoc 在 bootstrap 后才赋值，这里做兼容处理
        const parentDoc = (typeof _niPopDoc !== 'undefined') ? _niPopDoc : document;
        return parentDoc.getElementById(id) || document.getElementById(id);
    }
    function niPopEsc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // ── 条形码 ──
    function niPopBuildBarcode() {
        const bc = q('ni-pop-barcode');
        if (!bc || bc.children.length) return;
        [2,1,3,1,2,4,1,2,3,1,4,2,1,3,2,1,4,1,2,3].forEach(w => {
            const s = document.createElement('span');
            s.style.cssText = 'width:' + w + 'px;height:32px';
            bc.appendChild(s);
        });
    }

    // ── 状态 ──
    let _popOpen = false;
    let _popInferring = false;
    let _popInferExp = true;
    let _popStageOpen = false;
    let _popCurIdx = 0;   // 当前节点索引

    // ── 从主插件数据拉取节点/阶段信息 ──
    function niPopGetState() {
        // 优先通过主模块暴露的函数读取
        if (typeof window.niGetTbNodes === 'function' && typeof window.niGetTbStages === 'function') {
            const nodes  = window.niGetTbNodes();
            const stages = window.niGetTbStages();
            const S      = window._niS;
            const curIdx = (S && typeof S.tbCurIdx === 'number') ? S.tbCurIdx : _popCurIdx;
            return { nodes, stages, curIdx };
        }
        // fallback：旧路径
        const cfg = (typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
            ? extension_settings[EXT_NAME] : null;
        const nodes  = (cfg && Array.isArray(cfg.tbNodes))  ? cfg.tbNodes  : [];
        const stages = (cfg && Array.isArray(cfg.tbStages)) ? cfg.tbStages : [];
        const curIdx = (cfg && typeof cfg.tbCurIdx === 'number') ? cfg.tbCurIdx : _popCurIdx;
        return { nodes, stages, curIdx };
    }

    function niPopGetStageView(nodes, curIdx) {
        if (typeof window.niTbStageView === 'function') return window.niTbStageView(nodes, curIdx);
        const curNode = nodes[curIdx] || nodes[0];
        if (!curNode) return { nodes: [], curIdx: 0, stageIdx: null };
        const stageNodes = nodes
            .map((nd, idx) => ({ ...nd, _globalIdx: idx }))
            .filter(nd => nd.stageIdx === curNode.stageIdx);
        const localIdx = Math.max(0, stageNodes.findIndex(nd => nd.id === curNode.id));
        return { nodes: stageNodes, curIdx: localIdx, stageIdx: curNode.stageIdx };
    }

    // ── 渲染阶段下拉 ──
    function niPopBuildStages(stages, curStageIdx) {
        const drop = q('ni-pop-stage-drop');
        const val  = q('ni-pop-stage-val');
        if (!drop) return;
        drop.innerHTML = '';
        const active = stages.filter(s => s.enabled !== false);
        active.forEach((s, i) => {
            const el = document.createElement('div');
            el.className = 'ni-stage-opt' + (i === curStageIdx ? ' active' : '');
            el.innerHTML = '<span class="ni-sdot"></span>' + niPopEsc(s.title || s.name || ('阶段 ' + (i+1)));
            el.addEventListener('click', e => {
                e.stopPropagation();
                const { nodes } = niPopGetState();
                const firstIdx = nodes.findIndex(n => n.stageIdx === s.stageIdx);
                if (firstIdx >= 0) {
                    if (typeof window.niTbSetCurrentIdx === 'function') window.niTbSetCurrentIdx(firstIdx, nodes, { persist: true });
                    _popCurIdx = firstIdx;
                }
                _popStageOpen = false;
                drop.classList.remove('vis');
                const arrow = q('ni-pop-stage-arrow')?.querySelector('span');
                if (arrow) arrow.className = 'ni-arr-ds';
                niPopRender();
            });
            drop.appendChild(el);
        });
        const cur = active[curStageIdx];
        if (val && cur) val.textContent = cur.title || cur.name || '阶段 ' + (curStageIdx+1);
    }

    // ── 渲染节点列表 ──
    function niPopBuildNodes(nodes, curIdx) {
        const list = q('ni-pop-node-list');
        if (!list) return;
        list.innerHTML = '';
        nodes.forEach((n, i) => {
            const gi = n._globalIdx ?? i;
            const typeMap = { main:'main', sub:'sub', pivot:'pivot', 支线:'sub', 主线:'main', 关键转折:'pivot' };
            const typeKey = typeMap[n.type] || 'main';
            const typeLbl = { main:'主线', sub:'支线', pivot:'关键转折' }[typeKey] || (n.type || '');
            const isDone = !!n.done;
            const isActive = gi === curIdx;

            const g = document.createElement('div');
            g.className = 'ni-node-group' + (isActive ? ' is-active-g' : '');

            const row = document.createElement('div');
            row.id = 'ni-pop-nr' + gi;
            row.className = 'ni-node-row' + (isActive ? ' is-active' : '') + (isDone ? ' is-done' : '');
            row.innerHTML =
                '<span class="ni-nr-num">' + String(i+1).padStart(2,'0') + '</span>' +
                '<span class="ni-nr-tag ni-tag-' + typeKey + '">' + niPopEsc(typeLbl) + '</span>' +
                '<span class="ni-nr-title-blk">' +
                  '<span class="ni-nr-title">' + niPopEsc(n.title) + '</span>' +
                  (n.time || n.location ? '<div class="ni-nr-meta">' +
                    (n.time     ? '<span class="ni-nr-meta-item">🕐 ' + niPopEsc(n.time)     + '</span>' : '') +
                    (n.location ? '<span class="ni-nr-meta-item">📍 ' + niPopEsc(n.location) + '</span>' : '') +
                  '</div>' : '') +
                '</span>' +
                '<span class="ni-nr-status"><span class="ni-nr-chk' + (isDone ? ' checked' : '') + '" id="ni-pop-chk'+gi+'">' + (isDone ? '✔' : '') + '</span></span>';

            row.title = isDone ? '点击取消归纳' : '点击归纳此节点';
            row.addEventListener('click', function(e) {
                e.preventDefault();
                if (n.locked) return;
                const chkEl = q('ni-pop-chk' + gi);
                if (typeof window.niTbToggleCheck === 'function') {
                    window.niTbToggleCheck(gi).then(() => {
                        niPopRender();
                    }).catch(e => console.warn('[NI] 弹窗节点归纳切换失败:', e));
                    return;
                }
                // fallback：兼容旧版
                n.done = !n.done;
                chkEl?.classList.toggle('checked', n.done);
                if (chkEl) chkEl.textContent = n.done ? '✔' : '';
                row.classList.toggle('is-done', n.done);
                niPopSyncFt(nodes);
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            });

            g.appendChild(row);
            // 展开区：概括 + 事件 + 伏笔
            {
                const hasBody  = !!n.body;
                const hasSubs  = Array.isArray(n.sub_notes)   && n.sub_notes.length > 0;
                const foreshadows = (n.branch_links || []).filter(l => l.startsWith('【伏笔】')).map(l => l.replace('【伏笔】', '').trim());
                const hasFore  = foreshadows.length > 0;
                if (hasBody || hasSubs || hasFore || n.desc || n.description) {
                    const dd = document.createElement('div');
                    dd.className = 'ni-node-desc' + (isActive ? ' vis' : '');
                    let html = '';
                    // 概括
                    const bodyTxt = n.body || n.desc || n.description || '';
                    if (bodyTxt) {
                        html += '<div class="ni-nd-body">' + niPopEsc(bodyTxt) + '</div>';
                    }
                    // 事件
                    if (hasSubs) {
                        html += '<div class="ni-nd-section">';
                        n.sub_notes.forEach((s, si) => {
                            html += '<div class="ni-nd-event"><span class="ni-nd-event-num">' + (si+1) + '</span>' + niPopEsc(s) + '</div>';
                        });
                        html += '</div>';
                    }
                    // 伏笔
                    if (hasFore) {
                        html += '<div class="ni-nd-section">';
                        foreshadows.forEach(f => {
                            html += '<span class="ni-nd-foreshadow"><span>🔖</span>' + niPopEsc(f) + '</span>';
                        });
                        html += '</div>';
                    }
                    dd.innerHTML = html;
                    g.appendChild(dd);
                }
            }
            list.appendChild(g);
        });

        // 滚动到当前
        requestAnimationFrame(() => {
            const r = q('ni-pop-nr' + curIdx);
            if (!r) return;
            const g = r.parentElement, l = q('ni-pop-node-list');
            if (l) l.scrollTop += (g.getBoundingClientRect().top - l.getBoundingClientRect().top) - (l.clientHeight/2) + (g.offsetHeight/2);
        });
    }

    function niPopSyncFt(nodes) {
        const done = nodes.filter(n => n.done).length;
        const ftD = q('ni-pop-ft-done'), ftT = q('ni-pop-ft-todo');
        if (ftD) ftD.textContent = done;
        if (ftT) ftT.textContent = nodes.length - done;
    }

    function niPopSyncNav(nodes, curIdx) {
        const localIdx = Math.max(0, nodes.findIndex(n => (n._globalIdx ?? -1) === curIdx));
        q('ni-pop-btn-up')?.classList.toggle('disabled', localIdx === 0);
        q('ni-pop-btn-down')?.classList.toggle('disabled', localIdx >= nodes.length - 1);
        const prog = q('ni-pop-nav-prog');
        if (prog) prog.innerHTML = '<strong>' + (localIdx+1) + '</strong> / ' + nodes.length;
    }

    // ── 更新副标题：阶段•节点标题 #mesID ──
    function niPopSyncSub(nodes, stages, curIdx) {
        const sub = document.getElementById('ni-rcp-sub');
        if (!sub) return;
        const node = nodes[curIdx];
        if (!node) { sub.textContent = '✨ 阶段•节点标题'; return; }
        let stageName = '';
        if (Array.isArray(stages) && stages.length) {
            const s = stages.find(st => st.stageIdx === node.stageIdx)
                   || stages.find(st => Array.isArray(st.nodes) && st.nodes.some(nd => nd?.id === node.id))
                   || stages[0];
            if (s) stageName = s.title || s.name || '';
        }
        let mesID = '';
        try {
            const ctx = (typeof getContext === 'function') ? getContext() : null;
            if (ctx && Array.isArray(ctx.chat) && ctx.chat.length) {
                for (let k = ctx.chat.length - 1; k >= 0; k--) {
                    if (!ctx.chat[k].is_user) {
                        const mid = ctx.chat[k].mes_id ?? ctx.chat[k].id ?? k;
                        mesID = String(mid);
                        break;
                    }
                }
            }
        } catch(e) {}
        const nodeTitle = node.title || '';
        let txt = stageName ? (stageName + '•' + nodeTitle) : nodeTitle;
        if (mesID) txt += ' #' + mesID;
        sub.textContent = '✨ ' + txt;
    }

    // ── 更新底部时间──
    function niPopSyncTime() {
        const el = document.getElementById('ni-pop-time');
        if (!el) return;
        const pad = n => String(n).padStart(2, '0');
        try {
            const ctx = (typeof getContext === 'function') ? getContext() : null;
            if (ctx && Array.isArray(ctx.chat) && ctx.chat.length) {
                for (let k = ctx.chat.length - 1; k >= 0; k--) {
                    const msg = ctx.chat[k];
                    if (!msg.is_user) {
                        const raw = msg.send_date || msg.date || msg.timestamp;
                        let d = raw ? new Date(raw) : null;
                        if (!d || isNaN(d)) d = new Date();
                        el.textContent = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
                                       + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
                        return;
                    }
                }
            }
        } catch(e) {}
        const now = new Date();
        el.textContent = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate())
                       + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    }

    // ── 仅更新高亮和滚动，不重建列表──
    function niPopSetActive(newIdx) {
        const { nodes, stages } = niPopGetState();
        if (newIdx < 0 || newIdx >= nodes.length) return;
        const view = niPopGetStageView(nodes, newIdx);
        // 取消旧高亮
        const oldRow   = q('ni-pop-nr' + _popCurIdx);
        const oldGroup = oldRow?.parentElement;
        if (oldRow)   { oldRow.classList.remove('is-active'); }
        if (oldGroup) { oldGroup.classList.remove('is-active-g'); }
        const oldDesc = oldGroup?.querySelector('.ni-node-desc');
        if (oldDesc)  { oldDesc.classList.remove('vis'); }
        // 应用新高亮
        if (typeof window.niTbSetCurrentIdx === 'function') window.niTbSetCurrentIdx(newIdx, nodes, { persist: true });
        _popCurIdx = newIdx;
        const newRow   = q('ni-pop-nr' + newIdx);
        const newGroup = newRow?.parentElement;
        if (newRow)   { newRow.classList.add('is-active'); }
        if (newGroup) { newGroup.classList.add('is-active-g'); }
        const newDesc = newGroup?.querySelector('.ni-node-desc');
        if (newDesc)  { newDesc.classList.add('vis'); }
        // 滚动到新节点
        requestAnimationFrame(() => {
            const r = q('ni-pop-nr' + newIdx);
            if (!r) return;
            const g = r.parentElement, l = q('ni-pop-node-list');
            if (l) l.scrollTop += (g.getBoundingClientRect().top - l.getBoundingClientRect().top) - (l.clientHeight/2) + (g.offsetHeight/2);
        });
        // 更新进度条和按钮状态
        niPopSyncNav(view.nodes, newIdx);
        niPopSyncSub(nodes, stages, newIdx);
    }

    // ── 主渲染 ──
    function niPopRender() {
        const { nodes, stages } = niPopGetState();
        const view = niPopGetStageView(nodes, _popCurIdx);
        // 注意：_popCurIdx 由 niPopOpen 在弹窗打开时从外部同步一次，
        // 之后完全由弹窗内部管理，不再从外部覆盖
        const activeStages = stages.filter(s => s.enabled !== false);
        const curStageLocalIdx = Math.max(0, activeStages.findIndex(s => s.stageIdx === view.stageIdx));
        niPopBuildStages(stages, curStageLocalIdx);
        niPopBuildNodes(view.nodes, _popCurIdx);
        niPopSyncFt(view.nodes);
        niPopSyncNav(view.nodes, _popCurIdx);
        niPopSyncSub(nodes, stages, _popCurIdx);
        niPopSyncTime();
        niPopBuildBarcode();
    }

    // ── 弹窗开关 ──
    function niPopOpen() {
        _popOpen = true;
        // 每次打开时从主插件重新同步当前节点索引
        const { curIdx } = niPopGetState();
        _popCurIdx = curIdx;
        const fab = q('ni-fab'), panel = q('ni-popup-panel'), overlay = q('ni-popup-overlay');
        if (fab) fab.classList.add('open');
        if (panel) { panel.style.display = 'flex'; requestAnimationFrame(() => panel.classList.add('vis')); }
        if (overlay) overlay.style.display = 'block';
        // 强制用 JS 把遮罩层锁定到真实视口，绕开 CSS inset 可能失效的问题
        const wrap = q('ni-popup-wrap');
        if (wrap) {
            wrap.style.position = 'fixed';
            wrap.style.left     = '0';
            wrap.style.top      = '0';
            wrap.style.width    = window.innerWidth  + 'px';
            wrap.style.height   = window.innerHeight + 'px';
            wrap.style.display  = 'flex';
            wrap.style.alignItems    = 'center';
            wrap.style.justifyContent = 'center';
            wrap.style.pointerEvents = 'auto';
        }
        niPopRender();
        if (typeof window.niTbSyncPauseUI === 'function') window.niTbSyncPauseUI();
    }
    function niPopClose() {
        _popOpen = false;
        const fab = q('ni-fab'), panel = q('ni-popup-panel'), overlay = q('ni-popup-overlay');
        if (fab) fab.classList.remove('open');
        if (panel) { panel.classList.remove('vis'); setTimeout(() => { panel.style.display = 'none'; }, 380); }
        if (overlay) overlay.style.display = 'none';
        q('ni-popup-wrap').style.pointerEvents = 'none';
    }
    window.niPopOpen  = niPopOpen;
    window.niPopClose = niPopClose;

    // ── 显示/隐藏浮动按钮──
    function niPopSetVisible(show) {
        const fab = q('ni-fab'), ring = q('ni-fab-ring');
        if (fab)  fab.style.display  = show ? 'flex' : 'none';
        if (ring) ring.style.display = show ? 'block' : 'none';
    }
    window.niPopSetVisible = niPopSetVisible;

    // ── FAB 拖动 ──
    function niPopInitFab() {
        const fab  = q('ni-fab');
        const ring = q('ni-fab-ring');
        if (!fab) return;

        const _win = (typeof _niPopWin !== 'undefined') ? _niPopWin : window;

        let bx = _win.innerWidth - 24 - 40;
        let by = _win.innerHeight - 80 - 40;

        function applyPos() {
            bx = Math.max(0, Math.min(_win.innerWidth - 40, bx));
            by = Math.max(0, Math.min(_win.innerHeight - 40, by));
            fab.style.left = bx + 'px';
            fab.style.top  = by + 'px';
            if (ring) {
                ring.style.left   = (bx - 6) + 'px';
                ring.style.top    = (by - 6) + 'px';
                ring.style.width  = '52px';
                ring.style.height = '52px';
            }
        }
        applyPos();

        let dragging = false, moved = false, sx = 0, sy = 0, sbx = 0, sby = 0;

        function startDrag(e) {
            dragging = true; moved = false;
            const p = e.touches ? e.touches[0] : e;
            sx = p.clientX; sy = p.clientY; sbx = bx; sby = by;
            if (e.cancelable) e.preventDefault();
            _win.addEventListener('mousemove', onMove);
            _win.addEventListener('mouseup', onUp);
            _win.addEventListener('touchmove', onMove, { passive: false });
            _win.addEventListener('touchend', onUp);
        }
        function onMove(e) {
            if (!dragging) return;
            if (e.cancelable) e.preventDefault();
            const p = e.touches ? e.touches[0] : e;
            const dx = p.clientX - sx, dy = p.clientY - sy;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
            bx = sbx + dx; by = sby + dy;
            applyPos();
        }
        function onUp(e) {
            dragging = false;
            _win.removeEventListener('mousemove', onMove);
            _win.removeEventListener('mouseup', onUp);
            _win.removeEventListener('touchmove', onMove);
            _win.removeEventListener('touchend', onUp);
            if (!moved) { _popOpen ? niPopClose() : niPopOpen(); }
            else if (e && e.cancelable) e.stopPropagation();
        }
        fab.addEventListener('mousedown', startDrag);
        fab.addEventListener('touchstart', startDrag, { passive: false });
        _win.addEventListener('resize', applyPos);
        _win.addEventListener('resize', function() {
            const wrap = q('ni-popup-wrap');
            if (wrap && _popOpen) {
                wrap.style.width  = _win.innerWidth  + 'px';
                wrap.style.height = _win.innerHeight + 'px';
            }
        });
    }

    // ── 按钮事件 ──
    function niPopBindEvents() {
        q('ni-popup-overlay')?.addEventListener('click', niPopClose);

        q('ni-pop-stage-row')?.addEventListener('click', () => {
            // 弹窗可能持续打开；展开阶段选择前重新读取主模块的最新状态。
            const latest = niPopGetState();
            if (Number.isInteger(latest.curIdx) && latest.curIdx >= 0 && latest.curIdx < latest.nodes.length) {
                _popCurIdx = latest.curIdx;
            }
            niPopRender();
            _popStageOpen = !_popStageOpen;
            q('ni-pop-stage-drop')?.classList.toggle('vis', _popStageOpen);
            const arrow = q('ni-pop-stage-arrow')?.querySelector('span');
            if (arrow) arrow.className = _popStageOpen ? 'ni-arr-us' : 'ni-arr-ds';
        });

        const niPopMoveInStage = (delta) => {
            const { nodes } = niPopGetState();
            const view = niPopGetStageView(nodes, _popCurIdx);
            const localIdx = view.nodes.findIndex(n => (n._globalIdx ?? -1) === _popCurIdx);
            const nextNode = view.nodes[localIdx + delta];
            if (nextNode) niPopSetActive(nextNode._globalIdx);
        };

        q('ni-pop-btn-up')?.addEventListener('click', () => {
            niPopMoveInStage(-1);
        });
        q('ni-pop-btn-down')?.addEventListener('click', () => {
            niPopMoveInStage(1);
        });

        q('ni-pop-btn-pause')?.addEventListener('click', () => {
            if (typeof window.niTbTogglePaused === 'function') {
                window.niTbTogglePaused();
                return;
            }
            const runtime = (typeof window._niS !== 'undefined') ? window._niS : null;
            if (runtime) {
                runtime.tbPaused = !runtime.tbPaused;
                const paused = !!runtime.tbPaused;
                q('ni-pop-btn-pause')?.classList.toggle('paused', paused);
                const txt = q('ni-pop-pause-txt');
                if (txt) txt.textContent = paused ? '恢复' : '暂停';
            }
        });

        q('ni-pop-btn-infer')?.addEventListener('click', () => {
            if (_popInferring) return;
            _popInferring = true;
            const btn = q('ni-pop-btn-infer');
            const lbl = q('ni-pop-infer-lbl');
            if (btn) btn.classList.add('loading');
            if (lbl) lbl.textContent = '推演中…';
            q('ni-pop-infer-sec')?.classList.remove('vis');
            // 调用主插件推演函数
            const doInfer = window.niTbGenerateInfer || window.niTbDoInfer || window.niDoInfer;
            if (typeof doInfer === 'function') {
                doInfer().then(() => niPopInferDone(btn, lbl)).catch(() => niPopInferDone(btn, lbl));
            } else {
                setTimeout(() => niPopInferDone(btn, lbl), 1200);
            }
        });

        q('ni-pop-infer-tog')?.addEventListener('click', () => {
            _popInferExp = !_popInferExp;
            q('ni-pop-infer-items')?.classList.toggle('vis', _popInferExp);
            const chev = q('ni-pop-infer-chev')?.querySelector('span');
            if (chev) chev.className = _popInferExp ? 'ni-arr-us' : 'ni-arr-ds';
        });

        q('ni-pop-infer-items')?.addEventListener('click', (e) => {
            const item = e.target.closest('.ni-infer-item');
            if (!item) return;
            const desc = niApplyUserSubstitution(item?.dataset.desc || '');
            const ta = document.getElementById('send_textarea') || document.querySelector('#send_textarea');
            if (ta) {
                ta.value = desc;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.focus();
            }
        });
    }

    function niPopInferDone(btn, lbl) {
        _popInferring = false;
        if (btn) btn.classList.remove('loading');
        if (lbl) lbl.textContent = '✦ 重新推演';
        // 从主插件读取推演结果：优先从 window._niS，兼容旧路径
        const _S = (typeof window._niS !== 'undefined') ? window._niS
            : ((typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
               ? extension_settings[EXT_NAME] : null);
        const results = _S?.tbLastInfer;
        if (Array.isArray(results) && results.length) {
            const items = q('ni-pop-infer-items');
            if (items) {
                items.innerHTML = '';
                results.forEach((d, i) => {
                    const tagMap = { canon:'ni-itag-canon', diverge:'ni-itag-diverge', break:'ni-itag-break' };
                    const title = niApplyUserSubstitution(d.title || '');
                    const desc = niApplyUserSubstitution(d.desc || d.description || '');
                    const el = document.createElement('div');
                    el.className = 'ni-infer-item ni-fade-in';
                    el.dataset.desc = desc;
                    el.innerHTML =
                        '<div class="ni-infer-idx">' + (i+1) + '</div>' +
                        '<div class="ni-infer-body">' +
                          '<span class="ni-infer-tag ' + (tagMap[d.tag] || 'ni-itag-canon') + '">' + niPopEsc(d.tagLabel || d.tl || d.label || '') + '</span>' +
                          '<div class="ni-infer-title">' + niPopEsc(title) + '</div>' +
                          '<div class="ni-infer-desc">' + niPopEsc(desc) + '</div>' +
                        '</div>';
                    items.appendChild(el);
                });
                _popInferExp = true;
                items.classList.add('vis');
            }
            q('ni-pop-infer-sec')?.classList.add('vis');
            const chev = q('ni-pop-infer-chev')?.querySelector('span');
            if (chev) chev.className = 'ni-arr-us';
        }
    }

    // ── 响应设置变化：tbDisplayPopup 打钩时显示 FAB ──
    function niPopSyncVisibility() {
        const S = (typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
            ? extension_settings[EXT_NAME] : null;
        const show = !!(S?.transBookMode && S?.tbDisplayPopup);
        niPopSetVisible(show);
    }
    window.niPopSyncVisibility = niPopSyncVisibility;

    // ── 注入弹窗 CSS 到 document.head──
    // ── 本插件为 ES Module，直接运行在酒馆主页面，document/window 即主页面 ──
    const _niPopDoc = document;
    const _niPopWin = window;

    // ── 注入弹窗 CSS 到主页面 document.head ──
    function niPopInjectCSS() {
        if (_niPopDoc.getElementById('ni-popup-injected-css')) return;
        const style = _niPopDoc.createElement('style');
        style.id = 'ni-popup-injected-css';
        style.textContent = `#ni-fab{position:fixed !important;width:40px !important;height:40px !important;border-radius:50% !important;z-index:2147483647 !important;cursor:grab;user-select:none;background:linear-gradient(135deg,#b8a8f8 0%,#9ac8f0 40%,#f0a8d0 100%) !important;box-shadow:0 4px 18px rgba(160,130,220,.38),0 1px 4px rgba(160,130,220,.2),inset 0 1px 2px rgba(255,255,255,.5) !important;display:none;align-items:center !important;justify-content:center !important;transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .22s;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;}
#ni-fab::before{content:'' !important;position:absolute !important;inset:0 !important;border-radius:50% !important;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.45) 0%,transparent 65%) !important;pointer-events:none}
#ni-fab.open{background:linear-gradient(135deg,#c8b8ff 0%,#a8d8ff 40%,#ffb8e0 100%) !important}
#ni-fab:active{cursor:grabbing}
#ni-fab svg{pointer-events:none !important;display:block !important}
#ni-fab-ring{position:fixed !important;border-radius:50%;border:2px solid rgba(180,155,245,.45);pointer-events:none;z-index:2147483646 !important;animation:ni-fabRing 2.8s ease-in-out infinite;display:none}
@keyframes ni-fabRing{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.15);opacity:0}}
#ni-popup-wrap{position:fixed !important;left:0 !important;top:0 !important;width:100vw !important;height:100vh !important;z-index:2147483645 !important;pointer-events:none;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
#ni-popup-overlay{position:absolute;inset:0;background:var(--ni-popup-overlay-bg,rgba(180,160,220,.18));backdrop-filter:var(--ni-popup-backdrop-filter,blur(2px));cursor:pointer;display:none}
.ni-popup-panel{pointer-events:auto;transform-origin:center center;transform:scale(0.88);opacity:0;transition:transform .36s cubic-bezier(.34,1.25,.64,1),opacity .26s ease;filter:drop-shadow(0 8px 32px rgba(160,120,200,.28));width:320px;max-height:calc(100vh - 32px);display:none;flex-direction:column;border-radius:6px;overflow:visible;padding-bottom:24px}
.ni-popup-panel.vis{transform:scale(1);opacity:1}
.ni-popup-panel .ni-rcp-body,.ni-popup-panel .ni-node-list{scrollbar-width:thin;scrollbar-color:#dbeeff #fff8fc}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar,.ni-popup-panel .ni-node-list::-webkit-scrollbar{width:6px}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar-track,.ni-popup-panel .ni-node-list::-webkit-scrollbar-track{background:#fff8fc;border-left:1px dashed rgba(245,210,222,.5)}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar-thumb,.ni-popup-panel .ni-node-list::-webkit-scrollbar-thumb{background:linear-gradient(to bottom,#f8dbe6,#dbeeff);border-radius:6px;border:1px solid #fff8fc}
.ni-popup-panel .ni-rcp-body::-webkit-scrollbar-thumb:hover,.ni-popup-panel .ni-node-list::-webkit-scrollbar-thumb:hover{background:linear-gradient(to bottom,#f2c7d8,#cfe2ff)}`;
        _niPopDoc.head.appendChild(style);
    }

    // ── 初始化入口──
    function niPopBootstrap() {
        niPopInjectCSS();
        // ── 将 FAB、FAB-ring 和弹窗容器移动到主页面 body──
        const fabRing = document.getElementById('ni-fab-ring');
        const fab     = document.getElementById('ni-fab');
        const popWrap = document.getElementById('ni-popup-wrap');
        if (fabRing && fabRing.parentElement !== _niPopDoc.body) _niPopDoc.body.appendChild(fabRing);
        if (fab     && fab.parentElement     !== _niPopDoc.body) _niPopDoc.body.appendChild(fab);
        if (popWrap && popWrap.parentElement !== _niPopDoc.body) _niPopDoc.body.appendChild(popWrap);

        niPopInitFab();
        niPopBindEvents();
        niPopSyncVisibility();
    }

    // ── 暴露 bootstrap 供主模块在 template 插入后调用 ──
    window.niPopBootstrap = niPopBootstrap;

    // ── 监听穿书开关和弹窗选项变化，自动同步 FAB 显隐 ──
    // 直接在此处更新设置，防止 niTbInitSettingsUI 尚未调用时设置值未同步
    document.addEventListener('change', function(e) {
        if (!e.target) return;
        const _S = (typeof extension_settings !== 'undefined' && typeof EXT_NAME !== 'undefined')
            ? extension_settings[EXT_NAME] : null;
        if (e.target.id === 'ni-tb-display-popup') {
            if (_S) {
                _S.tbDisplayPopup = e.target.checked;
                if (e.target.checked) _S.tbDisplayStatusbar = false;
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            }
            niPopSyncVisibility();
        } else if (e.target.id === 'ni-tb-chk') {
            if (_S) {
                if (_S.pluginEnabled !== false) _S.transBookMode = e.target.checked;
                if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            }
            niPopSyncVisibility();
        }
    });
})();
