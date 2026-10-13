// URL userinfo cases for the scrub tests: [input, expected].

/** Free text through `scrubMessage`. */
export const MESSAGE_USERINFO_CASES: readonly (readonly [string, string])[] = [
  // Userinfo ends at the last `@` of the authority.
  ["connect postgres://u:pw1@pw2.ab@db:5432/x failed", "connect postgres://db:5432/x failed"],
  ["postgres://user:p@ss@db:5432/x", "postgres://db:5432/x"],
  ["postgres://user:jane.doe@corp.com@db/x", "postgres://db/x"],
  // `?`, `#` or `/` in a password.
  ["postgres://user:p?ss@db/x", "postgres://db/x"],
  ["postgres://user:p#ss@db/x", "postgres://db/x"],
  ["postgres://u:p/ss@db/x", "postgres://db/x"],
  ["https://medium.com/@alice", "https://medium.com/@alice"],
  ["https://host:8080/@handle", "https://host:8080/@handle"],
  ["https://h/p?x=a@b.com", "https://h/p"],
  ["https://h/pkg@1.2.3", "https://h/pkg@1.2.3"],
  // Every URL in a whitespace-free token.
  ['{"a":"http://x","b":"postgres://u:p@db/x"}', '{"a":"http://x","b":"postgres://db/x"}'],
  ["http://h/p,postgres://u:p@db/x", "http://h/p,postgres://db/x"],
  // Scheme-relative, at the token start or after a delimiter.
  ["//user:pass@host/x", "//host/x"],
  ['"//user:pass@host/x"', '"//host/x"'],
  ["(//u:p@h/x)", "(//h/x)"],
  ["url=//u:p@h/x", "url=//h/x"],
  ["/a//b", "/a//b"],
  ["// note", "// note"],
  // A URL ends at whitespace, a quote or an angle bracket, never at `,` or `;`.
  [
    '{"baseUrl":"https://api.example.com","to":"jane@x.io","msg":"sent"}',
    '{"baseUrl":"https://api.example.com","to":"[redacted]","msg":"sent"}',
  ],
  [
    '{"url":"http://localhost:3000","owner":"bob@x.io"}',
    '{"url":"http://localhost:3000","owner":"[redacted]"}',
  ],
  ["'https://h','a@b.io'", "'https://h','[redacted]'"],
  ["<https://h>jane@x.io", "<https://h>[redacted]"],
  ["`https://h`jane@x.io", "`https://h`[redacted]"],
  ["url=https://api.x.com,user=jane@x.io", "url=https://x.io"],
  ["webhook https://hooks.slack.com;by=ops@x.io", "webhook https://x.io"],
  ["postgres://u:p,q;r@db/x", "postgres://db/x"],
  // Colonless userinfo with a `?` or `#` before its `@` is a credential.
  ["https://ghp_ab#c@github.com/x", "https://github.com/x"],
  ["https://tok?c@github.com/x", "https://github.com/x"],
  ["redis://p#ss@r:6379", "redis://r:6379"],
  ["https://h?u=a@b", "https://b"],
  // A host and port, or a bracketed IPv6 host, before a `/`, `?` or `#` is never userinfo.
  ["http://[::1]:80/p?u=a@b.com", "http://[::1]:80/p"],
  ["http://[::1]:80/", "http://[::1]:80/"],
  ["https://h:/p?u=a@b", "https://h:/p"],
  ["https://h:8080?u=a@b.com", "https://h:8080"],
  // A `//` or `://` inside a password starts no URL.
  ["postgres://u:p,//x@db/x", "postgres://db/x"],
  ["postgres://u:ab://c@db/x", "postgres://db/x"],
  ["http://h,//u:p@db/x", "http://h,//db/x"],
  // A quote ends a URL only at the token's end or before a delimiter.
  ["postgres://u:it's@db/x", "postgres://db/x"],
  ['{"dsn":"postgres://u:p\\"x@db/x"}', '{"dsn":"postgres://db/x"}'],
  ['postgresql://app:p"w@db:5432/x', "postgresql://db:5432/x"],
  [
    "P1001: Can't reach database server at postgresql://app:p\"w@db:5432/x",
    "P1001: Can't reach database server at postgresql://db:5432/x",
  ],
  ['["https://h","x@y.io"]', '["https://h","[redacted]"]'],
  // A `host:port` head before `?` or `#` needs a `=` or `/` before the `@`.
  ["postgres://admin:2024#Secure@db/x", "postgres://db/x"],
  ["redis://:12345#abc@r:6379", "redis://r:6379"],
  ["redis://:1234?ab@r:6379", "redis://r:6379"],
  // A `\` is host evidence only as an escaped `\/`.
  ["postgres://app:\\abc/def@db/x", "postgres://db/x"],
  ["postgres://app:\\abc=def@db/x", "postgres://db/x"],
  ["postgres://app:1\\a/b@db/x", "postgres://db/x"],
  // A `'` before `)` or `'` does not end userinfo; it still ends a host and path.
  [
    "connect ECONNREFUSED postgres://app:oi0%7DDo%40%23b!c')%22!36%2B'5@db.internal:5432/app",
    "connect ECONNREFUSED postgres://db.internal:5432/app",
  ],
  [
    "postgres://app:%22%7D0f~gTp3U2WRWy7''Qk@db.internal:5432/app",
    "postgres://db.internal:5432/app",
  ],
  // Accepted cost: a quoted URL beside a quoted email loses its host.
  ["('https://h'),('x@y.io')", "('https://y.io')"],
  // `;` starts the path-parameter and query cut.
  ["https://h/x;jsessionid=S", "https://h/x"],
  ["GET https://h/p;jsessionid=A 200", "GET https://h/p 200"],
  ["/cb;jsessionid=A?x=1 hit", "/cb hit"],
  // One-slash, prefixed and JSON-escaped schemes.
  ["https:/u:p@h/x", "https:/h/x"],
  ["postgres:\\/\\/u:p@db\\/x", "postgres:\\/\\/db\\/x"],
  // Only a space or a line break ends userinfo; a tab or other space ends a host and path.
  ["postgres://u:p\tq@db/x", "postgres://db/x"],
  ["x https://u:p\u2028q@h/x", "x https://h/x"],
  ["postgres://u:p\u00a0q@db/x", "postgres://db/x"],
  ["a://u:p@h\tb://v:q@i", "a://h\tb://i"],
  ["https://h/p?q=1\tstatus=ok", "https://h/p\tstatus=ok"],
  // A line break ends the URL, so userinfo split across it stays.
  ["postgres://u:p\nass@db", "postgres://u:p\nass@db"],
  // Unchanged behavior.
  ["postgres://user:p%40ss@db/x", "postgres://db/x"],
  ["postgres://user:p:ss@db/x", "postgres://db/x"],
  ["https://ghp_X@github.com/o/r", "https://github.com/o/r"],
  ["redis://:pass@cache:6379", "redis://cache:6379"],
  ["amqp://guest:guest@mq/v", "amqp://mq/v"],
  ["mongodb+srv://u:p@cluster0/db", "mongodb+srv://cluster0/db"],
  ["jdbc:postgresql://u:p@db/x", "jdbc:postgresql://db/x"],
  ["1postgres://u:p@db/x", "1postgres://db/x"],
  ["x:postgres://u:p@db/x", "x:postgres://db/x"],
  ['"postgres://u:p@db/x"', '"postgres://db/x"'],
  ["(postgres://u:p@db/x)", "(postgres://db/x)"],
  ["<postgres://u:p@db/x>", "<postgres://db/x>"],
  ['{"url":"postgres://u:p@db/x"}', '{"url":"postgres://db/x"}'],
  ["url=postgres://u:p@db/x", "url=postgres://db/x"],
  ["a://u:p@h b://v:q@i", "a://h b://i"],
  ["a://u:p@h\nb://v:q@i", "a://h\nb://i"],
  ["GET HTTPS://user:pass@h/p?q=1 failed", "GET HTTPS://h/p failed"],
  ["Https://user:pass@h/p", "Https://h/p"],
  ["https://jane.doe@gmail.com/p", "https://gmail.com/p"],
  ["sent to a@b.com", "sent to [redacted]"],
  ["ssh deploy@buildbox failed", "ssh deploy@buildbox failed"],
];

/** A URL value through `stripQuery`. */
export const URL_USERINFO_CASES: readonly (readonly [string, string])[] = [
  ["postgres://u:pw1@pw2.ab@db:5432/x", "postgres://db:5432/x"],
  ["postgres://user:p@ss@db:5432/x", "postgres://db:5432/x"],
  ["postgres://user:p?ss@db/x", "postgres://db/x"],
  ["postgres://user:p#ss@db/x", "postgres://db/x"],
  ["postgres://u:p/ss@db/x", "postgres://db/x"],
  ["//user:pass@host/x?q=1", "//host/x"],
  ["https://medium.com/@alice", "https://medium.com/@alice"],
  ["https://host:8080/@handle?q", "https://host:8080/@handle"],
  ["https://user:pass@h/p?q=1#frag", "https://h/p"],
  ["HTTPS://user:pass@h/p?q", "HTTPS://h/p"],
  ["/a//b@c?q", "/a//b@c"],
  ["https://ghp_ab#c@github.com/x", "https://github.com/x"],
  ["redis://p#ss@r:6379", "redis://r:6379"],
  ["http://[::1]:80/p?u=a@b.com", "http://[::1]:80/p"],
  ["https://h:/p?u=a@b", "https://h:/p"],
  ["postgres://u:p,//x@db/x", "postgres://db/x"],
  ["postgres://u:ab://c@db/x", "postgres://db/x"],
  // Leading whitespace and a scheme chain. A value with no `//` keeps its text before an `@`.
  [" https://u:p@h/x", " https://h/x"],
  ["\thttps://u:p@h/x", "\thttps://h/x"],
  ["jdbc:postgresql://u:p@h/db", "jdbc:postgresql://h/db"],
  ["mailto:jane@example.com", "mailto:jane@example.com"],
  ["postgres://admin:2024#Secure@db/x", "postgres://db/x"],
  ["redis://:12345#abc@r:6379", "redis://r:6379"],
  ["https://h:8080?u=a@b.com", "https://h:8080"],
  ["postgres://app:\\abc/def@db/x", "postgres://db/x"],
  ["https://h/x;jsessionid=S", "https://h/x"],
  ["postgres://u:p,q;r@db/x", "postgres://db/x"],
  ["https:/u:p@h/x", "https:/h/x"],
  ["1postgres://u:p@db/x", "1postgres://db/x"],
  ['postgres://u:p"x@db/x', "postgres://db/x"],
];

/** A span name through `scrubSpanName`, with no route. */
export const SPAN_NAME_CASES: readonly (readonly [string, string])[] = [
  ["GET  /x?t=1", "GET  /x"],
  ["GET /x?t=1\n", "GET /x\n"],
  ["fetch GET https://u:p@h/x?t", "fetch GET https://h/x"],
  ["GET  /apply/SECRET", "GET  /apply/[token]"],
  ["GET /APPLY/SECRET?x", "GET /apply/[token]"],
  ["render route (app) /apply/[token]", "render route (app) /apply/[token]"],
  ["GET u:p@h/x?t=1", "GET h/x"],
  ["GET https://h/p;jsessionid=A", "GET https://h/p"],
  // Accepted cost: a scheme-less `x@` reads as userinfo.
  ["GET pkg@1.2.3", "GET 1.2.3"],
];

/** A URL attribute through `scrubAttributes`, with no route: [key, value, expected]. */
export const URL_ATTRIBUTE_CASES: readonly (readonly [string, string, string])[] = [
  ["url.full", "https://ghp_ab#c@github.com/x", "https://github.com/x"],
  ["http.target", "https://ghp_ab#c@github.com/x", "https://github.com/x"],
  ["url.full", " https://u:p@h/x", " https://h/x"],
  ["url.full", " https://h/apply/SECRET", " https://h/apply/[token]"],
  ["http.target", "\t/apply/SECRET", "\t/apply/[token]"],
  ["url.full", "jdbc:postgresql://u:p@h/db", "jdbc:postgresql://h/db"],
  ["http.url", "u:p@h/x", "h/x"],
  ["url.full", "u:p@h/x?q", "h/x"],
  ["url.full", "https:/u:p@h/x", "https:/h/x"],
  ["url.full", "1postgres://u:p@db/x", "1postgres://db/x"],
  ["url.full", "https://h/x;jsessionid=S", "https://h/x"],
  ["url.full", "https://h//apply/SECRET", "https://h/apply/[token]"],
  ["http.target", "/APPLY/SECRET", "/apply/[token]"],
  ["url.full", "//h/apply/SECRET", "//h/apply/[token]"],
  ["http.target", "//apply/SECRET?x", "/apply/[token]"],
  [
    "url.full",
    "https://h/v1//Applications/by-token/SECRET",
    "https://h/v1/applications/by-token/:token",
  ],
];
