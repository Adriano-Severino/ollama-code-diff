"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHARS_PER_TOKEN = void 0;
exports.estimateTokenCount = estimateTokenCount;
exports.splitTextIntoChunks = splitTextIntoChunks;
exports.chunkTextForTokenBudget = chunkTextForTokenBudget;
exports.DEFAULT_CHARS_PER_TOKEN = 4;
const MIN_CHUNK_SIZE_CHARS = 1;
function normalizePositiveInt(value, fallback, minimum = 1) {
    if (!Number.isFinite(value) || value < minimum) {
        return fallback;
    }
    return Math.max(minimum, Math.floor(value));
}
function estimateTokenCount(text, charsPerToken = exports.DEFAULT_CHARS_PER_TOKEN) {
    const normalized = String(text ?? '');
    if (!normalized) {
        return 0;
    }
    const safeCharsPerToken = normalizePositiveInt(charsPerToken, exports.DEFAULT_CHARS_PER_TOKEN);
    return Math.max(1, Math.ceil(normalized.length / safeCharsPerToken));
}
function splitTextIntoChunks(text, chunkSizeChars) {
    const normalizedText = String(text ?? '').replace(/\r\n/g, '\n');
    if (!normalizedText) {
        return [];
    }
    const safeChunkSize = normalizePositiveInt(chunkSizeChars, 25000, MIN_CHUNK_SIZE_CHARS);
    const lines = normalizedText.split('\n');
    const chunks = [];
    let currentChunk = '';
    const pushCurrentChunk = () => {
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = '';
        }
    };
    const pushLongSegment = (segment) => {
        for (let cursor = 0; cursor < segment.length; cursor += safeChunkSize) {
            const piece = segment.slice(cursor, cursor + safeChunkSize);
            if (piece) {
                chunks.push(piece);
            }
        }
    };
    for (let index = 0; index < lines.length; index++) {
        const suffix = index < lines.length - 1 ? '\n' : '';
        const lineWithBreak = `${lines[index]}${suffix}`;
        if (!lineWithBreak) {
            continue;
        }
        if (lineWithBreak.length > safeChunkSize) {
            pushCurrentChunk();
            pushLongSegment(lineWithBreak);
            continue;
        }
        if (currentChunk.length > 0 && currentChunk.length + lineWithBreak.length > safeChunkSize) {
            pushCurrentChunk();
        }
        currentChunk += lineWithBreak;
    }
    pushCurrentChunk();
    return chunks;
}
function chunkTextForTokenBudget(text, options) {
    const normalizedText = String(text ?? '');
    const safeMaxTokens = normalizePositiveInt(options.maxTokens, 0, 0);
    const safeCharsPerToken = normalizePositiveInt(options.charsPerToken ?? exports.DEFAULT_CHARS_PER_TOKEN, exports.DEFAULT_CHARS_PER_TOKEN);
    const estimatedTotalTokens = estimateTokenCount(normalizedText, safeCharsPerToken);
    const sourceChunks = splitTextIntoChunks(normalizedText, options.chunkSizeChars);
    if (!normalizedText || sourceChunks.length === 0 || safeMaxTokens === 0) {
        const truncated = normalizedText.length > 0 && safeMaxTokens === 0;
        return {
            chunks: [],
            usedTokens: 0,
            estimatedTotalTokens,
            totalChunkCount: sourceChunks.length,
            includedChunkCount: 0,
            omittedChunkCount: sourceChunks.length,
            partialChunkIncluded: false,
            truncated
        };
    }
    const selectedChunks = [];
    let usedTokens = 0;
    let partialChunkIncluded = false;
    for (const chunk of sourceChunks) {
        const remainingTokens = safeMaxTokens - usedTokens;
        if (remainingTokens <= 0) {
            break;
        }
        const chunkTokens = estimateTokenCount(chunk, safeCharsPerToken);
        if (chunkTokens <= remainingTokens) {
            selectedChunks.push(chunk);
            usedTokens += chunkTokens;
            continue;
        }
        const partialChars = remainingTokens * safeCharsPerToken;
        const partialChunk = chunk.slice(0, Math.max(0, partialChars));
        if (partialChunk.length > 0) {
            selectedChunks.push(partialChunk);
            usedTokens += estimateTokenCount(partialChunk, safeCharsPerToken);
            partialChunkIncluded = true;
        }
        break;
    }
    const includedChunkCount = selectedChunks.length;
    const omittedChunkCount = Math.max(sourceChunks.length - includedChunkCount, 0);
    const truncated = partialChunkIncluded || includedChunkCount < sourceChunks.length;
    return {
        chunks: selectedChunks,
        usedTokens,
        estimatedTotalTokens,
        totalChunkCount: sourceChunks.length,
        includedChunkCount,
        omittedChunkCount,
        partialChunkIncluded,
        truncated
    };
}
//# sourceMappingURL=contextWindow.js.map