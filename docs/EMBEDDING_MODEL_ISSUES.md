# Embedding Model Issues

## Summary

During testing, we encountered issues with different embedding providers on the Letta server:

### Google AI Embeddings (`google_ai/embedding-001`)
- **Error**: `404 Not Found`
- **Cause**: Google AI API key not configured or invalid on Letta server
- **Status**: Not usable

### OpenAI Embeddings (`openai/text-embedding-3-small`)
- **Error**: `429 Quota Exceeded`
- **Cause**: OpenAI API quota limit reached on Letta server
- **Status**: Not usable (quota issue)

### Letta Free Embeddings (`letta/letta-free`)
- **Status**: ✅ **Working** - Using this as default
- **Model**: OpenAI-compatible embeddings via Letta's free tier
- **Endpoint**: `https://embeddings.letta.com/`

## Current Configuration

We're using `letta/letta-free` as the default embedding model for all agents and folders.

### Environment Variable
```bash
LETTA_EMBEDDING=letta/letta-free
```

### Code Default
```javascript
this.embedding = options.embedding || process.env.LETTA_EMBEDDING || 'letta/letta-free';
```

## Impact on File Processing

With working embeddings, uploaded files will be:
1. **Chunked** - Split into manageable pieces
2. **Embedded** - Converted to vector embeddings
3. **Searchable** - Available for semantic search by the agent

Without working embeddings (404 or 429 errors), files are uploaded but not indexed for search.

## Recommendations

### Short-term
✅ Use `letta/letta-free` - Works reliably for development

### Long-term
Consider configuring your own embedding service:
1. **OpenAI** - Add API key with sufficient quota
2. **Google AI** - Configure Google AI API credentials
3. **Local embeddings** - Self-host embedding model (e.g., sentence-transformers)

## Server Configuration

To fix embedding issues on the Letta server:

### OpenAI Quota
```bash
# Check OpenAI API key and quota
export OPENAI_API_KEY="sk-..."
# Upgrade plan or add credits at https://platform.openai.com/account/billing
```

### Google AI Setup
```bash
# Configure Google AI API key
export GOOGLE_AI_API_KEY="..."
```

## Related Files
- `.env` - Embedding configuration
- `lib/LettaService.js` - Embedding defaults
- `SYSTEM_ENGINEERING_REVIEW_LETTA_INTEGRATION.md` - Architecture review
