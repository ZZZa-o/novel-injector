// ============================================================
// 并发控制
// ============================================================

export function concurrencyLimit(value, fallback = 0) {
    const parsed = parseInt(value ?? fallback, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export class DynamicSemaphore {
    constructor(getLimit) {
        this.getLimit = getLimit;
        this.running = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.running < this._limit()) {
            this.running++;
            return;
        }
        await new Promise(resolve => this.queue.push(resolve));
    }

    release() {
        this.running = Math.max(0, this.running - 1);
        this._drain();
    }

    _limit() {
        return concurrencyLimit(this.getLimit?.(), 1);
    }

    _drain() {
        while (this.queue.length && this.running < this._limit()) {
            const resolve = this.queue.shift();
            this.running++;
            resolve();
        }
    }

    get pendingCount() {
        return this.queue.length;
    }
}

export async function runWithSemaphore(semaphore, task) {
    await semaphore.acquire();
    try {
        return await task();
    } finally {
        semaphore.release();
    }
}

// ============================================================
// 请求限速队列
// ============================================================

export function parseRateLimit(value, fallback = 3) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function readQueueLastAt(storage, key) {
    try {
        const parsed = parseInt(storage?.getItem?.(key) || '0', 10);
        return Number.isFinite(parsed) ? parsed : 0;
    } catch (_) {
        return 0;
    }
}

export function saveQueueLastAt(storage, key, value) {
    try { storage?.setItem?.(key, String(value || 0)); } catch (_) {}
}

export class PersistedRateQueue {
    constructor({
        storageKey,
        getLimit,
        fallbackLimit = 3,
        storage = globalThis.localStorage,
        now = () => Date.now(),
        setTimer = (callback, delay) => setTimeout(callback, delay),
    }) {
        this.pending = [];
        this.processing = false;
        this.storageKey = storageKey;
        this.getLimit = getLimit;
        this.fallbackLimit = fallbackLimit;
        this.storage = storage;
        this.now = now;
        this.setTimer = setTimer;
        this.lastAt = readQueueLastAt(storage, storageKey);
    }

    async acquire() {
        return new Promise(resolve => {
            this.pending.push(resolve);
            this._flush();
        });
    }

    _flush() {
        if (this.processing) return;
        this.processing = true;
        this._tick();
    }

    _tick() {
        if (!this.pending.length) {
            this.processing = false;
            return;
        }

        const limit = parseRateLimit(this.getLimit?.(), this.fallbackLimit);
        if (limit <= 0) {
            const all = this.pending.splice(0);
            all.forEach(resolve => resolve());
            this.processing = false;
            return;
        }

        const now = this.now();
        const minGap = Math.ceil(60000 / limit) + 250;
        const waitMs = Math.max(0, (this.lastAt || 0) + minGap - now);
        if (waitMs > 0) {
            this.setTimer(() => this._tick(), waitMs);
            return;
        }

        const resolve = this.pending.shift();
        this.lastAt = this.now();
        saveQueueLastAt(this.storage, this.storageKey, this.lastAt);
        resolve();
        this.setTimer(() => this._tick(), 0);
    }
}

// ============================================================
// 模型列表
// ============================================================

export function niBuildModelsUrl(url) {
    const normalizedUrl = String(url ?? '').trim();
    const base = normalizedUrl
        .replace(/[?#].*$/, '')
        .replace(/\/chat\/completions?\/?$/, '')
        .replace(/\/completions?\/?$/, '')
        .replace(/\/chat\/?$/, '')
        .replace(/\/$/, '');
    return `${base}/models`;
}

export function niNormalizeModelIds(payload) {
    const items = payload?.data || payload?.models || [];
    if (!Array.isArray(items)) return [];
    return items
        .map(model => typeof model === 'string' ? model : model?.id)
        .filter(Boolean);
}

export async function niFetchModelIds({ url, key = '', fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    const response = await fetchImpl(niBuildModelsUrl(url), {
        headers: {
            'Authorization': `Bearer ${String(key ?? '').trim()}`,
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) {
        let detail = '';
        try {
            const payload = await response.json();
            detail = typeof payload?.error?.message === 'string' ? payload.error.message : '';
        } catch (_) { /* 响应体不是 JSON 时忽略 */ }
        throw new Error(`${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return niNormalizeModelIds(await response.json());
}

export function niApplyModelListToControls({
    models,
    selectElement,
    textInputElement,
    escapeAttribute = value => String(value ?? ''),
    escapeHtml = value => String(value ?? ''),
    onSelected = null,
} = {}) {
    if (!selectElement || !textInputElement) return false;
    const list = Array.isArray(models) ? models : [];
    selectElement.innerHTML = [
        '<option value="" disabled selected>请选择模型</option>',
        ...list.map(model =>
            `<option value="${escapeAttribute(model)}">${escapeHtml(model)}</option>`
        ),
    ].join('');
    selectElement.value = '';
    selectElement.style.display = '';
    textInputElement.style.display = 'none';
    selectElement.onchange = () => {
        const selectedValue = String(selectElement.value || '');
        if (!selectedValue) return;
        textInputElement.value = selectedValue;
        selectElement.style.display = 'none';
        textInputElement.style.display = '';
        onSelected?.(selectedValue);
    };
    return true;
}

export async function niLoadModelList({
    url,
    key = '',
    fetchImpl = globalThis.fetch,
    setBusy = null,
    showAlert = null,
    onModels = null,
} = {}) {
    const normalizedUrl = String(url ?? '').trim();
    if (!normalizedUrl) {
        showAlert?.('请先填写 API 端点');
        return [];
    }

    setBusy?.(true);
    try {
        const models = await niFetchModelIds({ url: normalizedUrl, key, fetchImpl });
        if (!models.length) {
            showAlert?.('未获取到模型列表');
            return [];
        }
        onModels?.(models);
        return models;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isNetworkError = /fetch|network|load|abort|timeout|cors|ssl|tls|failed/i.test(message);
        showAlert?.(isNetworkError
            ? `拉取失败: ${message}\n模型列表是浏览器直连请求，可能被跨域(CORS)拦截。可手动输入模型名继续，清洗/生成不受影响。`
            : `拉取失败: ${message}\n请确认 API 地址是 OpenAI 兼容格式（如 https://xxx/v1/chat/completions）且 Key 正确。`);
        return [];
    } finally {
        setBusy?.(false);
    }
}

// ============================================================
// 酒馆预设消息与宏
// ============================================================

export const TAVERN_TASK_ACTOR_NAME = 'Novel Injector';
export const TAVERN_TASK_USER_NAME = 'Novel Injector User';

export function createTavernPresetMessageTools({
    getSettings,
    getPresetManager,
    getPromptManager,
    getGlobalVariables,
    substituteParams: substituteParamsFn,
    taskSwitchPrompt,
    finalOverridePrompt,
} = {}) {
function niMessageContentToText(content) {
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part.text === 'string') return part.text;
            return part ? JSON.stringify(part) : '';
        }).filter(Boolean).join('\n');
    }
    if (content && typeof content === 'object') return JSON.stringify(content);
    return String(content ?? '');
}

const TAVERN_GLOBAL_PROMPT_ORDER_IDS = [100001, 100000];
const TAVERN_FOREGROUND_MACRO_NAMES = [
    'input',
    'lastMessage',
    'lastMessageId',
    'lastUserMessage',
    'lastCharMessage',
    'firstIncludedMessageId',
    'firstDisplayedMessageId',
    'lastSwipeId',
    'currentSwipeId',
    'allChatRange',
    'idle_duration',
];
const TAVERN_CONTEXT_PROMPT_IDS = new Set([
    'chatHistory',
    'dialogueExamples',
    'worldInfoBefore',
    'worldInfoAfter',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'groupNudge',
    'summary',
    'authorsNote',
    'vectorsMemory',
    'vectorsDataBank',
    'smartContext',
]);

function niDeepClonePlain(value) {
    if (value == null) return value;
    try {
        return structuredClone(value);
    } catch (_) {
        try { return JSON.parse(JSON.stringify(value)); }
        catch (_) { return value; }
    }
}

function niGetTavernPresetNames() {
    const names = getPresetManager?.()?.getPresetList?.()?.preset_names;
    return [...new Set((Array.isArray(names) ? names : Object.keys(names || {}))
        .filter(name => typeof name === 'string' && name.length > 0))];
}

function niResolveTavernPreset(cfg = getSettings?.() || {}) {
    const manager = getPresetManager?.();
    const name = typeof cfg.globalPromptPresetName === 'string' ? cfg.globalPromptPresetName : '';
    let settings;
    if (name) {
        if (!niGetTavernPresetNames().includes(name)) {
            throw new Error(`酒馆预设“${name}”已不存在，请在全局提示词中重新选择。`);
        }
        settings = manager?.getCompletionPresetByName?.(name);
    } else {
        settings = getPromptManager?.()?.serviceSettings;
    }
    if (!settings || !Array.isArray(settings.prompts)) {
        throw new Error(name
            ? `酒馆预设“${name}”没有可读取的提示词，请在全局提示词中重新选择。`
            : '未找到前台当前酒馆预设，请在全局提示词中选择一个已保存的预设。');
    }
    // 只复制提示词结构，不加载预设的接口、模型，也不改动前台服务设置。
    return {
        name: name || manager?.getSelectedPresetName?.() || settings.preset_settings_openai || '前台当前预设',
        settings: niDeepClonePlain({ prompts: settings.prompts, prompt_order: settings.prompt_order }),
    };
}

function niNormalizeTavernMessageRole(role) {
    const value = String(role || 'system').toLowerCase();
    return ['system', 'user', 'assistant'].includes(value) ? value : 'system';
}

function niGetTavernPresetOrder(settings) {
    const lists = Array.isArray(settings?.prompt_order) ? settings.prompt_order : [];
    const candidateIds = [
        getPromptManager?.()?.configuration?.promptOrder?.dummyId,
        ...TAVERN_GLOBAL_PROMPT_ORDER_IDS,
    ].filter(x => x !== undefined && x !== null);
    for (const id of candidateIds) {
        const matched = lists.find(list => String(list?.character_id) === String(id));
        if (Array.isArray(matched?.order) && matched.order.length) return matched.order;
    }
    const namedGlobal = lists.find(list => ['global', 'default', ''].includes(String(list?.character_id ?? '').toLowerCase()) && Array.isArray(list?.order) && list.order.length);
    if (namedGlobal) return namedGlobal.order;
    if (lists.length === 1 && Array.isArray(lists[0]?.order)) return lists[0].order;
    return [];
}

function niShouldUseTavernPresetPrompt(prompt, entry, generationType = 'quiet', includeHistory = false) {
    if (!prompt) return false;
    if (entry && entry.enabled === false) return false;
    const identifier = String(prompt.identifier || entry?.identifier || '');
    if (!identifier) return false;
    const isTaskHistory = includeHistory && identifier === 'chatHistory';
    if (!isTaskHistory && TAVERN_CONTEXT_PROMPT_IDS.has(identifier)) return false;
    if (!isTaskHistory && prompt.marker) return false;
    const manager = getPromptManager?.();
    const shouldTrigger = typeof manager?.shouldTrigger === 'function'
        ? manager.shouldTrigger(prompt, generationType)
        : !Array.isArray(prompt.injection_trigger) || !prompt.injection_trigger.length || prompt.injection_trigger.includes(generationType);
    if (!shouldTrigger) return false;
    return isTaskHistory || (typeof prompt.content === 'string' && prompt.content.trim().length > 0);
}

function niGetTavernPresetPromptEntries(generationType = 'quiet', { includeHistory = false, settings = niResolveTavernPreset().settings } = {}) {
    const prompts = Array.isArray(settings.prompts) ? settings.prompts : [];
    const promptMap = new Map(prompts.filter(p => p?.identifier).map(p => [String(p.identifier), p]));
    const order = niGetTavernPresetOrder(settings);
    const entries = [];

    if (order.length) {
        for (const entry of order) {
            const prompt = promptMap.get(String(entry?.identifier || ''));
            if (niShouldUseTavernPresetPrompt(prompt, entry, generationType, includeHistory)) entries.push(prompt);
        }
    } else {
        for (const prompt of prompts) {
            const entry = { identifier: prompt?.identifier, enabled: prompt?.enabled !== false };
            if (niShouldUseTavernPresetPrompt(prompt, entry, generationType, includeHistory)) entries.push(prompt);
        }
    }

    return entries;
}

function niTavernEmptyCharacterMacros() {
    return {
        char: TAVERN_TASK_ACTOR_NAME,
        charIfNotGroup: TAVERN_TASK_ACTOR_NAME,
        group: TAVERN_TASK_ACTOR_NAME,
        groupNotMuted: TAVERN_TASK_ACTOR_NAME,
        notChar: TAVERN_TASK_USER_NAME,
        user: TAVERN_TASK_USER_NAME,
        charPrompt: '',
        charInstruction: '',
        charJailbreak: '',
        description: '',
        charDescription: '',
        personality: '',
        charPersonality: '',
        scenario: '',
        charScenario: '',
        persona: '',
        mesExamples: '',
        mesExamplesRaw: '',
        charVersion: '',
        char_version: '',
        charDepthPrompt: '',
        creatorNotes: '',
    };
}

function niTavernVarToString(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); }
    catch (_) { return String(value); }
}

function niCreateTavernMacroState() {
    return {
        local: {},
        global: niDeepClonePlain(getGlobalVariables?.() || {}) || {},
    };
}

function niGetTavernVarStore(macroState, scope = 'local') {
    if (!macroState) return {};
    const key = scope === 'global' ? 'global' : 'local';
    if (!macroState[key] || typeof macroState[key] !== 'object') macroState[key] = {};
    return macroState[key];
}

function niTavernReadVar(macroState, scope, name) {
    const store = niGetTavernVarStore(macroState, scope);
    const key = String(name || '').trim();
    return niTavernVarToString(store[key]);
}

function niTavernSetVar(macroState, scope, name, value) {
    const key = String(name || '').trim();
    if (!key) return;
    niGetTavernVarStore(macroState, scope)[key] = niTavernVarToString(value);
}

function niTavernAddVar(macroState, scope, name, value) {
    const key = String(name || '').trim();
    if (!key) return;
    const store = niGetTavernVarStore(macroState, scope);
    const before = niTavernVarToString(store[key]);
    const addend = niTavernVarToString(value);
    const beforeNumber = Number(before || 0);
    const addNumber = Number(addend);
    store[key] = Number.isFinite(beforeNumber) && Number.isFinite(addNumber) && before.trim() !== ''
        ? String(beforeNumber + addNumber)
        : `${before}${addend}`;
}

function niTavernIncDecVar(macroState, scope, name, delta) {
    const key = String(name || '').trim();
    if (!key) return '0';
    const store = niGetTavernVarStore(macroState, scope);
    const next = (Number(store[key] || 0) || 0) + delta;
    store[key] = String(next);
    return store[key];
}

function niSplitTavernMacroArgs(text, maxParts = 3) {
    const parts = [];
    let rest = String(text || '');
    while (parts.length < maxParts - 1) {
        const idx = rest.indexOf('::');
        if (idx < 0) break;
        parts.push(rest.slice(0, idx));
        rest = rest.slice(idx + 2);
    }
    parts.push(rest);
    return parts.map(part => part.trim());
}

function niParseTavernMacroCall(rawBody) {
    let body = String(rawBody || '').trim();
    if (!body) return null;
    if (body.startsWith('//')) return { name: 'comment', args: [] };
    if (body.startsWith('#')) body = body.slice(1).trim();

    const colonIdx = body.indexOf('::');
    if (colonIdx >= 0) {
        const name = body.slice(0, colonIdx).trim().toLowerCase();
        const args = niSplitTavernMacroArgs(body.slice(colonIdx + 2), 2);
        return { name, args };
    }

    const spaceMatch = body.match(/^([A-Za-z][\w-]*)\s+([\s\S]*)$/);
    if (spaceMatch) {
        const name = spaceMatch[1].toLowerCase();
        const argText = spaceMatch[2].trim();
        if (['setvar', 'setglobalvar', 'addvar', 'addglobalvar'].includes(name)) {
            const argMatch = argText.match(/^(\S+)\s+([\s\S]*)$/);
            return { name, args: argMatch ? [argMatch[1], argMatch[2]] : [argText, ''] };
        }
        return { name, args: [argText] };
    }

    return { name: body.toLowerCase(), args: [] };
}

function niFindTavernMacroEnd(text, start) {
    let depth = 1;
    for (let i = start + 2; i < text.length - 1; i++) {
        if (text.startsWith('{{', i)) {
            depth++;
            i++;
            continue;
        }
        if (text.startsWith('}}', i)) {
            depth--;
            if (depth === 0) return i;
            i++;
        }
    }
    return -1;
}

function niApplyTavernVariableMacro(call, macroState, depth) {
    if (!call) return null;
    const [arg1 = '', arg2 = ''] = call.args || [];
    const localName = call.name.replace(/^local/, '');
    const isGlobal = call.name.includes('global');
    const scope = isGlobal ? 'global' : 'local';

    if (call.name === 'comment' || call.name === 'trim') return '';
    if (['setvar', 'setglobalvar'].includes(call.name)) {
        niTavernSetVar(macroState, scope, arg1, niProcessTavernVariableMacros(arg2, macroState, depth + 1));
        return '';
    }
    if (['addvar', 'addglobalvar'].includes(call.name)) {
        niTavernAddVar(macroState, scope, arg1, niProcessTavernVariableMacros(arg2, macroState, depth + 1));
        return '';
    }
    if (['getvar', 'getglobalvar'].includes(call.name)) return niProcessTavernVariableMacros(niTavernReadVar(macroState, scope, arg1), macroState, depth + 1);
    if (['incvar', 'incglobalvar'].includes(call.name)) return niTavernIncDecVar(macroState, scope, arg1, 1);
    if (['decvar', 'decglobalvar'].includes(call.name)) return niTavernIncDecVar(macroState, scope, arg1, -1);
    if (['hasvar', 'hasglobalvar', 'varexists', 'globalvarexists'].includes(call.name)) {
        const store = niGetTavernVarStore(macroState, scope);
        return Object.prototype.hasOwnProperty.call(store, String(arg1 || '').trim()) ? 'true' : 'false';
    }
    if (['deletevar', 'deleteglobalvar', 'flushvar', 'flushglobalvar'].includes(call.name)) {
        delete niGetTavernVarStore(macroState, scope)[String(arg1 || '').trim()];
        return '';
    }

    // Leave non-variable macros to SillyTavern's normal macro engine.
    if (localName !== call.name) return null;
    return null;
}

function niTavernIsFalsy(value) {
    const text = niTavernVarToString(value).trim().toLowerCase();
    return !text || text === '0' || text === 'false' || text === 'null' || text === 'undefined';
}

function niApplyTavernVariableShorthand(rawBody, macroState, depth) {
    const body = String(rawBody || '').trim();
    if (!body.startsWith('.') && !body.startsWith('$')) return null;

    const scope = body.startsWith('$') ? 'global' : 'local';
    const expr = body.slice(1).trim();
    if (!expr) return '';

    const operators = ['||=', '??=', '+=', '-=', '==', '!=', '>=', '<=', '++', '--', '||', '??', '=', '>', '<'];
    let found = null;
    for (const op of operators) {
        const idx = expr.indexOf(op);
        if (idx >= 0 && (!found || idx < found.idx || (idx === found.idx && op.length > found.op.length))) {
            found = { op, idx };
        }
    }

    const name = (found ? expr.slice(0, found.idx) : expr).trim();
    const rawValue = found ? expr.slice(found.idx + found.op.length).trim() : '';
    if (!name) return '';

    const store = niGetTavernVarStore(macroState, scope);
    const hasValue = Object.prototype.hasOwnProperty.call(store, name);
    const current = niTavernReadVar(macroState, scope, name);
    const value = () => niProcessTavernVariableMacros(rawValue, macroState, depth + 1);

    if (!found) return current;
    switch (found.op) {
        case '=':
            niTavernSetVar(macroState, scope, name, value());
            return '';
        case '+=':
            niTavernAddVar(macroState, scope, name, value());
            return '';
        case '-=': {
            const next = (Number(current || 0) || 0) - (Number(value()) || 0);
            niTavernSetVar(macroState, scope, name, String(next));
            return '';
        }
        case '++':
            return niTavernIncDecVar(macroState, scope, name, 1);
        case '--':
            return niTavernIncDecVar(macroState, scope, name, -1);
        case '||':
            return niTavernIsFalsy(current) ? value() : current;
        case '??':
            return hasValue ? current : value();
        case '||=':
            if (niTavernIsFalsy(current)) niTavernSetVar(macroState, scope, name, value());
            return niTavernReadVar(macroState, scope, name);
        case '??=':
            if (!hasValue) niTavernSetVar(macroState, scope, name, value());
            return niTavernReadVar(macroState, scope, name);
        case '==':
            return current === value() ? 'true' : 'false';
        case '!=':
            return current !== value() ? 'true' : 'false';
        case '>':
            return Number(current) > Number(value()) ? 'true' : 'false';
        case '>=':
            return Number(current) >= Number(value()) ? 'true' : 'false';
        case '<':
            return Number(current) < Number(value()) ? 'true' : 'false';
        case '<=':
            return Number(current) <= Number(value()) ? 'true' : 'false';
        default:
            return null;
    }
}

function niProcessTavernVariableBlocks(content, macroState, depth = 0) {
    return String(content || '').replace(/{{#?(setvar|setglobalvar)::([^}]*)}}([\s\S]*?){{\/\1}}/gi, (_, name, key, value) => {
        const scope = String(name).toLowerCase().includes('global') ? 'global' : 'local';
        niTavernSetVar(macroState, scope, key, niProcessTavernVariableMacros(value, macroState, depth + 1));
        return '';
    });
}

function niProcessTavernVariableMacros(content, macroState, depth = 0) {
    if (!content || depth > 20) return String(content || '');
    const source = niProcessTavernVariableBlocks(content, macroState, depth);
    let output = '';
    let index = 0;

    while (index < source.length) {
        const start = source.indexOf('{{', index);
        if (start < 0) {
            output += source.slice(index);
            break;
        }
        output += source.slice(index, start);
        const end = niFindTavernMacroEnd(source, start);
        if (end < 0) {
            output += source.slice(start);
            break;
        }

        const raw = source.slice(start + 2, end);
        const shorthandReplacement = niApplyTavernVariableShorthand(raw, macroState, depth);
        const replacement = shorthandReplacement === null
            ? niApplyTavernVariableMacro(niParseTavernMacroCall(raw), macroState, depth)
            : shorthandReplacement;
        output += replacement === null ? source.slice(start, end + 2) : replacement;
        index = end + 2;
    }

    return output;
}

function niNeutralizeTavernForegroundMacros(content) {
    let result = String(content || '');
    for (const name of [...TAVERN_FOREGROUND_MACRO_NAMES].sort((a, b) => b.length - a.length)) {
        result = result.replace(new RegExp(`{{\\s*${name}\\s*}}`, 'gi'), '');
    }
    return result;
}

function niFallbackCleanTavernMacros(content) {
    return String(content || '')
        .replace(/{{\/\/[\s\S]*?}}/g, '')
        .replace(/{{trim}}/gi, '')
        .trim();
}

function niTavernVariableDynamicMacro(macroState, scope, action) {
    return {
        unnamedArgs: ['set', 'add'].includes(action) ? 2 : 1,
        strictArgs: false,
        handler: ({ unnamedArgs = [] } = {}) => {
            const [name = '', value = ''] = unnamedArgs;
            if (action === 'set') {
                niTavernSetVar(macroState, scope, name, value);
                return '';
            }
            if (action === 'add') {
                niTavernAddVar(macroState, scope, name, value);
                return '';
            }
            if (action === 'get') return niTavernReadVar(macroState, scope, name);
            if (action === 'inc') return niTavernIncDecVar(macroState, scope, name, 1);
            if (action === 'dec') return niTavernIncDecVar(macroState, scope, name, -1);
            if (action === 'has') return Object.prototype.hasOwnProperty.call(niGetTavernVarStore(macroState, scope), String(name || '').trim()) ? 'true' : 'false';
            if (action === 'del') {
                delete niGetTavernVarStore(macroState, scope)[String(name || '').trim()];
                return '';
            }
            return '';
        },
    };
}

function niTavernSubstitutionMacros(macroState) {
    const macros = {
        ...niTavernEmptyCharacterMacros(),
        setvar: niTavernVariableDynamicMacro(macroState, 'local', 'set'),
        addvar: niTavernVariableDynamicMacro(macroState, 'local', 'add'),
        getvar: niTavernVariableDynamicMacro(macroState, 'local', 'get'),
        incvar: niTavernVariableDynamicMacro(macroState, 'local', 'inc'),
        decvar: niTavernVariableDynamicMacro(macroState, 'local', 'dec'),
        hasvar: niTavernVariableDynamicMacro(macroState, 'local', 'has'),
        varexists: niTavernVariableDynamicMacro(macroState, 'local', 'has'),
        deletevar: niTavernVariableDynamicMacro(macroState, 'local', 'del'),
        flushvar: niTavernVariableDynamicMacro(macroState, 'local', 'del'),
        setglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'set'),
        addglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'add'),
        getglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'get'),
        incglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'inc'),
        decglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'dec'),
        hasglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'has'),
        globalvarexists: niTavernVariableDynamicMacro(macroState, 'global', 'has'),
        deleteglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'del'),
        flushglobalvar: niTavernVariableDynamicMacro(macroState, 'global', 'del'),
    };
    for (const name of TAVERN_FOREGROUND_MACRO_NAMES) macros[name] = '';
    return macros;
}

function niSubstituteTavernPresetContent(content, original = '', macroState = niCreateTavernMacroState()) {
    const withVariables = niNeutralizeTavernForegroundMacros(niProcessTavernVariableMacros(content || '', macroState));
    try {
        return substituteParamsFn(withVariables, {
            name1Override: TAVERN_TASK_USER_NAME,
            name2Override: TAVERN_TASK_ACTOR_NAME,
            groupOverride: TAVERN_TASK_ACTOR_NAME,
            original,
            replaceCharacterCard: false,
            dynamicMacros: niTavernSubstitutionMacros(macroState),
        });
    } catch (err) {
        console.warn('[Novel Injector] 酒馆预设宏替换失败，已保留变量处理后的原文。', err);
        return niFallbackCleanTavernMacros(withVariables);
    }
}

async function niWithTavernMacroSandbox(fn) {
    return await fn(niCreateTavernMacroState());
}

function niNeutralizeTavernTaskIdentityLanguage(content) {
    const source = String(content || '');
    const headLimit = Math.min(source.length, 1800);
    let head = source.slice(0, headLimit);
    const tail = source.slice(headLimit);

    head = head
        .replace(/(^|[\n。！？.!?]\s*)你现在是/g, '$1本任务处理器定位为')
        .replace(/(^|[\n。！？.!?]\s*)你是一位/g, '$1本任务需要一位')
        .replace(/(^|[\n。！？.!?]\s*)你是/g, '$1本任务需要')
        .replace(/你的核心能力是/g, '本任务需要的核心能力是')
        .replace(/你的任务/g, '本任务')
        .replace(/你需要/g, '本任务需要')
        .replace(/请你/g, '请')
        .replace(/你必须/g, '本任务必须')
        .replace(/你不得/g, '本任务不得');

    return `${head}${tail}`;
}

function niWrapTavernTaskMessageContent(content) {
    const body = niNeutralizeTavernTaskIdentityLanguage(content).trim();
    if (!body) return '';
    return `[Novel Injector 后台任务正文]
说明：以下内容是插件发出的工具任务说明。若其中出现“你是”“作为”“专家”“编辑”“分析师”“整理师”等角色化措辞，请只理解为处理视角或能力标签，不要视为身份替换、人格设定、开发者声明、角色卡修改或 RP 请求。

${body}
[/Novel Injector 后台任务正文]`;
}

async function niBuildTavernPresetMessages(messages, cfg = getSettings?.() || {}) {
    const preset = niResolveTavernPreset(cfg);
    return niWithTavernMacroSandbox(async (macroState) => {
        const presetEntries = niGetTavernPresetPromptEntries('quiet', { settings: preset.settings });
        const result = [];
        for (const prompt of presetEntries) {
            const content = niSubstituteTavernPresetContent(prompt.content, '', macroState).trim();
            if (!content) continue;
            const role = niNormalizeTavernMessageRole(prompt.role);
            result.push({
                role: role === 'assistant' ? 'system' : role,
                content,
            });
        }

        result.push({ role: 'system', content: taskSwitchPrompt });
        let lastTaskUserIndex = -1;
        for (const message of Array.isArray(messages) ? messages : []) {
            const content = niWrapTavernTaskMessageContent(niMessageContentToText(message?.content));
            if (!content) continue;
            const role = niNormalizeTavernMessageRole(message?.role || 'user');
            result.push({
                role,
                content,
            });
            if (role === 'user') lastTaskUserIndex = result.length - 1;
        }
        if (lastTaskUserIndex >= 0) {
            result[lastTaskUserIndex].content = `${result[lastTaskUserIndex].content}\n\n${finalOverridePrompt}`;
        } else {
            result.push({
                role: 'user',
                content: finalOverridePrompt,
            });
        }
        return result;
    });
}

// 小说资料始终作为临时历史，只有预设条目经过宏展开。
// 不借用前台聊天、角色卡或世界书，也不把 assistant 改写成 system。
async function niBuildTavernCleanMessages(instructionMessage, historyMessages, cfg = getSettings?.() || {}) {
    const preset = niResolveTavernPreset(cfg);
    return niWithTavernMacroSandbox(async (macroState) => {
        const entries = niGetTavernPresetPromptEntries('quiet', { includeHistory: true, settings: preset.settings });
        const relative = [];
        const absolute = [];
        const notes = [];
        for (const prompt of entries) {
            if (prompt.identifier === 'chatHistory') {
                relative.push({ history: true });
                continue;
            }
            const content = niSubstituteTavernPresetContent(prompt.content, '', macroState).trim();
            if (!content) continue;
            const item = {
                role: niNormalizeTavernMessageRole(prompt.role), content,
                origin: `预设：${prompt.name || prompt.identifier}`,
                depth: Math.max(0, parseInt(prompt.injection_depth ?? 4, 10) || 0),
                order: Number.isFinite(Number(prompt.injection_order)) ? Number(prompt.injection_order) : 100,
            };
            (Number(prompt.injection_position) === 1 ? absolute : relative).push(item);
        }

        // 对齐酒馆 populationInjectionPrompts：在倒序历史上按深度、order、角色分组插入，最后翻回正序。
        const history = historyMessages.map((message, i) => ({
            role: message.role, content: message.content,
            origin: i === 0 ? '小说资料' : '清洗执行指令',
        })).reverse();
        let inserted = 0;
        const depths = [...new Set(absolute.map(item => item.depth))].sort((a, b) => a - b);
        for (const depth of depths) {
            const atDepth = absolute.filter(item => item.depth === depth);
            const orders = [...new Set(atDepth.map(item => item.order))].sort((a, b) => b - a);
            const additions = [];
            for (const order of orders) {
                for (const role of ['system', 'user', 'assistant']) {
                    const group = atDepth.filter(item => item.order === order && item.role === role);
                    if (group.length) additions.push({
                        role, content: group.map(item => item.content).join('\n'),
                        origin: `${group.map(item => item.origin).join('；')}（深度 ${depth}，顺序 ${order}）`,
                    });
                }
            }
            history.splice(Math.min(history.length, depth + inserted), 0, ...additions);
            inserted += additions.length;
        }
        history.reverse();
        if (depths.some(depth => depth > historyMessages.length)) {
            notes.push('部分预设深度超过本次临时历史长度，按酒馆插入规则放到历史开头。');
        }

        const result = [{ ...instructionMessage, origin: '清洗规则与资料边界' }];
        let insertedHistory = false;
        for (const item of relative) {
            if (item.history) {
                if (!insertedHistory) result.push(...history);
                insertedHistory = true;
            } else result.push(item);
        }
        if (!insertedHistory) {
            result.push(...history);
            notes.push('预设未启用 chatHistory 槽位，已将本次清洗资料与执行指令插入预设末尾。');
        }
        return {
            presetName: preset.name,
            messages: result.map(({ role, content }) => ({ role, content })),
            origins: result.map(item => item.origin),
            notes,
        };
    });
}


    return {
        niBuildTavernPresetMessages,
        niBuildTavernCleanMessages,
        niGetTavernPresetNames,
        niResolveTavernPreset,
        niCreateTavernMacroState,
        niFallbackCleanTavernMacros,
        niGetTavernPresetOrder,
        niGetTavernPresetPromptEntries,
        niMessageContentToText,
        niNeutralizeTavernForegroundMacros,
        niNeutralizeTavernTaskIdentityLanguage,
        niNormalizeTavernMessageRole,
        niParseTavernMacroCall,
        niProcessTavernVariableMacros,
        niShouldUseTavernPresetPrompt,
        niSubstituteTavernPresetContent,
        niTavernAddVar,
        niTavernReadVar,
        niTavernSetVar,
        niWrapTavernTaskMessageContent,
    };
}

// ============================================================
// 聊天补全响应解析
// ============================================================

function niApiFailure(message, code, status = null) {
    const error = new Error(message);
    error.code = code;
    if (status) error.status = status;
    return error;
}

function niAttachApiResponse(error, response) {
    if (!error || error.responseText) return error;
    const text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
    error.responseText = text.slice(0, 64000)
        .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
        .replace(/\bsk-[\w-]{8,}/g, '[已隐藏 Key]');
    return error;
}

function niApiErrorDetail(value) {
    const source = typeof value === 'string' ? value : '';
    const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return (title?.[1] || source)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
        .replace(/\bsk-[\w-]{8,}/g, '[已隐藏 Key]')
        .replace(/\s+/g, ' ').trim().slice(0, 350);
}

// 酒馆可能以 HTTP 200 包装上游错误；只把实际返回的数字当作状态码。
export function niGetApiResponseError(data, httpStatus = 0, statusText = '') {
    if (!data?.error && data?.type !== 'error' && httpStatus < 400) return null;
    const payload = data?.error;
    const detail = niApiErrorDetail(payload?.message || (typeof payload === 'string' ? payload : '')
        || data?.message || data?.response || (typeof data === 'string' ? data : '') || statusText);
    const isStatus = value => Number.isInteger(Number(value)) && Number(value) >= 400 && Number(value) <= 599;
    const explicitStatus = [payload?.status, payload?.status_code, payload?.statusCode, payload?.code,
        data?.status, data?.status_code, data?.statusCode, data?.code].find(isStatus);
    const messageStatus = detail.match(/\b(?:HTTP|API|status(?:[_ ]code)?|error code)\s*[:=]?\s*([45]\d{2})\b/i)?.[1];
    const status = Number(explicitStatus || messageStatus || (httpStatus >= 400 ? httpStatus : 0));
    const quota = data?.quota_error === true || /insufficient_quota|quota exceeded|余额不足|额度不足/i.test(String(payload?.code || '') + ' ' + detail);
    const hints = {
        400: ['请求参数不被接口接受', '请检查模型、接口地址和请求长度。'],
        401: ['API 身份验证失败', '请检查 Key 是否正确或已失效。'],
        403: ['接口拒绝访问', '请检查账号、模型权限或服务商限制。'],
        404: ['接口或模型不存在', '请检查接口地址和模型名。'],
        408: ['接口请求超时', '请稍后重试，或减小每段大小。'],
        413: ['请求内容过大', '请减小每段大小后重试。'],
        429: [quota ? 'API 额度不足' : '请求过多／接口限流', quota ? '请检查服务商余额与配额。' : '请降低并发数和每分钟请求数，稍后重试；也可检查服务商配额。'],
        500: ['接口内部错误', '请稍后重试，持续失败时联系接口服务商。'],
        502: ['网关或上游连接失败', '请检查接口服务是否可用，稍后重试。'],
        503: ['接口暂时不可用', '请稍后重试。'],
        504: ['网关等待上游超时', '请稍后重试，或减小每段大小；提高插件超时不能延长网关的等待时间。'],
        524: ['网关等待上游响应超时', '请稍后重试，或减小每段大小；提高插件超时不能延长网关的等待时间。'],
    };
    let [reason, hint] = hints[status] || ['接口返回错误', '请根据接口信息检查配置或稍后重试。'];
    if (!status) {
        reason = quota ? 'API 额度不足' : 'API 返回错误';
        if (quota) hint = '请检查服务商余额与配额。';
        else if (/too many requests|rate.?limit/i.test(detail)) {
            reason = '请求过多／接口限流（通常对应 429）';
            hint = hints[429][1];
        } else if (/a timeout occurred/i.test(detail)) {
            reason = '网关等待上游响应超时（通常对应 524）';
            hint = hints[524][1];
        }
    }
    const label = status ? `HTTP ${status}：${reason}` : `${reason}（酒馆未返回原始状态码）`;
    const wrapper = status && httpStatus >= 400 && status !== httpStatus ? `；酒馆响应为 HTTP ${httpStatus}` : '';
    return niAttachApiResponse(niApiFailure(`${label}${wrapper}。${detail ? `接口信息：${detail}。` : ''}${hint}`, 'NI_API_RESPONSE', status), data);
}

function niAssertApiResponse(data) {
    const error = niGetApiResponseError(data);
    if (error) throw error;
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    if (choices.some(choice => choice?.finish_reason === 'length') || data?.stop_reason === 'max_tokens') {
        throw niAttachApiResponse(niApiFailure('AI 返回被长度截断（达到输出上限）。请减小每段大小，或使用输出上限更高的模型。', 'NI_API_LENGTH'),
            choices.map(choice => choice?.message?.content || choice?.delta?.content || choice?.text || '').join('\n'));
    }
    if (choices.some(choice => choice?.finish_reason === 'content_filter' || choice?.message?.refusal || choice?.delta?.refusal)) {
        throw niAttachApiResponse(niApiFailure('模型拒绝回答或触发了接口内容过滤，未返回可用清洗结果。请检查服务商的返回信息。', 'NI_API_REFUSAL'),
            choices.map(choice => choice?.message?.refusal || choice?.delta?.refusal || choice?.message?.content || choice?.finish_reason || '').join('\n'));
    }
}

function niApiTransportError(error, signal, cfg = null) {
    if (cfg?.cleanKey && error) {
        if (typeof error.message === 'string') error.message = error.message.split(String(cfg.cleanKey)).join('[已隐藏 Key]');
        if (typeof error.responseText === 'string') error.responseText = error.responseText.split(String(cfg.cleanKey)).join('[已隐藏 Key]');
    }
    if (signal?.aborted || error?.name === 'AbortError' || error?.message === 'AbortError') {
        if (signal?.reason?.code === 'NI_API_TIMEOUT') return signal.reason;
        return niApiFailure('请求已取消（暂停或跳过）。', 'NI_API_ABORTED');
    }
    if (error?.name === 'NetworkError' || (error instanceof TypeError && /fetch|network|load failed|terminated|connection/i.test(error.message))) {
        return niApiFailure(`网络连接失败：${niApiErrorDetail(error.message) || '未收到接口响应'}。请检查酒馆服务与网络连接。`, 'NI_API_NETWORK');
    }
    return error;
}

async function niReadApiJson(response) {
    const raw = await response.text();
    if (!raw.trim()) throw niApiFailure('API 返回内容为空，请稍后重试或检查模型是否正常输出。', 'NI_API_EMPTY');
    try {
        return JSON.parse(raw);
    } catch (_) {
        throw niAttachApiResponse(niApiFailure('API 响应不是有效 JSON，可能返回了网页或损坏的响应。请检查接口地址与服务状态。', 'NI_API_JSON'), raw);
    }
}

async function niReadHttpError(response) {
    const raw = await response.text().catch(() => '');
    let data = raw;
    try { data = JSON.parse(raw); } catch (_) {}
    return niGetApiResponseError(data, response.status, response.statusText);
}

export function createChatCompletionResponseTools({ extractMessageFromData: extractMessageFromDataFn } = {}) {
function niContentPartToText(value, depth = 0) {
    if (value === undefined || value === null || depth > 8) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(item => niContentPartToText(item, depth + 1)).join('');
    if (typeof value !== 'object') return '';

    const keys = ['text', 'content', 'output_text', 'message', 'completion', 'response', 'generated_text', 'delta', 'parts', 'output'];
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            const text = niContentPartToText(value[key], depth + 1);
            if (text) return text;
        }
    }
    return '';
}

function niExtractChatCompletionText(data) {
    if (data === undefined || data === null) return '';
    if (typeof data === 'string') return data;

    try {
        const extracted = extractMessageFromDataFn(data, 'openai');
        if (typeof extracted === 'string' && extracted.trim()) return extracted;
    } catch (_) {}

    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const candidates = [
        choice?.delta?.content,
        choice?.delta?.text,
        choice?.message?.content,
        choice?.text,
        data?.delta?.text,
        data?.delta?.content,
        data?.delta,
        data?.message?.content,
        data?.content,
        data?.output_text,
        data?.output,
        data?.completion,
        data?.response,
        data?.text,
        data?.generated_text,
        data?.candidates?.[0]?.content?.parts,
        data?.candidates?.[0]?.content,
        data?.candidates?.[0]?.text,
    ];

    for (const candidate of candidates) {
        const text = niContentPartToText(candidate);
        if (text && text.trim()) return text;
    }
    return '';
}

function niExtractChatCompletionTextFromRaw(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';

    if (text.startsWith('{') || text.startsWith('[')) {
        let data;
        try {
            data = JSON.parse(text);
        } catch (_) {
            throw niApiFailure('API 响应 JSON 不完整或格式错误，请检查接口返回格式后重试。', 'NI_API_JSON');
        }
        niAssertApiResponse(data);
        return niExtractChatCompletionText(data);
    }

    let full = '';
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let data;
        try { data = JSON.parse(payload); }
        catch (_) { throw niApiFailure('流式响应中出现不合规的 JSON 数据，请检查接口的流式兼容性或关闭流式后重试。', 'NI_API_JSON'); }
        niAssertApiResponse(data);
        full += niExtractChatCompletionText(data);
    }
    return full;
}

function niHasLengthFinishReason(data) {
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    return choices.some(choice => String(choice?.finish_reason || '').toLowerCase() === 'length');
}

async function niReadChatCompletionStream(resp, controller, cleanup, emptyMessage = '流式响应内容为空') {
    const reader = resp.body?.getReader();
    if (!reader) {
        cleanup?.();
        throw niApiFailure(emptyMessage, 'NI_API_EMPTY');
    }

    const decoder = new TextDecoder();
    const signal = controller?.signal;
    let full = '';
    let raw = '';
    let pending = '';

    const processLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let data;
        try { data = JSON.parse(payload); }
        catch (_) { throw niApiFailure('流式响应中出现不合规的 JSON 数据，请检查接口的流式兼容性或关闭流式后重试。', 'NI_API_JSON'); }
        niAssertApiResponse(data);
        full += niExtractChatCompletionText(data);
    };

    try {
        while (true) {
            const readPromise = reader.read();
            let onAbort;
            const abortPromise = signal && new Promise((_, reject) => {
                onAbort = () => reject(niApiTransportError(new Error('AbortError'), signal));
                if (signal.aborted) onAbort();
                else signal.addEventListener('abort', onAbort, { once: true });
            });
            let readResult;
            try { readResult = await (abortPromise ? Promise.race([readPromise, abortPromise]) : readPromise); }
            finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
            const { done, value } = readResult;
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            raw += chunk;
            pending += chunk;
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() || '';
            for (const line of lines) processLine(line);
        }

        const tail = decoder.decode(undefined, { stream: false });
        if (tail) {
            raw += tail;
            pending += tail;
        }
        if (pending.trim()) processLine(pending);
    } catch (err) {
        reader.cancel().catch(() => {});
        cleanup?.();
        throw niAttachApiResponse(niApiTransportError(err, signal), full || raw);
    }

    cleanup?.();
    if (full.trim()) return full.trim();

    let fallback;
    try { fallback = niExtractChatCompletionTextFromRaw(raw); }
    catch (error) { throw niAttachApiResponse(error, raw); }
    if (fallback.trim()) return fallback.trim();

    if (raw.trim() && !/^[\[{]/.test(raw.trim()) && !/^\s*(?:data:|:)/m.test(raw)) {
        throw niAttachApiResponse(niApiFailure('接口没有返回有效的流式数据或 JSON，可能返回了网页。请检查接口地址，或关闭流式后重试。', 'NI_API_JSON'), raw);
    }

    throw niAttachApiResponse(niApiFailure(emptyMessage, 'NI_API_EMPTY'), raw);
}


    return {
        niContentPartToText,
        niExtractChatCompletionText,
        niExtractChatCompletionTextFromRaw,
        niHasLengthFinishReason,
        niReadChatCompletionStream,
    };
}

// ============================================================
// 全局提示词放置
// ============================================================

export function niNormalizeGlobalPromptSource(value) {
    if (value === 'none') return 'none';
    return value === 'tavern' ? 'tavern' : 'builtin';
}

export function createGlobalPromptTools({
    getSettings,
    defaultSettings = {},
    globalPrompt = '',
    globalTailPrompt = '',
} = {}) {
    function niApplyGlobalPromptsToMessages(messages, cfg = getSettings?.() || {}, { mergeSystemHead = true } = {}) {
        let next = Array.isArray(messages) ? messages.map(message => ({ ...message })) : [];
        if (niNormalizeGlobalPromptSource(cfg.globalPromptSource) !== 'builtin') return next;
        const headText = (cfg?.globalPrompt ?? globalPrompt).trim();
        const tailText = (cfg?.globalTailPrompt ?? globalTailPrompt).trim();
        if (headText) {
            next = niInsertGlobalPromptMessage(next, headText, {
                pos: cfg.globalHeadInjPos ?? defaultSettings.globalHeadInjPos,
                depth: cfg.globalHeadInjDepth ?? defaultSettings.globalHeadInjDepth,
                role: cfg.globalHeadInjRole ?? defaultSettings.globalHeadInjRole,
                preferPrependSystem: mergeSystemHead,
            });
        }
        if (tailText) {
            next = niInsertGlobalPromptMessage(next, tailText, {
                pos: cfg.globalTailInjPos ?? defaultSettings.globalTailInjPos,
                depth: cfg.globalTailInjDepth ?? defaultSettings.globalTailInjDepth,
                role: cfg.globalTailInjRole ?? defaultSettings.globalTailInjRole,
                preferPrependSystem: false,
            });
        }
        return next;
    }

    function niGlobalRoleName(role) {
        return role === 1 ? 'user' : (role === 2 ? 'assistant' : 'system');
    }

    function niInsertGlobalPromptMessage(messages, content, { pos, depth, role, preferPrependSystem }) {
        const roleName = niGlobalRoleName(role);
        if (preferPrependSystem && roleName === 'system' && Number(pos) === 2) {
            const firstSysIndex = messages.findIndex(message => message.role === 'system');
            if (firstSysIndex >= 0) {
                return messages.map((message, index) => index === firstSysIndex
                    ? { ...message, content: `${content}\n\n${message.content || ''}` } : message);
            }
        }

        const message = { role: roleName, content };
        const next = [...messages];
        const normalizedPos = Number(pos);
        if (normalizedPos === 2) {
            next.unshift(message);
            return next;
        }
        if (normalizedPos === 0) {
            const firstSysIdx = next.findIndex(item => item.role === 'system');
            next.splice(firstSysIdx >= 0 ? firstSysIdx + 1 : 0, 0, message);
            return next;
        }
        const normalizedDepth = Math.max(0, parseInt(depth, 10) || 0);
        const index = normalizedDepth > 0 ? Math.max(0, next.length - normalizedDepth) : next.length;
        next.splice(index, 0, message);
        return next;
    }

    function niInsertIntoEventChat(chat, content, pos, depth, role) {
        const next = niInsertGlobalPromptMessage(chat, content, {
            pos,
            depth,
            role,
            preferPrependSystem: false,
        });
        chat.splice(0, chat.length, ...next);
    }

    return {
        niApplyGlobalPromptsToMessages,
        niGlobalRoleName,
        niInsertGlobalPromptMessage,
        niInsertIntoEventChat,
    };
}

// ============================================================
// 统一小说 API 客户端
// ============================================================

export function createNovelApiClient({
    getSettings,
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
    getCurrentAbortController,
    setCurrentAbortController,
    fetch: fetchFn = globalThis.fetch,
} = {}) {
function niCreateRequestScope(signal, cfg = getSettings?.()) {
    const timeoutMin = cfg?.apiTimeoutMin ?? 15;
    const controller = new AbortController();
    setCurrentAbortController?.(controller);
    const timeoutId = setTimeout(() => controller.abort(niApiFailure(
        `请求超时：已超过设置的 ${timeoutMin} 分钟。请减小每段大小，或检查接口后调整请求超时。`, 'NI_API_TIMEOUT',
    )), timeoutMin * 60 * 1000);
    const abortFromOuter = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromOuter();
    else signal?.addEventListener?.('abort', abortFromOuter, { once: true });
    const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener?.('abort', abortFromOuter);
        if (getCurrentAbortController?.() === controller) setCurrentAbortController?.(null);
    };
    return { controller, cleanup };
}

async function niGenerateWithTavernMainPreset(messages, { responseLength = null, signal = null } = {}) {
    const cfg = { ...getSettings?.() };
    const tavernMessages = await niBuildTavernPresetMessages(messages, cfg);
    if (!tavernMessages.some(message => String(message.content || '').trim())) {
        throw new Error('酒馆主预设调用失败：提示词内容为空');
    }

    const useStream = cfg.cleanStream ?? true;
    const generate_data = {
        chat_completion_source: 'openai',
        messages: tavernMessages,
        model: cfg.cleanModel,
        max_tokens: typeof responseLength === 'number' && responseLength > 0 ? responseLength : 32000,
        temperature: 0.3,
        stream: useStream,
        reverse_proxy: cfg.cleanUrl,
        proxy_password: cfg.cleanKey,
        user_name: TAVERN_TASK_USER_NAME,
        char_name: TAVERN_TASK_ACTOR_NAME,
        group_names: [],
    };

    const { controller, cleanup } = niCreateRequestScope(signal);
    try {
        const resp = await fetchFn('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(generate_data),
            signal: controller.signal,
        });
        if (!resp.ok) throw await niReadHttpError(resp);
        if (useStream) {
            return await niReadChatCompletionStream(resp, controller, cleanup, '酒馆主预设调用失败：流式响应内容为空');
        }
        const data = await niReadApiJson(resp);
        niAssertApiResponse(data);
        const result = cleanUpMessage({
            getMessage: niExtractChatCompletionText(data),
            isImpersonate: false,
            isContinue: false,
            displayIncompleteSentences: true,
            includeUserPromptBias: false,
            trimNames: false,
            trimWrongNames: false,
        });
        if (typeof result === 'string' && result.trim()) return result.trim();
        throw niApiFailure('酒馆主预设调用失败：返回内容为空，请检查模型是否正常输出。', 'NI_API_EMPTY');
    } catch (err) {
        throw niApiTransportError(err, controller.signal, cfg);
    } finally {
        cleanup();
    }
}


async function callCleanApi(messages, { signal = null, prepared = false, requestSettings = null, onRequestSent = null } = {}) {
    await niAcquireApiRateSlot(signal);
    const cfg = (prepared && requestSettings) || getSettings?.() || {};
    const useStream = cfg.cleanStream ?? true;
    if (!prepared && niUseTavernGlobalPreset(cfg)) {
        return runWithSemaphore(ApiSemaphore, () => niGenerateWithTavernMainPreset(messages, { responseLength: 32000, signal }));
    }
    if (!prepared) messages = niApplyGlobalPromptsToMessages(messages, cfg);

    const body = {
        chat_completion_source: 'openai',
        messages,
        model: cfg.cleanModel,
        max_tokens: 32000,
        temperature: 0.3,
        stream: useStream,
        reverse_proxy: cfg.cleanUrl,
        proxy_password: cfg.cleanKey,
    };

    return runWithSemaphore(ApiSemaphore, async () => {
        // 超时与暂停信号贯穿请求和响应读取，保留各自的中止原因。
        const { controller, cleanup } = niCreateRequestScope(signal, cfg);
        try {
            if (controller.signal.aborted) throw niApiTransportError(new Error('AbortError'), controller.signal);
            onRequestSent?.();
            const resp = await fetchFn('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!resp.ok) throw await niReadHttpError(resp);
            if (useStream) {
                return await niReadChatCompletionStream(resp, controller, cleanup, '流式响应内容为空');
            }
            const json = await niReadApiJson(resp);
            niAssertApiResponse(json);
            const text = niExtractChatCompletionText(json);
            if (typeof text === 'string' && text.trim()) return text.trim();
            throw niAttachApiResponse(niApiFailure('API 返回内容为空或缺少可读取的正文，请检查接口格式与模型输出。', 'NI_API_EMPTY'), json);
        } catch (err) {
            throw niApiTransportError(err, controller.signal, cfg);
        } finally {
            cleanup();
        }
    });
}

// ============================================================

async function callApiSeq(messages, { responseLength = 1000, signal = null } = {}) {
    // 等待限速槽位
    await niAcquireApiRateSlot(signal);
    const cfg = getSettings?.();

    if (niUseTavernGlobalPreset(cfg)) {
        return await niGenerateWithTavernMainPreset(messages, { responseLength, signal });
    }

    messages = niApplyGlobalPromptsToMessages(messages, cfg);

    const useStream = cfg.cleanStream ?? true;
    const body = {
        chat_completion_source: 'openai',
        messages,
        model: cfg.cleanModel,
        max_tokens: responseLength,
        temperature: 0.3,
        stream: useStream,
        reverse_proxy: cfg.cleanUrl,
        proxy_password: cfg.cleanKey,
    };
    return runWithSemaphore(ApiSemaphore, async () => {
        try {
            const resp = await fetchFn('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: signal || undefined,
            });
            if (!resp.ok) throw await niReadHttpError(resp);
            if (useStream) {
                return await niReadChatCompletionStream(resp, { signal }, () => {}, '流式响应内容为空');
            }
            const json = await niReadApiJson(resp);
            niAssertApiResponse(json);
            const text = niExtractChatCompletionText(json);
            if (typeof text === 'string' && text.trim()) return text.trim();
            throw niApiFailure('API 返回内容为空或缺少可读取的正文，请检查接口格式与模型输出。', 'NI_API_EMPTY');
        } catch (err) {
            throw niApiTransportError(err, signal, cfg);
        }
    });
}

// ============================================================

    return {
        callApiSeq,
        callCleanApi,
        niGenerateWithTavernMainPreset,
    };
}
