import { readFileSync } from "node:fs";
import path from "node:path";

// Representative, deterministic records. No production data or credentials.
// Source-text records below are actual files from this repository.
export function createCorpus(repo) {
  const names = [
    "Ada Lovelace",
    "José García",
    "山田 太郎",
    "Maya Chen",
    "Amina أحمد",
    "Zoë Smith",
  ];
  const routes = [
    "/api/v1/users",
    "/assets/app.wasm",
    "/health",
    "/api/catalog/items.json",
    "/docs/getting-started",
    "/search",
    "/api/注文/一覧",
  ];
  const messages = [
    "Request completed",
    "Cache entry refreshed",
    "échec de connexion",
    "保存しました 😀",
    "Retry scheduled",
    "ERROR: upstream unavailable",
  ];
  const records = (count, make) =>
    Array.from({ length: count }, (_, i) => make(i));
  return [
    {
      name: "http-headers",
      kind: 0,
      records: records(48, (i) =>
        [
          `${i % 3 ? "GET" : "POST"} ${routes[i % routes.length]} HTTP/1.1`,
          `${i % 2 ? "Host" : "host"}: api.example.org`,
          `User-Agent: sample-client/${1 + (i % 4)}.2.0 (${i % 2 ? "Linux; x86_64" : "Macintosh; arm64"})`,
          "Accept: application/json, text/plain;q=0.8, */*;q=0.1",
          `Content-Type: ${i % 3 ? "application/json; charset=utf-8" : "text/plain"}`,
          `Cache-Control: ${i % 4 ? "public, max-age=3600" : "no-store"}`,
          `X-Request-ID: request-${i.toString(16).padStart(8, "0")}`,
          ...(i % 2 ? [`Authorization: Bearer example-token-${i}`] : []),
          `X-Client-Name: ${names[i % names.length]}`,
          "Connection: keep-alive",
          "",
          "",
        ].join("\r\n"),
      ),
    },
    {
      name: "url-routing",
      kind: 1,
      records: records(
        96,
        (i) =>
          routes[i % routes.length] +
          (i % 4
            ? `?page=${(i % 12) + 1}&lang=${["en", "ja", "es"][i % 3]}&q=${encodeURIComponent(names[i % names.length])}&sort=created_at&limit=25`
            : ""),
      ),
    },
    {
      name: "service-logs",
      kind: 2,
      records: records(
        128,
        (i) =>
          `2026-10-29T14:${String(i % 60).padStart(2, "0")}:12.345Z ${["INFO", "INFO", "DEBUG", "WARN", "ERROR"][i % 5]} request ${routes[i % routes.length]} status=${i % 5 ? 200 : 500} duration_ms=${(i * 7) % 240} message="${messages[i % messages.length]}" trace=${i.toString(16).padStart(24, "0")}`,
      ),
    },
    {
      name: "tsv-import",
      kind: 3,
      records: records(96, (i) =>
        [
          String(10000 + i),
          ` ${names[i % names.length]} `,
          `user${i}@example.org`,
          ["active", "pending", "disabled"][i % 3],
          ["eu-west-1", "us-east-1", "ap-northeast-1"][i % 3],
          String((i * 17) % 900),
          i % 7 ? "" : " review required ",
        ].join("\t"),
      ),
    },
    {
      name: "text-normalization",
      kind: 4,
      records: records(
        64,
        (i) =>
          ` \t${messages[i % messages.length]}  for ${names[i % names.length]}\r\n  Status: ${i % 4 ? "OK" : "ERROR"}\r\n${"The operation was queued for processing.  ".repeat(i % 6)}\u00a0 `,
      ),
    },
    {
      name: "source-search",
      kind: 5,
      records: [
        "README.md",
        "package.json",
        "assembly/str.ts",
        "assembly/str8.ts",
        "transform/src/optimizer.ts",
        "transform/src/rewrite.ts",
      ].flatMap((name) => {
        const text = readFileSync(path.join(repo, name), "utf8");
        // Preserve real syntax and variable lengths, including complete files.
        return [
          text,
          ...text
            .split(/\n\s*\n/)
            .filter((s) => s.length > 40)
            .slice(0, 12),
        ];
      }),
    },
    {
      name: "json-filter",
      kind: 6,
      records: records(64, (i) =>
        JSON.stringify({
          id: `event-${i}`,
          timestamp: "2026-10-29T14:30:00Z",
          level: i % 5 ? "info" : "error",
          active: i % 3 !== 0,
          region: ["eu-west-1", "us-east-1"][i % 2],
          message: messages[i % messages.length],
          retry: i % 7 === 0,
          user: { id: i + 1000, name: names[i % names.length] },
          tags: ["api", "production", "request"],
          detail: "Request metadata is retained for diagnostic review. ".repeat(
            i % 9,
          ),
        }),
      ),
    },
    {
      name: "view-encoding",
      kind: 7,
      records: records(
        64,
        (i) =>
          ` \t${(messages[i % messages.length] + " for " + names[i % names.length] + ". ").repeat(1 + (i % 16))}\n `,
      ),
    },
    {
      name: "request-extraction",
      kind: 8,
      records: records(
        96,
        (i) =>
          `${i % 3 ? "GET" : "POST"} ${routes[i % routes.length]}${i % 4 ? `?page=${i + 1}&lang=ja` : ""} HTTP/1.1`,
      ),
    },
    {
      name: "message-sizing",
      kind: 9,
      records: records(64, (i) =>
        i % 13 === 0
          ? ""
          : JSON.stringify({
              event: "notification",
              recipient: names[i % names.length],
              message: messages[i % messages.length].repeat(1 + (i % 32)),
            }),
      ),
    },
  ];
}

export function reference(kind, value, encoding) {
  if (kind === 9) return Buffer.byteLength(value);
  const len = (s) => (encoding === 8 ? Buffer.byteLength(s) : s.length);
  const first = (s, n) =>
    encoding === 8 ? Buffer.from(s).indexOf(n) : s.indexOf(n);
  const last = (s, n) =>
    encoding === 8 ? Buffer.from(s).lastIndexOf(n) : s.lastIndexOf(n);
  if (kind === 8) {
    const before = (s, n) => (s.includes(n) ? s.slice(0, s.indexOf(n)) : "");
    const after = (s, n) =>
      s.includes(n) ? s.slice(s.indexOf(n) + n.length) : "";
    const method = before(value, " ");
    const target = before(after(value, " "), " HTTP/");
    const query = after(target, "?");
    const pathname = target.includes("?") ? before(target, "?") : target;
    const resource = pathname.slice(pathname.lastIndexOf("/") + 1);
    const page = before(after(query, "page="), "&");
    return (
      (method === "GET" ? 101 : 211) + len(resource) + len(page) + len(query)
    );
  }
  if (kind === 7) {
    const text = value.trim();
    if (encoding === 16) {
      const bytes = Buffer.from(text);
      return bytes.length + 3 * (bytes[0] ?? -1) + 7 * (bytes.at(-1) ?? -1);
    }
    return (
      text.length +
      3 * (text.length ? text.charCodeAt(0) : -1) +
      7 * (text.length ? text.charCodeAt(text.length - 1) : -1)
    );
  }
  if (kind === 0) {
    let score = 0;
    for (const line of value.split("\r\n").slice(1)) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const field = line.slice(colon + 1).trim();
      score += len(field);
      if (key === "host") score += 101;
      if (key === "content-type" && field.startsWith("application/json"))
        score += 211;
      if (key === "authorization" && field.startsWith("Bearer ")) score += 307;
      if (key === "cache-control" && field.includes("max-age=")) score += 401;
      if (key === "x-request-id") score += 503;
    }
    return score;
  }
  if (kind === 1) {
    const question = value.indexOf("?");
    const pathname = value.slice(0, question < 0 ? value.length : question);
    let score = last(pathname, "/") + 1;
    if (pathname.startsWith("/api/")) score += 101;
    if (pathname.endsWith(".json")) score += 211;
    if (pathname.endsWith(".wasm")) score += 307;
    if (question < 0) return score;
    for (const param of value.slice(question + 1).split("&")) {
      const pair = param.split("=", 2);
      if (pair.length < 2) continue;
      if (pair[0] === "page") score += 401;
      if (pair[0] === "lang") score += 503;
      if (pair[0] === "q") score += 601;
      score += len(pair[1]);
    }
    return score;
  }
  if (kind === 2) {
    let score = 0;
    if (value.includes(" ERROR ")) score += 101;
    if (value.includes(" WARN ")) score += 211;
    if (value.includes("status=500")) score += 307;
    const trace = value.lastIndexOf(" trace=");
    if (trace >= 0) score += len(value.slice(trace + 7));
    const fields = value.split(" ", 5);
    score += fields.length;
    if (fields.length > 3 && fields[3].startsWith("/api/")) score += 401;
    return score;
  }
  if (kind === 3) {
    const fields = value.split("\t");
    let score = fields.length;
    for (const item of fields) {
      const field = item.trim();
      score += len(field);
      if (field === "active") score += 101;
      if (field === "pending") score += 211;
      if (field.endsWith("@example.org")) score += 307;
    }
    return score;
  }
  if (kind === 4) {
    const result = value
      .trim()
      .toLowerCase()
      .replaceAll("\r\n", "\n")
      .replaceAll("  ", " ");
    return len(result) + 31 * first(result, "error") + 17 * last(result, "\n");
  }
  if (kind === 5)
    return [
      "import ",
      "function ",
      "return ",
      "const ",
      "toString",
      "not_a_real_identifier",
    ].reduce(
      (sum, needle) => sum + first(value, needle) + last(value, needle),
      0,
    );
  let score = 0;
  if (value.includes('"level":"error"')) score += 101;
  if (value.includes('"active":true')) score += 211;
  if (value.includes('"region":"eu-west-1"')) score += 307;
  if (value.includes('"retry":true')) score += 401;
  return score + first(value, '"message":') + last(value, '"id":');
}
