/** Small server rendered pages for the control plane, in the Saralix look. */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

/** A template tag that escapes every value unless it's already safe HTML. */
export class Safe {
  constructor(public html: string) {}
  toString() {
    return this.html;
  }
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0]!;
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Safe ? x.html : esc(x))).join("") : v instanceof Safe ? v.html : esc(v);
    out += part + strings[i + 1]!;
  });
  return new Safe(out);
}

const MARK_PATH = "M625 318L980 178L978 252C977 282 960 302 935 310L776 369Z M572 337C586 347 600 353 618 358L930 457C972 470 1000 505 1000 543C1000 564 992 582 978 598C971 592 963 588 955 586L605 475C568 463 545 432 545 395C545 368 556 348 572 337Z M547 767L548 703C549 670 568 645 596 635L768 564L933 616Z";
const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#111111"/><svg x="5" y="5" width="22" height="22" viewBox="472 172 600 600"><path fill="#FFFFFF" d="${MARK_PATH}"/></svg></svg>`)}`;

const CSS = `
/* the Saralix palette (same values as apps/web/src/styles/theme.css) */
:root { --bg:#f6f6f1; --card:#ffffff; --text:#111111; --muted:#6b6b63; --border:#e4e4dc; --control:#8e8e85; --accent:#0f7a55; --accent-hover:#0c6346; --primary:#111111; --primary-fg:#ffffff; --primary-hover:#2b2b2b; --ok:#0f7a55; --bad:#b42318; --tint:#efefe9; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#111111; --card:#1a1a1a; --text:#f6f6f1; --muted:#a3a39c; --border:#2a2a2a; --control:#6a6a64; --accent:#34b584; --accent-hover:#4cc797; --primary:#f6f6f1; --primary-fg:#111111; --primary-hover:#e4e4dc; --ok:#34b584; --bad:#f2776b; --tint:#1f1f1f; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
.wrap { max-width: 440px; margin: 0 auto; padding: 56px 16px; }
.wide { max-width: 1180px; padding: 32px 16px; }
.brand { display:flex; align-items:center; gap:10px; font-size:20px; font-weight:600; margin-bottom:28px; }
.mark { width:34px; height:34px; border-radius:8px; background:var(--primary); color:var(--primary-fg); display:grid; place-items:center; }
.card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:24px; }
h1 { font-size:24px; margin:0 0 6px; font-weight:600; }
h2 { font-size:17px; margin:28px 0 10px; font-weight:600; }
p { margin: 0 0 14px; }
.muted { color: var(--muted); }
label { display:block; font-size:13px; font-weight:500; margin-bottom:6px; }
input[type=email] { width:100%; padding:11px 12px; border:1px solid var(--control); border-radius:10px; background:var(--bg); color:var(--text); font:inherit; }
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn { display:inline-flex; justify-content:center; align-items:center; gap:8px; width:100%; margin-top:14px; padding:11px 14px; border:0; border-radius:10px; background:var(--primary); color:var(--primary-fg); font:inherit; font-weight:600; cursor:pointer; text-decoration:none; }
.site { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 16px; border:1px solid var(--border); border-radius:12px; text-decoration:none; color:var(--text); margin-top:10px; }
.site:hover { background: var(--tint); text-decoration: none; }
.btn:hover { background: var(--primary-hover); text-decoration: none; }
.small { font-size:13px; }
.err { color: var(--bad); font-size:13px; margin-top:8px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th { text-align:start; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--border); }
td { padding:9px 10px; border-bottom:1px solid var(--border); vertical-align: top; }
td.num, th.num { text-align:end; font-variant-numeric: tabular-nums; }
.tag { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; background:var(--tint); }
.up { color: var(--ok); } .down { color: var(--bad); }
.grid { display:grid; gap:14px; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
.stat { font-size: 26px; font-weight: 600; }
.scroll { overflow-x: auto; }
nav.top { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
`;

export function page(title: string, body: Safe, opts: { wide?: boolean } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(title)}</title>
<link rel="icon" href="${FAVICON}" />
<style>${CSS}</style>
</head>
<body><main class="wrap${opts.wide ? " wide" : ""}">
<div class="brand"><span class="mark"><svg viewBox="472 172 600 600" width="23" height="23" aria-hidden="true"><path fill="currentColor" d="${MARK_PATH}"/></svg></span>Saralix</div>
${body.html}
</main></body>
</html>`;
}
