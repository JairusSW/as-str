import { str } from "./index";

function h(title: string): void {
  console.log("\n\x1b[1m== " + title + " ==\x1b[0m");
}

function show(label: string, value: string): void {
  console.log("  " + label + ' -> "' + value + '"');
}

function showi(label: string, value: i32): void {
  console.log("  " + label + " -> " + value.toString());
}

function showb(label: string, value: bool): void {
  console.log("  " + label + " -> " + (value ? "true" : "false"));
}

const sentence = "  The quick brown fox jumps over the lazy dog.  ";

h("converting a real string into a view");
const v: str = str.from(sentence);
showi("length (incl. padding)", v.length);
show("toString() round-trips", v.toString());

h("slice / substring / substr (all zero-copy views)");
const trimmed = v.trim(); // still a view - no allocation
show("trim()", trimmed.toString());
show("slice(4, 9)", trimmed.slice(4, 9).toString()); // "quick"
show("slice(-4)", trimmed.slice(-4).toString()); // "dog."
show("slice(-4, -1)", trimmed.slice(-4, -1).toString()); // "dog"
show("substring(10, 4)", trimmed.substring(10, 4).toString()); // swaps -> "quick"
show("substr(10, 5)", trimmed.substr(10, 5).toString()); // "brown"

h("a view of a view stays anchored to the original backing string");
const tail = str.from(sentence).trim().slice(-4); // "dog."
show("trim().slice(-4)", tail.toString());
show("  .slice(0, 3)", tail.slice(0, 3).toString()); // "dog"
showb("  still backed by the original?", tail.data === sentence);

h("char access");
show("charAt(4) on trimmed", trimmed.charAt(4).toString()); // "q"
show("at(-1) on trimmed", trimmed.at(-1).toString()); // "."
showi("charCodeAt(4)", trimmed.charCodeAt(4)); // 113 'q'
showi('codePointAt(1) of "a😀"', str.from("a😀").codePointAt(1)); // 128512

h("searching");
showi('indexOf("fox")', trimmed.indexOf("fox"));
showi('lastIndexOf("o")', trimmed.lastIndexOf("o"));
showb('includes("brown")', trimmed.includes("brown"));
showb('startsWith("The")', trimmed.startsWith("The"));
showb('endsWith("dog.")', trimmed.endsWith("dog."));

h("comparison operates on content, not identity");
const a = str.slice("__world", 2); // "world"
const b = str.slice("hello world", 6); // "world", different backing string
showb("a.equals(b)", a.equals(b));
showb("a == b (operator)", a == b);
showb('"apple" < "banana"', str.from("apple") < str.from("banana"));

h("free functions accept a real string OR a view");
show("str.slice(string, 4, 9)", str.slice(sentence, 4, 9).toString());
show("str.slice(view, 0, 3)", str.slice(trimmed, 0, 3).toString());
showi("str.length(view)", str.length(trimmed));

h("allocating helpers (these return a real string)");
show("toUpperCase", str.toUpperCase(trimmed.slice(0, 3))); // "THE"
show("repeat", str.repeat("ab", 4));
show("padStart", str.padStart("7", 3, "0"));
show("replaceAll", str.replaceAll("a-b-c-d", "-", "+"));

h("split into zero-copy pieces");
const csv = "id,name,email,role";
const cols = str.split(csv, ",");
showi("field count", cols.length);
for (let i = 0; i < cols.length; i++) {
  show("  field " + i.toString(), cols[i].toString());
}

h("a practical tokenizer - walk words without copying until the end");
const log = "GET /index.html 200 1043";
const fields = str.split(log, " ");
show("method", fields[0].toString());
show("path", fields[1].toString());
showi("status", <i32>parseInt(fields[2].toString()));
showi("bytes", <i32>parseInt(fields[3].toString()));

console.log("\n\x1b[32mdone\x1b[0m");
