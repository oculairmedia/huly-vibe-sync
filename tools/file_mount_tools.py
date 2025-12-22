"""
File Mounting Tools for Letta Agents

These tools allow agents to dynamically mount/unmount files for viewing and editing.
When a file is mounted, file-handling tools are attached to the agent's session.
When unmounted, those tools are detached to keep the agent's tool set clean.

Tools:
- look_at_file: Mount a file and view its contents
- unmount_file: Unmount a specific file and detach its tools  
- unmount_all_files: Unmount all files and detach all file tools
- list_mounted_files: Show currently mounted files
"""

# Session state - tracks mounted files per agent
# In production, this would be stored in Redis or the database
_mounted_files = {}  # agent_id -> {file_path: mount_info}


def look_at_file(file_path: str, start_line: int = 1, max_lines: int = 200) -> dict:
    """
    Mount and look at a file's contents. This attaches file-handling tools to your session
    so you can interact with the file.
    
    Use this when you need to examine code, documentation, or any file in your project.
    After calling this, you'll have access to tools for reading sections and editing.
    
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
    
    # Track mounted file
    if agent_id not in _mounted_files:
        _mounted_files[agent_id] = {}
    
    _mounted_files[agent_id][file_path] = {
        "full_path": full_path,
        "mode": result["mode"],
        "total_lines": result["total_lines"]
    }
    
    # Attach file-handling tools to the agent (only if not already attached)
    file_tools = ["read_file_section", "edit_file_content", "get_file_info"]
    attached = []
    
    if agent_id and letta_api_url:
        for tool_name in file_tools:
            try:
                # Check if tool exists
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
    
    # Count total mounted files
    mounted_count = len(_mounted_files.get(agent_id, {}))
    
    # Build instructions meta-prompt
    result["instructions"] = f"""
=== FILE MOUNTED: {file_path} ===
Mode: {result['mode']} | Lines {result['start_line']}-{result['end_line']} of {result['total_lines']} | Mounted files: {mounted_count}

AVAILABLE TOOLS:
• read_file_section("{file_path}", start_line, end_line) - Read more of this file
• edit_file_content("{file_path}", start_line, end_line, new_content) - Edit lines
• get_file_info("{file_path}") - Get file metadata
• unmount_file("{file_path}") - Unmount when done (detaches tools if no other files mounted)
• list_mounted_files() - See all currently mounted files

FILE CONTENT:
"""
    
    return result


def unmount_file(file_path: str) -> dict:
    """
    Unmount a file that was previously mounted with look_at_file.
    
    If this is the last mounted file, file-handling tools will be detached from your session.
    
    Args:
        file_path: Path to the file to unmount
    
    Returns:
        dict: Status of unmount operation
    """
    import os
    import requests
    
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    letta_api_url = os.environ.get("LETTA_API_URL", "http://192.168.50.90:8289")
    letta_api_key = os.environ.get("LETTA_API_KEY", "")
    
    # Normalize path
    if file_path.startswith("/"):
        file_path = file_path.lstrip("/")
    
    result = {
        "file_path": file_path,
        "unmounted": False,
        "tools_detached": [],
        "remaining_mounted": 0,
        "message": ""
    }
    
    # Check if file is mounted
    if agent_id not in _mounted_files or file_path not in _mounted_files[agent_id]:
        result["message"] = f"File '{file_path}' is not currently mounted."
        return result
    
    # Remove from mounted files
    del _mounted_files[agent_id][file_path]
    result["unmounted"] = True
    result["remaining_mounted"] = len(_mounted_files[agent_id])
    
    # If no more files mounted, detach file-handling tools
    if result["remaining_mounted"] == 0:
        file_tools = ["read_file_section", "edit_file_content", "get_file_info"]
        detached = []
        
        if agent_id and letta_api_url:
            for tool_name in file_tools:
                try:
                    # Find tool ID
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
                            # Detach tool from agent
                            detach_resp = requests.delete(
                                f"{letta_api_url}/v1/agents/{agent_id}/tools/{tool_id}",
                                headers={"Authorization": f"Bearer {letta_api_key}"},
                                timeout=10
                            )
                            if detach_resp.status_code in [200, 204]:
                                detached.append(tool_name)
                except Exception:
                    pass
        
        result["tools_detached"] = detached
        result["message"] = f"Unmounted '{file_path}'. All file tools detached (no files remain mounted)."
    else:
        result["message"] = f"Unmounted '{file_path}'. {result['remaining_mounted']} file(s) still mounted."
    
    return result


def unmount_all_files() -> dict:
    """
    Unmount all currently mounted files and detach all file-handling tools.
    
    Use this when you're done working with files and want to clean up your session.
    
    Returns:
        dict: Status of unmount operation
    """
    import os
    import requests
    
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    letta_api_url = os.environ.get("LETTA_API_URL", "http://192.168.50.90:8289")
    letta_api_key = os.environ.get("LETTA_API_KEY", "")
    
    result = {
        "files_unmounted": [],
        "tools_detached": [],
        "message": ""
    }
    
    # Get list of mounted files
    if agent_id in _mounted_files:
        result["files_unmounted"] = list(_mounted_files[agent_id].keys())
        _mounted_files[agent_id] = {}
    
    # Detach all file-handling tools
    file_tools = ["read_file_section", "edit_file_content", "get_file_info"]
    
    if agent_id and letta_api_url:
        for tool_name in file_tools:
            try:
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
                        detach_resp = requests.delete(
                            f"{letta_api_url}/v1/agents/{agent_id}/tools/{tool_id}",
                            headers={"Authorization": f"Bearer {letta_api_key}"},
                            timeout=10
                        )
                        if detach_resp.status_code in [200, 204]:
                            result["tools_detached"].append(tool_name)
            except Exception:
                pass
    
    count = len(result["files_unmounted"])
    result["message"] = f"Unmounted {count} file(s) and detached {len(result['tools_detached'])} tool(s)."
    
    return result


def list_mounted_files() -> dict:
    """
    List all files currently mounted in your session.
    
    Returns:
        dict: List of mounted files with their metadata
    """
    import os
    
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    
    result = {
        "mounted_files": [],
        "count": 0
    }
    
    if agent_id in _mounted_files:
        for file_path, info in _mounted_files[agent_id].items():
            result["mounted_files"].append({
                "file_path": file_path,
                "mode": info.get("mode", "unknown"),
                "total_lines": info.get("total_lines", 0)
            })
        result["count"] = len(result["mounted_files"])
    
    return result


# === FILE HANDLING TOOLS (attached when files are mounted) ===

def read_file_section(file_path: str, start_line: int, end_line: int) -> dict:
    """
    Read a specific section of a mounted file.
    
    Args:
        file_path: Path to the file
        start_line: First line to read (1-indexed)
        end_line: Last line to read (inclusive)
    
    Returns:
        dict: The requested lines with line numbers
    """
    import os
    import requests
    
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    project_root = os.environ.get("LETTA_PROJECT_ROOT", "")
    vibe_sync_url = os.environ.get("VIBE_SYNC_URL", "http://192.168.50.90:3099")
    
    # Normalize path
    if file_path.startswith("/"):
        file_path = file_path.lstrip("/")
    
    result = {
        "file_path": file_path,
        "start_line": start_line,
        "end_line": end_line,
        "content": "",
        "lines": []
    }
    
    # Check if file is mounted
    if agent_id in _mounted_files and file_path in _mounted_files[agent_id]:
        mount_info = _mounted_files[agent_id][file_path]
        
        if mount_info["mode"] == "local":
            full_path = mount_info.get("full_path")
            if full_path and os.path.isfile(full_path):
                try:
                    with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                        all_lines = f.readlines()
                    
                    start_idx = max(0, start_line - 1)
                    end_idx = min(len(all_lines), end_line)
                    
                    for i in range(start_idx, end_idx):
                        result["lines"].append({
                            "line_num": i + 1,
                            "content": all_lines[i].rstrip('\n\r')
                        })
                    
                    result["content"] = "".join(all_lines[start_idx:end_idx])
                    result["end_line"] = end_idx
                    
                except Exception as e:
                    result["error"] = str(e)
        
        elif mount_info["mode"] == "remote":
            try:
                resp = requests.post(
                    f"{vibe_sync_url}/api/files/read",
                    json={
                        "agent_id": agent_id,
                        "file_path": file_path,
                        "start_line": start_line,
                        "max_lines": end_line - start_line + 1
                    },
                    timeout=30
                )
                if resp.status_code == 200:
                    data = resp.json()
                    result["content"] = data.get("content", "")
                    result["end_line"] = data.get("end_line", end_line)
            except Exception as e:
                result["error"] = str(e)
    else:
        # Try to read anyway (file might be accessible but not formally mounted)
        full_path = os.path.join(project_root, file_path) if project_root else None
        if full_path and os.path.isfile(full_path):
            try:
                with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                    all_lines = f.readlines()
                
                start_idx = max(0, start_line - 1)
                end_idx = min(len(all_lines), end_line)
                result["content"] = "".join(all_lines[start_idx:end_idx])
                result["end_line"] = end_idx
            except Exception as e:
                result["error"] = str(e)
        else:
            result["error"] = f"File not mounted or not found: {file_path}"
    
    return result


def edit_file_content(file_path: str, start_line: int, end_line: int, new_content: str) -> dict:
    """
    Edit a section of a mounted file by replacing lines.
    
    Args:
        file_path: Path to the file
        start_line: First line to replace (1-indexed)
        end_line: Last line to replace (inclusive)
        new_content: New content to insert (can be multiple lines)
    
    Returns:
        dict: Status of the edit operation
    """
    import os
    import requests
    
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    project_root = os.environ.get("LETTA_PROJECT_ROOT", "")
    vibe_sync_url = os.environ.get("VIBE_SYNC_URL", "http://192.168.50.90:3099")
    
    # Normalize path
    if file_path.startswith("/"):
        file_path = file_path.lstrip("/")
    
    result = {
        "file_path": file_path,
        "start_line": start_line,
        "end_line": end_line,
        "success": False,
        "message": ""
    }
    
    # Check if file is mounted
    if agent_id not in _mounted_files or file_path not in _mounted_files[agent_id]:
        result["error"] = f"File not mounted: {file_path}. Use look_at_file() first."
        return result
    
    mount_info = _mounted_files[agent_id][file_path]
    
    if mount_info["mode"] == "local":
        full_path = mount_info.get("full_path")
        if full_path and os.path.isfile(full_path):
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    all_lines = f.readlines()
                
                # Ensure new_content ends with newline
                if new_content and not new_content.endswith('\n'):
                    new_content += '\n'
                
                # Replace the lines
                new_lines = new_content.splitlines(keepends=True)
                start_idx = max(0, start_line - 1)
                end_idx = min(len(all_lines), end_line)
                
                all_lines[start_idx:end_idx] = new_lines
                
                with open(full_path, 'w', encoding='utf-8') as f:
                    f.writelines(all_lines)
                
                # Update line count
                mount_info["total_lines"] = len(all_lines)
                
                result["success"] = True
                result["lines_removed"] = end_idx - start_idx
                result["lines_added"] = len(new_lines)
                result["new_total_lines"] = len(all_lines)
                result["message"] = f"Replaced lines {start_line}-{end_line} with {len(new_lines)} new line(s)."
                
            except Exception as e:
                result["error"] = str(e)
    
    elif mount_info["mode"] == "remote":
        try:
            resp = requests.post(
                f"{vibe_sync_url}/api/files/edit",
                json={
                    "agent_id": agent_id,
                    "file_path": file_path,
                    "start_line": start_line,
                    "end_line": end_line,
                    "new_content": new_content
                },
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                result["success"] = data.get("success", False)
                result["message"] = data.get("message", "Edit submitted to remote server.")
            else:
                result["error"] = f"Remote edit failed: {resp.status_code}"
        except Exception as e:
            result["error"] = str(e)
    
    return result


def get_file_info(file_path: str) -> dict:
    """
    Get metadata about a file (size, modified date, line count, etc.)
    
    Args:
        file_path: Path to the file
    
    Returns:
        dict: File metadata
    """
    import os
    from datetime import datetime
    
    agent_id = os.environ.get("LETTA_AGENT_ID", "")
    project_root = os.environ.get("LETTA_PROJECT_ROOT", "")
    
    # Normalize path
    if file_path.startswith("/"):
        file_path = file_path.lstrip("/")
    
    result = {
        "file_path": file_path,
        "exists": False,
        "mounted": False
    }
    
    # Check if mounted
    if agent_id in _mounted_files and file_path in _mounted_files[agent_id]:
        result["mounted"] = True
        mount_info = _mounted_files[agent_id][file_path]
        result["total_lines"] = mount_info.get("total_lines", 0)
        result["mode"] = mount_info.get("mode", "unknown")
    
    # Get file stats if local
    full_path = os.path.join(project_root, file_path) if project_root else None
    if full_path and os.path.isfile(full_path):
        try:
            stat = os.stat(full_path)
            result["exists"] = True
            result["size_bytes"] = stat.st_size
            result["modified"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
            result["created"] = datetime.fromtimestamp(stat.st_ctime).isoformat()
            
            # Count lines if not already known
            if "total_lines" not in result:
                with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                    result["total_lines"] = sum(1 for _ in f)
            
            # Detect file type
            ext = os.path.splitext(file_path)[1].lower()
            result["extension"] = ext
            
        except Exception as e:
            result["error"] = str(e)
    
    return result
