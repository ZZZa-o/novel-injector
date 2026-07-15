export function niNovelNameFromFileName(fileName = '') {
    return String(fileName || '')
        .trim()
        .replace(/\.[^.]+$/u, '')
        .trim() || '未命名小说';
}

export function niFindCurrentNovelIndex(library = [], novelKey = '') {
    if (!novelKey) return -1;
    return (Array.isArray(library) ? library : []).findIndex(snap => snap?.data?._novelKey === novelKey);
}

export function createAutosaveController({
    state,
    getSettings,
    saveSettingsDebounced,
    saveNovelSnapshot,
    updateNovelSnapshot,
    renderNovelLibrary = () => {},
    delay = 1200,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = timerId => clearTimeout(timerId),
    logger = console,
} = {}) {
    let timer = null;
    let saving = false;

    function isEnabled() {
        return getSettings()?.autoSaveEnabled === true;
    }

    function setSourceFileName(fileName = '') {
        const cfg = getSettings();
        if (!cfg) return;
        cfg._autoSaveSourceName = niNovelNameFromFileName(fileName);
        saveSettingsDebounced();
    }

    async function saveNow() {
        if (timer) {
            clearTimer(timer);
            timer = null;
        }
        if (!isEnabled() || saving) return false;

        const cfg = getSettings() || {};
        const idx = niFindCurrentNovelIndex(cfg.novelLibrary, state?.novelKey);
        if (idx < 0 && !state?.fileLoaded) return false;

        saving = true;
        try {
            if (idx >= 0) {
                await updateNovelSnapshot(idx, { confirmUpdate: false, notify: false, throwOnError: true });
            } else {
                await saveNovelSnapshot(cfg._autoSaveSourceName || '未命名小说', {
                    notifyErrors: false,
                    throwOnError: true,
                });
            }
            renderNovelLibrary();
            return true;
        } catch (e) {
            logger.warn('[NI] 自动保存失败:', e);
            return false;
        } finally {
            saving = false;
        }
    }

    function schedule({ immediate = false } = {}) {
        if (!isEnabled() || saving) return;
        if (timer) clearTimer(timer);
        if (immediate) {
            void saveNow();
            return;
        }
        timer = setTimer(() => {
            timer = null;
            void saveNow();
        }, delay);
    }

    function setEnabled(enabled) {
        const cfg = getSettings();
        if (!cfg) return;
        cfg.autoSaveEnabled = !!enabled;
        saveSettingsDebounced();
        if (enabled) schedule({ immediate: true });
        else if (timer) {
            clearTimer(timer);
            timer = null;
        }
    }

    return { isEnabled, setEnabled, setSourceFileName, schedule, saveNow };
}
