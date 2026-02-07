/**
 * Huly Identifier Parser - Extract Huly identifiers and descriptions
 */

/**
 * Extract Huly identifier from description text
 * Looks for patterns like "Huly Issue: PROJECT-123" or "Synced from Huly: PROJECT-123"
 *
 * @param {string} description - The description text to search
 * @returns {string|null} The Huly identifier (e.g., "PROJECT-123") or null
 */
export function extractHulyIdentifier(description) {
  if (!description) {
    return null;
  }

  const patterns = [/Huly Issue:\s*([A-Z]+-\d+)/i, /Synced from Huly:\s*([A-Z]+-\d+)/i];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (!match) {
      continue;
    }

    const identifier = match[1].trim();
    if (/^[A-Z]+-\d+$/.test(identifier)) {
      return identifier;
    }
  }

  return null;
}

/**
 * Extract Huly parent identifier metadata from description text.
 * Looks for "Huly Parent: PROJECT-123" and supports explicit top-level markers.
 *
 * @param {string} description - The description text to search
 * @returns {string|null|undefined}
 *   - string: parsed parent identifier
 *   - null: explicitly marked as top-level/no parent
 *   - undefined: no parent metadata found
 */
export function extractHulyParentIdentifier(description) {
  if (!description) {
    return undefined;
  }

  const match = description.match(
    /(?:Huly Parent(?: Issue)?|Parent Huly Issue):\s*([A-Z]+-\d+|none|null|top-?level)/i
  );

  if (!match) {
    return undefined;
  }

  const value = match[1].trim();
  if (/^(none|null|top-?level)$/i.test(value)) {
    return null;
  }

  const identifier = value.toUpperCase();
  if (/^[A-Z]+-\d+$/.test(identifier)) {
    return identifier;
  }

  return undefined;
}

/**
 * @deprecated Use extractHulyIdentifier instead
 */
export const extractHulyIdentifierFromDescription = extractHulyIdentifier;

/**
 * Extract full description from Huly issue detail response
 *
 * @param {string} detailText - The issue detail text to parse
 * @returns {string} The extracted description
 */
export function extractFullDescription(detailText) {
  const lines = detailText.split('\n');
  let inDescription = false;
  const description = [];

  const endSections = ['## Recent Comments', '## Sub-issues', '## Attachments'];

  for (const line of lines) {
    if (line.trim() === '## Description') {
      inDescription = true;
      continue;
    }

    if (inDescription) {
      const trimmedLine = line.trim();
      if (endSections.some(section => trimmedLine === section)) {
        break;
      }
    }

    if (inDescription) {
      description.push(line);
    }
  }

  return description.join('\n').trim();
}
