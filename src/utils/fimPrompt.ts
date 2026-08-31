/**
 * Utility functions for Fill-In-The-Middle (FIM) prompt formatting and cleanup
 */

export function buildFimPrompt(prefix: string, suffix: string, modelName: string): string {
  const model = (modelName || '').toLowerCase();

  // Qwen 2.5 Coder & CodeGemma format
  if (model.includes('qwen') || model.includes('codegemma')) {
    return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
  }

  // DeepSeek Coder format
  if (model.includes('deepseek')) {
    return `<｜fim begin｜>${prefix}<｜fim hole｜>${suffix}<｜fim end｜>`;
  }

  // CodeLlama format
  if (model.includes('codellama')) {
    return `<PRE> ${prefix} <SUF>${suffix} <MID>`;
  }

  // StarCoder / SantaCoder format
  if (model.includes('starcoder') || model.includes('santacoder')) {
    return `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`;
  }

  // Default fallback: Qwen/StarCoder style standard tokens
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

export function cleanInlineCompletion(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Remove common FIM control tokens if leaked by the model
  const controlTokens = [
    '<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>', '<|file_sep|>', '<|endoftext|>',
    '<｜fim begin｜>', '<｜fim hole｜>', '<｜fim end｜>', '<｜end of sentence｜>',
    '<PRE>', '<SUF>', '<MID>', '<EOT>',
    '<fim_prefix>', '<fim_suffix>', '<fim_middle>'
  ];

  for (const token of controlTokens) {
    cleaned = cleaned.split(token).join('');
  }

  // Strip Markdown code block wrappers if model wrapped the suggestion
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '');
  }

  // Remove leading newlines
  cleaned = cleaned.replace(/^\n+/, '');

  return cleaned;
}
