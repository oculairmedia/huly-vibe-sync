def search_folder_passages(query: str, folder_id: str = "", limit: int = 10) -> list:
    """
    Search folder/source passages using semantic vector similarity.
    
    This tool searches through uploaded file passages in folders attached to agents.
    Use this to find relevant content from project documentation, code files, and other uploaded documents.
    
    Args:
        query: The search query text to find semantically similar passages
        folder_id: Optional folder/source ID to limit search (e.g., 'source-xxx'). If not provided, searches all folders.
        limit: Maximum number of results to return (default: 10, max: 50)
    
    Returns:
        list: List of matching passages with text, file_name, similarity score, and source_id
    """
    import os
    import json
    import requests
    import psycopg2
    from psycopg2.extras import RealDictCursor
    
    # Limit the results
    limit = min(limit, 50)
    
    # Get embedding for the query using Ollama
    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://192.168.50.80:11434")
    embedding_model = "dengcao/Qwen3-Embedding-4B:Q4_K_M"
    
    try:
        resp = requests.post(
            f"{ollama_url}/api/embeddings",
            json={"model": embedding_model, "prompt": query},
            timeout=30
        )
        resp.raise_for_status()
        embedding = resp.json().get("embedding", [])
    except Exception as e:
        return [{"error": f"Failed to generate embedding: {str(e)}"}]
    
    if not embedding:
        return [{"error": "Empty embedding returned"}]
    
    # Pad embedding to 4096 dimensions (Letta's MAX_EMBEDDING_DIM)
    if len(embedding) < 4096:
        embedding = embedding + [0.0] * (4096 - len(embedding))
    
    # Connect to Letta's PostgreSQL database
    db_uri = os.environ.get("LETTA_PG_URI", "postgresql://letta:letta@postgres:5432/letta")
    
    try:
        conn = psycopg2.connect(db_uri)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Build the query
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        
        if folder_id and folder_id != "":
            sql = """
                SELECT 
                    text,
                    file_name,
                    source_id,
                    1 - (embedding <=> %s::vector) as similarity
                FROM source_passages
                WHERE source_id = %s AND is_deleted = false
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """
            cur.execute(sql, (embedding_str, folder_id, embedding_str, limit))
        else:
            sql = """
                SELECT 
                    text,
                    file_name,
                    source_id,
                    1 - (embedding <=> %s::vector) as similarity
                FROM source_passages
                WHERE is_deleted = false
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """
            cur.execute(sql, (embedding_str, embedding_str, limit))
        
        results = cur.fetchall()
        cur.close()
        conn.close()
        
        # Format results
        formatted = []
        for row in results:
            formatted.append({
                "text": row["text"][:1000] if row["text"] else "",  # Truncate long text
                "file_name": row["file_name"],
                "source_id": row["source_id"],
                "similarity": round(float(row["similarity"]), 4)
            })
        
        return formatted
        
    except Exception as e:
        return [{"error": f"Database query failed: {str(e)}"}]
