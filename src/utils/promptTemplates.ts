export interface PromptTemplateVariables {
  input: string;
  selection: string;
  file: string;
  language: string;
}

export function normalizeTemplateName(name: string): string {
  return String(name ?? '').trim().replace(/^\//, '').toLowerCase();
}

export function findPromptTemplate(
  command: string,
  templates: Record<string, string> | undefined
): string | undefined {
  if (!templates) {
    return undefined;
  }

  const wanted = normalizeTemplateName(command);
  for (const [name, template] of Object.entries(templates)) {
    if (normalizeTemplateName(name) === wanted && typeof template === 'string' && template.trim().length > 0) {
      return template;
    }
  }

  return undefined;
}

export function renderPromptTemplate(template: string, vars: PromptTemplateVariables): string {
  const values: Record<string, string> = {
    input: vars.input ?? '',
    selection: vars.selection ?? '',
    file: vars.file ?? '',
    language: vars.language ?? ''
  };

  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key];
    return value !== undefined ? value : match;
  });
}
