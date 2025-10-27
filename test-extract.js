#!/usr/bin/env node

// Sample response from huly_query get mode (LMS-29)
const sampleResponse = `# LMS-29: Optimize MCP Tool Response Token Efficiency

**🔗 Issue URL**: http://nginx/workbench/agentspace/tracker/LMS-29

**Project**: Letta MCP Server
**Status**: backlog - Backlog - Not yet started
**Priority**: High
**Created**: 10/12/2025, 3:33:24 PM
**Modified**: 10/27/2025, 5:15:52 AM
**Comments**: 0
**Sub-issues**: 0

## Description

## Summary

Several MCP tools return excessively verbose responses consuming unnecessary tokens. This impacts:

- Context window utilization in calling agents
- API costs for token-based pricing
- Response latency due to larger payloads
- Agent awareness when responses are truncated

## Completed Optimizations ✅

### 1. list_llm_models

**Before**: 18+ fields per model (~18.8k tokens for 153 models)
**After**: 6 essential fields per model (~7.5k tokens)
**Reduction**: ~60% token savings

## Recent Comments

No comments yet.`;

// Extract full description from Huly issue detail response
function extractFullDescription(detailText) {
  const lines = detailText.split('\n');
  let inDescription = false;
  let description = [];

  // Top-level sections that mark the end of description
  const endSections = ['## Recent Comments', '## Sub-issues', '## Attachments'];

  for (const line of lines) {
    // Start capturing after ## Description header
    if (line.trim() === '## Description') {
      inDescription = true;
      continue;
    }

    // Stop at known end sections (not subsections within description)
    if (inDescription) {
      const trimmedLine = line.trim();
      if (endSections.some(section => trimmedLine === section)) {
        break;
      }
    }

    // Capture all description lines (including subsections like ## Summary, etc.)
    if (inDescription) {
      description.push(line);
    }
  }

  // Join and trim the description
  return description.join('\n').trim();
}

console.log('Testing description extraction...\n');

const extracted = extractFullDescription(sampleResponse);

console.log('Extracted description length:', extracted.length, 'characters');
console.log('\nExtracted content:');
console.log('---START---');
console.log(extracted);
console.log('---END---');

console.log('\n✓ Includes Summary?', extracted.includes('## Summary'));
console.log('✓ Includes Completed Optimizations?', extracted.includes('## Completed Optimizations'));
console.log('✓ Multi-line?', extracted.split('\n').length > 5);

if (extracted.length > 100 && extracted.includes('## Summary')) {
  console.log('\n✅ SUCCESS: Full description extracted!');
} else {
  console.log('\n❌ FAILED');
}
