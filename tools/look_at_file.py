def look_at_file(file_path: str, start_line: int = 1, max_lines: int = 200) -> dict:
    """
    Mount and look at a file's contents. This attaches file-handling tools to your session
    so you can interact with the file.
    
    Use this when you need to examine code, documentation, or any file in your project.
    After calling this, you'll have access to additional tools for reading and editing.
    
    Args:
        file_path: Path to the file (relative to project root, e.g., "src/main.rs")
        start_line: Line number to start reading from (default: 1)
        max_lines: Maximum number of lines to return (default: 200, max: 500)
    
    Returns:
        dict: File content, metadata, and instructions for using attached tools
    """
    import os
    import json
    import requests
    
    max_lines = min(max_lines, 500)
    
    # Get project context from environment
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    project_root = os.environ.get("LETTA_PROJECT_ROOT", "")
    letta_api_url = os.environ.get("LETTA_API_URL", "http://192.168.50.90:8289")
    letta_api_key = os.environ.get("LETTA_API_KEY", "")
    vibe_sync_url = os.environ.get("VIBE_SYNC_URL", "http://192.168.50.90:3099")
    
    result = {
        "file_path": file_path,
        "mounted": False,
        "content": None,
        "total_lines": 0,
        "start_line": start_line,
        "end_line": 0,
        "mode": "unknown",
        "tools_attached": [],
        "instructions": ""
    }
    
    # Normalize file path
    if file_path.startswith("/"):
        file_path = file_path.lstrip("/")
    
    # Try local filesystem first
    full_path = None
    if project_root and os.path.isdir(project_root):
        full_path = os.path.join(project_root, file_path)
        if os.path.isfile(full_path):
            result["mode"] = "local"
    
    # If not local, try remote via vibe-sync API
    if result["mode"] == "unknown" and vibe_sync_url:
        try:
            resp = requests.post(
                f"{vibe_sync_url}/api/files/read",
                json={
                    "agent_id": agent_id,
                    "file_path": file_path,
                    "start_line": start_line,
                    "max_lines": max_lines
                },
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                result["mode"] = "remote"
                result["content"] = data.get("content", "")
                result["total_lines"] = data.get("total_lines", 0)
                result["end_line"] = data.get("end_line", 0)
                result["mounted"] = True
        except Exception as e:
            result["remote_error"] = str(e)
    
    # Read local file if available
    if result["mode"] == "local" and full_path:
        try:
            with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                all_lines = f.readlines()
            
            result["total_lines"] = len(all_lines)
            
            # Extract requested line range
            start_idx = max(0, start_line - 1)
            end_idx = min(len(all_lines), start_idx + max_lines)
            
            selected_lines = all_lines[start_idx:end_idx]
            result["content"] = "".join(selected_lines)
            result["start_line"] = start_idx + 1
            result["end_line"] = end_idx
            result["mounted"] = True
            
        except Exception as e:
            result["error"] = f"Failed to read file: {str(e)}"
            return result
    
    # If still no content, file not found
    if not result["mounted"]:
        result["error"] = f"File not found: {file_path}"
        result["instructions"] = "The file could not be located. Check the path and try again."
        return result
    
    # Attach file-handling tools to the agent
    tools_to_attach = ["read_file_section", "edit_file_content", "get_file_info"]
    attached = []
    
    if agent_id and letta_api_url:
        for tool_name in tools_to_attach:
            try:
                # Check if tool exists and attach to agent
                resp = requests.get(
                    f"{letta_api_url}/v1/tools",
                    params={"name": tool_name},
                    headers={"Authorization": f"Bearer {letta_api_key}"},
                    timeout=10
                )
                if resp.status_code == 200:
                    tools = resp.json()
                    if tools:
                        tool_id = tools[0].get("id")
                        # Attach tool to agent
                        attach_resp = requests.post(
                            f"{letta_api_url}/v1/agents/{agent_id}/tools/{tool_id}",
                            headers={"Authorization": f"Bearer {letta_api_key}"},
                            timeout=10
                        )
                        if attach_resp.status_code in [200, 201]:
                            attached.append(tool_name)
            except Exception:
                pass
    
    result["tools_attached"] = attached
    
    # Build instructions meta-prompt
    result["instructions"] = f"""
=== FILE MOUNTED: {file_path} ===

You are now viewing lines {result['start_line']}-{result['end_line']} of {result['total_lines']} total lines.

AVAILABLE ACTIONS:
- read_file_section(file_path, start_line, end_line) - Read a specific section of this or another file
- edit_file_content(file_path, start_line, end_line, new_content) - Replace lines in the file
- get_file_info(file_path) - Get file metadata (size, modified date, etc.)

To see more of this file, call read_file_section("{file_path}", {result['end_line'] + 1}, {result['end_line'] + 100})

The file content follows below:
---
"""
    
    return result
