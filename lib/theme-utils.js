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
