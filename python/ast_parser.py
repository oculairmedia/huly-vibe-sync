#!/usr/bin/env python3
"""
AST Parser Service for Code Perception

Extracts function definitions from source code files using Tree-sitter.
Designed to be called as a subprocess from Node.js.

Usage:
    python ast_parser.py <file_path>
    python ast_parser.py --batch < file_list.json

Output:
    JSON array of function definitions to stdout
"""

import json
import sys
import os
from typing import Optional

# Tree-sitter imports
try:
    from tree_sitter import Language, Parser
    import tree_sitter_python as ts_python
    import tree_sitter_javascript as ts_javascript
    import tree_sitter_typescript as ts_typescript
except ImportError as e:
    print(json.dumps({
        "error": f"Missing dependency: {e}. Run: pip install tree-sitter tree-sitter-python tree-sitter-javascript tree-sitter-typescript"
    }), file=sys.stderr)
    sys.exit(1)


# Language instances (lazy loaded)
_languages = {}


def get_language(lang_name: str) -> Optional[Language]:
    """Get Tree-sitter language instance."""
    if lang_name not in _languages:
        if lang_name == "python":
            _languages[lang_name] = Language(ts_python.language())
        elif lang_name == "javascript":
            _languages[lang_name] = Language(ts_javascript.language())
        elif lang_name == "typescript":
            _languages[lang_name] = Language(ts_typescript.language_typescript())
        elif lang_name == "tsx":
            _languages[lang_name] = Language(ts_typescript.language_tsx())
        else:
            return None
    return _languages[lang_name]


def detect_language(file_path: str) -> Optional[str]:
    """Detect language from file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    
    language_map = {
        ".py": "python",
        ".pyw": "python",
        ".js": "javascript",
        ".mjs": "javascript",
        ".cjs": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".mts": "typescript",
        ".cts": "typescript",
        ".tsx": "tsx",
    }
    
    return language_map.get(ext)


def extract_python_functions(source_code: str, tree, language: Language) -> list:
    """Extract function definitions from Python source code."""
    functions = []
    
    def get_text(node) -> str:
        """Get source text for a node."""
        return source_code[node.start_byte:node.end_byte]
    
    def extract_docstring(block_node) -> Optional[str]:
        """Extract docstring from function body."""
        if block_node.child_count == 0:
            return None
        
        first_child = block_node.child(0)
        if first_child.type == "expression_statement" and first_child.child_count > 0:
            string_node = first_child.child(0)
            if string_node.type == "string":
                docstring = get_text(string_node)
                # Strip quotes
                for quote in ['"""', "'''", '"', "'"]:
                    if docstring.startswith(quote) and docstring.endswith(quote):
                        docstring = docstring[len(quote):-len(quote)]
                        break
                return docstring.strip()
        return None
    
    def extract_return_type(node) -> Optional[str]:
        """Extract return type annotation."""
        for child in node.children:
            if child.type == "type":
                return get_text(child)
        return None
    
    def find_functions(node, is_top_level: bool = True):
        """Recursively find function definitions (top-level only for v1)."""
        if node.type == "function_definition":
            func_name = None
            params = None
            return_type = None
            docstring = None
            decorators = []
            
            # Check for decorators (previous siblings)
            if node.prev_sibling and node.prev_sibling.type == "decorator":
                current = node.prev_sibling
                while current and current.type == "decorator":
                    decorators.insert(0, get_text(current))
                    current = current.prev_sibling
            
            for child in node.children:
                if child.type == "identifier":
                    func_name = get_text(child)
                elif child.type == "parameters":
                    params = get_text(child)
                elif child.type == "type":
                    return_type = get_text(child)
                elif child.type == "block":
                    docstring = extract_docstring(child)
            
            if func_name and not func_name.startswith("_"):  # Skip private functions for now
                # Build signature
                signature = f"def {func_name}{params or '()'}"
                if return_type:
                    signature += f" -> {return_type}"
                
                functions.append({
                    "name": func_name,
                    "signature": signature,
                    "parameters": params or "()",
                    "return_type": return_type,
                    "docstring": docstring,
                    "decorators": decorators,
                    "start_line": node.start_point[0] + 1,
                    "end_line": node.end_point[0] + 1,
                    "is_async": any(c.type == "async" for c in node.children),
                })
            
            # Don't recurse into nested functions for v1
            return
        
        # Only process top-level for v1
        if is_top_level:
            for child in node.children:
                # Skip class bodies for v1
                if child.type != "class_definition":
                    find_functions(child, is_top_level=True)
    
    find_functions(tree.root_node)
    return functions


def extract_js_functions(source_code: str, tree, language: Language) -> list:
    """Extract function definitions from JavaScript/TypeScript source code."""
    functions = []
    
    def get_text(node) -> str:
        """Get source text for a node."""
        return source_code[node.start_byte:node.end_byte]
    
    # First pass: collect all comments for JSDoc
    comments = {}
    
    def collect_comments(node):
        if node.type == "comment":
            text = get_text(node).strip()
            if text.startswith("/**"):  # JSDoc
                comments[node.end_point[0]] = text
        for i in range(node.child_count):
            collect_comments(node.child(i))
    
    collect_comments(tree.root_node)
    
    def find_jsdoc(func_node) -> Optional[str]:
        """Find JSDoc comment for a function."""
        func_line = func_node.start_point[0]
        # Look for JSDoc ending within 2 lines before function
        for line in range(func_line - 1, func_line - 3, -1):
            if line in comments:
                return comments[line]
        return None
    
    def extract_function_info(node, name_hint: Optional[str] = None) -> Optional[dict]:
        """Extract function info from a function node."""
        func_name = name_hint
        params = None
        return_type = None
        is_async = False
        is_generator = False
        
        for child in node.children:
            if child.type in ("identifier", "property_identifier"):
                func_name = get_text(child)
            elif child.type == "formal_parameters":
                params = get_text(child)
            elif child.type == "type_annotation":
                return_type = get_text(child).lstrip(": ")
            elif child.type == "async":
                is_async = True
            elif child.type == "*":
                is_generator = True
        
        if not func_name:
            return None
        
        # Skip private and internal functions
        if func_name.startswith("_"):
            return None
        
        # Build signature
        prefix = ""
        if is_async:
            prefix = "async "
        if is_generator:
            prefix += "function* "
        else:
            prefix += "function "
        
        signature = f"{prefix}{func_name}{params or '()'}"
        if return_type:
            signature += f": {return_type}"
        
        jsdoc = find_jsdoc(node)
        
        return {
            "name": func_name,
            "signature": signature,
            "parameters": params or "()",
            "return_type": return_type,
            "docstring": jsdoc,
            "decorators": [],
            "start_line": node.start_point[0] + 1,
            "end_line": node.end_point[0] + 1,
            "is_async": is_async,
            "is_generator": is_generator,
        }
    
    def find_functions(node, is_top_level: bool = True):
        """Recursively find function definitions."""
        
        # Function declaration: function foo() {}
        if node.type == "function_declaration":
            info = extract_function_info(node)
            if info:
                functions.append(info)
            return
        
        # Arrow function in variable declaration: const foo = () => {}
        if node.type == "lexical_declaration" or node.type == "variable_declaration":
            for child in node.children:
                if child.type == "variable_declarator":
                    name_node = child.child_by_field_name("name")
                    value_node = child.child_by_field_name("value")
                    
                    if name_node and value_node:
                        name = get_text(name_node)
                        if value_node.type in ("arrow_function", "function_expression"):
                            info = extract_function_info(value_node, name_hint=name)
                            if info:
                                # Adjust signature for arrow functions
                                if value_node.type == "arrow_function":
                                    params = info["parameters"]
                                    ret = f": {info['return_type']}" if info["return_type"] else ""
                                    prefix = "async " if info["is_async"] else ""
                                    info["signature"] = f"const {name} = {prefix}{params} =>{ret}"
                                functions.append(info)
            return
        
        # Export declarations
        if node.type == "export_statement":
            for child in node.children:
                find_functions(child, is_top_level=True)
            return
        
        # Only process top-level for v1
        if is_top_level:
            for i in range(node.child_count):
                child = node.child(i)
                # Skip class bodies for v1
                if child.type != "class_declaration" and child.type != "class":
                    find_functions(child, is_top_level=True)
    
    find_functions(tree.root_node)
    return functions


def parse_file(file_path: str) -> dict:
    """Parse a file and extract functions."""
    result = {
        "file": file_path,
        "language": None,
        "functions": [],
        "error": None,
    }
    
    # Detect language
    language_name = detect_language(file_path)
    if not language_name:
        result["error"] = f"Unsupported file type: {file_path}"
        return result
    
    result["language"] = language_name
    
    # Get language instance
    language = get_language(language_name)
    if not language:
        result["error"] = f"Failed to load language: {language_name}"
        return result
    
    # Read file
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            source_code = f.read()
    except Exception as e:
        result["error"] = f"Failed to read file: {e}"
        return result
    
    # Check file size (skip files > 1MB)
    if len(source_code) > 1_000_000:
        result["error"] = "File too large (> 1MB)"
        return result
    
    # Parse
    try:
        parser = Parser(language)
        tree = parser.parse(bytes(source_code, "utf-8"))
    except Exception as e:
        result["error"] = f"Parse error: {e}"
        return result
    
    # Extract functions based on language
    try:
        if language_name == "python":
            result["functions"] = extract_python_functions(source_code, tree, language)
        elif language_name in ("javascript", "typescript", "tsx"):
            result["functions"] = extract_js_functions(source_code, tree, language)
    except Exception as e:
        result["error"] = f"Extraction error: {e}"
        return result
    
    return result


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ast_parser.py <file_path> or ast_parser.py --batch"}))
        sys.exit(1)
    
    if sys.argv[1] == "--batch":
        # Batch mode: read file paths from stdin as JSON array
        try:
            file_paths = json.load(sys.stdin)
            results = [parse_file(fp) for fp in file_paths]
            print(json.dumps(results))
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON input: {e}"}))
            sys.exit(1)
    else:
        # Single file mode
        file_path = sys.argv[1]
        result = parse_file(file_path)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
