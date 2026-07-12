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
        .replace(/\/chat\/completions\/?$/, '')
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
    if (!response.ok) throw new Error(`${response.status}`);
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
    selectElement.innerHTML = list.map(model =>
        `<option value="${escapeAttribute(model)}"${model === textInputElement.value ? ' selected' : ''}>${escapeHtml(model)}</option>`
    ).join('');
    selectElement.style.display = '';
    textInputElement.style.display = 'none';
    selectElement.onchange = () => {
        textInputElement.value = selectElement.value;
        selectElement.style.display = 'none';
        textInputElement.style.display = '';
        onSelected?.(selectElement.value);
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
        showAlert?.(`拉取失败: ${error?.message}`);
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

function niShouldUseTavernPresetPrompt(prompt, entry, generationType = 'quiet') {
    if (!prompt) return false;
    if (entry && entry.enabled === false) return false;
    const identifier = String(prompt.identifier || entry?.identifier || '');
    if (!identifier) return false;
    if (TAVERN_CONTEXT_PROMPT_IDS.has(identifier)) return false;
    if (prompt.marker) return false;
    const manager = getPromptManager?.();
    if (typeof manager?.shouldTrigger === 'function' && !manager.shouldTrigger(prompt, generationType)) return false;
    return typeof prompt.content === 'string' && prompt.content.trim().length > 0;
}

function niGetTavernPresetPromptEntries(generationType = 'quiet') {
    const settings = getPromptManager?.()?.serviceSettings;
    if (!settings) throw new Error('酒馆主预设调用失败：未找到当前酒馆预设设置');
    const prompts = Array.isArray(settings.prompts) ? settings.prompts : [];
    const promptMap = new Map(prompts.filter(p => p?.identifier).map(p => [String(p.identifier), p]));
    const order = niGetTavernPresetOrder(settings);
    const entries = [];

    if (order.length) {
        for (const entry of order) {
            const prompt = promptMap.get(String(entry?.identifier || ''));
            if (niShouldUseTavernPresetPrompt(prompt, entry, generationType)) entries.push(prompt);
        }
    } else {
        for (const prompt of prompts) {
            const entry = { identifier: prompt?.identifier, enabled: prompt?.enabled !== false };
            if (niShouldUseTavernPresetPrompt(prompt, entry, generationType)) entries.push(prompt);
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

async function niBuildTavernPresetMessages(messages) {
    return niWithTavernMacroSandbox(async (macroState) => {
        const presetEntries = niGetTavernPresetPromptEntries('quiet');
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


    return {
        niBuildTavernPresetMessages,
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
        try {
            return niExtractChatCompletionText(JSON.parse(text));
        } catch (_) {}
    }

    let full = '';
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
            full += niExtractChatCompletionText(JSON.parse(payload));
        } catch (_) {}
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
        throw new Error(emptyMessage);
    }

    const decoder = new TextDecoder();
    const signal = controller?.signal;
    let full = '';
    let raw = '';
    let pending = '';
    let hitLengthLimit = false;

    const processLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
            const data = JSON.parse(payload);
            if (niHasLengthFinishReason(data)) hitLengthLimit = true;
            full += niExtractChatCompletionText(data);
        } catch (_) {}
    };

    try {
        while (true) {
            const readPromise = reader.read();
            const readResult = signal
                ? await Promise.race([
                    readPromise,
                    new Promise((_, rej) => {
                        if (signal.aborted) rej(new Error('AbortError'));
                        else signal.addEventListener('abort', () => rej(new Error('AbortError')), { once: true });
                    }),
                ])
                : await readPromise;
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
        if (signal?.aborted || err?.message === 'AbortError') throw new Error('请求已中止（超时或用户操作）');
        throw err;
    }

    cleanup?.();
    if (hitLengthLimit) throw new Error('AI 返回被长度截断');
    if (full.trim()) return full.trim();

    const fallback = niExtractChatCompletionTextFromRaw(raw);
    if (fallback.trim()) return fallback.trim();

    throw new Error(emptyMessage);
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
    function niApplyGlobalPromptsToMessages(messages, cfg = getSettings?.() || {}) {
        let next = Array.isArray(messages) ? [...messages] : [];
        if (niNormalizeGlobalPromptSource(cfg.globalPromptSource) !== 'builtin') return next;
        const headText = (cfg?.globalPrompt ?? globalPrompt).trim();
        const tailText = (cfg?.globalTailPrompt ?? globalTailPrompt).trim();
        if (headText) {
            next = niInsertGlobalPromptMessage(next, headText, {
                pos: cfg.globalHeadInjPos ?? defaultSettings.globalHeadInjPos,
                depth: cfg.globalHeadInjDepth ?? defaultSettings.globalHeadInjDepth,
                role: cfg.globalHeadInjRole ?? defaultSettings.globalHeadInjRole,
                preferPrependSystem: true,
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
        if (preferPrependSystem && roleName === 'system' && pos === 2) {
            const firstSys = messages.find(message => message.role === 'system');
            if (firstSys) {
                firstSys.content = `${content}\n\n${firstSys.content || ''}`;
                return messages;
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
async function niGenerateWithTavernMainPreset(messages, { responseLength = null, signal = null } = {}) {
    const tavernMessages = await niBuildTavernPresetMessages(messages);
    if (!tavernMessages.some(message => String(message.content || '').trim())) {
        throw new Error('酒馆主预设调用失败：提示词内容为空');
    }

    const cfg = getSettings?.() || {};
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

    const TIMEOUT_MS = (getSettings?.()?.apiTimeoutMin ?? 15) * 60 * 1000;
    const controller = new AbortController();
    setCurrentAbortController?.(controller);
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const abortFromOuter = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener?.('abort', abortFromOuter, { once: true });
    const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener?.('abort', abortFromOuter);
        if (getCurrentAbortController?.() === controller) setCurrentAbortController?.(null);
    };

    let resp;
    try {
        resp = await fetchFn('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(generate_data),
            signal: controller.signal,
        });
    } catch (err) {
        cleanup();
        if (err?.name === 'AbortError') throw new Error('请求已中止（超时或用户操作）');
        throw err;
    }

    if (!resp.ok) {
        cleanup();
        const txt = await resp.text().catch(() => '');
        throw new Error(`酒馆主预设 API ${resp.status}: ${txt.slice(0, 200)}`);
    }

    if (useStream) {
        return await niReadChatCompletionStream(resp, controller, cleanup, '酒馆主预设调用失败：流式响应内容为空');
    }

    let data;
    try {
        data = await resp.json();
    } finally {
        cleanup();
    }

    if (data?.error) {
        const message = data.error.message || data.response || 'API 返回错误';
        throw new Error(message);
    }
    if (niHasLengthFinishReason(data)) throw new Error('AI 返回被长度截断');

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
    throw new Error('酒馆主预设调用失败：返回内容为空');
}


async function callCleanApi(messages, { signal = null } = {}) {
    await niAcquireApiRateSlot(signal);
    const cfg = getSettings?.();
    const useStream = cfg.cleanStream ?? true;
    if (niUseTavernGlobalPreset(cfg)) {
        return runWithSemaphore(ApiSemaphore, () => niGenerateWithTavernMainPreset(messages, { responseLength: 32000, signal }));
    }
    messages = niApplyGlobalPromptsToMessages(messages, cfg);

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
        // 超时控制：默认 5 分钟；同一个 controller 贯穿 fetch + 流式读取全程
        const TIMEOUT_MS = (getSettings?.()?.apiTimeoutMin ?? 15) * 60 * 1000;
        const controller = new AbortController();
        // 挂到 S 上，让跳过/暂停按钮可以直接 abort
        setCurrentAbortController?.(controller);
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(timeoutId);
            if (getCurrentAbortController?.() === controller) setCurrentAbortController?.(null);
        };

        let resp;
        try {
            resp = await fetchFn('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (err) {
            cleanup();
            if (err.name === 'AbortError') throw new Error(`请求已中止（超时或用户操作）`);
            throw err;
        }

        if (!resp.ok) {
            cleanup();
            const txt = await resp.text().catch(() => '');
            throw new Error(`API ${resp.status}: ${txt.slice(0, 200)}`);
        }

        // 流式模式：逐行读取 SSE，signal 也传给 reader 确保可被 abort
        if (useStream) {
            return await niReadChatCompletionStream(resp, controller, cleanup, '流式响应内容为空');
        }

        // 非流式模式
        let json;
        try {
            json = await resp.json();
        } catch (err) {
            cleanup();
            throw err;
        }
        cleanup();
        const text =
            json?.choices?.[0]?.message?.content ||
            json?.choices?.[0]?.text ||
            json?.content?.[0]?.text ||
            json?.content ||
            json?.output ||
            (Array.isArray(json?.choices) && json.choices[0]?.delta?.content) ||
            null;

        if (text && typeof text === 'string' && text.trim()) return text.trim();

        console.error('[NI] 无法解析 API 响应，完整内容:', JSON.stringify(json).slice(0, 500));
        throw new Error('API 返回格式异常，请查看控制台');
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
        let resp;
        try {
            resp = await fetchFn('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: signal || undefined,
            });
        } catch (err) {
            if (err?.name === 'AbortError' || signal?.aborted) throw new Error('请求已中止（超时或用户操作）');
            throw err;
        }
        if (!resp.ok) throw new Error(`API ${resp.status}`);

        if (useStream) {
            return await niReadChatCompletionStream(resp, { signal }, () => {}, '流式响应内容为空');
        }

        let json;
        try {
            json = await resp.json();
        } catch (err) {
            if (err?.name === 'AbortError' || signal?.aborted) throw new Error('请求已中止（超时或用户操作）');
            throw err;
        }
        if (niHasLengthFinishReason(json)) throw new Error('AI 返回被长度截断');
        const text = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text ||
                     json?.content?.[0]?.text || json?.content || json?.output || null;
        if (text && typeof text === 'string' && text.trim()) return text.trim();
        throw new Error('API 返回格式异常');
    });
}

// ============================================================

    return {
        callApiSeq,
        callCleanApi,
        niGenerateWithTavernMainPreset,
    };
}
