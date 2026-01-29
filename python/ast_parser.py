#!/usr/bin/env python3
"""
AST Parser Service for Code Perception

Extracts function definitions, imports, classes, and exports from source code
files using Tree-sitter. Designed to be called as a subprocess from Node.js.

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


# ---------------------------------------------------------------------------
# Python extraction
# ---------------------------------------------------------------------------

def extract_python_imports(source_code: str, tree) -> list:
    """Extract import statements from Python source code."""
    imports = []

    def get_text(node) -> str:
        return source_code[node.start_byte:node.end_byte]

    def walk_imports(node):
        if node.type == "import_statement":
            # import X  /  import X as Y
            for child in node.children:
                if child.type == "dotted_name":
                    imports.append({
                        "module": get_text(child),
                        "names": None,
                        "alias": None,
                        "is_from": False,
                        "line": node.start_point[0] + 1,
                    })
                elif child.type == "aliased_import":
                    mod_node = None
                    alias_node = None
                    for ac in child.children:
                        if ac.type == "dotted_name":
                            mod_node = ac
                        elif ac.type == "identifier" and mod_node is not None:
                            alias_node = ac
                    if mod_node:
                        imports.append({
                            "module": get_text(mod_node),
                            "names": None,
                            "alias": get_text(alias_node) if alias_node else None,
                            "is_from": False,
                            "line": node.start_point[0] + 1,
                        })
        elif node.type == "import_from_statement":
            # from X import Y, Z
            module_name = None
            names = []
            found_import_keyword = False
            for child in node.children:
                if child.type == "import":
                    found_import_keyword = True
                elif child.type == "dotted_name" and not found_import_keyword:
                    module_name = get_text(child)
                elif child.type == "relative_import":
                    module_name = get_text(child)
                elif child.type in ("dotted_name", "identifier") and found_import_keyword:
                    names.append(get_text(child))
                elif child.type == "aliased_import":
                    for ac in child.children:
                        if ac.type in ("dotted_name", "identifier"):
                            names.append(get_text(ac))
                            break
                elif child.type == "wildcard_import":
                    names.append("*")
            if module_name is not None:
                imports.append({
                    "module": module_name,
                    "names": names if names else None,
                    "alias": None,
                    "is_from": True,
                    "line": node.start_point[0] + 1,
                })
        else:
            for i in range(node.child_count):
                walk_imports(node.child(i))

    walk_imports(tree.root_node)
    return imports


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


def extract_python_classes(source_code: str, tree) -> list:
    """Extract class definitions with their methods from Python source code."""
    classes = []

    def get_text(node) -> str:
        return source_code[node.start_byte:node.end_byte]

    def extract_docstring(block_node) -> Optional[str]:
        """Extract docstring from a block node."""
        if block_node.child_count == 0:
            return None
        first_child = block_node.child(0)
        if first_child.type == "expression_statement" and first_child.child_count > 0:
            string_node = first_child.child(0)
            if string_node.type == "string":
                docstring = get_text(string_node)
                for quote in ['"""', "'''", '"', "'"]:
                    if docstring.startswith(quote) and docstring.endswith(quote):
                        docstring = docstring[len(quote):-len(quote)]
                        break
                return docstring.strip()
        return None

    def extract_method(node, decorators=None):
        """Extract a single method from a function_definition node."""
        func_name = None
        params = None
        return_type = None
        docstring = None
        is_async = False

        for child in node.children:
            if child.type == "identifier":
                func_name = get_text(child)
            elif child.type == "parameters":
                params = get_text(child)
            elif child.type == "type":
                return_type = get_text(child)
            elif child.type == "block":
                docstring = extract_docstring(child)

        is_async = any(c.type == "async" for c in node.children)

        decorators = decorators or []
        is_static = any("@staticmethod" in d or "@classmethod" in d for d in decorators)
        is_private = func_name.startswith("_") if func_name else False

        signature = f"def {func_name}{params or '()'}"
        if return_type:
            signature += f" -> {return_type}"

        return {
            "name": func_name,
            "signature": signature,
            "parameters": params or "()",
            "return_type": return_type,
            "docstring": docstring,
            "is_async": is_async,
            "is_static": is_static,
            "is_private": is_private,
            "start_line": node.start_point[0] + 1,
            "end_line": node.end_point[0] + 1,
        }

    def extract_class(node, class_decorators=None):
        """Extract a class definition including all its methods."""
        class_name = None
        superclass = None
        methods = []

        for child in node.children:
            if child.type == "identifier":
                class_name = get_text(child)
            elif child.type == "argument_list":
                # Superclass(es) — take the first one
                for arg in child.children:
                    if arg.type in ("identifier", "attribute"):
                        superclass = get_text(arg)
                        break
            elif child.type == "block":
                for body_child in child.children:
                    if body_child.type == "function_definition":
                        methods.append(extract_method(body_child))
                    elif body_child.type == "decorated_definition":
                        method_decorators = []
                        func_node = None
                        for dc in body_child.children:
                            if dc.type == "decorator":
                                method_decorators.append(get_text(dc))
                            elif dc.type == "function_definition":
                                func_node = dc
                        if func_node:
                            methods.append(extract_method(func_node, method_decorators))

        if class_name:
            classes.append({
                "name": class_name,
                "superclass": superclass,
                "decorators": class_decorators or [],
                "methods": methods,
                "start_line": node.start_point[0] + 1,
                "end_line": node.end_point[0] + 1,
            })

    def find_classes(node):
        """Walk root-level children looking for class definitions."""
        for child in node.children:
            if child.type == "class_definition":
                extract_class(child)
            elif child.type == "decorated_definition":
                decorators = []
                class_node = None
                for dc in child.children:
                    if dc.type == "decorator":
                        decorators.append(get_text(dc))
                    elif dc.type == "class_definition":
                        class_node = dc
                if class_node:
                    extract_class(class_node, decorators)

    find_classes(tree.root_node)
    return classes


# ---------------------------------------------------------------------------
# JavaScript / TypeScript extraction
# ---------------------------------------------------------------------------

def extract_js_imports(source_code: str, tree) -> list:
    """Extract import statements from JavaScript/TypeScript source code."""
    imports = []

    def get_text(node) -> str:
        return source_code[node.start_byte:node.end_byte]

    def walk_imports(node):
        if node.type == "import_statement":
            source = None
            specifiers = []
            default_import = None

            for child in node.children:
                if child.type == "string":
                    source = get_text(child).strip("'\"`")
                elif child.type == "import_clause":
                    for clause_child in child.children:
                        if clause_child.type == "identifier":
                            default_import = get_text(clause_child)
                        elif clause_child.type == "named_imports":
                            for spec in clause_child.children:
                                if spec.type == "import_specifier":
                                    name_node = spec.child_by_field_name("name")
                                    if name_node:
                                        specifiers.append(get_text(name_node))
                                    else:
                                        for sc in spec.children:
                                            if sc.type == "identifier":
                                                specifiers.append(get_text(sc))
                                                break
                        elif clause_child.type == "namespace_import":
                            # import * as X from ...
                            for ns_child in clause_child.children:
                                if ns_child.type == "identifier":
                                    default_import = f"* as {get_text(ns_child)}"
                                    break

            if source is not None:
                imports.append({
                    "source": source,
                    "specifiers": specifiers,
                    "default": default_import,
                    "line": node.start_point[0] + 1,
                })
        else:
            for i in range(node.child_count):
                walk_imports(node.child(i))

    walk_imports(tree.root_node)
    return imports


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


def extract_js_classes(source_code: str, tree) -> list:
    """Extract class definitions with their methods from JS/TS source code."""
    classes = []

    def get_text(node) -> str:
        return source_code[node.start_byte:node.end_byte]

    # Collect JSDoc comments for method docstrings
    comments = {}

    def collect_comments(node):
        if node.type == "comment":
            text = get_text(node).strip()
            if text.startswith("/**"):
                comments[node.end_point[0]] = text
        for i in range(node.child_count):
            collect_comments(node.child(i))

    collect_comments(tree.root_node)

    def find_jsdoc(target_node) -> Optional[str]:
        line = target_node.start_point[0]
        for check in range(line - 1, line - 3, -1):
            if check in comments:
                return comments[check]
        return None

    def extract_method(node):
        """Extract a single method from a method_definition node."""
        func_name = None
        params = None
        return_type = None
        is_async = False
        is_static = False

        for child in node.children:
            if child.type in ("identifier", "property_identifier"):
                func_name = get_text(child)
            elif child.type == "formal_parameters":
                params = get_text(child)
            elif child.type == "type_annotation":
                return_type = get_text(child).lstrip(": ")
            elif child.type == "async":
                is_async = True
            elif child.type == "static":
                is_static = True

        if not func_name:
            return None

        is_private = func_name.startswith("_") or func_name.startswith("#")

        prefix = "async " if is_async else ""
        signature = f"{prefix}{func_name}{params or '()'}"
        if return_type:
            signature += f": {return_type}"

        return {
            "name": func_name,
            "signature": signature,
            "parameters": params or "()",
            "return_type": return_type,
            "docstring": find_jsdoc(node),
            "is_async": is_async,
            "is_static": is_static,
            "is_private": is_private,
            "start_line": node.start_point[0] + 1,
            "end_line": node.end_point[0] + 1,
        }

    def extract_class(node):
        """Extract class name, superclass and methods."""
        class_name = None
        superclass = None
        methods = []

        for child in node.children:
            if child.type in ("identifier", "type_identifier") and class_name is None:
                class_name = get_text(child)
            elif child.type == "class_heritage":
                # Look for extends clause
                for hc in child.children:
                    if hc.type in ("identifier", "type_identifier", "member_expression"):
                        superclass = get_text(hc)
                        break
                    elif hc.type == "extends_clause":
                        for ec in hc.children:
                            if ec.type in ("identifier", "type_identifier", "member_expression"):
                                superclass = get_text(ec)
                                break
            elif child.type == "class_body":
                for body_child in child.children:
                    if body_child.type == "method_definition":
                        method = extract_method(body_child)
                        if method:
                            methods.append(method)

        if class_name:
            classes.append({
                "name": class_name,
                "superclass": superclass,
                "decorators": [],
                "methods": methods,
                "start_line": node.start_point[0] + 1,
                "end_line": node.end_point[0] + 1,
            })

    def find_classes(node):
        """Walk the tree looking for class declarations."""
        if node.type in ("class_declaration", "class"):
            extract_class(node)
            return
        # Classes inside export statements
        if node.type == "export_statement":
            for child in node.children:
                if child.type in ("class_declaration", "class"):
                    extract_class(child)
                    return
        for i in range(node.child_count):
            find_classes(node.child(i))

    find_classes(tree.root_node)
    return classes


def extract_js_exports(source_code: str, tree) -> list:
    """Extract export statements from JavaScript/TypeScript source code."""
    exports = []

    def get_text(node) -> str:
        return source_code[node.start_byte:node.end_byte]

    def walk_exports(node):
        if node.type == "export_statement":
            is_default = any(c.type == "default" for c in node.children)

            for child in node.children:
                if child.type == "function_declaration":
                    name = None
                    for fc in child.children:
                        if fc.type == "identifier":
                            name = get_text(fc)
                            break
                    if name:
                        exports.append({
                            "name": name,
                            "type": "function",
                            "is_default": is_default,
                            "line": node.start_point[0] + 1,
                        })
                elif child.type in ("class_declaration", "class"):
                    name = None
                    for cc in child.children:
                        if cc.type in ("identifier", "type_identifier"):
                            name = get_text(cc)
                            break
                    if name:
                        exports.append({
                            "name": name,
                            "type": "class",
                            "is_default": is_default,
                            "line": node.start_point[0] + 1,
                        })
                elif child.type in ("lexical_declaration", "variable_declaration"):
                    for vc in child.children:
                        if vc.type == "variable_declarator":
                            name_node = vc.child_by_field_name("name")
                            if name_node:
                                value_node = vc.child_by_field_name("value")
                                export_type = "variable"
                                if value_node and value_node.type in (
                                    "arrow_function", "function_expression",
                                ):
                                    export_type = "function"
                                exports.append({
                                    "name": get_text(name_node),
                                    "type": export_type,
                                    "is_default": is_default,
                                    "line": node.start_point[0] + 1,
                                })
                elif child.type == "export_clause":
                    for spec in child.children:
                        if spec.type == "export_specifier":
                            name_node = spec.child_by_field_name("name")
                            if name_node:
                                exports.append({
                                    "name": get_text(name_node),
                                    "type": "variable",
                                    "is_default": is_default,
                                    "line": node.start_point[0] + 1,
                                })
                            else:
                                for sc in spec.children:
                                    if sc.type == "identifier":
                                        exports.append({
                                            "name": get_text(sc),
                                            "type": "variable",
                                            "is_default": is_default,
                                            "line": node.start_point[0] + 1,
                                        })
                                        break
                elif child.type == "identifier" and is_default:
                    # export default someIdentifier
                    exports.append({
                        "name": get_text(child),
                        "type": "variable",
                        "is_default": True,
                        "line": node.start_point[0] + 1,
                    })
        else:
            for i in range(node.child_count):
                walk_exports(node.child(i))

    walk_exports(tree.root_node)
    return exports


# ---------------------------------------------------------------------------
# File-level orchestration
# ---------------------------------------------------------------------------

def parse_file(file_path: str) -> dict:
    """Parse a file and extract functions, imports, classes, and exports."""
    result = {
        "file": file_path,
        "language": None,
        "functions": [],
        "imports": [],
        "classes": [],
        "exports": [],
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
    
    # Extract based on language
    try:
        if language_name == "python":
            result["functions"] = extract_python_functions(source_code, tree, language)
            result["imports"] = extract_python_imports(source_code, tree)
            result["classes"] = extract_python_classes(source_code, tree)
        elif language_name in ("javascript", "typescript", "tsx"):
            result["functions"] = extract_js_functions(source_code, tree, language)
            result["imports"] = extract_js_imports(source_code, tree)
            result["classes"] = extract_js_classes(source_code, tree)
            result["exports"] = extract_js_exports(source_code, tree)
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
