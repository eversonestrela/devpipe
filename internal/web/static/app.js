/* DevPipe — interface (JS puro, sem dependências; CSP sem scripts inline). */
"use strict";

const STAGE_COLOR = {
  backlog: "#60a5fa", analise: "#c084fc", planejamento: "#a78bfa", preparacao: "#22d3ee",
  desenvolvimento: "#e879f9", validacao: "#fbbf24", revisao: "#fb923c", concluido: "#34d399",
  bloqueado: "#f87171", ajustes: "#f472b6",
};
const FLOW = ["backlog", "analise", "planejamento", "preparacao", "desenvolvimento", "validacao", "revisao", "concluido"];
const PRIO = { 1: "Crítica", 2: "Alta", 3: "Normal", 4: "Baixa" };
const STATUS = { na_fila: "Na fila", executando: "Executando", aguardando_aprovacao: "Aguardando você", parado: "Parado", falhou: "Falhou", cancelado: "Cancelado", concluido: "Concluído" };
const VALID = { ok: "Validação OK", falhou: "Validação falhou", nao_executada: "Sem validação" };
const LEVEL = { info: "info", aviso: "aviso", erro: "erro", autorizacao: "autorização", sucesso: "sucesso", agente: "agente" };

const S = { showEmpty: false, meta: null, projects: [], demands: [], settings: null, events: [], lastEventId: 0, filters: { q: "", project: "", prio: "" }, monitor: { level: "", demand: "", paused: false }, flashIds: new Set() };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------ utilidades
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function stageLabel(id) { const s = S.meta?.stages.find((x) => x.id === id); return s ? s.label : id; }
function fmtTime(t) { if (!t) return "—"; const d = new Date(t); return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function fmtDate(t) { if (!t) return "—"; const d = new Date(t); return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function fmtDur(sec) { sec = Math.max(0, Math.round(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}h${String(m).padStart(2, "0")}m` : m ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`; }
function ago(t) { if (!t) return ""; const s = (Date.now() - new Date(t)) / 1000; if (s < 60) return "agora"; if (s < 3600) return `há ${Math.floor(s / 60)} min`; if (s < 86400) return `há ${Math.floor(s / 3600)} h`; return `há ${Math.floor(s / 86400)} d`; }
function fileSize(n) { return n > 1 << 20 ? (n / (1 << 20)).toFixed(1) + " MB" : n > 1024 ? (n / 1024).toFixed(0) + " KB" : n + " B"; }

async function api(method, url, body, isForm) {
  const opt = { method, headers: { "X-DevPipe": "1" } };
  if (body !== undefined) {
    if (isForm) opt.body = body;
    else { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  }
  const r = await fetch(url, opt);
  let data = null;
  try { data = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) throw new Error(data?.error || `Erro HTTP ${r.status}`);
  return data;
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 8000 : 4200);
}

async function guarded(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg, "ok"); return r; }
  catch (e) { toast(e.message, "err"); throw e; }
}

// Markdown mínimo e seguro (escapa tudo antes de formatar).
function md(src) {
  if (!src) return "";
  const lines = String(src).replace(/\r/g, "").split("\n");
  let out = "", inCode = false, list = null, table = false;
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  const closeTable = () => { if (table) { out += "</table>"; table = false; } };
  for (const raw of lines) {
    const l = raw;
    if (l.trim().startsWith("```")) { closeList(); closeTable(); out += inCode ? "</pre>" : "<pre>"; inCode = !inCode; continue; }
    if (inCode) { out += esc(l) + "\n"; continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { closeList(); closeTable(); const n = m[1].length; out += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      closeList();
      if (/^\s*\|[\s:\-|]+\|\s*$/.test(l)) continue;
      if (!table) { out += "<table>"; table = true; }
      out += "<tr>" + l.trim().slice(1, -1).split("|").map((c) => `<td>${inline(c.trim())}</td>`).join("") + "</tr>";
      continue;
    }
    closeTable();
    if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { if (list !== "ul") { closeList(); out += "<ul>"; list = "ul"; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== "ol") { closeList(); out += "<ol>"; list = "ol"; } out += `<li>${inline(m[1])}</li>`; continue; }
    closeList();
    if (l.trim() === "") { out += ""; continue; }
    out += `<p>${inline(l)}</p>`;
  }
  closeList(); closeTable(); if (inCode) out += "</pre>";
  return out;
}

function renderDiff(text) {
  if (!text) return '<div class="empty">Sem alterações.</div>';
  return '<div class="diff">' + text.split("\n").map((l) => {
    const c = l.startsWith("diff --git") ? "f" : l.startsWith("@@") ? "h" : l.startsWith("+") && !l.startsWith("+++") ? "a" : l.startsWith("-") && !l.startsWith("---") ? "d" : "";
    return `<div class="${c}">${esc(l) || " "}</div>`;
  }).join("") + "</div>";
}

// copia texto para a área de transferência (com fallback para contextos sem Clipboard API)
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove(); return ok;
  }
}

// ------------------------------------------------------------ comparador (lado a lado / linha por linha)
let pendingCmp = null;
const CMP = { demandId: 0, file: "", mode: localStorage.getItem("devpipe.cmpMode") || "lado", onlyChanges: localStorage.getItem("devpipe.cmpOnly") === "1", collapsed: new Set(), filter: "", scroll: 0, full: false };

// Converte o diff (arquivo inteiro como contexto) em linhas alinhadas.
function parseFullDiff(text) {
  const rows = [];
  let o = 0, n = 0, started = false, dels = [], adds = [];
  const flush = () => {
    const k = Math.max(dels.length, adds.length);
    for (let i = 0; i < k; i++) rows.push({ t: dels[i] && adds[i] ? "m" : dels[i] ? "d" : "a", l: dels[i] || null, r: adds[i] || null });
    dels = []; adds = [];
  };
  for (const line of text.split("\n")) {
    if (!started) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (m) { started = true; o = +m[1] || 1; n = +m[2] || 1; if (+m[1] === 0) o = 1; if (+m[2] === 0) n = 1; }
      continue;
    }
    if (line.startsWith("@@")) { flush(); const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line); if (m) { o = +m[1]; n = +m[2]; } continue; }
    const c = line[0], tx = line.slice(1).replace(/\r$/, "");
    if (line.endsWith("\r")) rows.crlf = true;
    if (c === "-") dels.push({ n: o++, tx });
    else if (c === "+") adds.push({ n: n++, tx });
    else if (c === " ") { flush(); rows.push({ t: "c", l: { n: o++, tx }, r: { n: n++, tx } }); }
    else if (c === "\\") continue;
  }
  flush();
  return rows;
}

// destaca a parte alterada entre duas linhas (prefixo/sufixo comuns)
function intraLine(a, b) {
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0; while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const mk = (x) => esc(x.slice(0, p)) + (x.length - s > p ? `<mark>${esc(x.slice(p, x.length - s))}</mark>` : "") + esc(x.slice(x.length - s));
  return [mk(a), mk(b)];
}

function fileIcon(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return { cs: "C#", sql: "SQL", js: "JS", ts: "TS", aspx: "◇", ascx: "◇", xml: "‹›", xsd: "‹›", config: "⚙", json: "{}", css: "#", html: "‹›", md: "¶", txt: "≡", vb: "VB", py: "Py", go: "Go" }[ext] || "▢";
}

function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/"); let node = root, acc = "";
    for (const p of parts.slice(0, -1)) { acc += (acc ? "/" : "") + p; if (!node.dirs.has(p)) node.dirs.set(p, { path: acc, dirs: new Map(), files: [] }); node = node.dirs.get(p); }
    node.files.push(f);
  }
  // compacta pastas com um único filho (Base/Context, como no Visual Studio)
  const compact = (name, n) => { while (n.files.length === 0 && n.dirs.size === 1) { const [k, v] = [...n.dirs][0]; name += "/" + k; n = v; } return [name, n]; };
  return { root, compact };
}

async function mountComparator(box, d, files) {
  if (CMP.demandId !== d.id) { CMP.demandId = d.id; CMP.file = ""; CMP.collapsed = new Set(); CMP.scroll = 0; }
  if (!files.length) { box.innerHTML = emptyState("Sem alterações", "A demanda ainda não alterou arquivos."); return; }
  if (!files.find((f) => f.path === CMP.file)) CMP.file = (files.find((f) => f.status !== "D") || files[0]).path;
  const totA = files.reduce((s, f) => s + f.added, 0), totD = files.reduce((s, f) => s + f.removed, 0);
  box.innerHTML = `<div class="cmp ${CMP.full ? "full" : ""}">
    <div class="cmp-bar">
      <span class="cmp-all">Todas as alterações <b>${files.length}</b> <span class="ad">+${totA}</span> <span class="dl">−${totD}</span></span>
      <input class="cmp-filter" placeholder="Filtrar arquivos…" value="${esc(CMP.filter)}">
      <div class="cmp-cur"><b id="cmp-name"></b><span class="mono small muted" id="cmp-path"></span></div>
      <span class="grow"></span>
      <label class="small muted cmp-chk"><input type="checkbox" id="cmp-only" ${CMP.onlyChanges ? "checked" : ""}> Só trechos alterados</label>
      <div class="seg"><button data-mode="lado" class="${CMP.mode === "lado" ? "on" : ""}" title="Comparação lado a lado">◫ Lado a lado</button><button data-mode="linha" class="${CMP.mode === "linha" ? "on" : ""}" title="Linha por linha (unificado)">☰ Linha por linha</button></div>
      <button class="btn sm" id="cmp-prev" title="Alteração anterior (Shift+F7)">↑</button><button class="btn sm" id="cmp-next" title="Próxima alteração (F7)">↓</button>
      <div class="seg"><button id="cmp-copy-l" title="Copiar o código ANTES (arquivo original completo)">⧉ Copiar antes</button><button id="cmp-copy-r" title="Copiar o código DEPOIS (arquivo alterado completo)">⧉ Copiar depois</button></div>
      <button class="btn sm" id="cmp-full" title="Tela cheia">⤢</button>
    </div>
    <div class="cmp-body"><div class="cmp-tree" id="cmp-tree"></div><div class="cmp-view" id="cmp-view"></div></div></div>`;
  const tree = $("#cmp-tree", box), view = $("#cmp-view", box);

  const drawTree = () => {
    const q = CMP.filter.toLowerCase();
    const vis = files.filter((f) => !q || f.path.toLowerCase().includes(q));
    const { root, compact } = buildTree(vis);
    const st = { A: ["novo", "add"], D: ["excluído", "del"], M: ["alterado", "mod"], T: ["tipo", "mod"] };
    const rec = (n, depth) => {
      let h = "";
      for (const [k, v] of [...n.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
        const [name, node] = compact(k, v);
        const closed = CMP.collapsed.has(node.path);
        h += `<div class="ct-dir" data-dir="${esc(node.path)}" style="padding-left:${8 + depth * 14}px"><i>${closed ? "▸" : "▾"}</i> 📁 ${esc(name)}</div>`;
        if (!closed) h += rec(node, depth + 1);
      }
      for (const f of n.files.sort((a, b) => a.path.localeCompare(b.path))) {
        const nm = f.path.split("/").pop(); const s = st[f.status] || ["", "mod"];
        h += `<div class="ct-file ${f.path === CMP.file ? "on" : ""}" data-file="${esc(f.path)}" title="${esc(f.path)} — ${s[0]}" style="padding-left:${22 + depth * 14}px"><span class="fi">${fileIcon(nm)}</span><span class="nm">${esc(nm)}</span><span class="st ${s[1]}">${esc(f.status)}</span>${f.binary ? '<span class="small muted">bin</span>' : `<span class="ad">+${f.added}</span><span class="dl">−${f.removed}</span>`}</div>`;
      }
      return h;
    };
    tree.innerHTML = vis.length ? rec(root, 0) : '<div class="small muted" style="padding:10px">Nenhum arquivo.</div>';
    $$(".ct-dir", tree).forEach((el) => el.addEventListener("click", () => { const p = el.dataset.dir; CMP.collapsed.has(p) ? CMP.collapsed.delete(p) : CMP.collapsed.add(p); drawTree(); }));
    $$(".ct-file", tree).forEach((el) => el.addEventListener("click", () => { CMP.file = el.dataset.file; CMP.scroll = 0; drawTree(); loadFile(); }));
  };

  let rows = [], changeStarts = [], curChange = -1;
  const loadFile = async () => {
    const f = files.find((x) => x.path === CMP.file); if (!f) return;
    $("#cmp-name", box).textContent = CMP.file.split("/").pop();
    $("#cmp-path", box).textContent = "/" + CMP.file + `  (+${f.added} −${f.removed})`;
    view.innerHTML = '<div class="small muted" style="padding:16px">Carregando…</div>';
    let r;
    try { r = await api("GET", `/api/demands/${d.id}/diff/file?path=${encodeURIComponent(CMP.file)}`); }
    catch (e) { view.innerHTML = `<div class="callout bad">${esc(e.message)}</div>`; return; }
    if (r.binary) { view.innerHTML = '<div class="callout info">Arquivo binário — comparação de conteúdo não disponível.</div>'; return; }
    rows = parseFullDiff(r.diff || "");
    drawView(r.truncated);
  };

  const drawView = (trunc) => {
    changeStarts = []; curChange = -1;
    rows.forEach((x, i) => { if (x.t !== "c" && (i === 0 || rows[i - 1].t === "c")) changeStarts.push(i); });
    // "só trechos alterados": mantém 3 linhas de contexto ao redor das mudanças
    let show = rows.map(() => true);
    if (CMP.onlyChanges) {
      show = rows.map(() => false);
      rows.forEach((x, i) => { if (x.t !== "c") for (let k = Math.max(0, i - 3); k <= Math.min(rows.length - 1, i + 3); k++) show[k] = true; });
    }
    const parts = [];
    let skipped = 0;
    const gap = () => { if (skipped) { parts.push(CMP.mode === "lado" ? `<tr class="gap"><td colspan="4">⋯ ${skipped} linha(s) sem alteração</td></tr>` : `<tr class="gap"><td colspan="4">⋯ ${skipped} linha(s) sem alteração</td></tr>`); skipped = 0; } };
    rows.forEach((x, i) => {
      if (!show[i]) { skipped++; return; }
      gap();
      const id = changeStarts.includes(i) ? ` id="chg-${changeStarts.indexOf(i)}"` : "";
      if (CMP.mode === "lado") {
        let lt = x.l ? esc(x.l.tx) : "", rt = x.r ? esc(x.r.tx) : "";
        if (x.t === "m") [lt, rt] = intraLine(x.l.tx, x.r.tx);
        const lc = x.t === "c" ? "" : x.l ? "del" : "nil", rc = x.t === "c" ? "" : x.r ? "add" : "nil";
        parts.push(`<tr${id}><td class="ln ${lc}">${x.l ? x.l.n : ""}</td><td class="tx ${lc}">${lt || (x.l ? " " : "")}</td><td class="ln ${rc}">${x.r ? x.r.n : ""}</td><td class="tx ${rc}">${rt || (x.r ? " " : "")}</td></tr>`);
      } else {
        if (x.t === "c") parts.push(`<tr${id}><td class="ln">${x.l.n}</td><td class="ln">${x.r.n}</td><td class="sg"> </td><td class="tx">${esc(x.l.tx) || " "}</td></tr>`);
        else {
          let lt = x.l ? esc(x.l.tx) : "", rt = x.r ? esc(x.r.tx) : "";
          if (x.t === "m") [lt, rt] = intraLine(x.l.tx, x.r.tx);
          if (x.l) parts.push(`<tr${id}><td class="ln del">${x.l.n}</td><td class="ln del"></td><td class="sg del">−</td><td class="tx del">${lt || " "}</td></tr>`);
          if (x.r) parts.push(`<tr${x.l ? "" : id}><td class="ln add"></td><td class="ln add">${x.r.n}</td><td class="sg add">+</td><td class="tx add">${rt || " "}</td></tr>`);
        }
      }
    });
    gap();
    const head = CMP.mode === "lado" ? `<colgroup><col class="c-ln"><col><col class="c-ln"><col></colgroup><thead><tr><th colspan="2"><span class="cmp-th">Original (base)<button class="cmp-cp" data-copy="l" title="Copiar o código antes">⧉ Copiar</button></span></th><th colspan="2"><span class="cmp-th">Alterado (demanda)<button class="cmp-cp" data-copy="r" title="Copiar o código depois">⧉ Copiar</button></span></th></tr></thead>` : `<colgroup><col class="c-ln"><col class="c-ln"><col class="c-sg"><col></colgroup>`;
    view.innerHTML = (trunc ? '<div class="callout warn small">Arquivo muito grande: exibição truncada.</div>' : "") + (rows.length ? `<table class="cmp-tab ${CMP.mode}">${head}<tbody>${parts.join("")}</tbody></table>` : '<div class="small muted" style="padding:16px">Sem diferenças de conteúdo.</div>');
    view.scrollTop = CMP.scroll;
    $$("[data-copy]", view).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); copySide(b.dataset.copy); }));
    const hasL = rows.some((x) => x.l), hasR = rows.some((x) => x.r);
    $("#cmp-copy-l", box).disabled = !hasL; $("#cmp-copy-r", box).disabled = !hasR;
    $$('[data-copy="l"]', view).forEach((b) => (b.disabled = !hasL));
    $$('[data-copy="r"]', view).forEach((b) => (b.disabled = !hasR));
  };

  // monta o arquivo completo de um lado ("l" = antes, "r" = depois) e copia
  const copySide = async (side) => {
    const lines = rows.filter((x) => x[side]).map((x) => x[side].tx);
    const label = side === "l" ? "antes" : "depois";
    if (!lines.length) { toast(`Não há código ${label} neste arquivo`, "err"); return; }
    const ok = await copyText(lines.join(rows.crlf ? "\r\n" : "\n"));
    toast(ok ? `Código ${label} copiado (${lines.length} linha${lines.length > 1 ? "s" : ""})` : "Não foi possível copiar", ok ? "ok" : "err");
  };

  const goChange = (dir) => {
    if (!changeStarts.length) return;
    curChange = (curChange + dir + changeStarts.length) % changeStarts.length;
    const el = $(`#chg-${curChange}`, view);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 900); }
  };
  view.addEventListener("scroll", () => { CMP.scroll = view.scrollTop; });
  $$("[data-mode]", box).forEach((b) => b.addEventListener("click", () => { CMP.mode = b.dataset.mode; localStorage.setItem("devpipe.cmpMode", CMP.mode); $$("[data-mode]", box).forEach((x) => x.classList.toggle("on", x === b)); drawView(); }));
  $("#cmp-only", box).addEventListener("change", (e) => { CMP.onlyChanges = e.target.checked; localStorage.setItem("devpipe.cmpOnly", CMP.onlyChanges ? "1" : "0"); drawView(); });
  $("#cmp-prev", box).addEventListener("click", () => goChange(-1));
  $("#cmp-next", box).addEventListener("click", () => goChange(1));
  $("#cmp-copy-l", box).addEventListener("click", () => copySide("l"));
  $("#cmp-copy-r", box).addEventListener("click", () => copySide("r"));
  // lado a lado: ao selecionar com o mouse, limita a seleção à coluna clicada
  view.addEventListener("mousedown", (e) => {
    const t = $(".cmp-tab.lado", view); if (!t) return;
    const td = e.target.closest("td.tx");
    t.classList.remove("sel-l", "sel-r");
    if (td) t.classList.add(td.cellIndex === 1 ? "sel-l" : "sel-r");
  });
  $("#cmp-full", box).addEventListener("click", () => { CMP.full = !CMP.full; $(".cmp", box).classList.toggle("full", CMP.full); });
  $(".cmp-filter", box).addEventListener("input", (e) => { CMP.filter = e.target.value; drawTree(); });
  box.addEventListener("keydown", (e) => { if (e.key === "F7") { e.preventDefault(); goChange(e.shiftKey ? -1 : 1); } if (e.key === "Escape" && CMP.full) { CMP.full = false; $(".cmp", box).classList.remove("full"); } });
  box.tabIndex = -1;
  drawTree();
  await loadFile();
}

// ------------------------------------------------------------ dados
async function loadBase() {
  [S.meta, S.projects, S.demands, S.settings] = await Promise.all([api("GET", "/api/meta"), api("GET", "/api/projects"), api("GET", "/api/demands"), api("GET", "/api/settings")]);
  updateAIIndicator();
}
async function reloadDemands() { const antes = S.demands; S.demands = await api("GET", "/api/demands"); updateAIIndicator(); AVISO.comparar(antes, S.demands); }
function updateAIIndicator() {
  const n = S.demands.filter((d) => d.status === "executando").length;
  const el = $("#ai-indicator");
  el.className = "ai-ind " + (n ? "on" : "idle");
  $(".lbl", el).textContent = n ? `IA ativa · ${n} missão${n > 1 ? "ões" : ""}` : "IA ociosa";
}


// ------------------------------------------------------------ avisos ("precisa de você")
// Quando uma demanda passa a depender de você (revisão, aprovação da especificação,
// bloqueio ou falha), o DevPipe avisa: notificação do Windows (com a aba em segundo
// plano), som curto e contador no título da aba e no ícone. Preferências ficam no
// navegador (localStorage); nada vai para o servidor.
const AVISO = {
  pref: { ligado: localStorage.getItem("devpipe.avisos") !== "0", som: localStorage.getItem("devpipe.avisosSom") !== "0" },
  avisados: new Map(), // id -> chave da situação já avisada (evita repetir em reconexões)
  audio: null,
  tituloBase: document.title,
  iconeBase: null,

  precisa(d) {
    if (!d) return null;
    if (d.status === "aguardando_aprovacao" && d.stage === "revisao") return { tipo: "revisao", texto: "Pronta para sua revisão" };
    if (d.status === "aguardando_aprovacao") return { tipo: "aprovacao", texto: "Especificação aguardando sua aprovação" };
    if (d.stage === "bloqueado" || d.status === "falhou") return { tipo: "bloqueio", texto: "Bloqueada" + (d.message ? ": " + d.message : "") };
    return null;
  },
  chave(d) { return `${d.stage}|${d.status}|${d.currentRevision || ""}`; },

  iniciar() {
    this.iconeBase = $('link[rel="icon"]')?.href || "";
    // situação inicial: o que já estava pendente não gera aviso, só entra no contador
    for (const d of S.demands) if (this.precisa(d)) this.avisados.set(d.id, this.chave(d));
    this.atualizarContador();
    this.montarControle();
    // o navegador só libera som depois de um clique na página
    const liberar = () => { this.prepararAudio(); document.removeEventListener("pointerdown", liberar); document.removeEventListener("keydown", liberar); };
    document.addEventListener("pointerdown", liberar);
    document.addEventListener("keydown", liberar);
  },

  verificar(antes, d) {
    const p = this.precisa(d);
    if (!p) { this.avisados.delete(d.id); this.atualizarContador(); return; }
    const k = this.chave(d);
    if (this.avisados.get(d.id) !== k && (!antes || this.chave(antes) !== k)) {
      this.avisados.set(d.id, k);
      this.avisar(d, p);
    } else this.avisados.set(d.id, k);
    this.atualizarContador();
  },
  comparar(antes, depois) {
    const ant = new Map((antes || []).map((x) => [x.id, x]));
    for (const d of depois) this.verificar(ant.get(d.id), d);
    for (const id of [...this.avisados.keys()]) if (!depois.some((d) => d.id === id)) this.avisados.delete(id);
    this.atualizarContador();
  },

  avisar(d, p) {
    if (!this.pref.ligado) return;
    const titulo = `${d.ticket} · ${p.texto.split(":")[0]}`;
    const corpo = `${d.title}${p.tipo === "bloqueio" && d.message ? "\n" + d.message : ""}`;
    const emFoco = document.visibilityState === "visible" && document.hasFocus();
    if (!emFoco && "Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(titulo, { body: corpo, tag: "devpipe-" + d.id, icon: this.iconeBase || undefined, requireInteraction: p.tipo !== "revisao" });
        n.onclick = () => { window.focus(); location.hash = `#/demandas/${d.id}`; n.close(); };
      } catch { /* alguns navegadores bloqueiam fora de contexto seguro */ }
    }
    toast(`${titulo}: ${d.title}`, p.tipo === "bloqueio" ? "err" : "");
    if (this.pref.som) this.tocar(p.tipo);
  },

  prepararAudio() {
    if (this.audio) return;
    try { this.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.audio = null; }
  },
  tocar(tipo) {
    const ctx = this.audio; if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    // revisão/aprovação: dois tons subindo; bloqueio: dois tons descendo
    const notas = tipo === "bloqueio" ? [660, 440] : [660, 880];
    notas.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.16;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3);
    });
  },

  pendentes() { return S.demands.filter((d) => this.precisa(d)); },
  atualizarContador() {
    const n = this.pendentes().length;
    document.title = n ? `(${n}) ${this.tituloBase}` : this.tituloBase;
    this.desenharIcone(n);
    const b = $("#aviso-ctl .qtd");
    if (b) { b.textContent = n ? `${n} esperando você` : "nada pendente"; b.classList.toggle("tem", !!n); }
  },
  desenharIcone(n) {
    const link = $('link[rel="icon"]'); if (!link) return;
    if (!n) { if (this.iconeBase) link.href = this.iconeBase; return; }
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const img = new Image();
    img.onload = () => {
      g.drawImage(img, 0, 0, 64, 64);
      g.fillStyle = "#f59e0b"; g.beginPath(); g.arc(46, 18, 17, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0b1119"; g.font = "bold 24px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(n > 9 ? "9+" : String(n), 46, 19);
      link.href = c.toDataURL("image/png");
    };
    img.src = this.iconeBase;
  },

  estadoPermissao() {
    if (!("Notification" in window)) return "indisponivel";
    return Notification.permission; // default | granted | denied
  },
  montarControle() {
    const pe = $(".side-foot"); if (!pe || $("#aviso-ctl")) return;
    pe.insertAdjacentHTML("afterbegin", `<div id="aviso-ctl" class="aviso-ctl">
      <button type="button" class="aviso-sino" title="Avisos quando uma demanda precisar de você"></button>
      <button type="button" class="aviso-som" title="Som dos avisos"></button>
      <span class="qtd"></span></div>`);
    $("#aviso-ctl .aviso-sino").addEventListener("click", () => this.alternar());
    $("#aviso-ctl .aviso-som").addEventListener("click", () => {
      this.pref.som = !this.pref.som; localStorage.setItem("devpipe.avisosSom", this.pref.som ? "1" : "0");
      this.prepararAudio(); if (this.pref.som) this.tocar("revisao");
      this.desenharControle();
    });
    this.desenharControle(); this.atualizarContador();
  },
  desenharControle() {
    const sino = $("#aviso-ctl .aviso-sino"), som = $("#aviso-ctl .aviso-som"); if (!sino) return;
    const perm = this.estadoPermissao();
    let txt = "🔕 Avisos desligados", cls = "off";
    if (this.pref.ligado) {
      if (perm === "granted") { txt = "🔔 Avisos ligados"; cls = "on"; }
      else if (perm === "denied") { txt = "🔔 Só na tela (Windows bloqueado)"; cls = "parcial"; }
      else if (perm === "indisponivel") { txt = "🔔 Avisos na tela"; cls = "parcial"; }
      else { txt = "🔔 Ativar avisos do Windows"; cls = "pedir"; }
    }
    sino.textContent = txt; sino.className = "aviso-sino " + cls;
    sino.title = perm === "denied" ? "O navegador bloqueou as notificações deste site. Libere no cadeado da barra de endereço." : "Avisos quando uma demanda precisar de você";
    som.textContent = this.pref.som ? "🔊" : "🔇"; som.classList.toggle("off", !this.pref.som);
    som.setAttribute("aria-pressed", String(this.pref.som));
  },
  async alternar() {
    this.prepararAudio();
    const perm = this.estadoPermissao();
    if (this.pref.ligado && perm === "default") {
      const r = await Notification.requestPermission();
      if (r === "granted") { toast("Avisos do Windows ativados", "ok"); try { new Notification("DevPipe", { body: "Você será avisado quando uma demanda precisar de você.", icon: this.iconeBase || undefined }); } catch {} }
      this.desenharControle(); return;
    }
    this.pref.ligado = !this.pref.ligado;
    localStorage.setItem("devpipe.avisos", this.pref.ligado ? "1" : "0");
    if (this.pref.ligado && perm === "default") await Notification.requestPermission();
    toast(this.pref.ligado ? "Avisos ligados" : "Avisos desligados", this.pref.ligado ? "ok" : "");
    this.desenharControle();
  },
};

// ------------------------------------------------------------ tempo real (SSE)
let renderTimer = null;
function scheduleRender(onlyIf) { clearTimeout(renderTimer); renderTimer = setTimeout(() => { if (!onlyIf || onlyIf()) render(true); }, 250); }

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onopen = () => { $("#conn").textContent = "● tempo real conectado"; $("#conn").className = "conn ok"; };
  es.onerror = () => { $("#conn").textContent = "● reconectando…"; $("#conn").className = "conn err"; };
  es.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "demand") {
      const d = msg.data; const i = S.demands.findIndex((x) => x.id === d.id);
      const prev = i >= 0 ? S.demands[i] : null;
      if (prev && prev.stage !== d.stage) S.flashIds.add(d.id);
      if (i >= 0) S.demands[i] = d; else S.demands.push(d);
      updateAIIndicator();
      AVISO.verificar(prev, d);
      const r = route();
      if (["dashboard", "esteira"].includes(r.name) || (r.name === "demanda" && +r.id === d.id)) scheduleRender();
    } else if (msg.type === "event") {
      onEvent(msg.data);
    } else if (msg.type === "usage") {
      S.usage = msg.data;
      if (route().name === "dashboard") scheduleRender();
    } else if (msg.type === "reload") {
      reloadDemands().then(() => scheduleRender(() => route().name === "esteira"));
    }
  };
}

function onEvent(ev) {
  S.events.push(ev); if (S.events.length > 1500) S.events.splice(0, 500);
  const r = route();
  if (r.name === "monitor" && !S.monitor.paused && passMonitor(ev)) appendFeed($("#feed"), ev, true);
  if (r.name === "dashboard") appendFeed($("#feed"), ev, false, 40);
  if (r.name === "demanda" && +r.id === ev.demandId) appendFeed($("#dfeed"), ev, true);
  if (ev.level === "autorizacao") toast(`${ev.ticket ? ev.ticket + ": " : ""}${ev.message}`);
}

function evHTML(ev, withCtx = true) {
  const ctx = withCtx && ev.ticket ? `<span class="ctx">${esc(ev.ticket)}${ev.stage ? " · " + esc(stageLabel(ev.stage)) : ""}</span>` : "";
  const det = ev.detail ? `<details><summary>detalhes</summary><pre>${esc(ev.detail)}</pre></details>` : "";
  return `<div class="ev"><span class="t" title="${esc(fmtDate(ev.time))}">${fmtTime(ev.time)}</span><span class="lv lv-${esc(ev.level)}">${esc(LEVEL[ev.level] || ev.level)}</span><div class="m">${ctx}${esc(ev.message)}${det}</div></div>`;
}
function appendFeed(el, ev, autoscroll, max = 2000) {
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.querySelector(".empty")?.remove();
  el.insertAdjacentHTML("beforeend", evHTML(ev, el.id !== "dfeed"));
  while (el.children.length > max) el.firstElementChild.remove();
  if (autoscroll && atBottom) el.scrollTop = el.scrollHeight;
  if (!autoscroll) el.scrollTop = el.scrollHeight;
}

// ------------------------------------------------------------ roteamento
function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  const p = h.split("/").filter(Boolean);
  if (p.length === 0) return { name: "dashboard" };
  if (p[0] === "demandas" && p[1] === "nova") return { name: "nova" };
  if (p[0] === "demandas" && p[2] === "editar") return { name: "editar", id: p[1] };
  if (p[0] === "demandas" && p[1]) return { name: "demanda", id: p[1], tab: p[2] || "visao" };
  return { name: p[0], id: p[1] };
}
const VIEWS = {};
let lastRouteKey = "";
async function render(soft) {
  const r = route();
  const key = location.hash;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === r.name || (r.name === "demanda" && a.dataset.route === "esteira") || (r.name === "editar" && a.dataset.route === "esteira")));
  const view = VIEWS[r.name] || VIEWS.notfound;
  if (soft && ["nova", "editar", "projetos", "regras", "config", "provedores", "monitor"].includes(r.name) && key === lastRouteKey) return; // não interromper formulários
  const scroll = soft ? { y: window.scrollY, board: $(".board")?.scrollLeft } : null;
  try { await view(r, soft); } catch (e) { $("#view").innerHTML = `<div class="panel"><div class="callout bad">⚠ ${esc(e.message)}</div></div>`; }
  if (scroll) { window.scrollTo(0, scroll.y); if ($(".board") && scroll.board) $(".board").scrollLeft = scroll.board; }
  else { window.scrollTo(0, 0); $("#view").focus({ preventScroll: true }); }
  lastRouteKey = key;
}
window.addEventListener("hashchange", () => render());

// ------------------------------------------------------------ componentes
function segbar(d) {
  const idx = FLOW.indexOf(d.stage === "bloqueado" ? d.blockedFrom || "backlog" : d.stage === "ajustes" ? "revisao" : d.stage);
  return `<div class="segbar" title="${d.progress}% das etapas concluídas">${FLOW.slice(1).map((s, i) => `<i class="${i + 1 < idx ? "done" : i + 1 === idx ? (d.stage === "concluido" ? "done" : "cur") : ""}"></i>`).join("")}</div>`;
}
function badgeStatus(d) { return `<span class="badge st-${esc(d.status)}">${esc(STATUS[d.status] || d.status)}</span>`; }
function badgePrio(p) { return `<span class="badge prio-${p}">${esc(PRIO[p] || p)}</span>`; }
function badgeValid(v) { return v ? `<span class="badge v-${esc(v)}">${esc(VALID[v] || v)}</span>` : ""; }
function elapsed(d) { let s = d.elapsedSeconds || 0; return fmtDur(s); }

function cardHTML(d, draggable) {
  const cls = ["card"];
  if (d.status === "executando") cls.push("running");
  if (d.stage === "bloqueado") cls.push("blocked");
  if (d.stage === "concluido") cls.push("done");
  if (S.flashIds.has(d.id)) cls.push("flash");
  const canQueue = ["backlog", "bloqueado", "ajustes"].includes(d.stage) && !["na_fila", "executando"].includes(d.status);
  const ops = [];
  if (canQueue) ops.push(`<button class="btn sm primary" data-act="enqueue" data-id="${d.id}">▶ ${d.stage === "bloqueado" ? "Retomar" : "Executar"}</button>`);
  if (d.status === "executando" || d.status === "na_fila") ops.push(`<button class="btn sm bad" data-act="cancel" data-id="${d.id}">■ ${d.status === "na_fila" ? "Tirar da fila" : "Cancelar"}</button>`);
  if (d.status === "aguardando_aprovacao") ops.push(`<a class="btn sm warn" href="#/demandas/${d.id}">⚑ Revisar</a>`);
  return `<article class="${cls.join(" ")}" style="--sc:${STAGE_COLOR[d.stage]}" data-open="${d.id}" data-id="${d.id}" ${draggable ? 'draggable="true"' : ""}>
    <div class="top"><span class="tk">${esc(d.ticket)}</span>${badgePrio(d.priority)}<span class="grow"></span>${badgeStatus(d)}</div>
    <div class="ttl">${esc(d.title)}</div>
    <div class="meta"><span title="Projeto">⬡ ${esc(d.projectName)}</span><span title="${d.directBranch ? "Direto na branch selecionada" : "Branch"}">⑂ ${esc(d.workBranch || d.baseBranch || "branch atual")}${d.directBranch ? " (direto)" : ""}</span>
      <span title="Tempo de execução">⏱ ${elapsed(d)}</span><span title="Tentativas">↻ ${d.attempts}</span><span title="Provedor">◎ ${esc(d.provider)}</span>${d.currentRevision > 1 ? `<span title="Revisão">rev ${d.currentRevision}</span>` : ""}</div>
    ${d.validationState ? `<div style="margin-top:6px">${badgeValid(d.validationState)}</div>` : ""}
    ${segbar(d)}
    <div class="act" title="${esc(d.lastActivity)}">${d.lastActivity ? esc(d.lastActivity) + " · " + ago(d.lastActivityAt) : "Sem atividade"}</div>
    ${ops.length ? `<div class="ops">${ops.join("")}</div>` : ""}
  </article>`;
}

function emptyState(title, text, action) { return `<div class="empty"><b>${esc(title)}</b>${esc(text)}${action ? `<div style="margin-top:12px">${action}</div>` : ""}</div>`; }

function planPanel(info) {
  const u = info.usage;
  const mode = info.subscriptionOnly ? `<span class="badge v-ok">Somente assinatura Pro — sem cobrança extra</span>` : `<span class="badge v-nao_executada">Chave de API permitida</span>`;
  if (!u) return `<div class="panel" style="margin-top:14px"><div class="row"><h2 style="margin:0">Limite do plano Claude</h2><span class="grow"></span>${mode}</div><div class="small muted" style="margin-top:8px">O consumo aparece aqui após a primeira chamada ao Claude (ou use "Testar conexão" em Provedores de IA).</div></div>`;
  const bar = (label, pct, reset) => { const c = pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--green)";
    return `<div><div class="row small"><span class="muted">${label}</span><span class="grow"></span><b class="mono">${Math.round(pct)}%</b></div><div class="bar"><i style="width:${Math.min(100, pct)}%;background:${c}"></i></div><div class="small dim">renova ${esc(fmtDate(reset))}</div></div>`; };
  return `<div class="panel" style="margin-top:14px"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">Limite do plano Claude</h2><span class="grow"></span>${mode}</div>
    <div class="grid g2">${bar("Janela de 5 horas", u.fiveHourPct, u.fiveHourResetsAt)}${bar("Semana", u.sevenDayPct, u.sevenDayResetsAt)}</div>
    <div class="small dim" style="margin-top:6px">Atualizado ${ago(u.updatedAt)}. Ao atingir o limite, a fila pausa e retoma sozinha quando o plano libera.</div></div>`;
}

// ------------------------------------------------------------ 1. CENTRAL
VIEWS.dashboard = async () => {
  const [stats, events, uinfo] = await Promise.all([api("GET", "/api/stats"), api("GET", "/api/events?limit=40"), api("GET", "/api/usage")]);
  const done = stats.byStage.concluido || 0, blocked = stats.byStage.bloqueado || 0;
  const finished = stats.runsOk + stats.runsFailed;
  const rate = finished ? Math.round((stats.runsOk / finished) * 100) : null;
  const active = S.demands.filter((d) => ["executando", "na_fila", "aguardando_aprovacao"].includes(d.status));
  const level = Math.floor(done / 5) + 1, xp = (done % 5) * 20;
  const total = stats.total || 1;
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>Central de operações</small>Painel de missões</h1><div class="sub">Visão geral da esteira, execuções da IA e eventos recentes.</div></div>
    <div class="row"><a class="btn primary" href="#/demandas/nova">＋ Nova demanda</a><a class="btn" href="#/esteira">▤ Abrir esteira</a></div></div>
  ${uinfo.pausedUntil ? `<div class="callout warn"><div class="grow">⏸ <b>Fila pausada:</b> o limite da assinatura foi atingido. As demandas continuam automaticamente em ${esc(fmtDate(uinfo.pausedUntil))}, sem cobrança extra.</div><button class="btn sm" data-act="resume-queue">Retomar agora</button></div>` : ""}
  ${S.projects.length === 0 ? `<div class="callout info">ℹ Comece cadastrando um <a href="#/projetos">projeto</a> (repositório Git local) e depois crie sua primeira demanda.</div>` : ""}
  <div class="grid g4">
    <div class="panel hud tile c-cyan"><div class="k">Missões totais</div><div class="v">${stats.total}</div><div class="hint">${stats.projects} projeto(s)</div></div>
    <div class="panel hud tile c-violet"><div class="k">Em execução / fila</div><div class="v">${stats.running}<small> / ${stats.queued}</small></div><div class="hint">limite paralelo: ${S.settings.maxParallel}</div></div>
    <div class="panel hud tile c-green"><div class="k">Concluídas</div><div class="v">${done}</div><div class="hint">Nível do pipeline ${level} · ${xp}% p/ próximo</div><div class="bar"><i style="width:${xp}%;--sc:var(--green)"></i></div></div>
    <div class="panel hud tile ${blocked ? "c-red" : ""}"><div class="k">Bloqueadas</div><div class="v">${blocked}</div><div class="hint">${rate === null ? "sem execuções finalizadas" : `taxa de sucesso das execuções: ${rate}%`}</div></div>
  </div>
  <div class="panel" style="margin-top:14px"><h2>Distribuição por etapa</h2>
    <div class="stagebar">${S.meta.stages.map((s) => { const n = stats.byStage[s.id] || 0; return n ? `<i style="width:${(n / total) * 100}%;background:${STAGE_COLOR[s.id]}" title="${esc(s.label)}: ${n}"></i>` : ""; }).join("")}</div>
    <div class="legend">${S.meta.stages.map((s) => `<span style="--c:${STAGE_COLOR[s.id]}">${esc(s.label)} <b>${stats.byStage[s.id] || 0}</b></span>`).join("")}</div>
    <div class="small dim" style="margin-top:8px">Progresso médio: ${stats.avgProgress}% · ${uinfo.subscriptionOnly ? `Custo equivalente em API (informativo — <b>não cobrado</b> na assinatura): US$ ${stats.totalCost.toFixed(2)}` : `Custo informado pelos provedores: US$ ${stats.totalCost.toFixed(2)}`}</div>
  </div>
  ${planPanel(uinfo)}
  <div class="grid g2" style="margin-top:14px">
    <div class="panel"><h2>Missões ativas<span class="count">${active.length}</span></h2>
      <div class="grid" style="gap:8px">${active.length ? active.map((d) => cardHTML(d)).join("") : emptyState("Nenhuma missão ativa", " Coloque uma demanda na fila pela esteira.")}</div></div>
    <div class="panel"><h2>Eventos recentes</h2><div class="feed" id="feed">${events.length ? events.map((e) => evHTML(e)).join("") : emptyState("Sem eventos", "")}</div></div>
  </div>`;
  const f = $("#feed"); f.scrollTop = f.scrollHeight;
  S.flashIds.clear();
};

// ------------------------------------------------------------ 2. ESTEIRA
VIEWS.esteira = async (r, soft) => {
  if (!soft) await reloadDemands();
  const f = S.filters;
  const list = S.demands.filter((d) =>
    (!f.project || d.projectId === +f.project) && (!f.prio || d.priority === +f.prio) &&
    (!f.q || (d.ticket + " " + d.title + " " + d.summary + " " + d.workBranch + " " + d.baseBranch).toLowerCase().includes(f.q.toLowerCase())));
  const flowDone = S.demands.length ? Math.round(S.demands.reduce((a, d) => a + d.progress, 0) / S.demands.length) : 0;
  const prev = document.activeElement?.id;
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>Pipeline</small>Esteira de desenvolvimento</h1><div class="sub">Arraste cards no Backlog para reordenar a fila. Arraste para Backlog ou Bloqueado para mover manualmente. Demais etapas são controladas pela esteira.</div></div>
    <a class="btn primary" href="#/demandas/nova">＋ Nova demanda</a></div>
  <div class="panel" style="margin-bottom:12px;padding:12px"><div class="row">
    <input type="search" id="fq" placeholder="Pesquisar ticket, título, branch…" value="${esc(f.q)}" style="max-width:260px">
    <select id="fp" style="max-width:200px"><option value="">Todos os projetos</option>${S.projects.map((p) => `<option value="${p.id}" ${+f.project === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
    <select id="fr" style="max-width:180px"><option value="">Todas as prioridades</option>${[1, 2, 3, 4].map((p) => `<option value="${p}" ${+f.prio === p ? "selected" : ""}>${PRIO[p]}</option>`).join("")}</select>
    <label class="check" style="margin:0"><input type="checkbox" id="fe" ${S.showEmpty ? "checked" : ""}><span class="small">Expandir etapas vazias</span></label>
    <span class="grow"></span><span class="small muted">Progresso geral</span><div class="bar" style="width:120px;margin:0"><i style="width:${flowDone}%"></i></div><span class="mono small">${flowDone}%</span>
  </div></div>
  <div class="board">${S.meta.stages.map((s) => {
    const items = list.filter((d) => d.stage === s.id);
    const collapsed = !items.length && !S.showEmpty;
    return `<section class="col ${collapsed ? "collapsed" : ""}" data-stage="${s.id}" style="--sc:${STAGE_COLOR[s.id]}" title="${collapsed ? esc(s.label) + " — vazia" : ""}"><div class="col-head"><span class="pip"></span>${esc(s.label)}<span class="n">${items.length}</span></div>
      <div class="col-body">${items.length ? items.map((d) => cardHTML(d, s.id === "backlog" || ["parado", "falhou", "cancelado"].includes(d.status))).join("") : `<div class="col-empty">—</div>`}</div></section>`;
  }).join("")}</div>`;
  S.flashIds.clear();
  const bindFilter = (id, key) => $(id).addEventListener("input", (e) => { S.filters[key] = e.target.value; VIEWS.esteira(r, true).then(() => { const el = $(id); el.focus(); if (el.setSelectionRange && el.type === "search") el.setSelectionRange(el.value.length, el.value.length); }); });
  $("#fe").addEventListener("change", (e) => { S.showEmpty = e.target.checked; VIEWS.esteira(r, true); });
  bindFilter("#fq", "q"); bindFilter("#fp", "project"); bindFilter("#fr", "prio");
  if (prev && $("#" + prev)) $("#" + prev).focus();
  bindDrag();
};

function bindDrag() {
  let dragId = null;
  $$(".card[draggable=true]").forEach((c) => {
    c.addEventListener("dragstart", (e) => { dragId = +c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.dataset.id); });
    c.addEventListener("dragend", () => { c.classList.remove("dragging"); $$(".col").forEach((x) => x.classList.remove("drop-ok")); });
  });
  $$(".col").forEach((col) => {
    const stage = col.dataset.stage;
    if (!["backlog", "bloqueado"].includes(stage)) return;
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-ok"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop-ok"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault(); col.classList.remove("drop-ok");
      const id = dragId; if (!id) return;
      const d = S.demands.find((x) => x.id === id);
      if (stage === "backlog" && d.stage === "backlog") {
        // reordenar pela posição vertical
        const cards = $$(".card", col).filter((c) => +c.dataset.id !== id);
        let idx = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
        if (idx < 0) idx = cards.length;
        const ids = cards.map((c) => +c.dataset.id); ids.splice(idx, 0, id);
        const others = S.demands.filter((x) => x.stage !== "backlog").map((x) => x.id);
        await guarded(() => api("POST", "/api/queue/reorder", { ids: [...ids, ...others] }));
        await reloadDemands(); render(true);
      } else if (d.stage !== stage) {
        await guarded(() => api("POST", `/api/demands/${id}/move`, { stage }), `Movida para ${stageLabel(stage)}`);
      }
    });
  });
}

// ------------------------------------------------------------ 3. CADASTRO / EDIÇÃO
VIEWS.nova = async () => demandForm(null);
VIEWS.editar = async (r) => { const det = await api("GET", `/api/demands/${r.id}`); demandForm(det); };

async function demandForm(det) {
  S.projects = await api("GET", "/api/projects");
  const d = det?.demand || { priority: 3, provider: S.settings.defaultProvider, reviewSpec: false, projectId: S.projects[0]?.id || 0 };
  const instr = det ? det.revisions[0]?.instructions || "" : "";
  const editing = !!det;
  const providers = await api("GET", "/api/providers").catch(() => []);
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>${editing ? "Editar demanda" : "Cadastro"}</small>${editing ? esc(d.ticket) : "Nova demanda"}</h1>
    <div class="sub">${editing ? "Edite os dados da missão. Para mudar o escopo de uma demanda já desenvolvida, use 'Devolver para ajustes' nos detalhes." : "Descreva a demanda e anexe a especificação (PDF, Word, texto, Markdown, imagens). A IA converte tudo em uma especificação estruturada."}</div></div></div>
  <form id="dform" class="grid g2" autocomplete="off">
    <div class="panel hud">
      <h2>Identificação</h2>
      <div class="grid g2" style="gap:10px">
        <label class="f"><span>Ticket / chamado <em>*</em></span><input type="text" name="ticket" required value="${esc(d.ticket)}" placeholder="CH-1234"></label>
        <label class="f"><span>Prioridade</span><select name="priority">${[1, 2, 3, 4].map((p) => `<option value="${p}" ${d.priority === p ? "selected" : ""}>${PRIO[p]}</option>`).join("")}</select></label>
      </div>
      <label class="f"><span>Título <em>*</em></span><input type="text" name="title" required value="${esc(d.title)}" placeholder="Ex.: Incluir filtro por período no relatório de vendas"></label>
      <label class="f"><span>Descrição resumida</span><input type="text" name="summary" value="${esc(d.summary)}"></label>
      <label class="f"><span>Requisitos / instruções ${editing && d.stage !== "backlog" ? "(somente leitura — já analisada)" : ""}</span><textarea name="instructions" ${editing && d.stage !== "backlog" ? "readonly" : ""} placeholder="Descreva o que precisa ser feito, regras de negócio, critérios de aceite…">${esc(instr)}</textarea></label>
      <div class="grid g2" style="gap:10px">
        <label class="f"><span>Ordem na fila</span><input type="number" name="queueOrder" value="${d.queueOrder || ""}" placeholder="automática"></label>
        <label class="f"><span>Provedor de IA</span><select name="provider">${providers.map((p) => `<option value="${esc(p.id)}" ${d.provider === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("") || `<option value="claude">Claude</option>`}</select></label>
      </div>
      <label class="f"><span>Modelo (opcional)</span><input type="text" name="model" value="${esc(d.model)}" placeholder="padrão do provedor"></label>
      <label class="f"><span>Observações</span><textarea name="notes" style="min-height:70px">${esc(d.notes)}</textarea></label>
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel hud">
        <h2>Projeto e branch</h2>
        ${editing ? `<div class="kv" style="margin-bottom:12px"><dt>Projeto</dt><dd>${esc(d.projectName)}</dd></div>` : `
        <div class="seg" style="margin-bottom:10px"><button type="button" class="on" data-pmode="existing">Projeto cadastrado</button><button type="button" data-pmode="new">Novo caminho local</button></div>
        <div id="pm-existing"><label class="f"><span>Projeto de destino <em>*</em></span><select name="projectId">${S.projects.map((p) => `<option value="${p.id}" ${d.projectId === p.id ? "selected" : ""}>${esc(p.name)} — ${esc(p.path)}</option>`).join("") || `<option value="">Nenhum projeto cadastrado</option>`}</select></label></div>
        <div id="pm-new" class="hidden"><label class="f"><span>Caminho absoluto da pasta do projeto (repositório Git ou pasta nova)</span><div class="row"><input type="text" name="newPath" placeholder="C:\\repos\\meu-sistema" class="grow" style="width:auto"><button type="button" class="btn" id="inspect-new">Validar</button></div></label>
          <label class="f"><span>Nome do projeto</span><input type="text" name="newName"></label></div>`}
        <div id="branch-box"></div>
        <label class="check"><input type="checkbox" name="reviewSpec" ${d.reviewSpec ? "checked" : ""}><span>Revisar a especificação gerada pela IA antes do desenvolvimento<br><span class="help">A esteira pausa em Planejamento até você aprovar.</span></span></label>
      </div>
      <div class="panel hud">
        <h2>Especificação de requisitos — anexos</h2>
        ${editing ? `<div class="help" style="margin-bottom:8px">Novos anexos são adicionados à revisão atual (${d.currentRevision}).</div>` : ""}
        <div class="drop" id="drop" tabindex="0">Arraste arquivos aqui ou <u>clique para selecionar</u><div class="help">PDF · DOCX · DOC · TXT · MD · imagens · até 50 MB cada</div></div>
        <input type="file" id="files" multiple class="hidden" accept=".pdf,.docx,.doc,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.sql,.png,.jpg,.jpeg,.gif,.webp,.bmp,.feature,.log,.cs,.ts,.js,.py,.java,.go,.html,.css">
        <ul class="filelist" id="flist"></ul>
        ${editing ? "" : `<label class="f" style="margin-top:10px"><span>Ou cole um texto / print descrito</span><textarea name="pastedText" style="min-height:70px" placeholder="Texto colado é salvo como anexo Markdown."></textarea></label>`}
      </div>
      <div class="row">
        ${editing ? `<button class="btn primary" type="submit">Salvar alterações</button><a class="btn ghost" href="#/demandas/${d.id}">Cancelar</a>` :
      `<button class="btn primary" type="submit" data-enqueue="1">▶ Criar e colocar na fila</button><button class="btn" type="submit" data-enqueue="0">Criar no backlog</button>`}
      </div>
    </div>
  </form>`;

  const form = $("#dform");
  const files = [];
  const drawFiles = () => { $("#flist").innerHTML = files.map((f, i) => `<li>📄 <span class="grow">${esc(f.name)}</span><span class="dim small">${fileSize(f.size)}</span><button type="button" class="btn sm ghost" data-rmfile="${i}">✕</button></li>`).join(""); };
  const drop = $("#drop"), input = $("#files");
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { files.push(...input.files); input.value = ""; drawFiles(); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); files.push(...e.dataTransfer.files); drawFiles(); });
  $("#flist").addEventListener("click", (e) => { const b = e.target.closest("[data-rmfile]"); if (b) { files.splice(+b.dataset.rmfile, 1); drawFiles(); } });
  // colar imagem da área de transferência
  form.addEventListener("paste", (e) => { const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/")); if (imgs.length) { imgs.forEach((f, i) => files.push(new File([f], `print-${Date.now()}-${i}.png`, { type: f.type }))); drawFiles(); toast("Imagem colada adicionada aos anexos"); } });

  let pmode = "existing";
  $$("[data-pmode]").forEach((b) => b.addEventListener("click", () => {
    pmode = b.dataset.pmode; $$("[data-pmode]").forEach((x) => x.classList.toggle("on", x === b));
    $("#pm-existing").classList.toggle("hidden", pmode !== "existing"); $("#pm-new").classList.toggle("hidden", pmode !== "new");
    if (pmode === "existing") loadBranches(); else $("#branch-box").innerHTML = `<div class="help" style="margin-bottom:10px">Valide o caminho para listar as branches.</div>`;
  }));

  async function loadBranches(info) {
    const box = $("#branch-box");
    let opts = [], current = "", branches = [];
    try {
      if (!info) {
        const pid = editing ? d.projectId : +form.projectId?.value;
        if (!pid) { box.innerHTML = ""; return; }
        info = await api("GET", `/api/projects/${pid}/branches`);
        opts = S.projects.find((p) => p.id === pid)?.branchOptions || [];
      } else opts = info.suggestedOptions || [];
      current = info.current; branches = info.branches || [];
      if (!info.valid) {
        box.innerHTML = info.needsInit
          ? `<div class="callout warn small">ℹ ${esc(info.message)}<br>A demanda vai trabalhar direto na branch <b class="mono">main</b>: ao aprovar a revisão, os arquivos são gravados nesta pasta.</div>`
          : `<div class="callout bad">⚠ ${esc(info.message)}</div>`;
        return;
      }
    } catch (e) { box.innerHTML = `<div class="callout bad">⚠ ${esc(e.message)}</div>`; return; }
    const locked = editing && d.workBranch;
    const sel = d.baseBranch || "";
    const direct = editing ? !!d.directBranch : (localStorage.getItem("devpipe.directBranch") ?? "1") === "1";
    box.innerHTML = `<label class="f"><span>Branch base para desenvolver</span>
      <div class="chips" style="margin-bottom:8px"><span class="chip ${sel === "" ? "on" : ""}" data-branch="">● Atual (${esc(current || "?")})</span>${opts.map((o) => `<span class="chip ${sel === o ? "on" : ""}" data-branch="${esc(o)}">${esc(o)}</span>`).join("")}</div>
      <select name="baseBranch" ${locked ? "disabled" : ""}><option value="">Branch atualmente selecionada (${esc(current || "?")})</option>${branches.map((b) => `<option value="${esc(b.name)}" ${sel === b.name ? "selected" : ""}>${esc(b.name)}${b.current ? "  (atual)" : ""}${b.remote ? "  [remota]" : ""}</option>`).join("")}</select>
      <div class="help" id="branch-help"></div></label>
      <label class="check"><input type="checkbox" name="directBranch" ${direct ? "checked" : ""} ${locked ? "disabled" : ""}><span>Fazer os ajustes direto nesta branch (não criar branch nova)<br><span class="help">Os commits da demanda são aplicados na própria branch selecionada (somente fast-forward, sem push).</span></span></label>
      ${info.dirty ? `<div class="callout warn small">⚠ O checkout principal tem ${info.dirty} alteração(ões) não commitada(s). Elas não serão tocadas nem incluídas.</div>` : ""}`;
    const helpBranch = () => {
      const on = form.directBranch?.checked;
      $("#branch-help").textContent = locked
        ? (d.directBranch ? "Bloqueada: a demanda já está trabalhando direto na branch " + d.workBranch + "." : "Bloqueada: a branch de trabalho " + d.workBranch + " já foi criada.")
        : on ? "A IA edita numa área de trabalho separada e, a cada commit, aplica as alterações nesta mesma branch. Nenhuma branch nova é criada."
             : "A IA trabalha em uma branch nova e isolada criada a partir desta. Seu checkout atual não é alterado.";
    };
    form.directBranch?.addEventListener("change", () => { localStorage.setItem("devpipe.directBranch", form.directBranch.checked ? "1" : "0"); helpBranch(); });
    helpBranch();
    if (!locked) $$("[data-branch]", box).forEach((c) => c.addEventListener("click", () => { form.baseBranch.value = c.dataset.branch; $$("[data-branch]", box).forEach((x) => x.classList.toggle("on", x === c)); }));
    form.baseBranch?.addEventListener("change", () => $$("[data-branch]", box).forEach((x) => x.classList.toggle("on", x.dataset.branch === form.baseBranch.value)));
  }
  form.projectId?.addEventListener("change", () => loadBranches());
  $("#inspect-new")?.addEventListener("click", async () => {
    const info = await guarded(() => api("POST", "/api/projects/inspect", { path: form.newPath.value }));
    if ((info.valid || info.needsInit) && !form.newName.value) form.newName.value = info.path.split(/[\\/]/).pop();
    loadBranches(info);
  });
  loadBranches();

  let enqueue = "0";
  $$("button[type=submit]", form).forEach((b) => b.addEventListener("click", () => { enqueue = b.dataset.enqueue || "0"; }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      ticket: form.ticket.value.trim(), title: form.title.value.trim(), summary: form.summary.value, priority: +form.priority.value,
      queueOrder: +form.queueOrder.value || 0, notes: form.notes.value, provider: form.provider.value, model: form.model.value.trim(),
      reviewSpec: form.reviewSpec.checked, baseBranch: form.baseBranch ? form.baseBranch.value : d.baseBranch || "", instructions: form.instructions.value,
      directBranch: form.directBranch ? form.directBranch.checked : !!d.directBranch,
    };
    $$("button", form).forEach((b) => (b.disabled = true));
    try {
      if (editing) {
        data.baseBranch = form.baseBranch && !form.baseBranch.disabled ? form.baseBranch.value : d.baseBranch;
        await api("PUT", `/api/demands/${d.id}`, data);
        if (files.length) { const fd = new FormData(); files.forEach((f) => fd.append("files", f)); await api("POST", `/api/demands/${d.id}/attachments`, fd, true); }
        toast("Demanda atualizada", "ok"); location.hash = `#/demandas/${d.id}`;
      } else {
        if (pmode === "new") data.newProject = { path: form.newPath.value.trim(), name: form.newName.value.trim() };
        else data.projectId = +form.projectId.value;
        const fd = new FormData();
        fd.append("data", JSON.stringify(data)); fd.append("enqueue", enqueue);
        if (form.pastedText.value.trim()) fd.append("pastedText", form.pastedText.value);
        files.forEach((f) => fd.append("files", f));
        const nd = await api("POST", "/api/demands", fd, true);
        S.projects = await api("GET", "/api/projects");
        toast(enqueue === "1" ? `Missão ${nd.ticket} criada e na fila` : `Missão ${nd.ticket} criada no backlog`, "ok");
        location.hash = `#/demandas/${nd.id}`;
      }
    } catch (err) { toast(err.message, "err"); $$("button", form).forEach((b) => (b.disabled = false)); }
  });
}

// ------------------------------------------------------------ 4. DETALHES
VIEWS.demanda = async (r, soft) => {
  const det = await api("GET", `/api/demands/${r.id}`);
  const d = det.demand, tab = r.tab;
  const cur = det.revisions.find((x) => x.number === d.currentRevision) || det.revisions[det.revisions.length - 1];
  const idx = FLOW.indexOf(d.stage === "bloqueado" ? d.blockedFrom : d.stage === "ajustes" ? "revisao" : d.stage);
  const canQueue = ["backlog", "bloqueado", "ajustes"].includes(d.stage) && !["na_fila", "executando"].includes(d.status);
  const actions = [];
  if (canQueue) actions.push(`<button class="btn primary" data-act="enqueue" data-id="${d.id}">▶ ${d.stage === "bloqueado" ? "Retomar" : "Executar"}</button>`);
  if (d.status === "executando" || d.status === "na_fila") actions.push(`<button class="btn bad" data-act="cancel" data-id="${d.id}">■ ${d.status === "na_fila" ? "Tirar da fila" : "Cancelar execução"}</button>`);
  if (d.stage === "planejamento" && d.status === "aguardando_aprovacao") actions.push(`<a class="btn warn" href="#/demandas/${d.id}/especificacao">⚑ Revisar especificação</a>`);
  if (d.stage === "revisao") actions.push(`<button class="btn good" data-act="approve-review" data-id="${d.id}">✔ Aprovar e concluir${d.directBranch ? " (aplica na branch)" : ""}</button>`);
  if (d.directBranch && d.baseCommit && ["revisao", "concluido"].includes(d.stage) && !["executando", "na_fila"].includes(d.status)) actions.push(`<button class="btn" data-act="apply-branch" data-id="${d.id}" title="Aplica as alterações da demanda nos arquivos da branch ${esc(d.workBranch)} como alterações pendentes">⤓ Aplicar na branch</button>`);
  if (!["backlog"].includes(d.stage) && !["executando", "na_fila"].includes(d.status)) actions.push(`<button class="btn warn" data-act="adjust" data-id="${d.id}">↺ Devolver para ajustes</button>`);
  if (!["executando", "na_fila"].includes(d.status)) actions.push(`<a class="btn ghost" href="#/demandas/${d.id}/editar">✎ Editar</a>`, `<button class="btn ghost" data-act="delete" data-id="${d.id}">🗑</button>`);

  const tabs = [["visao", "Visão geral"], ["especificacao", "Especificação"], ["revisoes", `Revisões e anexos (${det.revisions.length})`], ["execucoes", `Execuções (${det.runs.length})`], ["diff", "Alterações (diff)"], ["log", "Log da missão"]];
  let body = "";
  if (tab === "visao") {
    const last = det.runs[0];
    body = `<div class="grid g2">
      <div class="panel"><h2>Dados da missão</h2><dl class="kv">
        <dt>Projeto</dt><dd>${esc(d.projectName)}</dd><dt>Branch base</dt><dd class="mono">${esc(d.baseBranch || "branch atual (definida ao iniciar)")}</dd>
        <dt>Branch de trabalho</dt><dd class="mono">${esc(d.workBranch || (d.directBranch ? "— (a própria branch selecionada)" : "— (criada na Preparação)"))}${d.directBranch ? " · direto na branch" : ""}</dd><dt>Worktree</dt><dd class="mono small">${esc(d.worktreePath || "—")}</dd>
        <dt>Provedor</dt><dd>${esc(d.provider)}${d.model ? " · " + esc(d.model) : ""}</dd><dt>Prioridade</dt><dd>${badgePrio(d.priority)} · ordem ${d.queueOrder}</dd>
        <dt>Revisão atual</dt><dd>${d.currentRevision}</dd><dt>Tentativas</dt><dd>${d.attempts}</dd><dt>Tempo de execução</dt><dd>${elapsed(d)}</dd>
        <dt>Validação</dt><dd>${badgeValid(d.validationState) || "—"}</dd><dt>Criada em</dt><dd>${fmtDate(d.createdAt)}</dd>
        ${d.summary ? `<dt>Resumo</dt><dd>${esc(d.summary)}</dd>` : ""}${d.notes ? `<dt>Observações</dt><dd>${esc(d.notes)}</dd>` : ""}</dl></div>
      <div class="panel"><h2>Última execução</h2>${last ? runHTML(last, true) : emptyState("Ainda não executada", " Clique em Executar para enviar a missão à esteira.")}</div></div>
      <div class="panel" style="margin-top:14px"><h2>Atividade ao vivo</h2><div class="feed" id="dfeed"></div></div>`;
  } else if (tab === "especificacao") {
    const awaiting = d.stage === "planejamento" && d.status === "aguardando_aprovacao";
    body = det.revisions.slice().reverse().map((rv) => `<div class="panel" style="margin-bottom:14px"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">Revisão ${rv.number} — ${rv.kind === "original" ? "especificação original" : "ajuste"}</h2><span class="grow"></span>
        ${rv.spec ? `<span class="badge ${rv.specApproved ? "v-ok" : "v-nao_executada"}">${rv.specApproved ? "aprovada" : "aguardando aprovação"}</span>` : `<span class="badge">não gerada</span>`}</div>
      ${awaiting && rv.number === d.currentRevision ? `<div class="callout warn">⚑ A esteira está pausada aguardando sua aprovação. Você pode editar o texto antes de aprovar.</div>
        <textarea class="code" id="spec-edit">${esc(rv.spec)}</textarea><div class="row" style="margin-top:10px"><button class="btn good" data-act="approve-spec" data-id="${d.id}">✔ Aprovar e continuar</button><button class="btn warn" data-act="adjust" data-id="${d.id}">↺ Pedir nova análise com instruções</button></div>`
      : rv.spec ? `<div class="md">${md(rv.spec)}</div>` : `<div class="muted">A especificação desta revisão será gerada pela IA na etapa de Análise.</div>`}</div>`).join("");
  } else if (tab === "revisoes") {
    body = det.revisions.slice().reverse().map((rv) => {
      const atts = det.attachments.filter((a) => a.revisionId === rv.id);
      return `<div class="panel" style="margin-bottom:14px"><h2>Revisão ${rv.number} · ${rv.kind === "original" ? "Solicitação original" : "Devolução para ajustes"} · ${fmtDate(rv.createdAt)}</h2>
      <div class="md">${rv.instructions ? md(rv.instructions) : '<span class="muted">Sem instruções em texto.</span>'}</div>
      <h3 style="margin-top:14px">Anexos (${atts.length})</h3>${atts.length ? `<table class="list"><tr><th>Arquivo</th><th>Tipo</th><th>Tamanho</th><th>Processamento</th></tr>${atts.map((a) => `<tr><td><a href="/api/attachments/${a.id}" target="_blank" rel="noopener">${esc(a.fileName)}</a></td><td>${esc(a.kind)}</td><td>${fileSize(a.size)}</td><td class="small muted">${esc(a.extractNote || "aguardando processamento")}</td></tr>`).join("")}</table>` : '<div class="muted small">Nenhum anexo.</div>'}</div>`;
    }).join("");
  } else if (tab === "execucoes") {
    body = det.runs.length ? det.runs.map((x) => runHTML(x, false)).join("") : emptyState("Sem execuções", "");
  } else if (tab === "diff") {
    const df = await api("GET", `/api/demands/${d.id}/diff/files`);
    body = df.message ? `<div class="callout info">${esc(df.message)}</div>` : `<div class="row small muted" style="margin-bottom:8px;gap:12px"><span>Branch <b class="mono">${esc(df.branch)}</b> comparada com <b class="mono">${esc(df.base)}</b> · área de trabalho <span class="mono">${esc(df.worktree)}</span></span><span class="grow"></span>${!["executando", "na_fila"].includes(d.status) ? `<button class="btn sm" data-act="repair-enc" data-id="${d.id}">Ꞩ Reparar acentuação / codificação</button>` : ""}</div><div id="cmp"></div>`;
    pendingCmp = { d, files: df.files };
  } else if (tab === "log") {
    body = `<div class="panel"><div class="feed tall" id="dfeed"></div></div>`;
  }

  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small><a href="#/esteira">Esteira</a> / ${esc(d.projectName)}</small><span class="mono" style="color:${STAGE_COLOR[d.stage]}">${esc(d.ticket)}</span> · ${esc(d.title)}</h1>
    <div class="row" style="margin-top:8px">${badgeStatus(d)}${badgePrio(d.priority)}<span class="badge" style="color:${STAGE_COLOR[d.stage]};border-color:${STAGE_COLOR[d.stage]}66">${esc(stageLabel(d.stage))}${d.stage === "bloqueado" && d.blockedFrom ? " em " + esc(stageLabel(d.blockedFrom)) : ""}</span>${badgeValid(d.validationState)}</div></div>
    <div class="row">${actions.join("")}</div></div>
  ${d.statusMessage ? `<div class="callout ${d.stage === "bloqueado" ? "bad" : d.status === "aguardando_aprovacao" ? "warn" : d.stage === "concluido" ? "good" : "info"}">${d.status === "executando" ? "◉" : "ℹ"} <div>${esc(d.statusMessage)}</div></div>` : ""}
  <div class="panel ${d.status === "executando" ? "running" : ""}" style="--sc:${STAGE_COLOR[d.stage]}">
    <div class="row"><span class="small muted">Progresso por etapas concluídas</span><span class="grow"></span><span class="mono">${d.progress}%</span></div>
    <div class="bar"><i style="width:${d.progress}%"></i></div>
    <div class="stepper">${FLOW.map((s, i) => `<div class="step ${i < idx || d.stage === "concluido" ? "done" : i === idx ? "cur" : ""}" style="--sc:${STAGE_COLOR[d.stage]}">${esc(stageLabel(s))}</div>`).join("")}</div>
  </div>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
  <div id="tabbody">${body}</div>`;
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/demandas/${d.id}/${b.dataset.tab}`; }));
  if (pendingCmp && $("#cmp")) { const p = pendingCmp; pendingCmp = null; mountComparator($("#cmp"), p.d, p.files); }
  const feed = $("#dfeed");
  if (feed) {
    const evs = await api("GET", `/api/events?demand=${d.id}&limit=${tab === "log" ? 2000 : 60}`);
    feed.innerHTML = evs.length ? evs.map((e) => evHTML(e, false)).join("") : emptyState("Sem eventos", "");
    feed.scrollTop = feed.scrollHeight;
  }
};

function runHTML(x, compact) {
  const dur = x.finishedAt ? (new Date(x.finishedAt) - new Date(x.startedAt)) / 1000 : (Date.now() - new Date(x.startedAt)) / 1000;
  return `<div class="runcard"><div class="row"><b class="mono">Execução #${x.id}</b><span class="badge st-${esc(x.status)}">${esc(STATUS[x.status] || x.status)}</span><span class="badge">rev ${x.revisionNum}</span><span class="badge">${esc(stageLabel(x.stage))}</span><span class="grow"></span><span class="small muted">${fmtDate(x.startedAt)} · ${fmtDur(dur)}</span></div>
  <div class="small muted" style="margin-top:6px">Provedor: ${esc(x.provider)} · Regras v<span class="mono">${esc(x.rulesHash)}</span>${x.costUsd ? ` · ${S.settings?.claude?.subscriptionOnly ? "equivalente em API (não cobrado)" : "custo informado"} US$ ${x.costUsd.toFixed(4)}` : ""}${x.commitSha ? ` · commit <span class="mono">${esc(x.commitSha.slice(0, 10))}</span>` : ""}${x.sessionId ? ` · sessão <span class="mono">${esc(x.sessionId.slice(0, 8))}</span>` : ""}</div>
  ${x.error ? `<div class="callout bad small" style="margin-top:8px">${esc(x.error)}</div>` : ""}
  ${x.diffStat ? `<pre class="mono small muted" style="white-space:pre-wrap">${esc(x.diffStat)}</pre>` : ""}
  ${x.summary ? (compact ? `<details><summary class="small">Resumo técnico da IA</summary><div class="md small">${md(x.summary)}</div></details>` : `<div class="md small">${md(x.summary)}</div>`) : ""}
  ${!compact && x.rulesText ? `<details><summary class="small muted">Regras utilizadas nesta execução (auditoria)</summary><div class="md small">${md(x.rulesText)}</div></details>` : ""}</div>`;
}

function adjustModal(id) {
  const files = [];
  openModal(`<h2>↺ Devolver para ajustes</h2>
    <div class="help" style="margin-bottom:12px">A especificação original e o histórico são preservados. A IA recebe o que já foi implementado e planeja somente os ajustes.</div>
    <label class="f"><span>Instruções de ajuste / novos critérios de aceite <em>*</em></span><textarea id="adj-text" style="min-height:150px"></textarea></label>
    <div class="drop" id="adj-drop">Anexar documentos ou imagens (clique ou arraste)</div><input type="file" id="adj-files" multiple class="hidden"><ul class="filelist" id="adj-list"></ul>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="adj-q" checked><span>Colocar na fila imediatamente</span></label>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="adj-go">Registrar revisão</button><button class="btn ghost" data-close>Cancelar</button></div>`);
  const draw = () => { $("#adj-list").innerHTML = files.map((f) => `<li>📄 ${esc(f.name)} <span class="dim small">${fileSize(f.size)}</span></li>`).join(""); };
  $("#adj-drop").addEventListener("click", () => $("#adj-files").click());
  $("#adj-files").addEventListener("change", (e) => { files.push(...e.target.files); draw(); });
  $("#adj-drop").addEventListener("dragover", (e) => e.preventDefault());
  $("#adj-drop").addEventListener("drop", (e) => { e.preventDefault(); files.push(...e.dataTransfer.files); draw(); });
  $("#adj-text").addEventListener("paste", (e) => { const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/")); imgs.forEach((f, i) => files.push(new File([f], `print-${Date.now()}-${i}.png`, { type: f.type }))); if (imgs.length) draw(); });
  $("#adj-text").focus();
  $("#adj-go").addEventListener("click", async () => {
    const fd = new FormData(); fd.append("instructions", $("#adj-text").value); fd.append("enqueue", $("#adj-q").checked ? "1" : "0");
    files.forEach((f) => fd.append("files", f));
    await guarded(() => api("POST", `/api/demands/${id}/adjust`, fd, true), "Revisão registrada");
    closeModal(); render(true);
  });
}

function openModal(html) { $("#modal-box").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); $("#modal-box").innerHTML = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ações globais (delegação — compatível com CSP sem scripts inline)
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (b) {
    e.stopPropagation();
    const id = b.dataset.id, act = b.dataset.act;
    if (act === "enqueue") await guarded(() => api("POST", `/api/demands/${id}/enqueue`), "Missão enviada para a fila");
    if (act === "cancel") { if (confirm("Interromper esta missão? O trabalho já feito na branch é preservado.")) await guarded(() => api("POST", `/api/demands/${id}/cancel`), "Cancelamento solicitado"); }
    if (act === "apply-branch") { const r = await guarded(() => api("POST", `/api/demands/${id}/apply-branch`, {})); if (r?.message) toast(r.message, "ok"); }
    if (act === "approve-review") { const note = prompt("Aprovar e concluir. Observação (opcional):", ""); if (note !== null) await guarded(() => api("POST", `/api/demands/${id}/approve-review`, { note }), "Missão concluída!"); }
    if (act === "approve-spec") await guarded(() => api("POST", `/api/demands/${id}/approve-spec`, { spec: $("#spec-edit")?.value || "" }), "Especificação aprovada");
    if (act === "adjust") return adjustModal(id);
    if (act === "repair-enc") {
      const r = await guarded(() => api("POST", `/api/demands/${id}/repair-encoding`));
      toast(`Codificação: ${r.restored} arquivo(s) regravados, ${r.repaired.length} com acentuação recuperada${r.issues.length ? `, ${r.issues.length} problema(s) restantes (veja o log)` : ""}`, r.issues.length ? "err" : "ok");
    }
    if (act === "resume-queue") { await guarded(() => api("POST", "/api/queue/resume"), "Fila retomada"); }
    if (act === "delete") { if (confirm("Excluir a demanda do cadastro? A branch e a worktree no disco são preservadas.")) { const r = await guarded(() => api("DELETE", `/api/demands/${id}`)); toast(r.message); location.hash = "#/esteira"; await reloadDemands(); } return; }
    await reloadDemands().catch(() => {});
    render(true);
    return;
  }
  const card = e.target.closest("[data-open]");
  if (card && !e.target.closest("a,button")) location.hash = `#/demandas/${card.dataset.open}`;
});

// ------------------------------------------------------------ 5. PROJETOS
VIEWS.projetos = async (r) => {
  S.projects = await api("GET", "/api/projects");
  const editing = r.id ? S.projects.find((p) => p.id === +r.id) : null;
  const p = editing || { autoCommit: true, branchPrefix: "devpipe/", branchOptions: [], standardsFiles: [], agentBashAllow: [] };
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>Cadastros</small>Projetos</h1><div class="sub">Repositórios Git locais que a IA pode modificar. Cada demanda trabalha em uma worktree isolada — o seu checkout nunca é alterado.</div></div></div>
  <div class="grid g2">
    <div class="panel"><h2>Projetos cadastrados<span class="count">${S.projects.length}</span></h2>
      ${S.projects.length ? `<table class="list"><tr><th>Projeto</th><th>Stack</th><th>Validação</th><th></th></tr>${S.projects.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="mono small dim">${esc(x.path)}</div></td><td class="small">${esc(x.language || "—")}<div class="dim">${esc(x.mainSolution)}</div></td><td class="small mono">${esc(x.buildCommand || "—")}<br>${esc(x.testCommand || "")}</td><td><a class="btn sm" href="#/projetos/${x.id}">Editar</a></td></tr>`).join("")}</table>` : emptyState("Nenhum projeto", " Cadastre ao lado o caminho de um repositório Git.")}
    </div>
    <form class="panel hud" id="pform" autocomplete="off"><h2>${editing ? "Editar projeto" : "Novo projeto"}</h2>
      <label class="f"><span>Caminho absoluto da pasta do projeto <em>*</em> <span class="help">(se ainda não for um repositório Git, o DevPipe cria um local)</span></span><div class="row"><input type="text" name="path" value="${esc(p.path)}" placeholder="C:\\repos\\sistema" class="grow" style="width:auto" required><button type="button" class="btn" id="pinspect">Validar e detectar</button></div></label>
      <div id="pinfo"></div>
      <div class="grid g2" style="gap:10px"><label class="f"><span>Nome <em>*</em></span><input type="text" name="name" value="${esc(p.name)}" required></label>
        <label class="f"><span>Linguagem predominante</span><input type="text" name="language" value="${esc(p.language)}"></label></div>
      <label class="f"><span>Solução / estrutura principal</span><input type="text" name="mainSolution" value="${esc(p.mainSolution)}" placeholder="Ex.: src/Sistema.sln"></label>
      <label class="f"><span>Atalhos de branch base (separados por vírgula)</span><input type="text" name="branchOptions" value="${esc(p.branchOptions.join(", "))}" placeholder="release, main, main_versao, stage"><div class="help">Aparecem como atalhos no cadastro de demandas. Não são obrigatórios nem universais.</div></label>
      <div class="grid g2" style="gap:10px"><label class="f"><span>Prefixo das branches de trabalho</span><input type="text" name="branchPrefix" value="${esc(p.branchPrefix)}"></label>
        <label class="check" style="margin-top:22px"><input type="checkbox" name="autoCommit" ${p.autoCommit ? "checked" : ""}><span>Commit local automático na branch de trabalho<br><span class="help">Nunca faz push nem merge.</span></span></label></div>
      <label class="f"><span>Codificação dos arquivos</span><select name="fileEncoding">
        ${[["auto", "Automática — preserva a de cada arquivo; novos seguem a predominante do repositório"], ["windows-1252", "Windows-1252 (ANSI) para arquivos novos"], ["utf-8", "UTF-8 para arquivos novos"], ["utf-8-bom", "UTF-8 com BOM para arquivos novos"]].map(([v, l]) => `<option value="${v}" ${(p.fileEncoding || "auto") === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <div class="help">Arquivos existentes sempre mantêm a codificação e os finais de linha originais. Arquivos ANSI são convertidos temporariamente para UTF-8 enquanto a IA edita e devolvidos ao original em seguida.</div></label>
      <label class="f"><span>Comando de build (validação oficial)</span><input type="text" name="buildCommand" class="mono" value="${esc(p.buildCommand)}" placeholder="dotnet build Sistema.sln"></label>
      <label class="f"><span>Comando de testes (validação oficial)</span><input type="text" name="testCommand" class="mono" value="${esc(p.testCommand)}" placeholder="dotnet test --no-build"></label>
      <label class="f"><span>Comandos que a IA pode executar (prefixos, um por linha)</span><textarea name="agentBashAllow" class="mono" style="min-height:70px" placeholder="dotnet build&#10;dotnet test">${esc(p.agentBashAllow.join("\n"))}</textarea><div class="help">Comandos destrutivos, de rede ou com encadeamento (; & |) são rejeitados.</div></label>
      <label class="f"><span>Arquivos de padrões do repositório (um por linha)</span><textarea name="standardsFiles" class="mono" style="min-height:60px" placeholder="docs/padroes.md">${esc(p.standardsFiles.join("\n"))}</textarea></label>
      <label class="f"><span>Regras adicionais do projeto</span><textarea name="extraRules" style="min-height:80px">${esc(p.extraRules)}</textarea></label>
      <div class="row"><button class="btn primary" type="submit">Salvar projeto</button>${editing ? `<a class="btn ghost" href="#/projetos">Novo</a><button type="button" class="btn bad" id="pdel">Excluir</button>` : ""}</div>
    </form></div>`;
  const f = $("#pform");
  const inspect = async () => {
    const info = await guarded(() => api("POST", "/api/projects/inspect", { path: f.path.value }));
    $("#pinfo").innerHTML = `<div class="callout ${info.valid ? (info.authorized ? "good" : "warn") : info.needsInit ? "warn" : "bad"} small">${info.valid ? "✔" : info.needsInit ? "ℹ" : "⚠"} <div>${esc(info.message)}${info.valid ? `<br>Branch atual: <b class="mono">${esc(info.current)}</b> · ${info.branches.length} branches · ${info.dirty} alteração(ões) locais${info.standardsFound?.length ? `<br>Arquivos de padrões encontrados: ${info.standardsFound.map(esc).join(", ")}` : ""}` : ""}</div></div>`;
    if (info.valid || info.needsInit) {
      if (!f.name.value) f.name.value = info.path.split(/[\\/]/).pop();
      if (!f.language.value) f.language.value = info.language || "";
      if (!f.mainSolution.value) f.mainSolution.value = info.solution || "";
      if (!f.branchOptions.value && info.suggestedOptions) f.branchOptions.value = info.suggestedOptions.join(", ");
      if (!f.standardsFiles.value && info.standardsFound) f.standardsFiles.value = info.standardsFound.filter((x) => x !== "CLAUDE.md").join("\n");
    }
  };
  $("#pinspect").addEventListener("click", inspect);
  $("#pdel")?.addEventListener("click", async () => { if (confirm("Excluir o projeto do cadastro? Nada é apagado do disco.")) { await guarded(() => api("DELETE", `/api/projects/${p.id}`), "Projeto excluído"); location.hash = "#/projetos"; } });
  const lines = (v) => v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = { name: f.name.value, path: f.path.value.trim(), language: f.language.value, mainSolution: f.mainSolution.value,
      branchOptions: f.branchOptions.value.split(",").map((s) => s.trim()).filter(Boolean), branchPrefix: f.branchPrefix.value, autoCommit: f.autoCommit.checked,
      buildCommand: f.buildCommand.value.trim(), testCommand: f.testCommand.value.trim(), agentBashAllow: lines(f.agentBashAllow.value), fileEncoding: f.fileEncoding.value, standardsFiles: lines(f.standardsFiles.value), extraRules: f.extraRules.value };
    const saved = await guarded(() => api(editing ? "PUT" : "POST", editing ? `/api/projects/${p.id}` : "/api/projects", data), "Projeto salvo");
    location.hash = `#/projetos/${saved.id}`; render();
  });
};

// ------------------------------------------------------------ 6. REGRAS
VIEWS.regras = async (r) => {
  const rules = await api("GET", "/api/rules");
  S.projects = await api("GET", "/api/projects");
  const editing = r.id ? rules.find((x) => x.id === +r.id) : null;
  const x = editing || { scope: "global", enabled: true, priority: 100, mandatory: false };
  const pname = (id) => S.projects.find((p) => p.id === id)?.name || "?";
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>Cadastros</small>Padrões e regras de desenvolvimento</h1><div class="sub">A IA consulta estas regras antes de planejar e implementar. Cada execução registra o hash da versão utilizada, para auditoria.</div></div></div>
  <div class="callout info small">Precedência: <b>segurança da aplicação</b> › globais obrigatórias › projeto obrigatórias › projeto › globais recomendadas › instruções da demanda (que nunca podem violar os três primeiros níveis).</div>
  <div class="grid g2">
    <div class="panel"><h2>Regras<span class="count">${rules.length}</span></h2>
      ${rules.length ? `<table class="list"><tr><th>Regra</th><th>Escopo</th><th>Versão</th><th></th></tr>${rules.map((ru) => `<tr style="${ru.enabled ? "" : "opacity:.5"}"><td><b>${esc(ru.title)}</b>${ru.mandatory ? ' <span class="badge prio-1">obrigatória</span>' : ""}<div class="small dim">${esc(ru.category)}${ru.pathGlob ? " · " + esc(ru.pathGlob) : ""}${ru.language ? " · " + esc(ru.language) : ""}</div></td><td class="small">${ru.scope === "global" ? "Global" : "Projeto: " + esc(pname(ru.projectId))}<div class="dim">prioridade ${ru.priority}</div></td><td class="mono small">v${ru.version}</td><td><a class="btn sm" href="#/regras/${ru.id}">Editar</a></td></tr>`).join("")}</table>` : emptyState("Nenhuma regra", " Cadastre convenções, arquitetura, padrões de banco, testes…")}
      <h3 style="margin-top:18px">Importar arquivo de padrões</h3>
      <form id="rimport" class="row"><input type="file" name="file" accept=".md,.txt,.markdown,.docx,.pdf" class="grow"><select name="scope" style="width:auto"><option value="global">Global</option>${S.projects.map((p) => `<option value="p${p.id}">Projeto: ${esc(p.name)}</option>`).join("")}</select><button class="btn" type="submit">Importar</button></form>
      <h3 style="margin-top:18px">Pré-visualizar o que a IA recebe</h3>
      <div class="row"><select id="rprev-p" style="max-width:280px">${S.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><button class="btn" id="rprev">Pré-visualizar</button></div>
    </div>
    <form class="panel hud" id="rform"><h2>${editing ? `Editar regra (v${x.version})` : "Nova regra"}</h2>
      <div class="grid g2" style="gap:10px">
        <label class="f"><span>Escopo</span><select name="scope"><option value="global" ${x.scope === "global" ? "selected" : ""}>Global (todos os projetos)</option><option value="projeto" ${x.scope === "projeto" ? "selected" : ""}>Projeto específico</option></select></label>
        <label class="f"><span>Projeto</span><select name="projectId">${S.projects.map((p) => `<option value="${p.id}" ${x.projectId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label></div>
      <label class="f"><span>Título <em>*</em></span><input type="text" name="title" value="${esc(x.title)}" required></label>
      <div class="grid g2" style="gap:10px"><label class="f"><span>Categoria</span><input type="text" name="category" value="${esc(x.category)}" list="cats"><datalist id="cats">${["Nomenclatura", "Arquitetura", "Banco de dados", "Exceções", "Testes", "Compatibilidade", "Bibliotecas", "Formatação", "Build e validação", "Regras de negócio"].map((c) => `<option>${c}</option>`).join("")}</datalist></label>
        <label class="f"><span>Prioridade (menor = mais forte)</span><input type="number" name="priority" value="${x.priority}"></label></div>
      <div class="grid g2" style="gap:10px"><label class="f"><span>Aplicar a diretórios/arquivos</span><input type="text" name="pathGlob" class="mono" value="${esc(x.pathGlob)}" placeholder="src/Dados/**"></label>
        <label class="f"><span>Aplicar à linguagem</span><input type="text" name="language" value="${esc(x.language)}" placeholder="C#"></label></div>
      <label class="f"><span>Conteúdo (texto ou Markdown) <em>*</em></span><textarea name="content" class="code" required>${esc(x.content)}</textarea></label>
      <label class="check"><input type="checkbox" name="mandatory" ${x.mandatory ? "checked" : ""}><span>Obrigatória (não pode ser contrariada por instruções da demanda)</span></label>
      <label class="check"><input type="checkbox" name="enabled" ${x.enabled ? "checked" : ""}><span>Ativa</span></label>
      <div class="row"><button class="btn primary" type="submit">Salvar ${editing ? "nova versão" : "regra"}</button>${editing ? `<a class="btn ghost" href="#/regras">Nova</a><button type="button" class="btn bad" id="rdel">Excluir</button>` : ""}</div>
    </form></div>`;
  const f = $("#rform");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = { scope: f.scope.value, projectId: +f.projectId.value || 0, title: f.title.value, category: f.category.value, priority: +f.priority.value || 100, pathGlob: f.pathGlob.value, language: f.language.value, content: f.content.value, mandatory: f.mandatory.checked, enabled: f.enabled.checked };
    const s = await guarded(() => api(editing ? "PUT" : "POST", editing ? `/api/rules/${x.id}` : "/api/rules", data), "Regra salva");
    location.hash = `#/regras/${s.id}`; render();
  });
  $("#rdel")?.addEventListener("click", async () => { if (confirm("Excluir esta regra?")) { await guarded(() => api("DELETE", `/api/rules/${x.id}`), "Regra excluída"); location.hash = "#/regras"; } });
  $("#rimport").addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const sc = fd.get("scope");
    fd.set("scope", sc === "global" ? "global" : "projeto"); if (sc !== "global") fd.set("projectId", sc.slice(1));
    const s = await guarded(() => api("POST", "/api/rules/import", fd, true), "Regra importada"); location.hash = `#/regras/${s.id}`;
  });
  $("#rprev").addEventListener("click", async () => {
    const pv = await guarded(() => api("GET", `/api/rules/preview?project=${$("#rprev-p").value}`));
    openModal(`<h2>Regras enviadas à IA · versão <span class="mono">${esc(pv.hash)}</span></h2><div class="md small" style="max-height:65vh;overflow:auto">${md(pv.text)}</div><div class="row" style="margin-top:12px"><button class="btn" data-close>Fechar</button></div>`);
  });
};

// ------------------------------------------------------------ 7. MONITOR
function passMonitor(ev) { const m = S.monitor; return (!m.level || ev.level === m.level) && (!m.demand || ev.demandId === +m.demand); }
VIEWS.monitor = async () => {
  const q = new URLSearchParams({ limit: "800" });
  if (S.monitor.level) q.set("level", S.monitor.level);
  if (S.monitor.demand) q.set("demand", S.monitor.demand);
  const evs = await api("GET", "/api/events?" + q);
  const running = S.demands.filter((d) => d.status === "executando");
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>Tempo real</small>Monitor de execução</h1><div class="sub">Eventos reais da esteira e dos agentes de IA. Segredos são redigidos automaticamente antes de serem registrados.</div></div>
    <div class="row">${running.map((d) => `<a class="badge st-executando" href="#/demandas/${d.id}">◉ ${esc(d.ticket)} · ${esc(stageLabel(d.stage))}</a>`).join("")}</div></div>
  <div class="panel" style="padding:12px;margin-bottom:12px"><div class="row">
    <select id="ml" style="max-width:190px"><option value="">Todos os níveis</option>${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}" ${S.monitor.level === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <select id="md" style="max-width:300px"><option value="">Todas as demandas</option>${S.demands.map((d) => `<option value="${d.id}" ${+S.monitor.demand === d.id ? "selected" : ""}>${esc(d.ticket)} — ${esc(d.title)}</option>`).join("")}</select>
    <span class="grow"></span><button class="btn ${S.monitor.paused ? "warn" : ""}" id="mpause">${S.monitor.paused ? "▶ Retomar" : "❚❚ Pausar"}</button>
  </div></div>
  <div class="panel"><div class="feed tall" id="feed">${evs.length ? evs.map((e) => evHTML(e)).join("") : emptyState("Sem eventos", " Os eventos aparecem aqui assim que uma missão executa.")}</div></div>`;
  const f = $("#feed"); f.scrollTop = f.scrollHeight;
  $("#ml").addEventListener("change", (e) => { S.monitor.level = e.target.value; render(); });
  $("#md").addEventListener("change", (e) => { S.monitor.demand = e.target.value; render(); });
  $("#mpause").addEventListener("click", () => { S.monitor.paused = !S.monitor.paused; render(); });
};

// ------------------------------------------------------------ 8. PROVEDORES
VIEWS.provedores = async () => {
  S.settings = await api("GET", "/api/settings");
  const provs = await api("GET", "/api/providers").catch(() => []);
  const c = S.settings.claude, g = S.settings.generic;
  const status = (id) => { const p = provs.find((x) => x.id === id); return p ? `<div class="callout ${p.status.ok ? "good" : "bad"} small">${p.status.ok ? "✔" : "⚠"} <div>${esc(p.status.version || "")} ${esc(p.status.message)}</div></div>` : `<div class="callout warn small">Desabilitado</div>`; };
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>Sistema</small>Provedores de IA</h1><div class="sub">A esteira usa uma camada de abstração: cada provedor implementa verificar, executar, receber eventos, cancelar e corrigir.</div></div></div>
  <form id="provform" class="grid g2">
    <div class="panel hud"><h2>Claude — Claude Code CLI</h2>${status("claude")}
      <div class="callout info small"><div>Pré-requisitos: instale o Claude Code (recomendado o instalador nativo — PowerShell: <span class="mono">irm https://claude.ai/install.ps1 | iex</span>) e execute <span class="mono">claude</span> uma vez no terminal para fazer login. Requer conta Pro, Max, Team, Enterprise ou Console (o plano gratuito não inclui o Claude Code). No Windows, instale o Git for Windows para que os comandos liberados ao agente funcionem. O uso consome a cota do plano ou é cobrado por tokens na API.</div></div>
      <label class="check"><input type="checkbox" name="cEnabled" ${c.enabled ? "checked" : ""}><span>Habilitado</span></label>
      <label class="check"><input type="checkbox" name="cSubOnly" ${c.subscriptionOnly ? "checked" : ""}><span><b>Usar somente o limite da assinatura Pro/Max</b><br><span class="help">Ignora chaves de API do ambiente (ANTHROPIC_API_KEY etc.), interrompe a execução se a CLI estiver autenticada por chave de API ou se o "uso extra" pago for acionado, e pausa a fila quando o limite do plano acabar.</span></span></label>
      <label class="f"><span>Executável</span><input type="text" name="cBinary" class="mono" value="${esc(c.binary)}"><div class="help">Caminho completo se não estiver no PATH (ex.: C:\\Users\\voce\\.local\\bin\\claude.exe).</div></label>
      <label class="f"><span>Modelo padrão</span><input type="text" name="cModel" value="${esc(c.model)}" placeholder="padrão da CLI (ex.: sonnet, opus)"></label>
      <div class="grid g2" style="gap:10px">
        <label class="f"><span>Modelo da análise (opcional)</span><input type="text" name="cAModel" value="${esc(c.analysisModel || "")}" placeholder="ex.: sonnet (mais rápido)"><div class="help">A especificação pode usar um modelo mais rápido que o desenvolvimento.</div></label>
        <label class="f"><span>Nível de esforço</span><select name="cEffort">${[["", "Padrão da CLI"], ["low", "Baixo — mais rápido"], ["medium", "Médio"], ["high", "Alto"], ["xhigh", "Muito alto"], ["max", "Máximo — mais lento"]].map(([v, l]) => `<option value="${v}" ${(c.effort || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select><div class="help">Menos esforço = respostas mais rápidas e menor consumo do plano.</div></label>
      </div>
      <label class="f"><span>Modo de permissão no desenvolvimento</span><select name="cPerm">${["acceptEdits", "dontAsk", "default"].map((m) => `<option ${c.permissionMode === m ? "selected" : ""}>${m}</option>`).join("")}</select><div class="help">acceptEdits: aceita edições de arquivo; demais ações seguem a lista liberada. bypassPermissions nunca é usado.</div></label>
      <label class="f"><span>Orçamento máximo por chamada (US$, opcional — só se aplica a chave de API)</span><input type="number" step="0.5" name="cBudget" value="${c.maxBudgetUsd || ""}"></label>
      <label class="f"><span>Argumentos extras (avançado)</span><input type="text" name="cExtra" class="mono" value="${esc(c.extraArgs)}"></label>
      <button type="button" class="btn" data-test="claude">⚡ Testar conexão (chamada real mínima)</button><div id="t-claude" style="margin-top:10px"></div>
    </div>
    <div class="panel hud"><h2>CLI genérico (outros agentes)</h2>${status("generico")}
      <div class="callout warn small">Executa qualquer CLI de agente na worktree, enviando o prompt via stdin (variáveis DEVPIPE_PHASE e DEVPIPE_WORKDIR). A aplicação não consegue impor permissões por ferramenta a uma CLI desconhecida: o isolamento vem da worktree e da revisão humana.</div>
      <label class="check"><input type="checkbox" name="gEnabled" ${g.enabled ? "checked" : ""}><span>Habilitado</span></label>
      <label class="f"><span>Nome de exibição</span><input type="text" name="gName" value="${esc(g.name)}"></label>
      <label class="f"><span>Comando</span><input type="text" name="gCmd" class="mono" value="${esc(g.command)}" placeholder="meu-agente --nao-interativo"></label>
      <button type="button" class="btn" data-test="generico">⚡ Testar</button><div id="t-generico" style="margin-top:10px"></div>
      <h3 style="margin-top:20px">Provedor padrão das novas demandas</h3>
      <select name="defProv"><option value="claude" ${S.settings.defaultProvider === "claude" ? "selected" : ""}>Claude</option><option value="generico" ${S.settings.defaultProvider === "generico" ? "selected" : ""}>CLI genérico</option></select>
    </div>
    <div><button class="btn primary" type="submit">Salvar provedores</button></div>
  </form>`;
  const f = $("#provform");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = { ...S.settings, defaultProvider: f.defProv.value,
      claude: { enabled: f.cEnabled.checked, binary: f.cBinary.value.trim() || "claude", model: f.cModel.value.trim(), permissionMode: f.cPerm.value, maxBudgetUsd: +f.cBudget.value || 0, extraArgs: f.cExtra.value.trim(), subscriptionOnly: f.cSubOnly.checked, analysisModel: f.cAModel.value.trim(), effort: f.cEffort.value },
      generic: { enabled: f.gEnabled.checked, name: f.gName.value, command: f.gCmd.value } };
    S.settings = await guarded(() => api("PUT", "/api/settings", st), "Provedores salvos"); render();
  });
  $$("[data-test]").forEach((b) => b.addEventListener("click", async () => {
    const out = $("#t-" + b.dataset.test); b.disabled = true; out.innerHTML = `<div class="small muted">◉ Testando… (pode levar alguns segundos)</div>`;
    try {
      const r = await api("POST", `/api/providers/${b.dataset.test}/test`);
      const auth = r.authMode === "assinatura" ? "<b>Autenticação: assinatura (Pro/Max)</b> — consome apenas o limite do plano, sem cobrança por token."
        : r.authMode === "chave_api" ? "<b>Autenticação: chave de API</b> — cobrada por token." : "";
      const cost = r.cost ? (r.authMode === "assinatura" ? `<br><span class="dim">Valor equivalente em API (informativo, não cobrado): US$ ${r.cost.toFixed(4)}</span>` : `<br>Custo: US$ ${r.cost.toFixed(4)}`) : "";
      const use = r.usage ? `<br>Uso do plano — 5h: ${Math.round(r.usage.fiveHourPct)}% · semana: ${Math.round(r.usage.sevenDayPct)}%` : "";
      out.innerHTML = `<div class="callout ${r.ok ? "good" : "bad"} small"><div>${r.ok ? "✔ Conectado. Resposta: " : "⚠ "}${esc(r.message)}${auth ? "<br>" + auth : ""}${cost}${use}</div></div>`;
    }
    catch (e) { out.innerHTML = `<div class="callout bad small">⚠ ${esc(e.message)}</div>`; }
    b.disabled = false;
  }));
};

// ------------------------------------------------------------ 9. CONFIGURAÇÃO E SEGURANÇA
VIEWS.config = async () => {
  S.settings = await api("GET", "/api/settings");
  const s = S.settings;
  $("#view").innerHTML = `
  <div class="page-head"><div><h1><small>Sistema</small>Configuração geral e segurança</h1><div class="sub">Pasta de dados: <span class="mono">${esc(S.meta.dataDir)}</span> · versão ${esc(S.meta.version)}</div></div></div>
  <form id="cform" class="grid g2">
    <div class="panel hud"><h2>Execução</h2>
      <label class="f"><span>Demandas em paralelo (máximo)</span><input type="number" min="1" max="8" name="maxParallel" value="${s.maxParallel}"><div class="help">Nunca mais de uma por repositório, independentemente deste valor.</div></label>
      <label class="f"><span>Tentativas automáticas de correção após falha de validação</span><input type="number" min="0" max="5" name="maxFix" value="${s.maxFixAttempts}"></label>
      <label class="f"><span>Tempo limite por chamada do agente (minutos)</span><input type="number" min="5" name="agentTO" value="${s.agentTimeoutMin}"></label>
      <label class="f"><span>Tempo limite por comando de build/teste (minutos)</span><input type="number" min="1" name="cmdTO" value="${s.commandTimeoutMin}"></label>
      <h3 style="margin-top:16px">Autor dos commits automáticos</h3>
      <label class="f"><span>Nome</span><input type="text" name="cName" value="${esc(s.commitAuthorName || "")}" placeholder="vazio = user.name do Git do repositório"></label>
      <label class="f"><span>E-mail</span><input type="text" name="cEmail" value="${esc(s.commitAuthorEmail || "")}" placeholder="vazio = user.email do Git do repositório"><div class="help">Use o mesmo usuário do Azure DevOps para que os commits apareçam com seu avatar e contem nos relatórios. Gravado somente nesta máquina (não vai para o código nem para o Git).</div></label>
    </div>
    <div class="panel hud"><h2>Segurança</h2>
      <label class="f"><span>Diretórios autorizados (um por linha)</span><textarea name="roots" class="mono" placeholder="C:\\repos">${esc((s.authorizedRoots || []).join("\n"))}</textarea><div class="help">Projetos fora destes diretórios são recusados. Vazio = qualquer repositório cadastrado (não recomendado).</div></label>
      <div class="callout info small"><div><b>Políticas fixas (não configuráveis):</b><ul style="margin:6px 0 0;padding-left:18px">
        <li>Servidor acessível somente em 127.0.0.1, com proteção contra CSRF e DNS rebinding.</li>
        <li>Cada demanda trabalha em uma worktree Git isolada; o checkout do usuário não é alterado.</li>
        <li>Nunca executa merge, push, reset, rebase, clean ou descarte de alterações.</li>
        <li>Agente sem acesso à rede, a git de escrita e a comandos destrutivos; bypassPermissions proibido.</li>
        <li>Documentos e código são tratados como dados não confiáveis (proteção contra prompt injection).</li>
        <li>Comandos de validação são classificados; destrutivos e de rede são bloqueados.</li>
        <li>Tokens, senhas e chaves são redigidos dos logs.</li></ul></div></div>
    </div>
    <div><button class="btn primary" type="submit">Salvar configurações</button></div>
  </form>`;
  const f = $("#cform");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = { ...S.settings, maxParallel: +f.maxParallel.value || 1, maxFixAttempts: +f.maxFix.value, agentTimeoutMin: +f.agentTO.value || 45, commandTimeoutMin: +f.cmdTO.value || 15,
      authorizedRoots: f.roots.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean), commitAuthorName: f.cName.value.trim(), commitAuthorEmail: f.cEmail.value.trim() };
    S.settings = await guarded(() => api("PUT", "/api/settings", st), "Configurações salvas");
  });
};

VIEWS.notfound = async () => { $("#view").innerHTML = emptyState("Página não encontrada", "", `<a class="btn" href="#/">Voltar à central</a>`); };

// ------------------------------------------------------------ início
(async function init() {
  try { await loadBase(); } catch (e) { $("#view").innerHTML = `<div class="callout bad">Não foi possível conectar ao servidor local: ${esc(e.message)}</div>`; return; }
  AVISO.iniciar();
  connectStream();
  $(".brand small").textContent = "esteira IA · v" + S.meta.version;
  render();
  setInterval(() => { if (S.demands.some((d) => d.status === "executando") && ["esteira", "dashboard"].includes(route().name)) scheduleRender(); }, 15000);
})();
