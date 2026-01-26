# Tree-sitter Quick Start Guide for Function Extraction

## 📦 Installation

```bash
pip install tree-sitter tree-sitter-python tree-sitter-javascript tree-sitter-typescript
```

## 🚀 Parser Setup

```python
# Python
from tree_sitter import Language, Parser
import tree_sitter_python as tspython
py_lang = Language(tspython.language())

# JavaScript
import tree_sitter_javascript as tsjavascript
js_lang = Language(tsjavascript.language())

# TypeScript (use language_typescript, NOT typescript_language)
import tree_sitter_typescript as tstypescript
ts_lang = Language(tstypescript.language_typescript())

# TSX
tsx_lang = Language(tstypescript.language_tsx())
```

## 📝 Extracting Functions

### Python with Docstrings

```python
from tree_sitter import Query, QueryCursor

parser = Parser(py_lang)
tree = parser.parse(bytes(source_code, "utf8"))

query = Query(py_lang, "(function_definition) @func")
cursor = QueryCursor(query)

for match_id, captures in cursor.matches(tree.root_node):
    for func_node in captures.get("func", []):
        name = None
        docstring = None
        params = []
        return_type = None
        
        for child in func_node.children:
            if child.type == "identifier":
                name = source_code[child.start_byte:child.end_byte]
            elif child.type == "parameters":
                for p in child.children:
                    if p.type == "identifier":
                        params.append(source_code[p.start_byte:p.end_byte])
            elif child.type == "type":
                return_type = source_code[child.start_byte:child.end_byte]
            elif child.type == "block":
                # Extract docstring from first string in body
                if child.child_count > 0:
                    first = child.child(0)
                    if first.type == "expression_statement" and first.child_count > 0:
                        string_node = first.child(0)
                        if string_node.type == "string":
                            docstring = source_code[string_node.start_byte:string_node.end_byte]
                            docstring = docstring.strip().strip('"""').strip("'''")
        
        print(f"{name}({', '.join(params)}) -> {return_type}")
        print(f"  Doc: {docstring}")
```

### JavaScript/TypeScript with JSDoc

```python
# First collect all comments
comments = {}
def collect_comments(node):
    if node.type == "comment":
        comments[node.start_point[0]] = source_code[node.start_byte:node.end_byte].strip()
    for child in node.children:
        collect_comments(child)
collect_comments(tree.root_node)

# Query for functions
query = Query(lang, "(function_declaration) @func (variable_declarator value: (arrow_function)) @arrow")
cursor = QueryCursor(query)

for match_id, captures in cursor.matches(tree.root_node):
    func_nodes = (captures.get("func", []) + captures.get("arrow", []))
    
    for func_node in func_nodes:
        # Extract name, params, return_type (same as Python example above)
        
        # Find nearest JSDoc
        func_line = func_node.start_point[0]
        jsdoc = None
        for line in sorted(comments.keys(), reverse=True):
            if line < func_line and func_line - line <= 5:
                jsdoc = comments[line]
                break
        
        print(f"{name}({', '.join(params)})")
        print(f"  JSDoc: {jsdoc}")
```

## ⚡ Performance

**Benchmark:** Parsing ~75KB file 100 times
- Total: ~1.1 seconds
- Average: ~11ms per parse
- Speed: ~67 KB/sec

**Result:** Very fast - suitable for real-time use

## 🆚 Comparison: Tree-sitter vs CocoIndex

| Feature | Tree-sitter | CocoIndex |
|----------|-------------|------------|
| **Purpose** | AST parsing | Semantic search + embeddings |
| **Speed** | Very fast (1-10ms) | Depends on embedding generation |
| **Control** | Fine-grained | Higher-level abstraction |
| **Dependencies** | Minimal | Heavier |
| **Vector Search** | ❌ | ✅ |
| **ML/AI** | ❌ | ✅ |

## 💡 Recommendation

**For your use case (function extraction):**
→ **Tree-sitter is simpler and more appropriate**

Tree-sitter provides:
- ✅ Fast, direct parsing
- ✅ Fine-grained AST control
- ✅ Minimal dependencies
- ✅ Precise line numbers and byte offsets

CocoIndex would be useful if you ALSO need:
- Semantic similarity search
- Vector embeddings
- ML-powered code understanding

## 📚 Complete Example

See `tree_sitter_function_extraction.py` for a complete, runnable script with:
- Python function extraction
- JavaScript function extraction  
- TypeScript function extraction
- JSDoc/docstring extraction
- Performance benchmarks

Run it:
```bash
python tree_sitter_function_extraction.py
```

## 🔗 References

- [Official Docs](https://tree-sitter.github.io/py-tree-sitter/)
- [PyPI](https://pypi.org/project/tree-sitter/)
- [GitHub](https://github.com/tree-sitter/py-tree-sitter)
