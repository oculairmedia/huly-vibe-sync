def search_folder_passages(query: str, folder_id: str = "", limit: int = 10, mount: bool = False) -> list:
    """
    Search folder/source passages using semantic vector similarity.
    
    This tool searches through uploaded file passages in folders attached to agents.
    Use this to find relevant content from project documentation, code files, and other uploaded documents.
    
    Args:
        query: The search query text to find semantically similar passages
        folder_id: Optional folder/source ID to limit search (e.g., 'source-xxx'). 
                   If not provided, automatically uses folders attached to the current agent.
        limit: Maximum number of results to return (default: 10, max: 50)
        mount: If True, also mount the files found so you can interact with them using
               file tools (read_file_section, edit_file_content, etc.)
    
    Returns:
        list: List of matching passages with text, file_name, similarity score, and source_id.
              If mount=True, also includes instructions for using file tools.
    """
    import os
    import json
    import requests
    import psycopg2
    from psycopg2.extras import RealDictCursor
    
    # Limit the results
    limit = min(limit, 50)
    
    # Get agent ID from environment (set by Letta when executing tool)
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    
    # Connect to Letta's PostgreSQL database
    db_uri = os.environ.get("LETTA_PG_URI", "postgresql://letta:letta@postgres:5432/letta")
    
    # If no folder_id provided, look up folders attached to this agent
    effective_folder_ids = []
    if folder_id and folder_id != "":
        effective_folder_ids = [folder_id]
    elif agent_id:
        try:
            conn = psycopg2.connect(db_uri)
            cur = conn.cursor()
            # Query the sources_agents junction table to find attached folders
            cur.execute(
                "SELECT source_id FROM sources_agents WHERE agent_id = %s",
                (agent_id,)
            )
            rows = cur.fetchall()
            effective_folder_ids = [row[0] for row in rows]
            cur.close()
            conn.close()
        except Exception as e:
            # If lookup fails, fall back to searching all folders
            effective_folder_ids = []
    
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
    
    try:
        conn = psycopg2.connect(db_uri)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Build the query
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        
        if effective_folder_ids:
            # Search within specific folder(s)
            placeholders = ",".join(["%s"] * len(effective_folder_ids))
            sql = f"""
                SELECT 
                    text,
                    file_name,
                    source_id,
                    1 - (embedding <=> %s::vector) as similarity
                FROM source_passages
                WHERE source_id IN ({placeholders}) AND is_deleted = false
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """
            params = [embedding_str] + effective_folder_ids + [embedding_str, limit]
            cur.execute(sql, params)
        else:
            # Search all folders (no agent context or no folders attached)
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
        unique_files = set()
        
        for row in results:
            file_name = row["file_name"]
            if file_name:
                unique_files.add(file_name)
            formatted.append({
                "text": row["text"][:1000] if row["text"] else "",  # Truncate long text
                "file_name": file_name,
                "source_id": row["source_id"],
                "similarity": round(float(row["similarity"]), 4)
            })
        
        # Add context about what was searched
        if formatted:
            if effective_folder_ids:
                formatted.insert(0, {"_search_context": f"Searched {len(effective_folder_ids)} folder(s) for agent {agent_id[:20]}..." if agent_id else f"Searched folder {effective_folder_ids[0]}"})
            else:
                formatted.insert(0, {"_search_context": "Searched all folders (no agent context)"})
        
        # If mount=True, add instructions for mounting the found files
        if mount and unique_files:
            mount_instructions = {
                "_mount_instructions": f"Found {len(unique_files)} unique file(s). To interact with these files, use look_at_file() with the file_name paths shown in the results.",
                "_files_to_mount": list(unique_files)[:10]  # Limit to first 10 files
            }
            formatted.append(mount_instructions)
        
        return formatted
        
    except Exception as e:
        return [{"error": f"Database query failed: {str(e)}"}]
