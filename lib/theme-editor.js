import {
    NI_THEME_BUILTIN_PRESETS,
    NI_THEME_DEFAULT,
    niApplyThemeSettings,
    niNormalizeBackgroundGradient,
    niNormalizeHex,
} from './theme-utils.js';

export function createThemeEditor({
    EXT_NAME,
    DEFAULT_SETTINGS,
    extension_settings,
    q,
    sv,
    niEscAttr,
    niEscHtml,
    saveSettingsDebounced,
}) {
    function niApplyCurrentTheme() {
        const cfg = extension_settings[EXT_NAME] || {};
        niApplyThemeWithSurface(cfg);
    }

    function niThemeTargets() {
        const targets = [document.documentElement, q('#ni-app')];
        try {
            const parentDoc = window.parent?.document;
            if (parentDoc && parentDoc !== document) targets.push(parentDoc.documentElement);
        } catch (_) {}
        return targets;
    }

    const NI_TAVERN_SURFACE_INLINE_PROPS = [
        '--SmartThemeBlurTintColor',
        '--SmartThemeChatTintColor',
        '--SmartThemeBodyColor',
        '--SmartThemeEmColor',
        '--SmartThemeBorderColor',
        '--SmartThemeBlurStrength',
        '--SmartThemeShadowColor',
        '--shadowWidth',
        '--ni-tavern-backdrop-filter',
    ];

    function niClearTavernSurfaceInlineProps(app) {
        NI_TAVERN_SURFACE_INLINE_PROPS.forEach(name => app.style.removeProperty(name));
    }

    function niTavernSurfaceSource(app) {
        return app?.closest('.drawer-content')
            || q('#ni_drawer_content')?.closest('.drawer-content')
            || q('#extensions_settings')?.closest('.drawer-content')
            || q('.drawer-content.openDrawer')
            || q('.drawer-content')
            || document.documentElement;
    }

    function niSetTavernSurfaceProp(app, name, value) {
        const next = String(value || '').trim();
        if (next && next !== 'none') app.style.setProperty(name, next);
    }

    function niApplyTavernSurfaceTheme(cfg = {}) {
        const app = q('#ni-app');
        if (!app) return;
        niClearTavernSurfaceInlineProps(app);
        if (cfg.themeSurfaceFollowPreset === false) return;
        app.classList.add('ni-surface-tavern');
        const source = niTavernSurfaceSource(app);
        if (!source) return;
        const sourceStyle = getComputedStyle(source);
        NI_TAVERN_SURFACE_INLINE_PROPS.forEach(name => {
            niSetTavernSurfaceProp(app, name, sourceStyle.getPropertyValue(name));
        });
    }

    function niApplyThemeWithSurface(cfg = {}) {
        const app = q('#ni-app');
        app?.classList.remove('ni-surface-tavern');
        niApplyThemeSettings(cfg, niThemeTargets());
        niApplyTavernSurfaceTheme(cfg);
        app?.classList.toggle('ni-borderless', cfg.themeBorderless === true);
        app?.classList.toggle('ni-cardless', cfg.themeCardless === true);
    }

    function niThemePresetOptions(cfg = extension_settings[EXT_NAME] || {}) {
        const deleted = new Set(Array.isArray(cfg.themeDeletedPresetIds) ? cfg.themeDeletedPresetIds : []);
        const builtins = NI_THEME_BUILTIN_PRESETS
            .filter(item => !deleted.has(item.id))
            .map(item => ({ value: item.id, name: item.name, builtin: item }));
        const users = (Array.isArray(cfg.themeUserPresets) ? cfg.themeUserPresets : [])
            .filter(item => item && item.id && !deleted.has(`user:${item.id}`))
            .map(item => ({ value: `user:${item.id}`, name: item.name || '未命名' }));
        return [...builtins, ...users];
    }

    function niRenderThemePresetOptions(selected) {
        const cfg = extension_settings[EXT_NAME] || {};
        const select = q('#ni-theme-preset');
        const options = niThemePresetOptions(cfg);
        const nextSelected = options.some(item => item.value === selected) ? selected : (options[0]?.value || 'default');
        if (select) {
            select.innerHTML = options.map(item => `<option value="${niEscAttr(item.value)}">${niEscHtml(item.name)}</option>`).join('');
            select.value = nextSelected;
        }
        return nextSelected;
    }

    function niThemeBuiltinPreset(id) {
        return NI_THEME_BUILTIN_PRESETS.find(item => item.id === id) || null;
    }

    function niThemeUserPreset(value, cfg = extension_settings[EXT_NAME] || {}) {
        if (!value?.startsWith('user:')) return null;
        const id = value.slice(5);
        return (Array.isArray(cfg.themeUserPresets) ? cfg.themeUserPresets : []).find(item => item?.id === id) || null;
    }

    function niThemeBuiltinOverride(value, cfg = extension_settings[EXT_NAME] || {}) {
        if (!value || value === 'custom' || value.startsWith('user:')) return null;
        const overrides = cfg.themePresetOverrides && typeof cfg.themePresetOverrides === 'object' ? cfg.themePresetOverrides : {};
        return overrides[value] || null;
    }

    function niThemePresetSource(value, cfg = extension_settings[EXT_NAME] || {}) {
        const user = niThemeUserPreset(value, cfg);
        if (user) return user;
        return niThemeBuiltinOverride(value, cfg) || niThemeBuiltinPreset(value);
    }

    function niThemePresetColors(value, cfg = extension_settings[EXT_NAME] || {}) {
        if (value === 'custom') {
            return {
                primary: niNormalizeHex(cfg.themePrimary, NI_THEME_DEFAULT.primary),
                success: niNormalizeHex(cfg.themeSuccess, NI_THEME_DEFAULT.success),
                pivot: niNormalizeHex(cfg.themePivot, NI_THEME_DEFAULT.pivot),
                warning: niNormalizeHex(cfg.themeWarning, NI_THEME_DEFAULT.warning),
                background: niNormalizeHex(cfg.themeBackground, NI_THEME_DEFAULT.background),
                text: niNormalizeHex(cfg.themeText, NI_THEME_DEFAULT.text),
            };
        }
        const source = niThemePresetSource(value, cfg)?.colors || NI_THEME_DEFAULT;
        return {
            primary: niNormalizeHex(source.primary, NI_THEME_DEFAULT.primary),
            success: niNormalizeHex(source.success, NI_THEME_DEFAULT.success),
            pivot: niNormalizeHex(source.pivot, NI_THEME_DEFAULT.pivot),
            warning: niNormalizeHex(source.warning, NI_THEME_DEFAULT.warning),
            background: niNormalizeHex(source.background, NI_THEME_DEFAULT.background),
            text: niNormalizeHex(source.text, NI_THEME_DEFAULT.text),
        };
    }

    function niThemePresetBackgroundGradient(value, cfg = extension_settings[EXT_NAME] || {}) {
        if (value === 'custom') return null;
        const source = niThemePresetSource(value, cfg);
        return niNormalizeBackgroundGradient(source?.backgroundGradient);
    }

    function niThemeCurrentColors() {
        return {
            primary: niNormalizeHex(q('#ni-theme-primary')?.value, NI_THEME_DEFAULT.primary),
            success: niNormalizeHex(q('#ni-theme-success')?.value, NI_THEME_DEFAULT.success),
            pivot: niNormalizeHex(q('#ni-theme-pivot')?.value, NI_THEME_DEFAULT.pivot),
            warning: niNormalizeHex(q('#ni-theme-warning')?.value, NI_THEME_DEFAULT.warning),
            background: niNormalizeHex(q('#ni-theme-background')?.value, NI_THEME_DEFAULT.background),
            text: niNormalizeHex(q('#ni-theme-text')?.value, NI_THEME_DEFAULT.text),
        };
    }

    function niSyncThemeUI() {
        const cfg = extension_settings[EXT_NAME] || {};
        const preset = niRenderThemePresetOptions(cfg.themePreset || DEFAULT_SETTINGS.themePreset);
        if (cfg.themePreset === 'custom' || cfg.themePreset !== preset) cfg.themePreset = preset;
        const colors = niThemePresetColors(preset, cfg);
        ['primary', 'success', 'pivot', 'warning'].forEach(key => {
            niSetThemeColorUI(key, colors[key]);
        });
        const surfaceFollow = cfg.themeSurfaceFollowPreset !== false;
        niSetThemeColorUI('background', surfaceFollow ? colors.background : niNormalizeHex(cfg.themeBackground, NI_THEME_DEFAULT.background));
        niSetThemeColorUI('text', surfaceFollow ? colors.text : niNormalizeHex(cfg.themeText, NI_THEME_DEFAULT.text));
        niSetThemeSurfaceUI(surfaceFollow);
        niSetThemeBorderlessUI(cfg.themeBorderless === true);
        niSetThemeCardlessUI(cfg.themeCardless === true);
    }

    function niSetThemePreset(preset) {
        const nextPreset = niRenderThemePresetOptions(preset);
        const cfg = extension_settings[EXT_NAME] || {};
        cfg.themePreset = nextPreset;
        const colors = niThemePresetColors(nextPreset);
        sv('#ni-theme-preset', nextPreset);
        ['primary', 'success', 'pivot', 'warning'].forEach(key => {
            niSetThemeColorUI(key, colors[key]);
        });
        niSetThemeColorUI('background', colors.background);
        niSetThemeColorUI('text', colors.text);
        niApplyThemeWithSurface(niReadThemeDraft());
        niSaveThemePreset();
    }

    function niParseThemeHexInput(value) {
        const raw = String(value || '').trim().toUpperCase();
        const body = raw.startsWith('#') ? raw.slice(1) : raw;
        if (/^[0-9A-F]{6}$/.test(body)) return `#${body}`;
        if (/^[0-9A-F]{3}$/.test(body)) {
            return `#${body.split('').map(ch => ch + ch).join('')}`;
        }
        return '';
    }

    function niIsThemeHexDraft(value) {
        const raw = String(value || '').trim();
        return raw === '' || /^#?[0-9a-fA-F]{0,6}$/.test(raw);
    }

    function niSetThemeColorUI(key, value, opts = {}) {
        const syncCode = opts.syncCode !== false;
        const color = niNormalizeHex(value, NI_THEME_DEFAULT[key] || NI_THEME_DEFAULT.primary);
        sv(`#ni-theme-${key}`, color);
        const code = q(`#ni-theme-${key}-code`);
        if (code) {
            if (syncCode) code.value = color;
            code.classList.remove('ni-theme-code-invalid');
        }
        const swatch = q(`#ni-theme-${key}-swatch`);
        if (swatch) swatch.style.background = color;
    }

    function niReadThemeDraft() {
        const preset = q('#ni-theme-preset')?.value || 'default';
        const surfaceFollow = q('#ni-theme-surface-follow')?.checked !== false;
        const colors = niThemeCurrentColors();
        return {
            themePreset: preset,
            themePrimary: colors.primary,
            themeSuccess: colors.success,
            themePivot: colors.pivot,
            themeWarning: colors.warning,
            themePreviewColors: colors,
            themeSurfaceFollowPreset: surfaceFollow,
            themeBorderless: q('#ni-theme-borderless')?.checked === true,
            themeCardless: q('#ni-theme-cardless')?.checked === true,
            themeBackground: colors.background,
            themeText: colors.text,
        };
    }

    function niSetThemeColor(key, value) {
        if (key === 'background' || key === 'text') {
            niSetThemeSurfaceUI(false);
            niSetThemeColorUI(key, value);
            niApplyThemeWithSurface(niReadThemeDraft());
            return;
        }
        niSetThemeColorUI(key, value);
        niApplyThemeWithSurface(niReadThemeDraft());
    }

    function niSetThemeColorFromText(key, value) {
        const el = q(`#ni-theme-${key}-code`);
        if (!niIsThemeHexDraft(value)) {
            el?.classList.add('ni-theme-code-invalid');
            return;
        }
        el?.classList.remove('ni-theme-code-invalid');
        const raw = String(value || '').trim();
        const body = raw.startsWith('#') ? raw.slice(1) : raw;
        if (!/^[0-9a-fA-F]{6}$/.test(body)) return;
        const color = niParseThemeHexInput(value);
        niSetThemeColor(key, color);
        niSetThemeColorUI(key, color, { syncCode: false });
    }

    function niRestoreThemeColorText(key) {
        const el = q(`#ni-theme-${key}-code`);
        const color = niParseThemeHexInput(el?.value);
        if (color) {
            niSetThemeColor(key, color);
            return;
        }
        const current = niNormalizeHex(q(`#ni-theme-${key}`)?.value, NI_THEME_DEFAULT[key] || NI_THEME_DEFAULT.primary);
        niSetThemeColorUI(key, current);
    }

    function niSetThemeSurfaceUI(follow) {
        const checked = follow !== false;
        const chk = q('#ni-theme-surface-follow');
        const row = q('#ni-theme-surface-switch-row');
        const state = q('#ni-theme-surface-state');
        if (chk) chk.checked = checked;
        row?.classList.toggle('ni-switch-off', !checked);
        if (state) state.textContent = checked ? '开' : '关';
        ['background', 'text'].forEach(key => {
            const el = q(`#ni-theme-${key}`);
            if (el) el.disabled = checked;
            const code = q(`#ni-theme-${key}-code`);
            if (code) code.disabled = checked;
        });
    }

    function niSetThemeSurfaceFollow(follow) {
        niSetThemeSurfaceUI(follow);
        const cfg = extension_settings[EXT_NAME] || {};
        const presetColors = niThemePresetColors(q('#ni-theme-preset')?.value || 'default');
        if (follow !== false) {
            niSetThemeColorUI('background', presetColors.background);
            niSetThemeColorUI('text', presetColors.text);
        } else {
            niSetThemeColorUI('background', niNormalizeHex(cfg.themeBackground, presetColors.background));
            niSetThemeColorUI('text', niNormalizeHex(cfg.themeText, presetColors.text));
        }
        niApplyThemeWithSurface(niReadThemeDraft());
        niSaveThemePreset();
    }

    function niSetThemeBorderlessUI(enabled) {
        const checked = enabled === true;
        const chk = q('#ni-theme-borderless');
        const row = q('#ni-theme-borderless-row');
        const state = q('#ni-theme-borderless-state');
        if (chk) chk.checked = checked;
        row?.classList.toggle('ni-switch-off', !checked);
        if (state) state.textContent = checked ? '开' : '关';
    }

    function niSetThemeBorderless(enabled) {
        niSetThemeBorderlessUI(enabled);
        niApplyThemeWithSurface(niReadThemeDraft());
    }

    function niSetThemeCardlessUI(enabled) {
        const checked = enabled === true;
        const chk = q('#ni-theme-cardless');
        const row = q('#ni-theme-cardless-row');
        const state = q('#ni-theme-cardless-state');
        if (chk) chk.checked = checked;
        row?.classList.toggle('ni-switch-off', !checked);
        if (state) state.textContent = checked ? '开' : '关';
    }

    function niSetThemeCardless(enabled) {
        niSetThemeCardlessUI(enabled);
        niApplyThemeWithSurface(niReadThemeDraft());
    }

    function niToggleThemePanel() {
        const body = q('#ni-theme-body');
        const icon = q('#ni-theme-chevron');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
    }

    function niNewThemePreset() {
        const cfg = extension_settings[EXT_NAME];
        const name = prompt('主题名称：', '新主题');
        if (!name) return;
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        if (!Array.isArray(cfg.themeUserPresets)) cfg.themeUserPresets = [];
        cfg.themeUserPresets.push({ id, name: name.trim() || '新主题', colors: niThemeCurrentColors() });
        cfg.themePreset = `user:${id}`;
        niRenderThemePresetOptions(cfg.themePreset);
        niSaveThemePreset();
    }

    function niThemeColorsEqual(a = {}, b = {}) {
        return ['primary', 'success', 'pivot', 'warning', 'background', 'text']
            .every(key => niNormalizeHex(a[key], NI_THEME_DEFAULT[key] || NI_THEME_DEFAULT.primary) === niNormalizeHex(b[key], NI_THEME_DEFAULT[key] || NI_THEME_DEFAULT.primary));
    }

    function niSaveThemePreset() {
        const cfg = extension_settings[EXT_NAME];
        const draft = niReadThemeDraft();
        const colors = niThemeCurrentColors();
        if (draft.themePreset?.startsWith('user:')) {
            const user = niThemeUserPreset(draft.themePreset, cfg);
            if (user) user.colors = colors;
        } else {
            const builtin = niThemeBuiltinPreset(draft.themePreset);
            if (builtin) {
                if (!cfg.themePresetOverrides || typeof cfg.themePresetOverrides !== 'object') cfg.themePresetOverrides = {};
                const existing = cfg.themePresetOverrides[draft.themePreset];
                const shouldStore = existing || !niThemeColorsEqual(colors, builtin.colors);
                if (shouldStore) {
                    cfg.themePresetOverrides[draft.themePreset] = {
                        colors,
                        ...(builtin.backgroundGradient ? { backgroundGradient: builtin.backgroundGradient } : {}),
                        ...(builtin.surfaceGlass === true ? { surfaceGlass: true } : {}),
                    };
                }
            }
        }
        cfg.themePreset = draft.themePreset;
        cfg.themePrimary = draft.themePrimary;
        cfg.themeSuccess = draft.themeSuccess;
        cfg.themePivot = draft.themePivot;
        cfg.themeWarning = draft.themeWarning;
        cfg.themeSurfaceFollowPreset = draft.themeSurfaceFollowPreset;
        cfg.themeBorderless = draft.themeBorderless;
        cfg.themeCardless = draft.themeCardless;
        cfg.themeBackground = draft.themeBackground;
        cfg.themeText = draft.themeText;
        niApplyCurrentTheme();
        niSyncThemeUI();
        saveSettingsDebounced();
    }

    function niDeleteThemePreset() {
        const cfg = extension_settings[EXT_NAME];
        const value = q('#ni-theme-preset')?.value || 'default';
        const option = niThemePresetOptions(cfg).find(item => item.value === value);
        if (!option) return;
        if (!confirm(`删除主题「${option.name}」？`)) return;
        if (value.startsWith('user:')) {
            const id = value.slice(5);
            cfg.themeUserPresets = (Array.isArray(cfg.themeUserPresets) ? cfg.themeUserPresets : []).filter(item => item?.id !== id);
        } else {
            if (!Array.isArray(cfg.themeDeletedPresetIds)) cfg.themeDeletedPresetIds = [];
            if (!cfg.themeDeletedPresetIds.includes(value)) cfg.themeDeletedPresetIds.push(value);
        }
        cfg.themePreset = niRenderThemePresetOptions('default');
        niSetThemePreset(cfg.themePreset);
        niSaveThemePreset();
    }

    function niExportThemePreset() {
        const value = q('#ni-theme-preset')?.value || 'default';
        const option = niThemePresetOptions().find(item => item.value === value);
        const name = option?.name || '主题';
        const backgroundGradient = niThemePresetBackgroundGradient(value);
        const payload = {
            type: 'novel-injector-theme-preset',
            version: 1,
            preset: {
                name,
                colors: niThemeCurrentColors(),
                surfaceFollowPreset: q('#ni-theme-surface-follow')?.checked !== false,
            },
        };
        if (backgroundGradient) payload.preset.backgroundGradient = backgroundGradient;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `novel-injector-theme-${name.replace(/[\\/:*?"<>|]+/g, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function niImportThemePresetFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const raw = JSON.parse(String(reader.result || '{}'));
                const preset = raw.preset || raw;
                const colors = preset.colors || preset;
                const backgroundGradient = niNormalizeBackgroundGradient(preset.backgroundGradient || raw.backgroundGradient);
                const name = String(preset.name || raw.name || file.name.replace(/\.json$/i, '') || '导入主题').trim();
                const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                const cfg = extension_settings[EXT_NAME];
                if (!Array.isArray(cfg.themeUserPresets)) cfg.themeUserPresets = [];
                const normalizedColors = {
                    primary: niNormalizeHex(colors.primary, NI_THEME_DEFAULT.primary),
                    success: niNormalizeHex(colors.success, NI_THEME_DEFAULT.success),
                    pivot: niNormalizeHex(colors.pivot, NI_THEME_DEFAULT.pivot),
                    warning: niNormalizeHex(colors.warning, NI_THEME_DEFAULT.warning),
                    background: niNormalizeHex(colors.background, NI_THEME_DEFAULT.background),
                    text: niNormalizeHex(colors.text, NI_THEME_DEFAULT.text),
                };
                const userPreset = { id, name, colors: normalizedColors };
                if (backgroundGradient) userPreset.backgroundGradient = backgroundGradient;
                cfg.themeUserPresets.push(userPreset);
                cfg.themePreset = `user:${id}`;
                cfg.themeSurfaceFollowPreset = backgroundGradient ? false : preset.surfaceFollowPreset !== false;
                cfg.themeBackground = normalizedColors.background;
                cfg.themeText = normalizedColors.text;
                niSyncThemeUI();
                niSaveThemePreset();
            } catch (e) {
                toastr?.error(`导入失败：${e.message}`);
            }
        };
        reader.readAsText(file);
    }

    return {
        applyCurrentTheme: niApplyCurrentTheme,
        syncUI: niSyncThemeUI,
        togglePanel: niToggleThemePanel,
        setPreset: niSetThemePreset,
        setColor: niSetThemeColor,
        setColorFromText: niSetThemeColorFromText,
        restoreColorText: niRestoreThemeColorText,
        setSurfaceFollow: niSetThemeSurfaceFollow,
        setBorderless: niSetThemeBorderless,
        setCardless: niSetThemeCardless,
        importPresetFile: niImportThemePresetFile,
        exportPreset: niExportThemePreset,
        deletePreset: niDeleteThemePreset,
        newPreset: niNewThemePreset,
        savePreset: niSaveThemePreset,
    };
}
