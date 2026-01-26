# Tree-sitter Python Bindings Research
## Complete Guide for Function Extraction

### 1. PACKAGES NEEDED

**Exact pip install command:**
```bash
pip install tree-sitter tree-sitter-python tree-sitter-javascript tree-sitter-typescript
```

**Package versions (as of Jan 2026):**
- `tree-sitter`: 0.25.2
- `tree-sitter-python`: 0.25.0
- `tree-sitter-javascript`: 0.25.0
- `tree-sitter-typescript`: 0.23.2

---

### 2. HOW TO SET UP PARSERS

#### Python Parser
```python
from tree_sitter import Language, Parser
import tree_sitter_python as tspython

PY_LANGUAGE = Language(tspython.language())
parser = Parser(PY_LANGUAGE)
```

#### JavaScript Parser
```python
from tree_sitter import Language, Parser
import tree_sitter_javascript as tsjavascript

JS_LANGUAGE = Language(tsjavascript.language())
parser = Parser(JS_LANGUAGE)
```

#### TypeScript Parser
```python
from tree_sitter import Language, Parser
import tree_sitter_typescript as tstypescript

TS_LANGUAGE = Language(tstypescript.language_typescript())
parser = Parser(TS_LANGUAGE)

# For TSX files:
TSX_LANGUAGE = Language(tstypescript.language_tsx())
parser = Parser(TSX_LANGUAGE)
```

---

### 3. HOW TO WALK THE AST AND FIND FUNCTION DEFINITIONS

#### Basic Pattern
```python
from tree_sitter import Query, QueryCursor

# Parse source code
source_code = "your code here"
tree = parser.parse(bytes(source_code, "utf8"))

# Define a query to find function definitions
query = Query(language, "(function_definition) @func")
cursor = QueryCursor(query)

# Execute query
for match_id, captures in cursor.matches(tree.root_node):
    for func_node in captures.get("func", []):
        # Process each function node
        name = source_code[func_node.start_byte:func_node.end_byte]
```

#### Extracting Details from Nodes
```python
# Walk children to find name, parameters, return type
for child in func_node.children:
    if child.type == "identifier":
        name = source_code[child.start_byte:child.end_byte]
    elif child.type == "parameters":
        # Extract parameter names
    elif child.type == "type":
        # Extract return type
    elif child.type == "block":
        # Extract docstring from body
```

---

### 4. HOW TO EXTRACT DOCSTRINGS AND JSDOC

#### Python Docstrings
```python
# Look for string node as first child of block body
if child.type == "block":
    if child.child_count > 0:
        first_child = child.child(0)
        if first_child.type == "expression_statement":
            string_node = first_child.child(0)
            if string_node.type == "string":
                docstring = source_code[string_node.start_byte:string_node.end_byte]
                # Clean up triple quotes
                docstring = docstring.strip().strip('"""').strip("'''")
```

#### JavaScript/TypeScript JSDoc
```python
# First pass: Collect all comment nodes
comments = {}
def collect_comments(node):
    if node.type == "comment":
        comments[node.start_point[0]] = source_code[node.start_byte:node.end_byte].strip()
    for child in node.children:
        collect_comments(child)
collect_comments(tree.root_node)

# Then associate JSDoc with nearest function
func_line = func_node.start_point[0]
for line in sorted(comments.keys(), reverse=True):
    if line < func_line and func_line - line <= 5:
        jsdoc = comments[line]
        break
```

---

### 5. PERFORMANCE

**Benchmark Results (100 parses of ~75KB file):**
- Total time: ~1.1 seconds
- Average per parse: ~11ms
- Parse speed: ~67 KB/sec

**Key Points:**
- ✅ Very fast parsing (typically 1-10ms per file)
- ✅ Low overhead
- ✅ Suitable for real-time use
- ✅ Scales well with larger files

---

### 6. COMPARISON: TREE-SITTER VS COCOINDEX

| Aspect | Tree-sitter | CocoIndex |
|--------|-------------|-----------|
| **Abstraction Level** | Low-level, direct | High-level |
| **Performance** | Very fast (1-10ms) | Depends on embedding |
| **Control** | Fine-grained AST control | Less granular |
| **Dependencies** | Minimal | Heavier |
| **Vector Embeddings** | ❌ No | ✅ Yes |
| **Semantic Search** | ❌ No | ✅ Yes |
| **Learning Curve** | Moderate | Low |

### Recommendation

**Use Tree-sitter directly if you need:**
- ✅ FAST parsing with minimal overhead
- ✅ Fine-grained control over AST traversal
- ✅ No external dependencies
- ✅ To build your own indexing/search system

**Use CocoIndex (or integrate with it) if you need:**
- ✅ Automatic vector embeddings
- ✅ Semantic search out of the box
- ✅ Higher-level abstractions
- ✅ Machine learning-powered analysis

**For your use case (function extraction):**
→ Tree-sitter is **simpler and more appropriate** for direct function extraction
→ CocoIndex would be overkill unless you also need semantic similarity search

---

### 7. WORKING CODE EXAMPLE

See `tree_sitter_function_extraction.py` in this repository for a complete, runnable
example that demonstrates:
- Python function extraction with docstrings
- JavaScript function extraction with JSDoc
- TypeScript function extraction with type annotations
- Performance benchmarks

Run it with:
```bash
python tree_sitter_function_extraction.py
```

---

### 8. API REFERENCE

#### Core Classes
- `Language`: Loads a specific language grammar
- `Parser`: Parses source code into a syntax tree
- `Tree`: Represents the parsed syntax tree
- `Node`: A single node in the tree
- `Query`: Pattern-matching queries for tree traversal
- `QueryCursor`: Executes queries and yields matches

#### Key Node Properties
- `node.type`: Node type (e.g., "function_definition")
- `node.start_point`: (row, column) of start
- `node.end_point`: (row, column) of end
- `node.start_byte`: Byte offset of start
- `node.end_byte`: Byte offset of end
- `node.children`: List of child nodes
- `node.child(n)`: Get nth child

#### Query Syntax
```
(pattern
  child: (child_type) @capture_name
) @parent_capture
```

Multiple patterns in one query:
```
(pattern1) @capture1
(pattern2) @capture2
```

---

### 9. USEFUL QUERIES

#### Find all functions
```
(function_definition) @func
(function_declaration) @func
```

#### Find functions with name and parameters
```
(function_definition
  name: (identifier) @name
  parameters: (parameters (identifier) @param)*
) @func
```

#### Find class methods
```
(class_definition
  body: (block
    (function_definition) @method
  )
)
```

#### Find arrow functions
```
(arrow_function
  parameters: (formal_parameters (identifier) @param)*
) @arrow
```

---

### 10. TROUBLESHOOTING

#### Query Syntax Errors
- Ensure parentheses are balanced
- Use `@` only for captures, not pattern names
- Don't use Python-specific features in query strings

#### TypeScript Language Loading
- Use `language_typescript()` not `typescript_language()`
- Use `language_tsx()` for TSX files

#### No Matches Found
- Check if the language parser is correct
- Verify the query pattern matches the grammar
- Use `tree.root_node.sexp()` to debug tree structure

---

## References

- [Official Documentation](https://tree-sitter.github.io/py-tree-sitter/)
- [PyPI](https://pypi.org/project/tree-sitter/)
- [GitHub](https://github.com/tree-sitter/py-tree-sitter)
- [Query Syntax](https://tree-sitter.github.io/tree-sitter/using-parsers/#query-syntax)
