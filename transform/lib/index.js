import { Transform } from "assemblyscript/dist/transform.js";
import { Node, ImportStatement, } from "assemblyscript/dist/assemblyscript.js";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
const PKG = "as-str";
const NAME = "str";
const DEBUG = /^(1|true|on|yes)$/i.test(process.env["STR_AS_DEBUG"] ?? "");
const USES = /(?:\bstr\s*\.|:\s*str\b|\bnew\s+str\b|<\s*str\s*>|\bstr\s*\[\s*\])/;
const BINDS = /(?:\b(?:const|let|var|function|class|namespace|type)\s+str\b|\(\s*str\s*:|,\s*str\s*:)/;
function normalizeBaseRel(baseRel) {
    if (baseRel.endsWith(PKG)) {
        return PKG + baseRel.slice(baseRel.lastIndexOf(PKG) + PKG.length);
    }
    if (!baseRel.startsWith(".") &&
        !baseRel.startsWith("/") &&
        !baseRel.startsWith(PKG)) {
        return "./" + baseRel;
    }
    return baseRel;
}
function computeImportBaseRel(fromDir, packageDir, p = path) {
    return normalizeBaseRel(path.posix.join(...p.relative(fromDir, packageDir).split(p.sep)));
}
function importedNames(source) {
    const names = new Set();
    for (const stmt of source.statements) {
        if (!(stmt instanceof ImportStatement))
            continue;
        if (stmt.namespaceName)
            names.add(stmt.namespaceName.text);
        if (stmt.declarations) {
            for (const d of stmt.declarations)
                names.add(d.name.text);
        }
    }
    return names;
}
export default class StrAsTransform extends Transform {
    afterParse(parser) {
        const packageDir = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
        const baseCWD = path.join(process.cwd(), this.baseDir ?? ".");
        const specifiers = new Set();
        for (const source of parser.sources) {
            if (source.isLibrary)
                continue;
            if (source.internalPath.startsWith("~lib"))
                continue;
            const text = source.text;
            const already = importedNames(source);
            if (already.has(NAME) || !USES.test(text) || BINDS.test(text))
                continue;
            let fromPath = source.normalizedPath.replaceAll("/", path.sep);
            fromPath = fromPath.startsWith("~lib")
                ? fromPath.slice(5)
                : path.join(baseCWD, fromPath);
            const baseRel = computeImportBaseRel(path.dirname(fromPath), packageDir);
            const specifier = path.posix.join(baseRel, "assembly", "index");
            specifiers.add(specifier);
            const range = source.range;
            source.statements.unshift(Node.createImportStatement([
                Node.createImportDeclaration(Node.createIdentifierExpression(NAME, range, false), null, range),
            ], Node.createStringLiteralExpression(specifier, range), range));
            if (DEBUG) {
                console.log(`[as-str] inject { ${NAME} } from "${specifier}" -> ${source.normalizedPath}`);
            }
        }
        for (const specifier of specifiers) {
            if (!specifier.startsWith(PKG + "/"))
                continue;
            const internal = "~lib/" + specifier;
            if (parser.sources.some((s) => s.internalPath === internal))
                continue;
            const file = path.join(packageDir, "assembly", "index.ts");
            if (!existsSync(file))
                continue;
            parser.parseFile(readFileSync(file, "utf8"), internal + ".ts", false);
            if (DEBUG)
                console.log(`[as-str] force-parsed ${internal}`);
        }
    }
}
