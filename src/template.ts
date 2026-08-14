export interface TemplateField {
  label: string;
  content: string;
}

export interface ParsedTemplate {
  header: string[];
  variables: string[];
  fields: TemplateField[];
  quickActions: string[];
}

export interface CreatePayload {
  title: string;
  variables: string[];
  fields: string[];
  quickActions: string;
}

const PLACEHOLDER_RE = /<?(?:PUT[_\s]+)([A-Z][A-Z0-9_\s]*)[_\s]+HERE>?/gi;

function extractVariables(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(PLACEHOLDER_RE)) {
    const name = m[1].trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export function parseTemplate(content: string): ParsedTemplate {
  const header: string[] = [];
  const fields: TemplateField[] = [];
  const quickActions: string[] = [];
  let current: TemplateField | null = null;

  for (const raw of content.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed.startsWith('/')) {
      quickActions.push(trimmed);
      continue;
    }
    const heading = trimmed.match(/^#\s+(.+)$/);
    if (heading) {
      current = { label: heading[1], content: '' };
      fields.push(current);
      continue;
    }
    if (current) {
      current.content += line + '\n';
    } else {
      header.push(line);
    }
  }

  // Fall back to a plain description when the template has no sections.
  if (fields.length === 0 && (header.join('\n').trim() || quickActions.length)) {
    fields.push({ label: 'Description', content: content });
    header.length = 0;
  }

  return { header, variables: extractVariables(content), fields, quickActions };
}

export function buildDescription(parsed: ParsedTemplate, payload: CreatePayload): string {
  const lines: string[] = [];

  for (const hl of parsed.header) {
    lines.push(hl);
  }

  parsed.fields.forEach((field, i) => {
    lines.push(`# ${field.label}`);
    lines.push((payload.fields[i] || '').trim());
  });

  for (const qa of payload.quickActions.split('\n').map((s) => s.trim()).filter(Boolean)) {
    lines.push(qa);
  }

  let doc = lines.join('\n');
  if (parsed.variables.length > 0) {
    doc = doc.replace(PLACEHOLDER_RE, (match, name: string) => {
      const idx = parsed.variables.indexOf(name.trim());
      const value = idx >= 0 ? (payload.variables[idx] || '').trim() : '';
      return value || match;
    });
  }

  return doc.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
