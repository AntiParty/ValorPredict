// HTML for the two pages a streamer can land on after Twitch redirects back.
//
// The connection code is NEVER rendered as text. The page shows a masked
// placeholder and a Copy button; the code only exists as a string constant in
// one nonce-protected inline script and goes to the clipboard on click.

import { toB64url } from "./b64.js";
import { baseHeaders } from "./http.js";

export function makeNonce(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Colors and the brand mark mirror companion/src/styles.css.
const STYLE = `
:root{color-scheme:dark;--text:#f5f5f4;--soft:#c5c6cc;--muted:#a3a6af;--red:#ff4655;--red-dark:#d93644;--green:#54d397;--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.14)}
*{box-sizing:border-box}
html,body{margin:0}
body{display:grid;place-items:center;min-height:100vh;padding:24px 16px;background:radial-gradient(900px 500px at 50% -10%,rgba(255,70,85,.10),transparent 60%),#07080a;color:var(--text);font-family:"Aptos","Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.5}
.card{width:100%;max-width:440px;padding:28px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.035),rgba(255,255,255,.012))}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.brand strong{font-size:13px;letter-spacing:.015em}
.mark{display:grid;place-items:center;width:30px;height:30px;transform:rotate(45deg);border:1px solid rgba(255,255,255,.2);border-radius:8px;background:linear-gradient(145deg,var(--red),#bb2535);box-shadow:0 8px 26px rgba(255,70,85,.22)}
.mark i{width:8px;height:8px;transform:rotate(-45deg);border:2px solid #fff;border-radius:2px}
h1{margin:0 0 8px;font-size:22px;line-height:1.25}
p{margin:0 0 16px;color:var(--soft);font-size:14px}
.code{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 12px;padding:14px 16px;border:1px solid var(--line-strong);border-radius:10px;background:rgba(0,0,0,.35);font-family:ui-monospace,"Cascadia Code","Cascadia Mono",Consolas,monospace;font-size:15px;letter-spacing:.08em;user-select:none;-webkit-user-select:none}
.code small{color:var(--muted);font-family:inherit;font-size:12px;letter-spacing:0;white-space:nowrap}
button{width:100%;padding:12px 16px;border:0;border-radius:10px;background:var(--red);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:hover{background:var(--red-dark)}
button:focus-visible{outline:2px solid #fff;outline-offset:2px}
button:disabled{opacity:.5;cursor:not-allowed}
button.done{background:#1f7a52}
.status{min-height:22px;margin:12px 0 0;font-size:13px}
.status.ok{color:var(--green)}
.status.bad{color:#ff8b95}
.note{margin:20px 0 0;padding-top:16px;border-top:1px solid var(--line)}
.note p{margin:0 0 6px;color:var(--muted);font-size:12px}
`;

function shell(title: string, nonce: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main class="card">
<div class="brand"><span class="mark" aria-hidden="true"><i></i></span><strong>ValorPredict</strong></div>
${body}
</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;
}

export function renderCodePage(opts: { code: string; remainingSeconds: number; nonce: string }): string {
  // The code is [A-Za-z0-9_-] only, but escape `<` anyway so it can never close the script tag.
  const codeLiteral = JSON.stringify(opts.code).replace(/</g, "\\u003c");
  const script = `
"use strict";
let code = ${codeLiteral};
const end = performance.now() + ${Math.max(0, Math.floor(opts.remainingSeconds))} * 1000;
const btn = document.getElementById("copy");
const status = document.getElementById("status");
const timer = document.getElementById("timer");
const mask = document.getElementById("mask");
function say(text, kind) { status.textContent = text; status.className = "status " + (kind || ""); }
function copied() {
  btn.textContent = "Copied \\u2713";
  btn.classList.add("done");
  say("Now switch to ValorPredict and click \\u201CPaste from clipboard\\u201D.", "ok");
}
function blocked() { say("Your browser blocked copying. Allow clipboard access for this page, then try again.", "bad"); }
function legacyCopy() {
  const box = document.createElement("textarea");
  box.value = code;
  box.setAttribute("readonly", "");
  box.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  document.body.appendChild(box);
  box.select();
  let worked = false;
  try { worked = document.execCommand("copy"); } catch (e) { worked = false; }
  box.remove();
  if (worked) copied(); else blocked();
}
btn.addEventListener("click", async () => {
  if (!code) return;
  try { await navigator.clipboard.writeText(code); copied(); } catch (e) { legacyCopy(); }
});
function tick() {
  const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
  if (left === 0) {
    code = "";
    btn.disabled = true;
    btn.textContent = "Code expired";
    mask.textContent = "vp1_expired";
    timer.textContent = "";
    say("This code has expired. Return to ValorPredict and click Connect Twitch to start again.", "bad");
    clearInterval(handle);
    return;
  }
  timer.textContent = "expires in " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
}
const handle = setInterval(tick, 1000);
tick();
`;

  const body = `<h1>Almost done</h1>
<p>Twitch approved the connection. Copy your connection code, then paste it into ValorPredict.</p>
<div class="code" aria-label="Connection code (hidden)"><span id="mask">vp1_••••••••••••</span><small id="timer"></small></div>
<button id="copy" type="button">Copy connection code</button>
<p id="status" class="status" role="status" aria-live="polite"></p>
<noscript><p class="status bad">Your browser has JavaScript turned off, so the code can't be copied. Turn it on for this page and refresh, or start again from ValorPredict.</p></noscript>
<div class="note">
<p><strong>Keep it private.</strong> This code lets ValorPredict act on your Twitch channel. Don't share it or post it anywhere.</p>
<p>It stops working after 10 minutes. You can close this tab once you've pasted it.</p>
</div>`;

  return shell("ValorPredict — Connect Twitch", opts.nonce, body, script);
}

export function renderErrorPage(opts: { title: string; message: string; nonce: string }): string {
  const body = `<h1>${escapeHtml(opts.title)}</h1>
<p>${escapeHtml(opts.message)}</p>
<p>Return to ValorPredict and click <strong>Connect Twitch</strong> to try again.</p>`;
  return shell(`ValorPredict — ${opts.title}`, opts.nonce, body);
}

/** An HTML response locked down with a nonce-based CSP. */
export function htmlResponse(html: string, nonce: string, status = 200, cookies: string[] = []): Response {
  const headers = baseHeaders({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(html, { status, headers });
}

export function errorPageResponse(
  title: string,
  message: string,
  status: number,
  cookies: string[] = [],
): Response {
  const nonce = makeNonce();
  return htmlResponse(renderErrorPage({ title, message, nonce }), nonce, status, cookies);
}
