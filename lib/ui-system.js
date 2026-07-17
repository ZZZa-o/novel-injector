export const NI_THEME_DEFAULT = {
    primary: '#A0445E',
    primaryHover: '#8B3A50',
    primaryFocus: '#B8336A',
    primarySoft: '#F5E6EC',
    primarySoft2: '#FBF2F6',
    primarySoftText: '#8B3A50',
    primaryBorder: '#DDB5C0',
    primaryBorderStrong: '#E0C0CA',
    primaryOn: '#F5E6EC',
    success: '#1D9E75',
    successSoft: '#E1F5EE',
    successSoft2: '#EEF9F5',
    successText: '#0F6E56',
    successBorder: '#B9E3D4',
    successHover: '#C5EAD9',
    pivot: '#D68AC2',
    pivotSoft: '#FCF7FB',
    pivotSoft2: '#FDFAFD',
    pivotText: '#7C5071',
    pivotBorder: '#EAC2DF',
    pivotHover: '#F2DAEB',
    pivotOn: '#FFFFFF',
    warning: '#C05A62',
    warningSoft: '#FDE8EA',
    warningSoft2: '#FFF5F6',
    warningText: '#C05A62',
    warningBorder: '#EDB6BB',
    background: '#FFFDFA',
    text: '#000000',
};

export function niResolveStageInjectionUiState({
    stageCount = 0,
    stageStates = {},
    stageVecDone = {},
    vecDone = false,
    vecInjDisabled = false,
} = {}) {
    const total = Math.max(0, parseInt(stageCount, 10) || 0);
    const enabledStages = [];
    for (let i = 1; i <= total; i++) {
        const enabled = stageStates[i] === undefined ? i === 1 : stageStates[i] !== false;
        if (enabled) enabledStages.push(i);
    }

    const hasAnyVector = !!vecDone && Object.values(stageVecDone).some(Boolean);
    const hasEnabledVector = hasAnyVector && enabledStages.some(i => !!stageVecDone[i]);
    const hasEnabledRaw = enabledStages.some(i => !stageVecDone[i]);

    return {
        hasAnyVector,
        hasEnabledVector,
        hasEnabledRaw,
        showVectorToggle: hasEnabledVector,
        showRawMode: !hasAnyVector || !!vecInjDisabled || hasEnabledRaw,
    };
}

export const NI_THEME_BUILTIN_PRESETS = [
    {
        id: 'default',
        name: '默认',
        colors: { ...NI_THEME_DEFAULT },
    },
    {
        id: 'paper-note',
        name: '星糖梦簿',
        colors: {
            primary: '#A8C8F0',
            success: '#B8E8C8',
            pivot: '#F0B8D8',
            warning: '#F0D8A8',
            background: '#EFF6FF',
            text: '#345A78',
        },
        backgroundGradient: {
            enabled: true,
            type: 'linear',
            angle: 160,
            stops: [
                { color: '#DDEEFF', position: 0 },
                { color: '#F0F8FF', position: 0.35 },
                { color: '#FFF0F8', position: 0.7 },
                { color: '#F8F0FF', position: 1 },
            ],
        },
    },
    {
        id: 'paper-note-dark',
        name: '星糖梦簿·夜间',
        colors: {
            primary: '#C485F4',
            success: '#716FE2',
            pivot: '#A751D2',
            warning: '#E8C4F0',
            background: '#1A1420',
            text: '#E8D8F5',
        },
        backgroundGradient: {
            enabled: true,
            type: 'linear',
            angle: 145,
            stops: [
                { color: '#12091D', position: 0 },
                { color: '#2E1A48', position: 0.34 },
                { color: '#3A2054', position: 0.68 },
                { color: '#160B21', position: 1 },
            ],
        },
        surfaceGlass: true,
    },
];

export function niNormalizeHex(value, fallback = NI_THEME_DEFAULT.primary) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
        return ('#' + raw.slice(1).split('').map(ch => ch + ch).join('')).toUpperCase();
    }
    return fallback;
}

function niHexToRgb(hex) {
    const v = niNormalizeHex(hex).slice(1);
    return {
        r: parseInt(v.slice(0, 2), 16),
        g: parseInt(v.slice(2, 4), 16),
        b: parseInt(v.slice(4, 6), 16),
    };
}

function niRgbToHex({ r, g, b }) {
    const part = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function niMixHex(a, b, amount) {
    const ca = niHexToRgb(a);
    const cb = niHexToRgb(b);
    const t = Math.max(0, Math.min(1, amount));
    return niRgbToHex({
        r: ca.r + (cb.r - ca.r) * t,
        g: ca.g + (cb.g - ca.g) * t,
        b: ca.b + (cb.b - ca.b) * t,
    });
}

function niRgba(hex, alpha) {
    const c = niHexToRgb(hex);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function niContrastText(hex) {
    const c = niHexToRgb(hex);
    const luminance = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return luminance > 0.58 ? '#1A1A1A' : '#FFFFFF';
}

function niIsLightHex(hex) {
    const c = niHexToRgb(hex);
    return ((0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255) > 0.58;
}

function niNormalizePresetColors(colors = {}) {
    return {
        primary: niNormalizeHex(colors.primary, NI_THEME_DEFAULT.primary),
        success: niNormalizeHex(colors.success, NI_THEME_DEFAULT.success),
        pivot: niNormalizeHex(colors.pivot, NI_THEME_DEFAULT.pivot),
        warning: niNormalizeHex(colors.warning, NI_THEME_DEFAULT.warning),
        background: niNormalizeHex(colors.background, NI_THEME_DEFAULT.background),
        text: niNormalizeHex(colors.text, NI_THEME_DEFAULT.text),
    };
}

function niNormalizeGradientPosition(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const pct = n <= 1 ? n * 100 : n;
    return Math.max(0, Math.min(100, pct));
}

export function niNormalizeBackgroundGradient(gradient) {
    if (!gradient || typeof gradient !== 'object' || gradient.enabled === false) return null;
    if (gradient.type && gradient.type !== 'linear') return null;
    const rawStops = Array.isArray(gradient.stops) ? gradient.stops : [];
    const stops = rawStops
        .slice(0, 8)
        .map((stop, index) => {
            const color = niNormalizeHex(stop?.color, '');
            if (!color) return null;
            return {
                color,
                position: niNormalizeGradientPosition(stop?.position, rawStops.length > 1 ? index * (100 / (rawStops.length - 1)) : 0),
            };
        })
        .filter(Boolean);
    if (stops.length < 2) return null;
    const angle = Number.isFinite(Number(gradient.angle)) ? Number(gradient.angle) : 180;
    return {
        enabled: true,
        type: 'linear',
        angle: ((angle % 360) + 360) % 360,
        stops,
    };
}

function niBackgroundGradientToCss(gradient) {
    const normalized = niNormalizeBackgroundGradient(gradient);
    if (!normalized) return '';
    const stops = normalized.stops.map(stop => `${stop.color} ${stop.position.toFixed(2).replace(/\.?0+$/, '')}%`).join(', ');
    return `linear-gradient(${normalized.angle}deg, ${stops})`;
}

function niGetBuiltinPreset(id) {
    return NI_THEME_BUILTIN_PRESETS.find(item => item.id === id) || NI_THEME_BUILTIN_PRESETS[0];
}

function niGetUserPreset(cfg, id) {
    const presets = Array.isArray(cfg.themeUserPresets) ? cfg.themeUserPresets : [];
    return presets.find(item => item && item.id === id);
}

function niGetBuiltinOverride(cfg, id) {
    const overrides = cfg.themePresetOverrides && typeof cfg.themePresetOverrides === 'object' ? cfg.themePresetOverrides : {};
    return overrides[id] || null;
}

function niGetPresetSource(cfg, preset) {
    if (preset?.startsWith('user:')) {
        return niGetUserPreset(cfg, preset.slice(5));
    }
    return niGetBuiltinOverride(cfg, preset) || niGetBuiltinPreset(preset);
}

function niGetPresetColors(cfg, preset) {
    if (cfg.themePreviewColors && typeof cfg.themePreviewColors === 'object') {
        return niNormalizePresetColors(cfg.themePreviewColors);
    }
    if (preset === 'custom') {
        return niNormalizePresetColors({
            primary: cfg.themePrimary,
            success: cfg.themeSuccess,
            pivot: cfg.themePivot,
            warning: cfg.themeWarning,
            background: cfg.themeBackground,
            text: cfg.themeText,
        });
    }
    return niNormalizePresetColors(niGetPresetSource(cfg, preset)?.colors || niGetBuiltinPreset(preset).colors);
}

function niGetPresetBackgroundGradient(cfg, preset) {
    if (cfg.themeBackgroundGradient) return niNormalizeBackgroundGradient(cfg.themeBackgroundGradient);
    if (preset === 'custom') return null;
    return niNormalizeBackgroundGradient(niGetPresetSource(cfg, preset)?.backgroundGradient);
}

function niGetPresetSurfaceGlass(cfg, preset) {
    if (cfg.themeSurfaceGlass === true) return true;
    if (preset === 'custom') return false;
    return niGetPresetSource(cfg, preset)?.surfaceGlass === true;
}

export function niGetTheme(cfg = {}) {
    const preset = cfg.themePreset || 'default';
    const surfaceFollowPreset = cfg.themeSurfaceFollowPreset !== false;
    const presetColors = niGetPresetColors(cfg, preset);
    const background = surfaceFollowPreset ? presetColors.background : niNormalizeHex(cfg.themeBackground, NI_THEME_DEFAULT.background);
    const text = surfaceFollowPreset ? presetColors.text : niNormalizeHex(cfg.themeText, NI_THEME_DEFAULT.text);
    const backgroundGradient = !surfaceFollowPreset ? niGetPresetBackgroundGradient(cfg, preset) : null;
    const backgroundCss = backgroundGradient ? niBackgroundGradientToCss(backgroundGradient) : background;
    const surfaceGlass = !surfaceFollowPreset && niGetPresetSurfaceGlass(cfg, preset);
    const lightSurface = niIsLightHex(background);
    const gradientCardBg = backgroundGradient ? niRgba(background, surfaceGlass ? 0.44 : (lightSurface ? 0.42 : 0.54)) : '';
    const gradientPanelBg = backgroundGradient ? niRgba(background, surfaceGlass ? 0.30 : (lightSurface ? 0.26 : 0.36)) : '';
    const gradientSoftBg = backgroundGradient ? niRgba(background, surfaceGlass ? 0.22 : (lightSurface ? 0.18 : 0.24)) : '';
    const surface = { surfaceFollowPreset, surfaceEnabled: !surfaceFollowPreset, disablePresetGlass: !surfaceFollowPreset && !surfaceGlass, surfaceGlass, background, backgroundCss, text, backgroundGradient, gradientCardBg, gradientPanelBg, gradientSoftBg };

    const primary = presetColors.primary;
    const success = presetColors.success;
    const pivot = presetColors.pivot;
    const warning = presetColors.warning;
    const softTarget = lightSurface ? '#FFFFFF' : background;
    const textTarget = lightSurface ? '#000000' : '#FFFFFF';
    const softAmount = lightSurface ? 0.76 : 0.48;
    const soft2Amount = lightSurface ? 0.84 : 0.62;
    const borderAmount = lightSurface ? 0.48 : 0.28;
    const borderStrongAmount = lightSurface ? 0.36 : 0.16;
    const hoverAmount = lightSurface ? 0.56 : 0.30;
    const tabActiveBg = lightSurface ? primary : niMixHex(primary, background, 0.42);
    const tabActiveText = lightSurface ? niContrastText(primary) : niMixHex(primary, '#FFFFFF', 0.72);
    const tabActiveBorder = lightSurface ? niMixHex(primary, '#000000', 0.10) : niMixHex(primary, background, 0.08);
    return {
        ...surface,
        primary,
        primaryHover: niMixHex(primary, '#000000', 0.16),
        primaryFocus: niMixHex(primary, '#000000', 0.08),
        primarySoft: niMixHex(primary, softTarget, softAmount),
        primarySoft2: niMixHex(primary, softTarget, soft2Amount),
        primarySoftText: niMixHex(primary, textTarget, lightSurface ? 0.28 : 0.62),
        primaryBorder: niMixHex(primary, softTarget, borderAmount),
        primaryBorderStrong: niMixHex(primary, softTarget, borderStrongAmount),
        primaryOn: niContrastText(primary),
        checkboxOn: lightSurface ? '#FFFFFF' : '#1A1A1A',
        checkboxCheckImage: lightSurface ? NI_CHECK_IMAGE_WHITE : NI_CHECK_IMAGE_BLACK,
        tabActiveBg,
        tabActiveText,
        tabActiveBorder,
        success,
        successSoft: niMixHex(success, softTarget, softAmount),
        successSoft2: niMixHex(success, softTarget, soft2Amount),
        successText: niMixHex(success, textTarget, lightSurface ? 0.30 : 0.58),
        successBorder: niMixHex(success, softTarget, borderAmount),
        successHover: niMixHex(success, softTarget, hoverAmount),
        pivot,
        pivotSoft: niMixHex(pivot, softTarget, lightSurface ? 0.82 : 0.48),
        pivotSoft2: niMixHex(pivot, softTarget, lightSurface ? 0.88 : 0.62),
        pivotText: niMixHex(pivot, textTarget, lightSurface ? 0.42 : 0.60),
        pivotBorder: niMixHex(pivot, softTarget, lightSurface ? 0.36 : 0.22),
        pivotHover: niMixHex(pivot, softTarget, lightSurface ? 0.54 : 0.28),
        pivotOn: niContrastText(pivot),
        warning,
        warningSoft: niMixHex(warning, softTarget, lightSurface ? 0.74 : 0.48),
        warningSoft2: niMixHex(warning, softTarget, lightSurface ? 0.82 : 0.62),
        warningText: niMixHex(warning, textTarget, lightSurface ? 0.10 : 0.52),
        warningBorder: niMixHex(warning, softTarget, lightSurface ? 0.40 : 0.24),
    };
}

const NI_SURFACE_PROPS = [
    '--ni-surface-bg',
    '--ni-surface-text',
    '--color-background-primary',
    '--color-background-secondary',
    '--color-background-tertiary',
    '--color-text-primary',
    '--color-text-secondary',
    '--color-text-tertiary',
    '--color-border-secondary',
    '--color-border-tertiary',
    '--ni-gradient-card-bg',
    '--ni-gradient-panel-bg',
    '--ni-gradient-soft-bg',
];

const NI_GLASS_PROPS = [
    '--ni-popup-overlay-bg',
    '--ni-popup-backdrop-filter',
];

const NI_CHECK_IMAGE_WHITE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 8.2l2.5 2.5L12 5.3'/%3E%3C/svg%3E")`;
const NI_CHECK_IMAGE_BLACK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%231A1A1A' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 8.2l2.5 2.5L12 5.3'/%3E%3C/svg%3E")`;

function niIsAppSurface(el) {
    return !!el && (el.id === 'ni-app' || el.classList?.contains('ni-app'));
}

function niClearSurfaceSettings(el) {
    NI_SURFACE_PROPS.forEach(name => el.style.removeProperty(name));
}

function niClearGlassSettings(el) {
    NI_GLASS_PROPS.forEach(name => el.style.removeProperty(name));
}

function niToggleSolidSurface(el, enabled) {
    if (niIsAppSurface(el)) el.classList?.toggle('ni-surface-solid', !!enabled);
}

function niToggleGradientSurface(el, enabled) {
    if (niIsAppSurface(el)) el.classList?.toggle('ni-surface-gradient', !!enabled);
}

function niToggleGlassSurface(el, enabled) {
    if (niIsAppSurface(el)) el.classList?.toggle('ni-surface-glass', !!enabled);
}

export function niApplyThemeSettings(cfg = {}, targets = []) {
    const theme = niGetTheme(cfg);
    const roots = targets.filter(Boolean);
    roots.forEach(el => {
        el.style.setProperty('--ni-primary', theme.primary);
        el.style.setProperty('--ni-primary-hover', theme.primaryHover);
        el.style.setProperty('--ni-primary-focus', theme.primaryFocus);
        el.style.setProperty('--ni-primary-soft', theme.primarySoft);
        el.style.setProperty('--ni-primary-soft-2', theme.primarySoft2);
        el.style.setProperty('--ni-primary-soft-text', theme.primarySoftText);
        el.style.setProperty('--ni-primary-border', theme.primaryBorder);
        el.style.setProperty('--ni-primary-border-strong', theme.primaryBorderStrong);
        el.style.setProperty('--ni-primary-on', theme.primaryOn);
        el.style.setProperty('--ni-checkbox-on', theme.checkboxOn);
        el.style.setProperty('--ni-checkbox-check-image', theme.checkboxCheckImage);
        el.style.setProperty('--ni-tab-active-bg', theme.tabActiveBg);
        el.style.setProperty('--ni-tab-active-text', theme.tabActiveText);
        el.style.setProperty('--ni-tab-active-border', theme.tabActiveBorder);
        el.style.setProperty('--ni-primary-alpha-07', niRgba(theme.primary, 0.07));
        el.style.setProperty('--ni-primary-alpha-08', niRgba(theme.primary, 0.08));
        el.style.setProperty('--ni-primary-alpha-12', niRgba(theme.primary, 0.12));
        el.style.setProperty('--ni-primary-alpha-15', niRgba(theme.primary, 0.15));
        el.style.setProperty('--ni-primary-alpha-30', niRgba(theme.primary, 0.30));
        el.style.setProperty('--ni-primary-alpha-40', niRgba(theme.primary, 0.40));
        el.style.setProperty('--ni-success', theme.success);
        el.style.setProperty('--ni-success-soft', theme.successSoft);
        el.style.setProperty('--ni-success-soft-2', theme.successSoft2);
        el.style.setProperty('--ni-success-text', theme.successText);
        el.style.setProperty('--ni-success-border', theme.successBorder);
        el.style.setProperty('--ni-success-hover', theme.successHover);
        el.style.setProperty('--ni-success-alpha-10', niRgba(theme.success, 0.10));
        el.style.setProperty('--ni-success-alpha-30', niRgba(theme.success, 0.30));
        el.style.setProperty('--ni-pivot', theme.pivot);
        el.style.setProperty('--ni-pivot-soft', theme.pivotSoft);
        el.style.setProperty('--ni-pivot-soft-2', theme.pivotSoft2);
        el.style.setProperty('--ni-pivot-text', theme.pivotText);
        el.style.setProperty('--ni-pivot-border', theme.pivotBorder);
        el.style.setProperty('--ni-pivot-hover', theme.pivotHover);
        el.style.setProperty('--ni-pivot-on', theme.pivotOn);
        el.style.setProperty('--ni-pivot-alpha-10', niRgba(theme.pivot, 0.10));
        el.style.setProperty('--ni-pivot-alpha-20', niRgba(theme.pivot, 0.20));
        el.style.setProperty('--ni-warning', theme.warning);
        el.style.setProperty('--ni-warning-soft', theme.warningSoft);
        el.style.setProperty('--ni-warning-soft-2', theme.warningSoft2);
        el.style.setProperty('--ni-warning-text', theme.warningText);
        el.style.setProperty('--ni-warning-border', theme.warningBorder);
        el.style.setProperty('--ni-warning-alpha-03', niRgba(theme.warning, 0.03));
        el.style.setProperty('--ni-warning-alpha-06', niRgba(theme.warning, 0.06));
        el.style.setProperty('--ni-warning-alpha-12', niRgba(theme.warning, 0.12));
        el.style.setProperty('--ni-warning-alpha-14', niRgba(theme.warning, 0.14));
        el.style.setProperty('--ni-warning-alpha-15', niRgba(theme.warning, 0.15));
        el.style.setProperty('--ni-warning-alpha-20', niRgba(theme.warning, 0.20));
        el.style.setProperty('--ni-warning-alpha-25', niRgba(theme.warning, 0.25));
        el.style.setProperty('--ni-warning-alpha-30', niRgba(theme.warning, 0.30));
        el.style.setProperty('--ni-warning-alpha-35', niRgba(theme.warning, 0.35));
        el.style.setProperty('--ni-warning-alpha-40', niRgba(theme.warning, 0.40));
        el.style.setProperty('--ni-warning-alpha-50', niRgba(theme.warning, 0.50));
        if (theme.disablePresetGlass) {
            el.style.setProperty('--ni-popup-overlay-bg', 'transparent');
            el.style.setProperty('--ni-popup-backdrop-filter', 'none');
        } else {
            niClearGlassSettings(el);
        }
        niToggleSolidSurface(el, theme.disablePresetGlass);
        niToggleGradientSurface(el, !!theme.backgroundGradient && theme.surfaceEnabled);
        niToggleGlassSurface(el, !!theme.surfaceGlass && theme.surfaceEnabled);
        el.style.setProperty('--ni-theme-background', theme.backgroundCss);
        el.style.setProperty('--ni-theme-text', theme.text);
        if (!niIsAppSurface(el)) return;
        if (!theme.surfaceEnabled) {
            niClearSurfaceSettings(el);
            return;
        }
        el.style.setProperty('--ni-surface-bg', theme.backgroundCss);
        el.style.setProperty('--ni-surface-text', theme.text);
        el.style.setProperty('--color-background-primary', theme.backgroundGradient ? theme.gradientCardBg : theme.background);
        el.style.setProperty('--color-background-secondary', theme.backgroundGradient ? theme.gradientPanelBg : niMixHex(theme.background, theme.text, 0.04));
        el.style.setProperty('--color-background-tertiary', theme.backgroundGradient ? theme.gradientSoftBg : niMixHex(theme.background, theme.text, 0.07));
        el.style.setProperty('--color-text-primary', theme.text);
        el.style.setProperty('--color-text-secondary', niMixHex(theme.text, theme.background, theme.backgroundGradient ? 0.18 : 0.35));
        el.style.setProperty('--color-text-tertiary', niMixHex(theme.text, theme.background, theme.backgroundGradient ? 0.34 : 0.55));
        el.style.setProperty('--color-border-secondary', niMixHex(theme.background, theme.text, theme.backgroundGradient ? 0.24 : 0.16));
        el.style.setProperty('--color-border-tertiary', niMixHex(theme.background, theme.text, theme.backgroundGradient ? 0.16 : 0.10));
        if (theme.backgroundGradient) {
            el.style.setProperty('--ni-gradient-card-bg', theme.gradientCardBg);
            el.style.setProperty('--ni-gradient-panel-bg', theme.gradientPanelBg);
            el.style.setProperty('--ni-gradient-soft-bg', theme.gradientSoftBg);
        }
    });
}

export function createThemeEditor({
    EXT_NAME,
    DEFAULT_SETTINGS,
    extension_settings,
    q,
    sv,
    niEscAttr,
    niEscHtml,
    saveSettingsDebounced,
    refreshStatusbar,
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
        const aliIconsEnabled = cfg.themeIconReplace === true;
        app?.classList.remove('ni-surface-tavern');
        niApplyThemeSettings(cfg, niThemeTargets());
        niApplyTavernSurfaceTheme(cfg);
        app?.classList.toggle('ni-borderless', cfg.themeBorderless === true);
        app?.classList.toggle('ni-cardless', cfg.themeCardless === true);
        app?.classList.toggle('ni-ali-icons', aliIconsEnabled);
        document.documentElement?.classList.toggle('ni-ali-icons', aliIconsEnabled);
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

    function niThemePresetSurfaceGlass(value, cfg = extension_settings[EXT_NAME] || {}) {
        if (value === 'custom') return false;
        const source = niThemePresetSource(value, cfg);
        return source?.surfaceGlass === true;
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
        niSetThemeStatusbarFollowUI(cfg.themeStatusbarFollow === true);
        niSetThemeIconReplaceUI(cfg.themeIconReplace === true);
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
        const backgroundGradient = niThemePresetBackgroundGradient(preset);
        const surfaceGlass = niThemePresetSurfaceGlass(preset);
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
            themeStatusbarFollow: q('#ni-theme-statusbar-follow')?.checked === true,
            themeIconReplace: q('#ni-theme-icon-replace')?.checked === true,
            themeBackground: colors.background,
            themeText: colors.text,
            ...(backgroundGradient ? { themeBackgroundGradient: backgroundGradient } : {}),
            ...(surfaceGlass ? { themeSurfaceGlass: true } : {}),
        };
    }

    function niSetThemeColor(key, value) {
        if (key === 'background' || key === 'text') {
            niSetThemeSurfaceUI(false);
            niSetThemeColorUI(key, value);
            const draft = niReadThemeDraft();
            niApplyThemeWithSurface(draft);
            refreshStatusbar?.(draft);
            return;
        }
        niSetThemeColorUI(key, value);
        const draft = niReadThemeDraft();
        niApplyThemeWithSurface(draft);
        refreshStatusbar?.(draft);
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
        const draft = niReadThemeDraft();
        niApplyThemeWithSurface(draft);
        refreshStatusbar?.(draft);
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
        const draft = niReadThemeDraft();
        niApplyThemeWithSurface(draft);
        refreshStatusbar?.(draft);
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
        const draft = niReadThemeDraft();
        niApplyThemeWithSurface(draft);
        refreshStatusbar?.(draft);
    }

    function niSetThemeStatusbarFollowUI(enabled) {
        const checked = enabled === true;
        const chk = q('#ni-theme-statusbar-follow');
        const row = q('#ni-theme-statusbar-follow-row');
        const state = q('#ni-theme-statusbar-follow-state');
        if (chk) chk.checked = checked;
        row?.classList.toggle('ni-switch-off', !checked);
        if (state) state.textContent = checked ? '开' : '关';
    }

    function niSetThemeStatusbarFollow(enabled) {
        niSetThemeStatusbarFollowUI(enabled);
        const cfg = extension_settings[EXT_NAME];
        cfg.themeStatusbarFollow = enabled === true;
        refreshStatusbar?.(niReadThemeDraft());
        saveSettingsDebounced();
    }

    function niSetThemeIconReplaceUI(enabled) {
        const checked = enabled === true;
        const chk = q('#ni-theme-icon-replace');
        const row = q('#ni-theme-icon-replace-row');
        const state = q('#ni-theme-icon-replace-state');
        if (chk) chk.checked = checked;
        row?.classList.toggle('ni-switch-off', !checked);
        if (state) state.textContent = checked ? '开' : '关';
    }

    function niSetThemeIconReplace(enabled) {
        niSetThemeIconReplaceUI(enabled);
        const cfg = extension_settings[EXT_NAME];
        cfg.themeIconReplace = enabled === true;
        niApplyThemeWithSurface(niReadThemeDraft());
        refreshStatusbar?.(niReadThemeDraft());
        saveSettingsDebounced();
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
        cfg.themeStatusbarFollow = draft.themeStatusbarFollow;
        cfg.themeIconReplace = draft.themeIconReplace;
        cfg.themeBackground = draft.themeBackground;
        cfg.themeText = draft.themeText;
        niApplyCurrentTheme();
        niSyncThemeUI();
        refreshStatusbar?.();
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
        setStatusbarFollow: niSetThemeStatusbarFollow,
        setIconReplace: niSetThemeIconReplace,
        importPresetFile: niImportThemePresetFile,
        exportPreset: niExportThemePreset,
        deletePreset: niDeleteThemePreset,
        newPreset: niNewThemePreset,
        savePreset: niSaveThemePreset,
    };
}

const NI_STATUSBAR_THEME_STYLE_ID = 'ni-statusbar-theme-css';

function niEnsureStatusbarThemeStyle() {
    if (document.getElementById(NI_STATUSBAR_THEME_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = NI_STATUSBAR_THEME_STYLE_ID;
    style.textContent = `
#ni-storybar.ni-tb-theme-follow {
  background: var(--ni-tb-theme-bg) !important;
  backdrop-filter: var(--ni-tb-theme-backdrop, none) !important;
  -webkit-backdrop-filter: var(--ni-tb-theme-backdrop, none) !important;
  border-color: var(--ni-tb-theme-secondary-border) !important;
  color: var(--ni-tb-theme-text) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-bar,
#ni-storybar.ni-tb-theme-follow .ni-tb-selrow,
#ni-storybar.ni-tb-theme-follow .ni-tb-drop-panel,
#ni-storybar.ni-tb-theme-follow .ni-tb-carousel-wrap,
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-block {
  background: var(--ni-tb-theme-bg) !important;
  color: var(--ni-tb-theme-text) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-curtitle,
#ni-storybar.ni-tb-theme-follow .ni-tb-sc-title,
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-title,
#ni-storybar.ni-tb-theme-follow .ni-tb-np-row.active .ni-tb-np-title {
  color: var(--ni-tb-theme-text) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-meta,
#ni-storybar.ni-tb-theme-follow .ni-tb-chevron,
#ni-storybar.ni-tb-theme-follow .ni-tb-sp-label,
#ni-storybar.ni-tb-theme-follow .ni-tb-section-icon,
#ni-storybar.ni-tb-theme-follow .ni-tb-section-label,
#ni-storybar.ni-tb-theme-follow .ni-tb-section-count,
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-toggle-label,
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-toggle-icon,
#ni-storybar.ni-tb-theme-follow .ni-tb-sc-num,
#ni-storybar.ni-tb-theme-follow .ni-tb-sp-name,
#ni-storybar.ni-tb-theme-follow .ni-tb-np-title,
#ni-storybar.ni-tb-theme-follow .ni-tb-sc-desc,
#ni-storybar.ni-tb-theme-follow .ni-tb-sc-event,
#ni-storybar.ni-tb-theme-follow .ni-tb-sc-fore,
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-desc {
  color: var(--ni-tb-theme-text-muted) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-pin,
#ni-storybar.ni-tb-theme-follow .ni-tb-sp-row.active-stage .ni-tb-sp-dot,
#ni-storybar.ni-tb-theme-follow .ni-tb-np-dot.done,
#ni-storybar.ni-tb-theme-follow .ni-tb-np-dot.active-dot {
  background: var(--ni-tb-theme-accent) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-np-dot.active-dot {
  box-shadow: 0 0 0 3px var(--ni-tb-theme-accent-soft) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-status,
#ni-storybar.ni-tb-theme-follow .ni-tb-btn-pause {
  background: var(--ni-tb-theme-accent-soft) !important;
  border-color: var(--ni-tb-theme-accent-border) !important;
  color: var(--ni-tb-theme-accent) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-btn-pause:hover,
#ni-storybar.ni-tb-theme-follow .ni-tb-btn-pause.paused {
  background: var(--ni-tb-theme-accent-soft-strong) !important;
  border-color: var(--ni-tb-theme-accent) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-sp-row.active-stage .ni-tb-sp-name,
#ni-storybar.ni-tb-theme-follow .ni-tb-section-count.done-count {
  color: var(--ni-tb-theme-accent) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-sel-btn,
#ni-storybar.ni-tb-theme-follow .ni-tb-btn-free,
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-num,
#ni-storybar.ni-tb-theme-follow .ni-tb-section-count {
  background: var(--ni-tb-theme-secondary-soft) !important;
  border-color: var(--ni-tb-theme-secondary-border) !important;
  color: var(--ni-tb-theme-secondary-text) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-sel-btn:hover,
#ni-storybar.ni-tb-theme-follow .ni-tb-btn-free:hover:not(.loading),
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-item:hover,
#ni-storybar.ni-tb-theme-follow .ni-tb-section-hd:hover,
#ni-storybar.ni-tb-theme-follow .ni-tb-np-row:hover,
#ni-storybar.ni-tb-theme-follow .ni-tb-sp-row:hover,
#ni-storybar.ni-tb-theme-follow .ni-tb-infer-toggle:hover {
  background: var(--ni-tb-theme-secondary-soft-2) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-btn-free.has-result {
  background: var(--ni-tb-theme-secondary-soft) !important;
  border-color: var(--ni-tb-theme-secondary-border) !important;
  color: var(--ni-tb-theme-secondary-text) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-scard {
  background: var(--ni-tb-theme-secondary-soft-2) !important;
  border-color: var(--ni-tb-theme-secondary-border) !important;
  color: var(--ni-tb-theme-text) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-scard.active {
  background: var(--ni-tb-theme-secondary-soft) !important;
  border-color: var(--ni-tb-theme-secondary) !important;
  box-shadow: 0 6px 24px var(--ni-tb-theme-secondary-shadow) !important;
}
#ni-storybar.ni-tb-theme-follow .ni-tb-scard.side-prev,
#ni-storybar.ni-tb-theme-follow .ni-tb-scard.side-next,
#ni-storybar.ni-tb-theme-follow .ni-tb-scard.far {
  background: var(--ni-tb-theme-secondary-soft-2) !important;
}
`;
    document.head.appendChild(style);
}

function niSetStatusbarVar(bar, name, value) {
    if (value) bar.style.setProperty(name, value);
    else bar.style.removeProperty(name);
}

function niCssVar(style, name, fallback = '') {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
}

function niStatusbarHexToRgb(hex) {
    const raw = String(hex || '').replace('#', '');
    return {
        r: parseInt(raw.slice(0, 2), 16) || 0,
        g: parseInt(raw.slice(2, 4), 16) || 0,
        b: parseInt(raw.slice(4, 6), 16) || 0,
    };
}

function niStatusbarRgba(hex, alpha) {
    const c = niStatusbarHexToRgb(hex);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function niReadCurrentSurfaceTheme() {
    const app = document.getElementById('ni-app');
    if (!app) return null;
    const style = getComputedStyle(app);
    if (!app.classList.contains('ni-surface-tavern')) return null;
    const blurStrength = niCssVar(style, '--SmartThemeBlurStrength');
    const backdrop = niCssVar(style, '--ni-tavern-backdrop-filter', blurStrength ? `blur(${blurStrength})` : '');
    return {
        background: niCssVar(style, '--SmartThemeBlurTintColor',
            niCssVar(style, '--SmartThemeChatTintColor',
                niCssVar(style, '--color-background-primary', 'transparent'))),
        backdrop,
        text: niCssVar(style, '--SmartThemeBodyColor', niCssVar(style, '--color-text-primary', '#ddd')),
        textMuted: niCssVar(style, '--SmartThemeEmColor',
            niCssVar(style, '--SmartThemeBodyColor',
                niCssVar(style, '--color-text-secondary', '#ddd'))),
    };
}

function niClearStatusbarVars(bar) {
    [
        '--color-background-primary',
        '--color-background-secondary',
        '--color-background-tertiary',
        '--color-text-primary',
        '--color-text-secondary',
        '--color-text-tertiary',
        '--color-border-secondary',
        '--color-border-tertiary',
        '--ni-primary-soft',
        '--ni-primary-soft-text',
        '--ni-success-soft',
        '--ni-success-text',
        '--ni-pivot-soft',
        '--ni-pivot-text',
        '--ni-warning',
        '--ni-warning-soft',
        '--ni-warning-soft-2',
        '--ni-warning-alpha-06',
        '--ni-warning-alpha-12',
        '--ni-warning-alpha-14',
        '--ni-warning-alpha-15',
        '--ni-warning-alpha-20',
        '--ni-warning-alpha-25',
        '--ni-warning-alpha-30',
        '--ni-warning-alpha-35',
        '--ni-warning-alpha-40',
        '--ni-warning-alpha-50',
        '--ni-tb-theme-bg',
        '--ni-tb-theme-backdrop',
        '--ni-tb-theme-text',
        '--ni-tb-theme-text-muted',
        '--ni-tb-theme-accent',
        '--ni-tb-theme-accent-soft',
        '--ni-tb-theme-accent-soft-strong',
        '--ni-tb-theme-accent-border',
        '--ni-tb-theme-secondary',
        '--ni-tb-theme-secondary-soft',
        '--ni-tb-theme-secondary-soft-2',
        '--ni-tb-theme-secondary-text',
        '--ni-tb-theme-secondary-border',
        '--ni-tb-theme-secondary-shadow',
    ].forEach(name => bar.style.removeProperty(name));
}

function niApplyDefaultStatusbarTheme(bar) {
    const theme = niGetTheme({
        themePreset: 'default',
        themeSurfaceFollowPreset: false,
        themePrimary: NI_THEME_DEFAULT.primary,
        themeSuccess: NI_THEME_DEFAULT.success,
        themePivot: NI_THEME_DEFAULT.pivot,
        themeWarning: NI_THEME_DEFAULT.warning,
        themeBackground: NI_THEME_DEFAULT.background,
        themeText: NI_THEME_DEFAULT.text,
    });
    niSetStatusbarVar(bar, '--color-background-primary', '#FFFFFF');
    niSetStatusbarVar(bar, '--color-background-secondary', '#F7F7F8');
    niSetStatusbarVar(bar, '--color-background-tertiary', '#EEEEEF');
    niSetStatusbarVar(bar, '--color-text-primary', '#1A1A1A');
    niSetStatusbarVar(bar, '--color-text-secondary', '#5A5A6A');
    niSetStatusbarVar(bar, '--color-text-tertiary', '#9A9AAA');
    niSetStatusbarVar(bar, '--color-border-secondary', '#D8D8DE');
    niSetStatusbarVar(bar, '--color-border-tertiary', '#E8E8EC');
    niSetStatusbarVar(bar, '--ni-primary-soft', theme.primarySoft);
    niSetStatusbarVar(bar, '--ni-primary-soft-text', theme.primarySoftText);
    niSetStatusbarVar(bar, '--ni-success-soft', theme.successSoft);
    niSetStatusbarVar(bar, '--ni-success-text', theme.successText);
    niSetStatusbarVar(bar, '--ni-pivot-soft', theme.pivotSoft);
    niSetStatusbarVar(bar, '--ni-pivot-text', theme.pivotText);
    niSetStatusbarVar(bar, '--ni-warning', theme.warning);
    niSetStatusbarVar(bar, '--ni-warning-soft', theme.warningSoft);
    niSetStatusbarVar(bar, '--ni-warning-soft-2', theme.warningSoft2);
    niSetStatusbarVar(bar, '--ni-warning-alpha-06', niStatusbarRgba(theme.warning, 0.06));
    niSetStatusbarVar(bar, '--ni-warning-alpha-12', niStatusbarRgba(theme.warning, 0.12));
    niSetStatusbarVar(bar, '--ni-warning-alpha-14', niStatusbarRgba(theme.warning, 0.14));
    niSetStatusbarVar(bar, '--ni-warning-alpha-15', niStatusbarRgba(theme.warning, 0.15));
    niSetStatusbarVar(bar, '--ni-warning-alpha-20', niStatusbarRgba(theme.warning, 0.20));
    niSetStatusbarVar(bar, '--ni-warning-alpha-25', niStatusbarRgba(theme.warning, 0.25));
    niSetStatusbarVar(bar, '--ni-warning-alpha-30', niStatusbarRgba(theme.warning, 0.30));
    niSetStatusbarVar(bar, '--ni-warning-alpha-35', niStatusbarRgba(theme.warning, 0.35));
    niSetStatusbarVar(bar, '--ni-warning-alpha-40', niStatusbarRgba(theme.warning, 0.40));
    niSetStatusbarVar(bar, '--ni-warning-alpha-50', niStatusbarRgba(theme.warning, 0.50));
}

export function niApplyStatusbarTheme(cfg = {}) {
    const bar = document.getElementById('ni-storybar');
    if (!bar) return;

    const enabled = cfg === true || cfg?.themeStatusbarFollow === true;
    bar.classList.toggle('ni-tb-theme-follow', enabled);
    niClearStatusbarVars(bar);
    if (!enabled) {
        niApplyDefaultStatusbarTheme(bar);
        return;
    }

    niEnsureStatusbarThemeStyle();
    const theme = niGetTheme(typeof cfg === 'object' ? cfg : {});
    const surface = cfg?.themeSurfaceFollowPreset !== false ? niReadCurrentSurfaceTheme() : null;
    niSetStatusbarVar(bar, '--ni-tb-theme-bg', surface?.background || theme.backgroundCss || theme.background);
    niSetStatusbarVar(bar, '--ni-tb-theme-backdrop', surface?.backdrop || 'none');
    niSetStatusbarVar(bar, '--ni-tb-theme-text', surface?.text || theme.text);
    niSetStatusbarVar(bar, '--ni-tb-theme-text-muted', surface?.textMuted || surface?.text || theme.text);
    niSetStatusbarVar(bar, '--ni-tb-theme-accent', theme.pivot);
    niSetStatusbarVar(bar, '--ni-tb-theme-accent-soft', theme.pivotSoft);
    niSetStatusbarVar(bar, '--ni-tb-theme-accent-soft-strong', theme.pivotHover);
    niSetStatusbarVar(bar, '--ni-tb-theme-accent-border', theme.pivotBorder);
    niSetStatusbarVar(bar, '--ni-tb-theme-secondary', theme.success);
    niSetStatusbarVar(bar, '--ni-tb-theme-secondary-soft', theme.successSoft);
    niSetStatusbarVar(bar, '--ni-tb-theme-secondary-soft-2', theme.successSoft2);
    niSetStatusbarVar(bar, '--ni-tb-theme-secondary-text', theme.successText);
    niSetStatusbarVar(bar, '--ni-tb-theme-secondary-border', theme.successBorder);
    niSetStatusbarVar(bar, '--ni-tb-theme-secondary-shadow', 'var(--ni-success-alpha-10, rgba(29, 158, 117, .1))');
}
