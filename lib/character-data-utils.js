import { niFiniteNumber } from './plot-order-utils.js';

export function isSameCharacter(a, b) {
    const nameA = (a?.name || '').trim();
    const nameB = (b?.name || '').trim();
    if (!nameA || !nameB) return false;
    if (nameA === nameB) return true;
    if (nameA.length >= 2 && nameB.includes(nameA)) return true;
    if (nameB.length >= 2 && nameA.includes(nameB)) return true;
    return false;
}

export function normalizeCharacterAlias(raw, chunkIndex, fallbackCharName = '') {
    const source = typeof raw === 'string' ? { text: raw } : (raw || {});
    const text = String(source.text || source.name || source.alias || source.title || '').trim();
    if (!text) return null;
    return {
        character_name: String(source.character_name || source.characterName || source.char || fallbackCharName || '').trim(),
        text,
        kind: String(source.kind || source.type || 'alias').trim() || 'alias',
        note: String(source.note || source.desc || '').trim(),
        _chunkIdx: chunkIndex ?? null,
    };
}

export function mergeAliasesIntoCharacter(character, aliases, chunkIndex) {
    if (!character || !Array.isArray(aliases)) return;
    if (!Array.isArray(character.aliases)) character.aliases = [];
    aliases.forEach(raw => {
        const alias = normalizeCharacterAlias(raw, chunkIndex, character.name);
        if (!alias || alias.text === character.name) return;
        const existing = character.aliases.find(item => (item.text || '') === alias.text);
        if (!existing) {
            character.aliases.push(alias);
        } else if (existing._chunkIdx == null || (alias._chunkIdx != null && alias._chunkIdx < existing._chunkIdx)) {
            existing._chunkIdx = alias._chunkIdx;
        }
    });
}

export function mergeCharacters(state, incoming, chunkIndex) {
    if (!state || !Array.isArray(incoming)) return;
    if (!Array.isArray(state.characters)) state.characters = [];
    for (const character of incoming) {
        if (!character?.name) continue;
        const existing = state.characters.find(item => isSameCharacter(item, character));
        if (!existing) {
            const isProtagonist = (character.role || '其他') === '主角';
            state.characters.push({
                name: character.name,
                role: character.role || '其他',
                identity: character.identity || character.bio || '',
                appearance: character.appearance || '',
                gender: character.gender || '',
                personality: character.personality || '',
                relations: character.relations || '',
                aliases: [],
                _firstChunkIdx: chunkIndex ?? null,
                enabled: isProtagonist,
            });
            mergeAliasesIntoCharacter(state.characters[state.characters.length - 1], character.aliases || character.character_aliases || [], chunkIndex);
        } else {
            mergeAliasesIntoCharacter(existing, character.aliases || character.character_aliases || [], chunkIndex);
        }
    }
}

export function mergeCharacterAliases(state, incoming, chunkIndex) {
    if (!state || !Array.isArray(incoming) || !incoming.length) return;
    if (!Array.isArray(state.characters)) state.characters = [];
    incoming.forEach(raw => {
        const alias = normalizeCharacterAlias(raw, chunkIndex);
        if (!alias) return;
        const owner = state.characters.find(character =>
            isSameCharacter(character, { name: alias.character_name }) ||
            isSameCharacter(character, { name: alias.text }) ||
            (Array.isArray(character.aliases) && character.aliases.some(item => (item.text || '') === alias.character_name))
        );
        if (owner) mergeAliasesIntoCharacter(owner, [alias], chunkIndex);
    });
}

export function captureCharacterMemory(state) {
    return (state?.characters || []).map(character => ({
        ...character,
        aliases: Array.isArray(character?.aliases) ? character.aliases.map(alias => ({ ...alias })) : [],
    }));
}

export function restoreCharacterMemory(state, memory) {
    if (!state || !Array.isArray(state.characters) || !Array.isArray(memory) || !memory.length) return;
    state.characters.forEach(current => {
        const previous = memory.find(character => isSameCharacter(character, current));
        if (!previous) return;
        const aliases = [];
        [...(previous.aliases || []), ...(current.aliases || [])].forEach(alias => {
            if (!alias?.text || aliases.some(item => item.text === alias.text)) return;
            aliases.push({ ...alias });
        });
        const firstChunkIdx = Math.min(
            niFiniteNumber(previous._firstChunkIdx, Number.MAX_SAFE_INTEGER),
            niFiniteNumber(current._firstChunkIdx, Number.MAX_SAFE_INTEGER)
        );
        Object.assign(current, previous);
        current.aliases = aliases;
        current._firstChunkIdx = firstChunkIdx === Number.MAX_SAFE_INTEGER ? null : firstChunkIdx;
    });
}
