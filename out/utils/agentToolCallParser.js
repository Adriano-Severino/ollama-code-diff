"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAgentToolCall = parseAgentToolCall;
function parseAgentToolCall(response) {
    if (!response || !response.trim()) {
        return null;
    }
    const candidates = collectJsonCandidates(response);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            const normalized = normalizeToolCall(parsed);
            if (normalized) {
                return normalized;
            }
        }
        catch {
            // Ignore invalid JSON snippets and keep searching.
        }
    }
    return null;
}
function normalizeToolCall(value) {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const tool = record.tool;
    if (typeof tool !== 'string' || !tool.trim()) {
        return null;
    }
    const args = asRecord(record.args) ?? {};
    return {
        tool: tool.trim().toLowerCase(),
        args
    };
}
function asRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value;
}
function collectJsonCandidates(text) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed || seen.has(trimmed)) {
            return;
        }
        seen.add(trimmed);
        candidates.push(trimmed);
    };
    const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let fencedMatch;
    while ((fencedMatch = fencedRegex.exec(text)) !== null) {
        addCandidate(fencedMatch[1]);
    }
    for (const objectCandidate of extractBalancedJsonObjects(text)) {
        addCandidate(objectCandidate);
    }
    return candidates;
}
function extractBalancedJsonObjects(text) {
    const objects = [];
    let depth = 0;
    let startIndex = -1;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') {
            if (depth === 0) {
                startIndex = index;
            }
            depth++;
            continue;
        }
        if (char === '}' && depth > 0) {
            depth--;
            if (depth === 0 && startIndex >= 0) {
                objects.push(text.slice(startIndex, index + 1));
                startIndex = -1;
            }
        }
    }
    return objects;
}
//# sourceMappingURL=agentToolCallParser.js.map