const headers = [
  "Host: api.example.org",
  "Content-Type: application/json",
  "X-Request-ID: abc123",
  "Authorization: Bearer example",
  "Cache-Control: max-age=3600",
  "Accept: */*",
];
function classify(key: string): i32 {
  key = key.toLowerCase();
  if (key == "host") return 101;
  if (key == "content-type") return 211;
  if (key == "x-request-id") return 307;
  if (key == "authorization") return 401;
  if (key == "cache-control") return 503;
  return 17;
}
export function run(count: i32): i32 {
  let score = 0;
  for (let i = 0; i < count; i++) {
    const header = headers[i % headers.length];
    score += classify(header.slice(0, header.indexOf(":")));
  }
  return score;
}
