export const PROJECT_DESCRIPTION_MAX_LENGTH = 255;

function textLength(value) {
  return Array.from(String(value)).length;
}

function truncateText(value, maxLength) {
  const chars = Array.from(String(value));
  if (chars.length <= maxLength) return String(value);
  return `${chars.slice(0, Math.max(0, maxLength - 3)).join('').trimEnd()}...`;
}

function compactSummary(value) {
  const compact = String(value).replace(/\s+/g, ' ').trim();
  return truncateText(compact, PROJECT_DESCRIPTION_MAX_LENGTH);
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function mergeContent(existingContent, originalDescription) {
  if (!hasText(existingContent)) return originalDescription;
  if (existingContent.includes(originalDescription)) return existingContent;
  return `${existingContent.trimEnd()}\n\n## Full Project description\n\n${originalDescription}`;
}

export function projectDescriptionLimit(input) {
  if (!input || typeof input.description !== 'string') return null;
  const originalLength = textLength(input.description);
  if (originalLength <= PROJECT_DESCRIPTION_MAX_LENGTH) return null;
  return {
    field: 'description',
    limit: PROJECT_DESCRIPTION_MAX_LENGTH,
    originalLength
  };
}

export function normalizeProjectDescriptionFields(input) {
  const limit = projectDescriptionLimit(input);
  if (!limit) return { input, fieldTransforms: [] };

  const originalDescription = input.description;
  const normalizedDescription = compactSummary(originalDescription);
  const normalizedInput = {
    ...input,
    description: normalizedDescription,
    content: mergeContent(input.content, originalDescription)
  };

  return {
    input: normalizedInput,
    fieldTransforms: [
      {
        field: 'description',
        action: 'downgrade_to_content',
        limit: PROJECT_DESCRIPTION_MAX_LENGTH,
        originalLength: limit.originalLength,
        normalizedLength: textLength(normalizedDescription),
        contentField: 'content',
        contentPreserved: true,
        message: 'Project.description exceeds Linear limit; wrote a short summary to description and preserved the full text in content.'
      }
    ]
  };
}
