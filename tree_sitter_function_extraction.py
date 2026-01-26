#!/usr/bin/env python3
"""
===============================================================================
TREE-SITTER FUNCTION EXTRACTION - COMPLETE WORKING EXAMPLE
===============================================================================

This script demonstrates how to extract function definitions from Python, JavaScript,
and TypeScript using tree-sitter Python bindings.

OUTPUT EXTRACTED PER FUNCTION:
- name: Function/method name
- parameters: List of parameter names
- return_type: Return type annotation (if present)
- docstring: Python docstring or JSDoc comment
- start_line: 1-based line number
- end_line: 1-based line number

PACKAGES NEEDED:
    pip install tree-sitter tree-sitter-python tree-sitter-javascript tree-sitter-typescript

PERFORMANCE: Typically 1-10ms to parse a single file
===============================================================================
"""

from tree_sitter import Language, Parser, Query, QueryCursor
import tree_sitter_python as tspython
import tree_sitter_javascript as tsjavascript
import tree_sitter_typescript as tstypescript
import json
import time


def extract_python_functions(source_code: str):
    """
    Extract Python function definitions with full metadata.
    
    Returns:
        List of dicts with keys: name, parameters, return_type, docstring,
        start_line, end_line
    """
    PY_LANGUAGE = Language(tspython.language())
    parser = Parser(PY_LANGUAGE)
    tree = parser.parse(bytes(source_code, "utf8"))
    
    # Query: Find all function_definition nodes
    query = Query(PY_LANGUAGE, "(function_definition) @func")
    cursor = QueryCursor(query)
    functions = []
    
    for match_id, captures in cursor.matches(tree.root_node):
        for func_node in captures.get("func", []):
            func_info = {
                "start_line": func_node.start_point[0] + 1,
                "end_line": func_node.end_point[0] + 1,
                "name": None,
                "parameters": [],
                "return_type": None,
                "docstring": None
            }
            
            # Walk children to extract details
            for child in func_node.children:
                if child.type == "identifier":
                    func_info["name"] = source_code[child.start_byte:child.end_byte]
                
                elif child.type == "parameters":
                    params = []
                    for param in child.children:
                        if param.type == "identifier":
                            params.append(source_code[param.start_byte:param.end_byte])
                    func_info["parameters"] = params
                
                elif child.type == "type":
                    func_info["return_type"] = source_code[child.start_byte:child.end_byte]
                
                elif child.type == "block":
                    # Look for docstring in first line of body
                    if child.child_count > 0:
                        first_child = child.child(0)
                        if first_child.type == "expression_statement":
                            if first_child.child_count > 0:
                                string_node = first_child.child(0)
                                if string_node.type == "string":
                                    docstring = source_code[string_node.start_byte:string_node.end_byte]
                                    # Remove triple quotes and whitespace
                                    docstring = docstring.strip()
                                    docstring = docstring.strip('"""').strip("'''")
                                    docstring = docstring.strip('"').strip("'")
                                    func_info["docstring"] = docstring
            
            functions.append(func_info)
    
    return functions


def extract_javascript_functions(source_code: str, language: Language, language_name: str = "JavaScript"):
    """
    Extract JavaScript/TypeScript function definitions with JSDoc comments.
    
    Returns:
        List of dicts with keys: name, parameters, return_type, jsdoc,
        start_line, end_line, language
    """
    parser = Parser(language)
    tree = parser.parse(bytes(source_code, "utf8"))
    
    # First pass: Collect all comment nodes for JSDoc association
    comments = {}
    def collect_comments(node):
        if node.type == "comment":
            comments[node.start_point[0]] = source_code[node.start_byte:node.end_byte].strip()
        for child in node.children:
            collect_comments(child)
    collect_comments(tree.root_node)
    
    # Query: Find function declarations and arrow function assignments
    query = Query(language, 
        "(function_declaration) @func "
        "(variable_declarator value: (arrow_function)) @arrow"
    )
    cursor = QueryCursor(query)
    functions = []
    
    for match_id, captures in cursor.matches(tree.root_node):
        func_nodes = []
        if "func" in captures:
            func_nodes.extend(captures["func"])
        if "arrow" in captures:
            func_nodes.extend(captures["arrow"])
        
        for func_node in func_nodes:
            func_info = {
                "start_line": func_node.start_point[0] + 1,
                "end_line": func_node.end_point[0] + 1,
                "name": None,
                "parameters": [],
                "return_type": None,
                "jsdoc": None,
                "language": language_name
            }
            
            # Extract details from children
            for child in func_node.children:
                if child.type == "identifier":
                    func_info["name"] = source_code[child.start_byte:child.end_byte]
                
                elif child.type == "formal_parameters":
                    params = []
                    for param in child.children:
                        if param.type == "identifier":
                            params.append(source_code[param.start_byte:param.end_byte])
                    func_info["parameters"] = params
                
                elif child.type == "arrow_function":
                    # Extract from arrow function (for arrow functions)
                    for arrow_child in child.children:
                        if arrow_child.type == "formal_parameters":
                            params = []
                            for param in arrow_child.children:
                                if param.type == "identifier":
                                    params.append(source_code[param.start_byte:param.end_byte])
                            func_info["parameters"] = params
                
                elif child.type == "type_annotation":
                    # Extract return type (mainly for TypeScript)
                    func_info["return_type"] = source_code[child.start_byte:child.end_byte]
            
            # Find nearest JSDoc comment (look backward up to 5 lines)
            func_line = func_node.start_point[0]
            for line in sorted(comments.keys(), reverse=True):
                if line < func_line and func_line - line <= 5:
                    func_info["jsdoc"] = comments[line]
                    break
            
            functions.append(func_info)
    
    return functions


def main():
    """Run demonstrations and performance tests."""
    
    # ========================================================================
    # PYTHON EXAMPLE
    # ========================================================================
    print("=" * 80)
    print("PYTHON FUNCTION EXTRACTION")
    print("=" * 80)
    print()
    
    python_code = '''
"""Module docstring - demonstrating tree-sitter Python parsing."""

def greet(name: str) -> str:
    """
    Greet the user by name.
    
    Args:
        name: The user's name
        
    Returns:
        A greeting message
    """
    return f"Hello, {name}!"

def add(a: int, b: int) -> int:
    """Add two numbers together and return the result."""
    return a + b

def no_params() -> None:
    """Function with no parameters."""
    pass

def no_type_annotation(x, y):
    """Function without type hints."""
    return x + y

class Calculator:
    """A simple calculator class."""
    
    def multiply(self, x: float, y: float) -> float:
        """Multiply two numbers."""
        return x * y
    
    def divide(self, a, b):
        return a / b
'''
    
    py_functions = extract_python_functions(python_code)
    print(f"Extracted {len(py_functions)} function definitions:")
    print(json.dumps(py_functions, indent=2))
    
    # ========================================================================
    # JAVASCRIPT EXAMPLE
    # ========================================================================
    print("\n" + "=" * 80)
    print("JAVASCRIPT FUNCTION EXTRACTION")
    print("=" * 80)
    print()
    
    javascript_code = '''
/**
 * Calculate the sum of two numbers
 * @param {number} a - First number
 * @param {number} b - Second number  
 * @returns {number} The sum of a and b
 */
function add(a, b) {
    return a + b;
}

/**
 * Multiply two numbers
 * @param {number} x - First factor
 * @param {number} y - Second factor
 * @returns {number} The product of x and y
 */
function multiply(x, y) {
    return x * y;
}

/**
 * Subtract two numbers
 * @param {number} a - Minuend
 * @param {number} b - Subtrahend
 * @returns {number} The difference
 */
const subtract = (a, b) => a - b;

// Arrow function without JSDoc
const divide = (a, b) => a / b;

// Regular function without JSDoc
function power(base, exponent) {
    return Math.pow(base, exponent);
}
'''
    
    JS_LANGUAGE = Language(tsjavascript.language())
    js_functions = extract_javascript_functions(javascript_code, JS_LANGUAGE, "JavaScript")
    print(f"Extracted {len(js_functions)} function definitions:")
    print(json.dumps(js_functions, indent=2))
    
    # ========================================================================
    # TYPESCRIPT EXAMPLE  
    # ========================================================================
    print("\n" + "=" * 80)
    print("TYPESCRIPT FUNCTION EXTRACTION")
    print("=" * 80)
    print()
    
    typescript_code = '''
/**
 * Calculate the sum of two numbers
 * @param a - First number
 * @param b - Second number
 * @returns The sum of a and b
 */
function add(a: number, b: number): number {
    return a + b;
}

/**
 * Multiply two numbers
 * @param x - First factor
 * @param y - Second factor
 * @returns The product
 */
const multiply = (x: number, y: number): number => x * y;

/**
 * Generic identity function
 * @param value - Any value
 * @returns The same value
 */
function identity<T>(value: T): T {
    return value;
}

// Arrow function without JSDoc
const noop = (): void => {};

// Function with complex return type
function getArray<T>(length: number): T[] {
    return new Array(length);
}
'''
    
    # Use TypeScript grammar (note: language_typescript, not typescript_language())
    TS_LANGUAGE = Language(tstypescript.language_typescript())
    ts_functions = extract_javascript_functions(typescript_code, TS_LANGUAGE, "TypeScript")
    print(f"Extracted {len(ts_functions)} function definitions:")
    print(json.dumps(ts_functions, indent=2))
    
    # ========================================================================
    # PERFORMANCE TEST
    # ========================================================================
    print("\n" + "=" * 80)
    print("PERFORMANCE TEST")
    print("=" * 80)
    print()
    
    # Create a large test file (~10KB)
    large_code = python_code * 100
    file_size_kb = len(large_code) / 1024
    
    # Test parsing performance
    parse_count = 100
    start = time.time()
    for _ in range(parse_count):
        parser = Parser(Language(tspython.language()))
        tree = parser.parse(bytes(large_code, "utf8"))
        _ = tree.root_node  # Access root to ensure tree is built
    end = time.time()
    
    total_time = end - start
    avg_time_ms = (total_time / parse_count) * 1000
    parse_speed_kbps = file_size_kb / total_time
    
    print(f"File size:        {file_size_kb:.1f} KB ({len(large_code):,} bytes)")
    print(f"Parse count:      {parse_count}")
    print(f"Total time:       {total_time:.3f} seconds")
    print(f"Average per parse: {avg_time_ms:.2f} ms")
    print(f"Parse speed:      {parse_speed_kbps:.1f} KB/sec")
    print()
    
    # ========================================================================
    # COMPARISON WITH COCOINDEX
    # ========================================================================
    print("=" * 80)
    print("COMPARISON: Tree-sitter vs CocoIndex")
    print("=" * 80)
    print()
    print("TREE-SITTER:")
    print("  ✓ Direct, low-level parsing")
    print("  ✓ Very fast: 1-10ms per file")
    print("  ✓ No external dependencies")
    print("  ✓ Explicit control over AST traversal")
    print("  ✗ Requires manual AST walking code")
    print("  ✗ No built-in vector embeddings")
    print()
    print("COCOINDEX:")
    print("  ✓ Higher-level abstraction")
    print("  ✓ Automatic vector embeddings")
    print("  ✓ Semantic search out of the box")
    print("  ✗ Heavier dependency")
    print("  ✗ Less granular control")
    print()
    print("RECOMMENDATION:")
    print("  If you need FAST parsing + fine-grained control:")
    print("    → Use Tree-sitter directly")
    print()
    print("  If you need SEMANTIC SEARCH + vector embeddings:")
    print("    → Use CocoIndex (or integrate tree-sitter into it)")
    print()

if __name__ == "__main__":
    main()
