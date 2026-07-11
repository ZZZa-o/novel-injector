// 小说库、快照、存储键与导入导出。

// === 中文名称规范化 ===
// Compact Hanzi-to-pinyin helper for snapshot filenames.
// Boundary table adapted from tiny-pinyin / Android HanziToPinyin.

const FIRST_PINYIN_UNIHAN = '\u963f';
const LAST_PINYIN_UNIHAN = '\u9fff';

const NI_PINYIN_UNIHANS = [
    '\u963f', '\u54ce', '\u5b89', '\u80ae', '\u51f9', '\u516b',
    '\u6300', '\u6273', '\u90a6', '\u52f9', '\u9642', '\u5954',
    '\u4f3b', '\u5c44', '\u8fb9', '\u706c', '\u618b', '\u6c43',
    '\u51ab', '\u7676', '\u5cec', '\u5693', '\u5072', '\u53c2',
    '\u4ed3', '\u64a1', '\u518a', '\u5d7e', '\u66fd',
    '\u53c9', '\u8286', '\u8fbf', '\u4f25', '\u6284',
    '\u8f66', '\u62bb', '\u9637', '\u5403',
    '\u5145', '\u62bd', '\u51fa', '\u6b3b', '\u63e3', '\u5ddb',
    '\u5205', '\u5439', '\u65fe', '\u9034', '\u5472', '\u5306',
    '\u51d1', '\u7c97', '\u6c46', '\u5d14', '\u90a8', '\u6413',
    '\u5491', '\u5446', '\u4e39', '\u5f53', '\u5200', '\u561a',
    '\u6265', '\u706f', '\u6c10', '\u7538', '\u5201',
    '\u7239', '\u4e01', '\u4e1f', '\u4e1c', '\u543a', '\u53be',
    '\u8011', '\u5796', '\u5428', '\u591a', '\u59b8', '\u8bf6',
    '\u5940', '\u97a5', '\u513f', '\u53d1', '\u5e06', '\u531a',
    '\u98de', '\u5206', '\u4e30', '\u8985', '\u4ecf', '\u7d11',
    '\u592b', '\u65ee', '\u4f85', '\u7518', '\u5188', '\u768b',
    '\u6208', '\u7ed9', '\u6839', '\u522f', '\u5de5', '\u52fe',
    '\u4f30', '\u74dc', '\u4e56', '\u5173', '\u5149', '\u5f52',
    '\u4e28', '\u5459', '\u54c8', '\u548d', '\u4f44', '\u592f',
    '\u8320', '\u8bc3', '\u9ed2', '\u62eb', '\u4ea8', '\u5677',
    '\u53ff', '\u9f41', '\u4e4e', '\u82b1', '\u6000', '\u6b22',
    '\u5ddf', '\u7070', '\u660f', '\u5419', '\u4e0c', '\u52a0',
    '\u620b', '\u6c5f', '\u827d', '\u9636', '\u5dfe', '\u5755',
    '\u5182', '\u4e29', '\u51e5', '\u59e2', '\u5658', '\u519b',
    '\u5494', '\u5f00', '\u520a', '\u5ffc', '\u5c3b', '\u533c',
    '\u808e', '\u52a5', '\u7a7a', '\u62a0', '\u625d', '\u5938',
    '\u84af', '\u5bbd', '\u5321', '\u4e8f', '\u5764', '\u6269',
    '\u5783', '\u6765', '\u5170', '\u5577', '\u635e', '\u808b',
    '\u52d2', '\u5d1a', '\u54e9', '\u4fe9', '\u5941', '\u826f',
    '\u64a9', '\u6bdf', '\u62ce', '\u4f36', '\u6e9c', '\u56d6',
    '\u9f99', '\u779c', '\u565c', '\u9a74', '\u5a08', '\u63a0', '\u62a1',
    '\u7f57', '\u5463', '\u5988', '\u57cb', '\u5ada', '\u7264',
    '\u732b', '\u4e48', '\u5445', '\u95e8', '\u753f', '\u54aa',
    '\u5b80', '\u55b5', '\u4e5c', '\u6c11', '\u540d', '\u8c2c',
    '\u6478', '\u54de', '\u6bea', '\u55ef', '\u62cf', '\u8149',
    '\u56e1', '\u56d4', '\u5b6c', '\u7592', '\u5a1e', '\u6041',
    '\u80fd', '\u59ae', '\u62c8', '\u5a18', '\u9e1f', '\u634f',
    '\u56dc', '\u5b81', '\u599e', '\u519c', '\u7fba', '\u5974', '\u5973',
    '\u597b', '\u759f', '\u9ec1', '\u632a', '\u5594', '\u8bb4',
    '\u5991', '\u62cd', '\u7705', '\u4e53', '\u629b', '\u5478',
    '\u55b7', '\u5309', '\u4e15', '\u56e8', '\u527d', '\u6c15',
    '\u59d8', '\u4e52', '\u948b', '\u5256', '\u4ec6', '\u4e03',
    '\u6390', '\u5343', '\u545b', '\u6084', '\u767f', '\u4eb2',
    '\u9751', '\u536d', '\u4e18', '\u533a', '\u5cd1', '\u7f3a',
    '\u590b', '\u5465', '\u7a63', '\u5a06', '\u60f9', '\u4eba',
    '\u6254', '\u65e5', '\u8338', '\u53b9', '\u909a', '\u633c',
    '\u5827', '\u5a51', '\u77a4', '\u637c', '\u4ee8', '\u6be2',
    '\u4e09', '\u6852', '\u63bb', '\u95aa', '\u68ee', '\u50e7',
    '\u6740', '\u7b5b', '\u5c71', '\u4f24', '\u5f30', '\u5962',
    '\u7533', '\u5347', '\u5c38', '\u53ce',
    '\u4e66', '\u5237', '\u8870', '\u95e9', '\u53cc', '\u813d',
    '\u542e', '\u8bf4', '\u53b6', '\u5fea', '\u635c', '\u82cf',
    '\u72fb', '\u590a', '\u5b59', '\u5506', '\u4ed6', '\u56fc',
    '\u574d', '\u6c64', '\u5932', '\u5fd1', '\u71a5', '\u5254',
    '\u5929', '\u65eb', '\u5e16', '\u5385', '\u56f2', '\u5077',
    '\u51f8', '\u6e4d', '\u63a8', '\u541e', '\u4e47', '\u7a75',
    '\u6b6a', '\u5f2f', '\u5c23', '\u5371', '\u6637', '\u7fc1',
    '\u631d', '\u4e4c', '\u5915', '\u8672', '\u4ed9', '\u4e61',
    '\u7071', '\u4e9b', '\u5fc3', '\u661f', '\u51f6', '\u4f11',
    '\u5401', '\u5405', '\u524a', '\u5743', '\u4e2b', '\u6079',
    '\u592e', '\u5e7a', '\u503b', '\u4e00', '\u56d9', '\u5e94',
    '\u54df', '\u4f63', '\u4f18', '\u625c', '\u56e6', '\u66f0',
    '\u6655', '\u5e00', '\u707d', '\u5142',
    '\u5328', '\u50ae', '\u5219', '\u8d3c', '\u600e', '\u5897',
    '\u624e', '\u635a', '\u6cbe', '\u5f20', '\u4f4b', '\u8707', '\u8d1e', '\u4e89', '\u4e4b',
    '\u4e2d', '\u5dde', '\u6731', '\u6293', '\u62fd',
    '\u4e13', '\u5986', '\u96b9', '\u5b92', '\u5353', '\u4e72',
    '\u5b97', '\u90b9', '\u79df', '\u94bb', '\u539c', '\u5c0a',
    '\u6628', '\u5159',
];

const NI_PINYINS = (
    'A AI AN ANG AO BA BAI BAN BANG BAO BEI BEN BENG BI BIAN BIAO BIE BIN ' +
    'BING BO BU CA CAI CAN CANG CAO CE CEN CENG CHA CHAI CHAN CHANG CHAO ' +
    'CHE CHEN CHENG CHI CHONG CHOU CHU CHUA CHUAI CHUAN CHUANG CHUI CHUN ' +
    'CHUO CI CONG COU CU CUAN CUI CUN CUO DA DAI DAN DANG DAO DE DEN DENG ' +
    'DI DIAN DIAO DIE DING DIU DONG DOU DU DUAN DUI DUN DUO E EI EN ENG ER ' +
    'FA FAN FANG FEI FEN FENG FIAO FO FOU FU GA GAI GAN GANG GAO GE GEI GEN ' +
    'GENG GONG GOU GU GUA GUAI GUAN GUANG GUI GUN GUO HA HAI HAN HANG HAO ' +
    'HE HEI HEN HENG HM HONG HOU HU HUA HUAI HUAN HUANG HUI HUN HUO JI JIA ' +
    'JIAN JIANG JIAO JIE JIN JING JIONG JIU JU JUAN JUE JUN KA KAI KAN KANG ' +
    'KAO KE KEN KENG KONG KOU KU KUA KUAI KUAN KUANG KUI KUN KUO LA LAI LAN ' +
    'LANG LAO LE LEI LENG LI LIA LIAN LIANG LIAO LIE LIN LING LIU LO LONG ' +
    'LOU LU LV LUAN LVE LUN LUO M MA MAI MAN MANG MAO ME MEI MEN MENG MI ' +
    'MIAN MIAO MIE MIN MING MIU MO MOU MU N NA NAI NAN NANG NAO NE NEI NEN ' +
    'NENG NI NIAN NIANG NIAO NIE NIN NING NIU NONG NOU NU NV NUAN NVE NUN ' +
    'NUO O OU PA PAI PAN PANG PAO PEI PEN PENG PI PIAN PIAO PIE PIN PING PO ' +
    'POU PU QI QIA QIAN QIANG QIAO QIE QIN QING QIONG QIU QU QUAN QUE QUN ' +
    'RAN RANG RAO RE REN RENG RI RONG ROU RU RUA RUAN RUI RUN RUO SA SAI SAN ' +
    'SANG SAO SE SEN SENG SHA SHAI SHAN SHANG SHAO SHE SHEN SHENG SHI SHOU ' +
    'SHU SHUA SHUAI SHUAN SHUANG SHUI SHUN SHUO SI SONG SOU SU SUAN SUI SUN ' +
    'SUO TA TAI TAN TANG TAO TE TENG TI TIAN TIAO TIE TING TONG TOU TU TUAN ' +
    'TUI TUN TUO WA WAI WAN WANG WEI WEN WENG WO WU XI XIA XIAN XIANG XIAO ' +
    'XIE XIN XING XIONG XIU XU XUAN XUE XUN YA YAN YANG YAO YE YI YIN YING ' +
    'YO YONG YOU YU YUAN YUE YUN ZA ZAI ZAN ZANG ZAO ZE ZEI ZEN ZENG ZHA ' +
    'ZHAI ZHAN ZHANG ZHAO ZHE ZHEN ZHENG ZHI ZHONG ZHOU ZHU ZHUA ZHUAI ' +
    'ZHUAN ZHUANG ZHUI ZHUN ZHUO ZI ZONG ZOU ZU ZUAN ZUI ZUN ZUO'
).toLowerCase().split(' ');

const NI_PINYIN_EXCEPTIONS = {
    '\u66fe': 'zeng',
    '\u6c88': 'shen',
    '\u55f2': 'dia',
    '\u78a1': 'zhou',
    '\u8052': 'guo',
    '\u7094': 'que',
    '\u86b5': 'ke',
    '\u7809': 'hua',
    '\u5b24': 'mo',
    '\u5b37': 'mo',
    '\u8e52': 'pan',
    '\u8e4a': 'xi',
    '\u4e2c': 'pan',
    '\u9730': 'xian',
    '\u8398': 'xin',
    '\u8c49': 'chi',
    '\u9967': 'xing',
    '\u7b60': 'jun',
    '\u957f': 'chang',
    '\u5e27': 'zhen',
    '\u5cd9': 'shi',
    '\u90cd': 'na',
    '\u828e': 'xiong',
    '\u8c01': 'shui',
};

let niPinyinCollator = null;
let niPinyinSupported = null;

function niGetPinyinCollator() {
    if (niPinyinSupported !== null) return niPinyinSupported ? niPinyinCollator : null;
    try {
        if (typeof Intl !== 'object' || !Intl.Collator) {
            niPinyinSupported = false;
            return null;
        }
        niPinyinCollator = new Intl.Collator(
            ['zh-Hans-CN-u-co-pinyin', 'zh-CN-u-co-pinyin', 'zh-Hans-CN', 'zh-CN'],
            { sensitivity: 'base' }
        );
        niPinyinSupported = Intl.Collator.supportedLocalesOf(['zh-CN']).length > 0;
        return niPinyinSupported ? niPinyinCollator : null;
    } catch (e) {
        niPinyinSupported = false;
        niPinyinCollator = null;
        return null;
    }
}

export function niHanziToPinyin(ch) {
    if (!ch) return '';
    if (NI_PINYIN_EXCEPTIONS[ch]) return NI_PINYIN_EXCEPTIONS[ch];

    const collator = niGetPinyinCollator();
    if (!collator) return '';

    let cmp = collator.compare(ch, FIRST_PINYIN_UNIHAN);
    if (cmp < 0) return '';
    if (cmp === 0) return NI_PINYINS[0] || '';

    cmp = collator.compare(ch, LAST_PINYIN_UNIHAN);
    if (cmp > 0) return '';
    if (cmp === 0) return NI_PINYINS[NI_PINYINS.length - 1] || '';

    let begin = 0;
    let end = NI_PINYIN_UNIHANS.length - 1;
    let offset = 0;
    while (begin <= end) {
        offset = Math.floor((begin + end) / 2);
        cmp = collator.compare(ch, NI_PINYIN_UNIHANS[offset]);
        if (cmp === 0) break;
        if (cmp > 0) begin = offset + 1;
        else end = offset - 1;
    }
    if (cmp < 0) offset -= 1;
    return NI_PINYINS[offset] || '';
}

// === 存储键与转义 ===
export function niServerFileId(value) {
    return String(value || '').replace(/^ni_data_/, '');
}

function niAsciiTitleToken(ch) {
    if (/^[A-Za-z0-9-]$/.test(ch)) return ch.toLowerCase();
    if (ch === '_') return '_';
    const pinyin = niHanziToPinyin(ch);
    if (pinyin) return pinyin;
    return `_x${ch.codePointAt(0).toString(36)}_`;
}

export function niSnapshotNamePart(value) {
    const raw = String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    let out = '';
    for (const ch of raw) {
        out += niAsciiTitleToken(ch);
    }
    return out.replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'untitled';
}

export function niSnapshotFileKey(name, novelKey = '') {
    const keyPart = niServerFileId(novelKey).replace(/^ni_/, '') || Date.now().toString(36);
    return `ni_${niSnapshotNamePart(name)}_${keyPart}`;
}

export function niServerFileName(fileKey) {
    return `${niServerFileId(fileKey)}.json`;
}

export function niLegacyServerFileNames(key) {
    const id = niServerFileId(key);
    return [
        `novel_injector_${id}.json`,
        `novel_injector_${key}.json`,
        `ni_data_${key}.json`,
    ];
}

export function niServerFileNames(novelKey, fileKey = '') {
    const primary = fileKey || novelKey;
    const names = [niServerFileName(primary), ...niLegacyServerFileNames(primary)];
    if (fileKey && fileKey !== novelKey) {
        names.push(niServerFileName(novelKey), ...niLegacyServerFileNames(novelKey));
    }
    return names.filter((name, idx, arr) => name && arr.indexOf(name) === idx);
}

export function niB64(str) {
    const bytes = new TextEncoder().encode(str);
    const CHUNK = 0x8000;
    let s = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
}

export function niEscHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

export function niEscAttr(value) {
    return niEscHtml(value);
}

// === ZIP 导入导出 ===
export function _u8(str) { return new TextEncoder().encode(str); }
export function _str(u8) { return new TextDecoder().decode(u8); }

export function _buildZip(files) {
    const centralDir = [];
    const parts = [];
    let offset = 0;

    for (const f of files) {
        const nameBytes = _u8(f.name);
        const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
        const crc = _crc32(data);
        const header = _localHeader(nameBytes, data.length, crc);
        centralDir.push({ nameBytes, offset, size: data.length, crc });
        parts.push(header, data);
        offset += header.length + data.length;
    }

    const cdParts = centralDir.map(e => _centralHeader(e.nameBytes, e.offset, e.size, e.crc));
    const cdSize = cdParts.reduce((a, b) => a + b.length, 0);
    const eocd = _eocd(centralDir.length, cdSize, offset);

    const total = [...parts, ...cdParts, eocd].reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of [...parts, ...cdParts, eocd]) { out.set(p, pos); pos += p.length; }
    return out;
}

function _w16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
function _w32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

function _localHeader(name, size, crc) {
    return new Uint8Array([
        0x50,0x4b,0x03,0x04, 0x14,0x00, 0x00,0x00, 0x00,0x00,
        0x00,0x00, 0x00,0x00,
        ..._w32(crc), ..._w32(size), ..._w32(size),
        ..._w16(name.length), 0x00,0x00,
        ...name,
    ]);
}

function _centralHeader(name, offset, size, crc) {
    return new Uint8Array([
        0x50,0x4b,0x01,0x02, 0x3f,0x00, 0x14,0x00,
        0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00,
        ..._w32(crc), ..._w32(size), ..._w32(size),
        ..._w16(name.length), 0x00,0x00, 0x00,0x00, 0x00,0x00,
        0x00,0x00, 0x00,0x00, 0x00,0x00,0x00,0x00,
        ..._w32(offset),
        ...name,
    ]);
}

function _eocd(count, cdSize, cdOffset) {
    return new Uint8Array([
        0x50,0x4b,0x05,0x06, 0x00,0x00, 0x00,0x00,
        ..._w16(count), ..._w16(count),
        ..._w32(cdSize), ..._w32(cdOffset),
        0x00,0x00,
    ]);
}

function _crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function _parseZip(buffer) {
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    const files = {};
    let i = 0;
    while (i < u8.length - 4) {
        if (view.getUint32(i, true) !== 0x04034b50) { i++; continue; }
        const nameLen   = view.getUint16(i + 26, true);
        const extraLen  = view.getUint16(i + 28, true);
        const compSize  = view.getUint32(i + 18, true);
        const name      = _str(u8.slice(i + 30, i + 30 + nameLen));
        const dataStart = i + 30 + nameLen + extraLen;
        files[name]     = u8.slice(dataStart, dataStart + compSize);
        i = dataStart + compSize;
    }
    return files;
}

// === 小说库快照 ===
export const NI_NOVEL_SPINE_COLORS = [
    'var(--ni-primary, #A0445E)',
    'var(--ni-success, #1D9E75)',
    'var(--ni-pivot, #D68AC2)',
    'var(--ni-warning, #C05A62)',
];

export function niNovelLibraryEntries(library) {
    return Array.isArray(library) ? library : [];
}

export function niNovelSnapshotData(snapshot) {
    if (snapshot?.data && typeof snapshot.data === 'object') return snapshot.data;
    if (snapshot?.snapshot?.data && typeof snapshot.snapshot.data === 'object') return snapshot.snapshot.data;
    if (snapshot?.snapshot && typeof snapshot.snapshot === 'object') return snapshot.snapshot;
    return {};
}

export function niNovelSnapshotKey(snapshot) {
    return niNovelSnapshotData(snapshot)._novelKey || snapshot?.key || snapshot?.novelKey || '';
}

export function niNovelSnapshotDisplayName(snapshot, fallback = '未命名') {
    return snapshot?.name || fallback;
}

export function niSelectCurrentNovelKey(settingsKey, runtimeKey) {
    return settingsKey || runtimeKey || '';
}

export function niIsCurrentNovelSnapshot(snapshot, currentKey) {
    return !!currentKey && niNovelSnapshotKey(snapshot) === currentKey;
}

export function niFindNovelSnapshotByKey(library, novelKey) {
    if (!novelKey) return null;
    return niNovelLibraryEntries(library)
        .find(snapshot => niNovelSnapshotKey(snapshot) === novelKey) || null;
}

export function niCurrentNovelDisplayName(library, novelKey) {
    return niFindNovelSnapshotByKey(library, novelKey)?.name || '';
}

export function niNovelSnapshotStatusText(snapshot, currentKey) {
    return niIsCurrentNovelSnapshot(snapshot, currentKey) ? '当前' : '';
}

export function niNovelLibraryCountText(library) {
    const count = niNovelLibraryEntries(library).length;
    return count ? `${count} 本` : '';
}

export function niNovelSpineColor(name, colors = NI_NOVEL_SPINE_COLORS) {
    const palette = Array.isArray(colors) && colors.length ? colors : NI_NOVEL_SPINE_COLORS;
    let hash = 0;
    const text = String(name || '');
    for (let index = 0; index < text.length; index++) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return palette[Math.abs(hash) % palette.length];
}

function niNovelFiniteCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function niNormalizeNovelLibraryEntry(snapshot, index = 0, currentKey = '') {
    const savedAt = snapshot?.savedAt || '';
    return {
        index,
        source: snapshot,
        data: niNovelSnapshotData(snapshot),
        novelKey: niNovelSnapshotKey(snapshot),
        name: niNovelSnapshotDisplayName(snapshot),
        isActive: niIsCurrentNovelSnapshot(snapshot, currentKey),
        statusText: niNovelSnapshotStatusText(snapshot, currentKey),
        savedAt,
        savedAtMs: savedAt ? Date.parse(savedAt) || 0 : 0,
        charCount: niNovelFiniteCount(snapshot?.charCount),
        stageCount: niNovelFiniteCount(snapshot?.stageCount),
        plotCount: niNovelFiniteCount(snapshot?.plotCount),
        sizeBytes: niNovelFiniteCount(snapshot?.sizeBytes ?? snapshot?.fileSize ?? snapshot?.size),
    };
}

export function niNormalizeNovelLibrary(library, currentKey = '') {
    return niNovelLibraryEntries(library)
        .map((snapshot, index) => niNormalizeNovelLibraryEntry(snapshot, index, currentKey));
}

export function niFilterNovelLibrary(entries, query = '') {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    if (!normalizedQuery) return [...niNovelLibraryEntries(entries)];
    return niNovelLibraryEntries(entries).filter(entry =>
        String(entry?.name || '').toLocaleLowerCase().includes(normalizedQuery) ||
        String(entry?.novelKey || '').toLocaleLowerCase().includes(normalizedQuery)
    );
}

export function niSortNovelLibrary(entries, mode = 'original') {
    const list = [...niNovelLibraryEntries(entries)];
    if (mode === 'newest') {
        return list.sort((a, b) => (b?.savedAtMs || 0) - (a?.savedAtMs || 0) || (a?.index || 0) - (b?.index || 0));
    }
    if (mode === 'oldest') {
        return list.sort((a, b) => (a?.savedAtMs || 0) - (b?.savedAtMs || 0) || (a?.index || 0) - (b?.index || 0));
    }
    if (mode === 'name') {
        return list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-CN') || (a?.index || 0) - (b?.index || 0));
    }
    return list;
}

export function niNovelSnapshotTimeText(snapshot, formatDate = date => date.toLocaleString()) {
    const timestamp = snapshot?.savedAt || '';
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '';
    return formatDate(date);
}

export function niNovelSnapshotSizeText(snapshot) {
    const bytes = Number(snapshot?.sizeBytes ?? snapshot?.fileSize ?? snapshot?.size);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function niStripNovelImportExtension(fileName, extension) {
    const suffix = String(extension || '').replace(/^\./, '');
    if (!suffix) return String(fileName || '');
    return String(fileName || '').replace(new RegExp(`\\.${suffix}$`, 'i'), '');
}

export function niResolveLegacyImportedNovelName(exportObject, fileName, fallbackName) {
    return exportObject?.settings?.novelLibrary?.[0]?.name
        || niStripNovelImportExtension(fileName, 'json')
        || fallbackName;
}

export function niResolveZipImportedNovelName({ runtime, manifest, settings, fileName, fallbackName } = {}) {
    const exportedNovelKey = runtime?._novelKey || manifest?.novelKey || '';
    const matchedSnapshot = niFindNovelSnapshotByKey(settings?.novelLibrary, exportedNovelKey);
    return runtime?._currentNovelName
        || matchedSnapshot?.name
        || niStripNovelImportExtension(fileName, 'zip')
        || fallbackName;
}

export function niBuildNovelExportFileName(library, currentKey) {
    const currentSnapshot = niFindNovelSnapshotByKey(library, currentKey);
    const novelName = (currentSnapshot?.name || currentKey || 'data').replace(/[\\/:*?"<>|]/g, '_');
    return `novel-injector-${novelName}.zip`;
}

export function createStorageController(deps = {}) {
    const {
        S, extension_settings, EXT_NAME, DEFAULT_SETTINGS, DB_STORE,
        NI_UPLOAD_LABEL, NI_UPLOAD_HINT, q, getRequestHeaders,
        normalizePlotCollections, niSyncSubPlotStageAssignments,
        niMaybeMigrateLegacyDeviationToChat = () => {}, buildStages,
        canUseDerivedModules,
        dbCloneNovelKey, niReconcileVecStateFromDb, niGetWorldCategories,
        niSaveSettings, saveSettingsDebounced, niResetNovelWorkspace,
        niLoadDeviationStateFromChat, niClearLegacyDeviationSettings,
        niSyncDeviationResultUI, niSaveDeviationChatState,
        renderPlots, renderCharacters, renderChunkList, niRenderWorldSettings,
        niSyncCleanButtonState, dbLoadByNovel, getVectorFingerprint,
        vecToBytes, bytesToVecs, vecToBuffer, dbOpen, dbClearNovel, setBtn,
    } = deps;
    const fetch = deps.fetch || globalThis.fetch;
    const document = deps.document || globalThis.document;
    const Blob = deps.Blob || globalThis.Blob;
    const URL = deps.URL || globalThis.URL;
    const FileReader = deps.FileReader || globalThis.FileReader;
    const alert = deps.alert || globalThis.alert;
    const confirm = deps.confirm || globalThis.confirm;
    const prompt = deps.prompt || globalThis.prompt;
    const toastr = deps.toastr ?? globalThis.toastr;
    const HEAVY_FIELDS = ['_characters', '_plots', '_chunkResults', '_chunkMeta', '_chunkStatus'];

    function niHeavyPartFileName(fileKey, part) {
        return `${niServerFileId(fileKey)}_${part}.json`;
    }
    
    function niHeavyPartFileNames(novelKey, fileKey = '', part = 'core') {
        const bases = [fileKey || S.heavyFileKey || novelKey, novelKey]
            .map(v => niServerFileId(v))
            .filter(Boolean);
        return bases
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .map(base => `${base}_${part}.json`);
    }
    
    function niStripCharAiRuntime(characters) {
        return (Array.isArray(characters) ? characters : []).map(c => {
            if (!c || typeof c !== 'object') return c;
            const copy = { ...c };
            delete copy.aiProfile;
            delete copy.showAi;
            return copy;
        });
    }
    
    async function niServerUploadJson(name, payload) {
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name, data: niB64(JSON.stringify(payload)) }),
        });
        if (!res.ok) throw new Error(`服务端写入失败: ${res.status}`);
    }
    
    async function niServerLoadJsonByNames(names) {
        for (const name of names) {
            const res = await fetch(`/user/files/${name}`, {
                headers: getRequestHeaders(),
                cache: 'no-cache',
            });
            if (res.status === 404) continue;
            if (!res.ok) throw new Error(`服务端读取失败: ${res.status}`);
            return { name, payload: await res.json() };
        }
        return null;
    }
    
    function niApplyHeavyCore(payload) {
        if (!payload) return;
        if (payload._characters)   S.characters   = niStripCharAiRuntime(payload._characters);
        if (payload._plots) {
            S.plots = payload._plots;
            normalizePlotCollections(S, niSyncSubPlotStageAssignments);
        }
        if (payload._chunkMeta)    S.chunkMeta    = payload._chunkMeta;
        if (payload._chunkStatus) {
            S.chunkStatus = payload._chunkStatus;
            S.cleanDone = S.chunkStatus.length > 0 && S.chunkStatus.every(status => status === 'done');
        }
        if (payload._styleGuide != null) S.styleGuide = payload._styleGuide;
        niMaybeMigrateLegacyDeviationToChat(payload);
        if (payload.heavyFileKey) S.heavyFileKey = payload.heavyFileKey;
    }
    
    function niApplyHeavyChunks(payload) {
        if (!payload) return;
        if (payload._chunkResults) S.chunkResults = payload._chunkResults;
        if (payload.heavyFileKey) S.heavyFileKey = payload.heavyFileKey;
    }
    
    function niHasLoadedChunks() {
        return Array.isArray(S.chunkResults) && S.chunkResults.some(t => String(t || '').trim());
    }
    
    // 把当前工作区的重数据写入服务端文件
    async function niServerSaveHeavy(novelKey, fileKey = '') {
        if (!novelKey) throw new Error('novelKey 为空，无法写入服务端');
        const heavyFileKey = fileKey || S.heavyFileKey || novelKey;
        const savedAt = new Date().toISOString();
        const corePayload = {
            version: 2,
            part: 'core',
            novelKey,
            heavyFileKey,
            savedAt,
            _characters:  niStripCharAiRuntime(S.characters),
            _plots:       S.plots,
            _chunkMeta:   S.chunkMeta,
            _chunkStatus: S.chunkStatus,
            _styleGuide:  S.styleGuide,
        };
        const chunksPayload = {
            version: 2,
            part: 'chunks',
            novelKey,
            heavyFileKey,
            savedAt,
            _chunkResults: S.chunkResults,
        };
        if (Array.isArray(S.chunkResults) && S.chunkResults.length > 0) {
            await niServerUploadJson(niHeavyPartFileName(heavyFileKey, 'chunks'), chunksPayload);
        }
        await niServerUploadJson(niHeavyPartFileName(heavyFileKey, 'core'), corePayload);
    }
    
    async function niServerLoadHeavy(novelKey, fileKey = '', opts = {}) {
        if (!novelKey) return false;
        const loadCore = opts.core !== false;
        const loadChunks = opts.chunks !== false;
        const allowLegacy = opts.legacy !== false;
        let ok = false;
    
        if (loadCore) {
            const core = await niServerLoadJsonByNames(niHeavyPartFileNames(novelKey, fileKey || S.heavyFileKey, 'core'));
            if (core) {
                niApplyHeavyCore(core.payload);
                ok = true;
            }
        }
    
        if (loadChunks) {
            const chunks = await niServerLoadJsonByNames(niHeavyPartFileNames(novelKey, fileKey || S.heavyFileKey, 'chunks'));
            if (chunks) {
                niApplyHeavyChunks(chunks.payload);
                ok = true;
            }
        }
    
        if (ok || !allowLegacy) return ok;
    
        // 旧版单 JSON 兼容：找不到 core/chunks 时回退读取旧文件。
        const legacy = await niServerLoadJsonByNames(niServerFileNames(novelKey, fileKey || S.heavyFileKey));
        if (legacy) {
            niApplyHeavyCore(legacy.payload);
            if (loadChunks) niApplyHeavyChunks(legacy.payload);
            return true;
        }
        return false;
    }
    
    async function niEnsureChunksLoaded() {
        if (niHasLoadedChunks()) return true;
        if (!S.novelKey) return false;
        try {
            return await niServerLoadHeavy(S.novelKey, S.heavyFileKey, { core: false, chunks: true });
        } catch (e) {
            console.warn('[NI] 懒加载压缩正文失败:', e);
            return false;
        }
    }
    
    async function niBuildStagesWithChunksIfNeeded() {
        const rawMode = (extension_settings[EXT_NAME]?.rawInjMode) ?? DEFAULT_SETTINGS.rawInjMode;
        if (rawMode === 'compressed') {
            await niEnsureChunksLoaded();
        }
        buildStages();
    }
    
    // 删除服务端文件
    async function niServerDeleteHeavy(novelKey, fileKey = '') {
        if (!novelKey) return;
        const names = [
            ...niHeavyPartFileNames(novelKey, fileKey, 'core'),
            ...niHeavyPartFileNames(novelKey, fileKey, 'chunks'),
            ...niServerFileNames(novelKey, fileKey),
        ].filter((name, idx, arr) => name && arr.indexOf(name) === idx);
        for (const name of names) {
            try {
                await fetch('/api/files/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ path: `user/files/${name}` }),
                });
            } catch (e) {
                console.warn('[NI] 删除服务端文件失败（忽略）:', e);
            }
        }
    }
    
    // extension_settings / snap.data 里的重字段在保存前删掉
    function _niStripHeavy(obj) {
        HEAVY_FIELDS.forEach(k => { delete obj[k]; });
        return obj;
    }
    
    function niRenderNovelLibrary() {
        const cfg = extension_settings[EXT_NAME] || {};
        const lib = niNovelLibraryEntries(cfg.novelLibrary);
        const el = q('#ni-lib-list');
        const lbl = q('#ni-lib-count-lbl');
        if (lbl) lbl.textContent = niNovelLibraryCountText(lib);
        if (!el) return;
        if (!lib.length) {
            el.innerHTML = '<div class="ni-empty" style="padding:12px 0"><i class="ti ti-books"></i>暂无快照，保存当前工作区即可创建</div>';
            return;
        }
        const currentKey = niSelectCurrentNovelKey(cfg._novelKey, S.novelKey);
        const entries = niNormalizeNovelLibrary(lib, currentKey);
        el.innerHTML = '<div class="ni-book-grid">' +
            entries.map(entry => {
                const { index, isActive, name: snapName } = entry;
                const color = niNovelSpineColor(snapName);
                return `<div class="ni-book-card${isActive ? ' ni-book-card-active' : ''}" data-lib-idx="${index}">
              <div class="ni-book-card-accent" style="background:${color}"></div>
              <div class="ni-book-card-name-row">
                <div class="ni-book-card-name" title="${niEscAttr(snapName)}">${niEscHtml(snapName)}</div>
                ${isActive ? '<span class="ni-book-card-pill">当前</span>' : ''}
              </div>
              <div class="ni-book-card-footer">
                <div class="ni-book-card-acts">
                  ${isActive ? `<button class="ni-book-card-btn ni-lib-update-btn" data-lib-idx="${index}" title="用当前工作区数据更新此快照"><i class="ti ti-refresh"></i></button>` : ''}
                  <button class="ni-book-card-btn ni-lib-rename-btn" data-lib-idx="${index}" title="重命名"><i class="ti ti-pencil"></i></button>
                  <button class="ni-book-card-btn ni-lib-load-btn" data-lib-idx="${index}" title="加载此小说（覆盖当前工作区）"><i class="ti ti-download"></i></button>
                  <button class="ni-book-card-btn ni-book-card-del ni-lib-del-btn" data-lib-idx="${index}" title="删除并彻底清除所有数据"><i class="ti ti-trash"></i></button>
                </div>
              </div>
            </div>`;
            }).join('') +
            '</div>';
    }
    
    async function niSaveNovelSnapshot(name) {
        if (!name) return;
        const cfg = extension_settings[EXT_NAME];
        if (!cfg.novelLibrary) cfg.novelLibrary = [];
        // 新建快照时生成唯一 novelKey，确保"当前"标签只跟随这个新快照
        const oldKey = S.novelKey || cfg._novelKey || '';
        const newKey = `ni_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const heavyFileKey = niSnapshotFileKey(name, newKey);
    
        // 如果当前工作区已向量化，保存为新快照时必须复制 IndexedDB 向量到新 key，
        // 否则保存后 vecDone 仍为 true，但导出/加载会找不到任何向量块。
        let copiedVecCount = 0;
        try {
            copiedVecCount = await dbCloneNovelKey(oldKey, newKey);
        } catch (e) {
            console.warn('[NI] 保存快照时复制向量失败:', e);
        }
    
        S.novelKey = newKey;
        S.heavyFileKey = heavyFileKey;
        cfg._novelKey = newKey;
        cfg._heavyFileKey = heavyFileKey;
        if (S.vecDone && !copiedVecCount) {
            await niReconcileVecStateFromDb({ persist: false });
        }
    
        // 重数据写服务端文件
        try {
            await niServerSaveHeavy(newKey, heavyFileKey);
        } catch (e) {
            alert('重数据写入服务端失败：' + e.message + '\n快照仍会保存，但角色/剧情/压缩文本需重新载入。');
            console.error('[NI] niSaveNovelSnapshot 服务端写入失败:', e);
        }
    
        // snap.data 只存轻量字段
        const snap = {
            name,
            savedAt: new Date().toISOString(),
            charCount: (S.characters || []).length,
            stageCount: S.stageMapN || 0,
            plotCount: ((S.plots?.main?.length || 0) + (S.plots?.sub?.length || 0) + (S.plots?.pivot?.length || 0)),
            data: _niStripHeavy({
                _stageStates:   S.stageStates,
                _stageSummaries:S.stageSummaries,
                _stageTitles:   S.stageTitles,
                _novelKey:      newKey,
                _heavyFileKey:   heavyFileKey,
                _fileFingerprint:S.fileFingerprint,
                _chunkKbUsed:    S.chunkKbUsed,
                _vecDone:       S.vecDone,
                _stageVecDone:  S.stageVecDone,
                _stageVecExpected:S.stageVecExpected,
                _cleanDone:     S.cleanDone,
                _stageMap:      S.stageMap,
                _stageMapN:     S.stageMapN,
                _chunkStageMap: S.chunkStageMap
                    ? Object.fromEntries(Object.entries(S.chunkStageMap).map(([k,v])=>[k,[...v]]))
                    : undefined,
                _worldCategories: niGetWorldCategories(),
                _styleGuide: S.styleGuide || '',
            }),
        };
        cfg.novelLibrary.push(snap);
        niSaveSettings();
        niRenderNovelLibrary();
    }
    
    async function niUpdateNovelSnapshot(idx) {
        const cfg = extension_settings[EXT_NAME];
        const snap = (cfg.novelLibrary || [])[idx];
        if (!snap) return;
        if (!confirm(`确认用当前工作区数据更新「${snap.name}」？`)) return;
        snap.savedAt = new Date().toISOString();
        snap.charCount = (S.characters || []).length;
        snap.stageCount = S.stageMapN || 0;
        snap.plotCount = ((S.plots?.main?.length || 0) + (S.plots?.sub?.length || 0) + (S.plots?.pivot?.length || 0));
        const heavyFileKey = snap.data?._heavyFileKey || S.heavyFileKey || niSnapshotFileKey(snap.name || S.novelKey, S.novelKey);
        S.heavyFileKey = heavyFileKey;
    
        // 重数据写服务端文件
        try {
            await niServerSaveHeavy(S.novelKey, heavyFileKey);
        } catch (e) {
            alert('重数据写入服务端失败：' + e.message);
            console.error('[NI] niUpdateNovelSnapshot 服务端写入失败:', e);
        }
    
        snap.data = _niStripHeavy({
            _stageStates:   S.stageStates,
            _stageSummaries:S.stageSummaries,
            _stageTitles:   S.stageTitles,
            _novelKey:      S.novelKey,
            _heavyFileKey:   heavyFileKey,
            _fileFingerprint:S.fileFingerprint,
            _chunkKbUsed:    S.chunkKbUsed,
            _vecDone:       S.vecDone,
            _stageVecDone:  S.stageVecDone,
            _stageVecExpected:S.stageVecExpected,
            _cleanDone:     S.cleanDone,
            _stageMap:      S.stageMap,
            _stageMapN:     S.stageMapN,
            _chunkStageMap: S.chunkStageMap
                ? Object.fromEntries(Object.entries(S.chunkStageMap).map(([k,v])=>[k,[...v]]))
                : undefined,
            _worldCategories: niGetWorldCategories(),
            _styleGuide: S.styleGuide || '',
        });
        niSaveSettings();
        niRenderNovelLibrary();
        toastr?.success(`「${snap.name}」已更新`);
    }
    
    // 重命名快照
    function niRenameNovelSnapshot(idx) {
        const cfg = extension_settings[EXT_NAME];
        const snap = (cfg.novelLibrary || [])[idx];
        if (!snap) return;
        const newName = prompt('请输入新名称：', snap.name || '');
        if (!newName || !newName.trim()) return;
        snap.name = newName.trim();
        niSaveSettings();
        niRenderNovelLibrary();
    }
    
    async function niLoadNovelSnapshot(idx) {
        const cfg = extension_settings[EXT_NAME];
        const snap = (cfg.novelLibrary || [])[idx];
        if (!snap || !snap.data) { alert('快照数据损坏'); return; }
        if (!confirm(`确认加载「${snap.name}」？当前工作区数据将被覆盖。`)) return;
        const d = snap.data;
    
        // 先完整重置小说级状态，避免快照缺失字段继承当前工作区。
        niResetNovelWorkspace();
    
        // 还原轻量字段
        if (d._stageStates)   S.stageStates   = d._stageStates;
        if (d._stageSummaries)S.stageSummaries= d._stageSummaries;
        if (d._stageTitles)   S.stageTitles   = d._stageTitles;
        if (d._novelKey)      S.novelKey      = d._novelKey;
        S.heavyFileKey = d._heavyFileKey || '';
        S.fileFingerprint = d._fileFingerprint || '';
        S.chunkKbUsed = Math.max(0, parseInt(d._chunkKbUsed, 10) || 0);
        if (d._vecDone != null) S.vecDone     = d._vecDone;
        if (d._stageVecDone) {
            S.stageVecDone = {};
            Object.entries(d._stageVecDone).forEach(([k, v]) => { S.stageVecDone[Number(k)] = v; });
        }
        if (d._stageVecExpected) {
            Object.entries(d._stageVecExpected).forEach(([k, v]) => {
                const count = Math.max(0, parseInt(v, 10) || 0);
                if (count > 0) S.stageVecExpected[Number(k)] = count;
            });
        }
        if (d._cleanDone != null) S.cleanDone = d._cleanDone;
        if (d._stageMap)      S.stageMap      = d._stageMap;
        if (d._stageMapN != null) S.stageMapN = d._stageMapN;
        if (d._chunkStageMap) {
            S.chunkStageMap = {};
            Object.entries(d._chunkStageMap).forEach(([k, v]) => { S.chunkStageMap[k] = new Set(v); });
        }
        if (d._worldCategories) S.worldCategories = d._worldCategories;
        // Bug修复③：还原文风并立即刷新 UI
        S.styleGuide = (d._styleGuide != null) ? d._styleGuide : '';
        niLoadDeviationStateFromChat({ allowLegacyMigration: false, collapsed: true, syncUI: false });
        {
            const resEl = q('#ni-style-result');
            if (resEl) resEl.value = S.styleGuide;
            const wrap = q('#ni-style-result-wrap');
            if (wrap) wrap.style.display = S.styleGuide ? 'block' : 'none';
            niSyncDeviationResultUI({ collapsed: true });
        }
    
        // 从服务端拉取 core 重数据；压缩正文 chunks 按需懒加载
        let heavyOk = false;
        let heavyErr = '';
        if (S.novelKey) {
            try {
                heavyOk = await niServerLoadHeavy(S.novelKey, S.heavyFileKey, { chunks: false });
            } catch (e) {
                console.warn('[NI] 加载快照时拉取重数据失败:', e);
                heavyErr = e.message || String(e);
            }
        }
        await niReconcileVecStateFromDb();
        {
            const resEl = q('#ni-style-result');
            if (resEl) resEl.value = S.styleGuide || '';
            const wrap = q('#ni-style-result-wrap');
            if (wrap) wrap.style.display = S.styleGuide ? 'block' : 'none';
            niSyncDeviationResultUI({ collapsed: true });
        }
    
        niSaveSettings();
        if (canUseDerivedModules(S)) {
            if (S.chunkStatus.length) {
                q('#ni-chunk-info') && (q('#ni-chunk-info').style.display = 'block');
                q('#ni-st-chunks') && (q('#ni-st-chunks').textContent = S.chunkStatus.length);
                renderChunkList();
            }
            renderPlots(); renderCharacters(); buildStages(); niRenderWorldSettings();
            if (S.vecDone) {
                setBtn('#ni-btn-vec', false, '<i class="ti ti-check"></i>向量化完成');
            } else {
                setBtn('#ni-btn-vec', false);
            }
            niSyncCleanButtonState();
        }
        niRenderNovelLibrary();
        const note = heavyOk
            ? ''
            : (heavyErr
                ? `\n（注意：重数据拉取失败：${heavyErr}，角色/剧情/压缩文本可能为空）`
                : '\n（注意：服务端重数据文件不存在，角色/剧情/压缩文本为空）');
        alert(`已加载「${snap.name}」${note}`);
    }
    
    
    async function niDeleteNovelSnapshot(idx) {
        const cfg = extension_settings[EXT_NAME];
        const lib = cfg.novelLibrary || [];
        const snap = lib[idx];
        if (!snap) return;
        if (!confirm(`确认删除「${snap.name}」？\n\n将彻底清除该小说的所有关联数据（清洗文本、剧情、角色、向量等），无法恢复。`)) return;
    
        const snapKey = snap.data?._novelKey || '';
    
        // 1. 清除 IndexedDB 向量数据 + 服务端重数据文件
        try {
            if (snapKey) await dbClearNovel(snapKey);
        } catch(e) {
            console.warn('[NI] 删除向量数据失败:', e);
        }
        await niServerDeleteHeavy(snapKey, snap.data?._heavyFileKey || '');
    
        // 2. 如果当前工作区正在使用该快照的 novelKey，同时重置工作区
        if (snapKey && S.novelKey === snapKey) {
            niResetNovelWorkspace();
            Object.assign(S, { deviationGuide: '', devChangedFacts: '', devCurrentConstraint: '', devPreservedFacts: '', devCoveredFloor: 0, devLastRange: null });
            niSyncDeviationResultUI({ collapsed: true });
            await niSaveDeviationChatState({ saveChat: true });
            ['_characters','_plots','_stageStates','_stageSummaries','_stageTitles',
             '_chunkResults','_chunkStatus','_novelKey','_fileFingerprint','_chunkKbUsed','_vecDone','_stageVecDone','_stageVecExpected',
             '_cleanDone','_stageMap','_stageMapN','_chunkStageMap','_heavyFileKey',
             '_styleGuide','_deviationGuide','_devCoveredFloor','_devLastRange'].forEach(k => { delete cfg[k]; });
            S.chunkStageMap = null;
            S.worldCategories = null;
            // 重置 UI
            q('#ni-chunk-info') && (q('#ni-chunk-info').style.display = 'none');
            q('#ni-u-ok') && (q('#ni-u-ok').style.display = 'none');
            q('#ni-uz') && q('#ni-uz').classList.remove('loaded');
            q('#ni-u-label') && (q('#ni-u-label').textContent = NI_UPLOAD_LABEL);
            q('#ni-u-hint') && (q('#ni-u-hint').textContent = NI_UPLOAD_HINT);
            q('#ni-style-result') && (q('#ni-style-result').value = '');
            q('#ni-style-result-wrap') && (q('#ni-style-result-wrap').style.display = 'none');
            niSyncDeviationResultUI({ collapsed: true });
            renderPlots(); renderCharacters(); buildStages(); niRenderWorldSettings();
            niSyncCleanButtonState();
        }
    
        // 3. 从库中移除快照记录
        lib.splice(idx, 1);
        niSaveSettings();
        niRenderNovelLibrary();
    }
    
    // ============================================================
    // 设置 Tab — 导入 / 导出
    // ============================================================
    // ============================================================
    // 导入 / 导出
    // ============================================================
    
    // --- 导出：打包为 ZIP ---
    
    async function niExportData() {
        const cfg = extension_settings[EXT_NAME] || {};
        niClearLegacyDeviationSettings();
        if (S.cleanDone && !niHasLoadedChunks()) {
            const ok = await niEnsureChunksLoaded();
            if (!ok) {
                alert('导出前无法加载压缩正文，导出的备份可能不完整。请确认服务端数据文件存在后重试。');
                return;
            }
        }
    
        // 1. 读取向量数据
        let allChunks = [];
        try {
            if (S.novelKey) {
                allChunks = await dbLoadByNovel();
            }
        } catch (e) { console.warn('[NI] 读取向量失败，将导出不含向量的版本:', e); }
    
        // 2. 构建 settings.json
        const exportObj = {
            _ni_export_version: 2,
            _ni_export_time: new Date().toISOString(),
            settings: {},
            runtime: {
                _characters:    niStripCharAiRuntime(S.characters),
                _plots:         S.plots,
                _stageStates:   S.stageStates,
                _stageSummaries:S.stageSummaries,
                _stageTitles:   S.stageTitles,
                _chunkResults:  S.chunkResults,
                _chunkStatus:   S.chunkStatus,
                _novelKey:      S.novelKey,
                _heavyFileKey:   S.heavyFileKey,
                _fileFingerprint:S.fileFingerprint,
                _chunkKbUsed:    S.chunkKbUsed,
                _vecDone:       S.vecDone,
                _stageVecDone:  S.stageVecDone,
                _stageVecExpected:S.stageVecExpected,
                _cleanDone:     S.cleanDone,
                _stageMap:      S.stageMap,
                _stageMapN:     S.stageMapN,
                _chunkStageMap: S.chunkStageMap
                    ? Object.fromEntries(Object.entries(S.chunkStageMap).map(([k,v])=>[k,[...v]]))
                    : undefined,
                _worldCategories: niGetWorldCategories(),
                _styleGuide: S.styleGuide || '',
                // Bug修复①②：导出时记录当前小说的名称，导入时直接使用，不依赖novelLibrary顺序
                _currentNovelName: niCurrentNovelDisplayName(extension_settings[EXT_NAME]?.novelLibrary, S.novelKey),
            }
        };
        Object.keys(DEFAULT_SETTINGS).forEach(k => {
            if (k === 'cleanKey' || k === 'vecKey') return;
            exportObj.settings[k] = cfg[k] !== undefined ? cfg[k] : DEFAULT_SETTINGS[k];
        });
        exportObj.settings.novelLibrary = cfg.novelLibrary || [];
        exportObj.settings.customPrompt = cfg.customPrompt || '';
    
        // 3. 构建 manifest.json
        const dims = allChunks[0]?.vector?.length || 0;
        const manifest = {
            version: 2,
            exportedAt: new Date().toISOString(),
            novelKey: S.novelKey,
            heavyFileKey: S.heavyFileKey,
            fingerprint: getVectorFingerprint(),
            dims,
            chunkCount: allChunks.length,
        };
    
        // 4. 构建 chunks.jsonl + vectors.bin
        const sortedChunks = [...allChunks].sort((a, b) =>
            (a.stageIdx - b.stageIdx) || (a.chunkIdx - b.chunkIdx)
        );
        const chunksJsonl = sortedChunks.map(c => JSON.stringify({
            key: c.key, stageIdx: c.stageIdx, chunkIdx: c.chunkIdx, sourceChunkIdx: c.sourceChunkIdx, text: c.text,
        })).join('\n');
        const vectorsOrdered = sortedChunks.map(c => c.vector || []);
    
        // 5. 打包 ZIP
        const zipFiles = [
            { name: 'manifest.json',  data: _u8(JSON.stringify(manifest, null, 2)) },
            { name: 'settings.json',  data: _u8(JSON.stringify(exportObj, null, 2)) },
            { name: 'chunks.jsonl',   data: _u8(chunksJsonl) },
            { name: 'vectors.bin',    data: dims > 0 ? vecToBytes(vectorsOrdered, dims) : new Uint8Array(0) },
        ];
        const zipBytes = _buildZip(zipFiles);
    
        // 6. 下载
        const fname = niBuildNovelExportFileName(cfg.novelLibrary, S.novelKey);
    
        const blob = new Blob([zipBytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fname; a.click();
        URL.revokeObjectURL(url);
    
        const sizeMB = (zipBytes.length / 1024 / 1024).toFixed(2);
        console.log(`[NI] 导出完成: ${fname} (${sizeMB}MB, ${allChunks.length} 个向量块)`);
    }
    
    async function niImportData(file) {
        const resultEl = q('#ni-import-result');
        const show = (msg, ok) => {
            if (!resultEl) return;
            resultEl.style.display = '';
            resultEl.className = `ni-import-result ${ok ? 'ni-import-ok' : 'ni-import-err'}`;
            resultEl.innerHTML = `<i class="ti ti-${ok ? 'circle-check' : 'alert-circle'}"></i> ${niEscHtml(msg)}`;
        };
        if (!file) return;
    
        const isZip = file.name.endsWith('.zip');
    
        if (!isZip) {
            // ── 旧版 JSON 导入──
            const reader = new FileReader();
            reader.onload = async ev => {
                try {
                    const obj = JSON.parse(ev.target.result);
                    if (!obj._ni_export_version) { show('文件格式不正确（缺少版本标记）', false); return; }
                    if (!confirm('确认导入？将作为新快照添加到小说库，不影响当前工作区。')) return;
                    const cfg = extension_settings[EXT_NAME];
                    const rt = obj.runtime || {};
                    const importedKey = `ni_imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
                    if (!cfg.novelLibrary) cfg.novelLibrary = [];
                    const snapName = obj.settings?.novelLibrary?.[0]?.name
                        || file.name.replace(/\.json$/i, '')
                        || `导入-${new Date().toLocaleDateString()}`;
                    const heavyFileKey = niSnapshotFileKey(snapName, importedKey);
                    // 旧版 JSON 里重数据直接写服务端文件，snap.data 只存轻量字段
                    const oldS = { characters: S.characters, plots: S.plots, chunkResults: S.chunkResults, chunkMeta: S.chunkMeta, chunkStatus: S.chunkStatus, styleGuide: S.styleGuide };
                    S.characters   = niStripCharAiRuntime(rt._characters);
                    S.plots        = rt._plots        || { main: [], sub: [], pivot: [] };
                    normalizePlotCollections(S, niSyncSubPlotStageAssignments);
                    S.chunkResults = rt._chunkResults || [];
                    S.chunkMeta    = rt._chunkMeta    || [];
                    S.chunkStatus  = rt._chunkStatus  || [];
                    S.styleGuide   = rt._styleGuide   || '';
                    let heavyWriteNote = '';
                    try {
                        await niServerSaveHeavy(importedKey, heavyFileKey);
                    } catch (e) {
                        heavyWriteNote = '（重数据写服务端失败，加载后角色/剧情/压缩文本可能为空）';
                        console.warn('[NI] 旧版JSON导入写服务端失败:', e);
                    }
                    // 恢复工作区
                    S.characters = oldS.characters; S.plots = oldS.plots;
                    S.chunkResults = oldS.chunkResults; S.chunkMeta = oldS.chunkMeta; S.chunkStatus = oldS.chunkStatus;
                    S.styleGuide = oldS.styleGuide;
    
                    cfg.novelLibrary.push({
                        name: snapName,
                        savedAt: obj._ni_export_time || new Date().toISOString(),
                        charCount: (rt._characters || []).length,
                        stageCount: rt._stageMapN || 0,
                        plotCount: ((rt._plots?.main?.length||0)+(rt._plots?.sub?.length||0)+(rt._plots?.pivot?.length||0)),
                        data: _niStripHeavy({
                            _stageStates:    rt._stageStates,
                            _stageSummaries: rt._stageSummaries,
                            _stageTitles:    rt._stageTitles,
                            _novelKey:       importedKey,
                            _heavyFileKey:    heavyFileKey,
                            _fileFingerprint:rt._fileFingerprint,
                            _chunkKbUsed:    rt._chunkKbUsed,
                            _vecDone:        rt._vecDone,
                            _stageVecDone:   rt._stageVecDone,
                            _stageVecExpected:rt._stageVecExpected,
                            _cleanDone:      rt._cleanDone,
                            _stageMap:       rt._stageMap,
                            _stageMapN:      rt._stageMapN,
                            _chunkStageMap:  rt._chunkStageMap,
                            _worldCategories:rt._worldCategories,
                            _styleGuide:     rt._styleGuide || '',
                        }),
                    });
                    saveSettingsDebounced();
                    niRenderNovelLibrary();
                    show(`已导入为「${snapName}」（旧版格式，不含向量）${heavyWriteNote}，可在小说库中加载`, true);
                } catch(e) { show(`解析失败：${e.message}`, false); }
            };
            reader.readAsText(file);
            return;
        }
    
        // ── 新版 ZIP 导入 ──
        try {
            const arrayBuffer = await file.arrayBuffer();
            let zipFiles;
            try { zipFiles = _parseZip(arrayBuffer); }
            catch (e) { show('ZIP 解压失败：' + e.message, false); return; }
    
            if (!zipFiles['manifest.json'] || !zipFiles['settings.json']) {
                show('ZIP 格式不正确（缺少必要文件）', false); return;
            }
    
            const manifest = JSON.parse(_str(zipFiles['manifest.json']));
            const exportObj = JSON.parse(_str(zipFiles['settings.json']));
    
            if (![1, 2].includes(manifest.version) && ![1, 2].includes(exportObj._ni_export_version)) {
                show(`不支持的版本: ${manifest.version}`, false); return;
            }
    
            if (!confirm('确认导入？向量数据将写入本地数据库，快照将添加到小说库，不影响当前工作区。')) return;
    
            const cfg = extension_settings[EXT_NAME];
            const rt = exportObj.runtime || {};
    
            // 为导入的快照生成新的唯一 novelKey，避免与现有数据冲突
            const importedKey = `ni_imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
            // Bug修复①：优先用导出时记录的小说名，其次从novelLibrary中匹配novelKey找名，最后用文件名
            const exportedNovelKey = rt._novelKey || manifest.novelKey || '';
            const exportedLibrary = exportObj.settings?.novelLibrary || [];
            const matchedSnap = exportedNovelKey
                ? exportedLibrary.find(s => s.data && s.data._novelKey === exportedNovelKey)
                : null;
            const snapName = rt._currentNovelName
                || matchedSnap?.name
                || file.name.replace(/\.zip$/i, '')
                || `导入-${new Date().toLocaleDateString()}`;
            const heavyFileKey = niSnapshotFileKey(snapName, importedKey);
    
            // 写入向量到 IndexedDB
            let vecImported = 0;
            if (manifest.dims > 0 && zipFiles['chunks.jsonl'] && zipFiles['vectors.bin']) {
                try {
                    const chunkMetas = _str(zipFiles['chunks.jsonl'])
                        .split('\n').filter(Boolean).map(l => JSON.parse(l));
                    const vectors = bytesToVecs(zipFiles['vectors.bin'], manifest.dims);
    
                    if (chunkMetas.length === vectors.length && chunkMetas.length > 0) {
                        await dbOpen();
                        const fingerprint = manifest.fingerprint || '';
                        await new Promise((resolve, reject) => {
                            const tx = S.db.transaction(DB_STORE, 'readwrite');
                            const store = tx.objectStore(DB_STORE);
                            chunkMetas.forEach((meta, i) => {
                                // key 用新 importedKey 替换原 novelKey 前缀，保证隔离
                                const newKey = `${importedKey}_s${meta.stageIdx}_c${meta.chunkIdx}`;
                                store.put({
                                    key: newKey,
                                    novelKey: importedKey,
                                    stageIdx: meta.stageIdx,
                                    chunkIdx: meta.chunkIdx,
                                    sourceChunkIdx: meta.sourceChunkIdx ?? meta.chunkIdx,
                                    text: meta.text,
                                    vector: vecToBuffer(vectors[i]),
                                    fingerprint,
                                });
                            });
                            tx.oncomplete = resolve;
                            tx.onerror = () => reject(tx.error);
                        });
                        vecImported = chunkMetas.length;
                    }
                } catch (e) { console.warn('[NI] 向量写入失败:', e); }
            }
    
            // 把重数据写服务端文件
            const oldS2 = { characters: S.characters, plots: S.plots, chunkResults: S.chunkResults, chunkMeta: S.chunkMeta, chunkStatus: S.chunkStatus, styleGuide: S.styleGuide };
            S.characters   = niStripCharAiRuntime(rt._characters);
            S.plots        = rt._plots        || { main: [], sub: [], pivot: [] };
            normalizePlotCollections(S, niSyncSubPlotStageAssignments);
            S.chunkResults = rt._chunkResults || [];
            S.chunkMeta    = rt._chunkMeta    || [];
            S.chunkStatus  = rt._chunkStatus  || [];
            S.styleGuide   = rt._styleGuide   || '';
            let heavyWriteNote2 = '';
            try {
                await niServerSaveHeavy(importedKey, heavyFileKey);
            } catch (e) {
                heavyWriteNote2 = '（重数据写服务端失败，加载后角色/剧情/压缩文本可能为空）';
                console.warn('[NI] ZIP导入写服务端失败:', e);
            }
            S.characters = oldS2.characters; S.plots = oldS2.plots;
            S.chunkResults = oldS2.chunkResults; S.chunkMeta = oldS2.chunkMeta; S.chunkStatus = oldS2.chunkStatus;
            S.styleGuide = oldS2.styleGuide;
    
            // 添加快照到小说库
            if (!cfg.novelLibrary) cfg.novelLibrary = [];
            cfg.novelLibrary.push({
                name: snapName,
                savedAt: exportObj._ni_export_time || new Date().toISOString(),
                charCount: (rt._characters || []).length,
                stageCount: rt._stageMapN || 0,
                plotCount: ((rt._plots?.main?.length||0)+(rt._plots?.sub?.length||0)+(rt._plots?.pivot?.length||0)),
                data: _niStripHeavy({
                    _stageStates:    rt._stageStates,
                    _stageSummaries: rt._stageSummaries,
                    _stageTitles:    rt._stageTitles,
                    _novelKey:       importedKey,
                    _heavyFileKey:    heavyFileKey,
                    _fileFingerprint:rt._fileFingerprint,
                    _chunkKbUsed:    rt._chunkKbUsed,
                    _vecDone:        rt._vecDone,
                    _stageVecDone:   rt._stageVecDone,
                    _stageVecExpected:rt._stageVecExpected,
                    _cleanDone:      rt._cleanDone,
                    _stageMap:       rt._stageMap,
                    _stageMapN:      rt._stageMapN,
                    _chunkStageMap:  rt._chunkStageMap,
                    _worldCategories:rt._worldCategories,
                    _styleGuide:     rt._styleGuide || '',
                }),
            });
            saveSettingsDebounced();
            niRenderNovelLibrary();
    
            const vecNote = vecImported > 0 ? `，含 ${vecImported} 个向量块` : '，不含向量数据';
            show(`已导入为「${snapName}」${vecNote}${heavyWriteNote2}，可在小说库中加载`, true);
    
        } catch(e) { show(`导入失败：${e.message}`, false); }
    }
    
    async function niClearVecCache() {
        if (!S.novelKey) { alert('当前没有加载小说，无缓存可清除。'); return; }
        if (!confirm('确认清除当前小说的向量缓存？此操作不影响剧情和角色数据，但需重新向量化。')) return;
        try {
            await dbClearNovel();
            S.vecDone = false;
            S.stageVecDone = {};
            niSaveSettings();
            setBtn('#ni-btn-vec', false);
            alert('向量缓存已清除。');
    
        } catch(e) {
            alert('清除失败：' + e.message);
        }
    }
    
    async function niClearAllData() {
        if (!confirm('确认清除全部数据？这将清空所有剧情、角色、阶段、向量缓存，且无法恢复！')) return;
        if (!confirm('【再次确认】这会删除所有已清洗数据，确定吗？')) return;
        try {
            const oldNovelKey = S.novelKey;
            const oldHeavyFileKey = S.heavyFileKey;
            if (oldNovelKey) {
                await dbClearNovel();
                await niServerDeleteHeavy(oldNovelKey, oldHeavyFileKey);
            }
            niResetNovelWorkspace();
            Object.assign(S, { deviationGuide: '', devChangedFacts: '', devCurrentConstraint: '', devPreservedFacts: '', devCoveredFloor: 0, devLastRange: null });
            niSyncDeviationResultUI({ collapsed: true });
            await niSaveDeviationChatState({ saveChat: true });
            const cfg = extension_settings[EXT_NAME];
            if (oldNovelKey && Array.isArray(cfg.novelLibrary)) {
                cfg.novelLibrary = cfg.novelLibrary.filter(s => s?.data?._novelKey !== oldNovelKey);
            }
            ['_characters','_plots','_stageStates','_stageSummaries','_stageTitles',
             '_chunkResults','_chunkStatus','_novelKey','_fileFingerprint','_chunkKbUsed','_vecDone','_stageVecDone','_stageVecExpected',
             '_cleanDone','_stageMap','_stageMapN','_chunkStageMap','_heavyFileKey',
             '_styleGuide','_deviationGuide','_devCoveredFloor','_devLastRange'].forEach(k => { delete cfg[k]; });
            S.chunkStageMap = null;
            S.worldCategories = null;
            saveSettingsDebounced();
            q('#ni-chunk-info') && (q('#ni-chunk-info').style.display = 'none');
            q('#ni-u-ok') && (q('#ni-u-ok').style.display = 'none');
            q('#ni-uz') && q('#ni-uz').classList.remove('loaded');
            q('#ni-u-label') && (q('#ni-u-label').textContent = NI_UPLOAD_LABEL);
            q('#ni-u-hint') && (q('#ni-u-hint').textContent = NI_UPLOAD_HINT);
            q('#ni-style-result') && (q('#ni-style-result').value = '');
            q('#ni-style-result-wrap') && (q('#ni-style-result-wrap').style.display = 'none');
            niSyncDeviationResultUI({ collapsed: true });
            renderPlots(); renderCharacters(); buildStages(); niRenderWorldSettings();
            niRenderNovelLibrary();
            niSyncCleanButtonState();
    
            alert('全部数据已清除。');
        } catch(e) {
            alert('清除失败：' + e.message);
        }
    }

    return {
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
    };
}
