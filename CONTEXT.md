# as-str Transform

The as-str transform replaces eligible native-string work with zero-copy string
views while preserving AssemblyScript program behavior.

## Language

**String view**:
A zero-copy window over an existing string whose operations preserve
AssemblyScript string semantics.
_Avoid_: Virtual string, borrowed string

**Promotion**:
A transform decision that allows a native-string value to remain a string view
because every observed use is safe and profitable.
_Avoid_: Conversion, replacement

**Materialization**:
The creation of a native string from a string view when a use cannot remain
view-backed.
_Avoid_: Copy, fallback

**Packed span**:
An allocation-free representation of a non-escaping string view used when its
owner and range can remain separate.
_Avoid_: Packed string, scalarized string

**Operation semantics**:
The transform's canonical knowledge of each string operation's result and
zero-copy capabilities.
_Avoid_: Method lists, operation taxonomy

**Source admission**:
The decision that a parsed source may participate in semantic analysis,
promotion, and generated view imports.
_Avoid_: Source filtering, source eligibility
