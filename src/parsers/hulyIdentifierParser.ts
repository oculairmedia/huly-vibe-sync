export function extractHulyIdentifier(description: string | null | undefined): string | null {
  if (!description) {
    return null;
  }

  const patterns = [/Huly Issue:\s*([A-Z]+-\d+)/i, /Synced from Huly:\s*([A-Z]+-\d+)/i];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (!match) {
      continue;
    }

    const identifier = match[1]!.trim();
    if (/^[A-Z]+-\d+$/.test(identifier)) {
      return identifier;
    }
  }

  return null;
}

export function extractHulyParentIdentifier(description: string | null | undefined): string | null | undefined {
  if (!description) {
    return undefined;
  }

  const match = description.match(
    /(?:Huly Parent(?: Issue)?|Parent Huly Issue):\s*([A-Z]+-\d+|none|null|top-?level)/i,
  );

  if (!match) {
    return undefined;
  }

  const value = match[1]!.trim();
  if (/^(none|null|top-?level)$/i.test(value)) {
    return null;
  }

  const identifier = value.toUpperCase();
  if (/^[A-Z]+-\d+$/.test(identifier)) {
    return identifier;
  }

  return undefined;
}

export const extractHulyIdentifierFromDescription = extractHulyIdentifier;

export function extractFullDescription(detailText: string): string {
  const lines = detailText.split('\n');
  let inDescription = false;
  const description: string[] = [];

  const endSections = ['## Recent Comments', '## Sub-issues', '## Attachments'];

  for (const line of lines) {
    if (line.trim() === '## Description') {
      inDescription = true;
      continue;
    }

    if (inDescription) {
      const trimmedLine = line.trim();
      if (endSections.some((section) => trimmedLine === section)) {
        break;
      }
    }

    if (inDescription) {
      description.push(line);
    }
  }

  return description.join('\n').trim();
}
