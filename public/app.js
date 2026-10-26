const CATS = ['Royalty & Payments', 'ISBN & Metadata Issues', 'Printing & Quality', 'Distribution & Availability', 'Book Status & Production Updates', 'General Inquiry'];
const PRIS = ['Critical', 'High', 'Medium', 'Low'], STATS = ['Open', 'In Progress', 'Resolved', 'Closed'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN');
const when = s => new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const ageH = s => (Date.now() - new Date(s)) / 36e5;
const ageTxt = s => { const h = ageH(s); return h < 1 ? '<1h' : h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'; };
const opts = (list, sel, blank) => (blank != null ? `<option value="">${blank}</option>` : '') + list.map(o => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');
const slug = x => String(x).toLowerCase().replace(/\W+/g, '-');
const badge = (t, cls) => `<span class="badge ${esc(cls || t)}">${esc(t)}</span>`;
// Re-rendering on a live event must not steal focus or caret from a textarea the person is typing in.
function keepFocus(fn) {
  const a = document.activeElement, pos = a?.selectionStart;
  const sel = a?.dataset?.reply ? `[data-reply="${a.dataset.reply}"]` : a?.id ? '#' + a.id : null;
  fn();
  const el = sel && document.querySelector(sel);
  if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } }
}

let token = localStorage.getItem('bl_token'), me = null, view = null, es = null;
function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 3500); }
async function api(path, o = {}) {
  const res = await fetch('/api' + path, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: o.body && JSON.stringify(o.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401 && token) logout(); throw new Error(data.error?.details?.map(d => `${d.field}: ${d.message}`).join('; ') || data.error?.message || 'Request failed'); }
  return data;
}
function logout() { localStorage.removeItem('bl_token'); token = me = null; es?.close(); boot(); }

// ---------- Real-time: SSE with a slow polling safety net ----------
async function connect() {
  es?.close(); if (!token) return;
  try { const { ticket } = await api('/events/ticket', { method: 'POST' }); es = new EventSource('/api/events?ticket=' + ticket); }
  catch { return setTimeout(connect, 5000); }
  const refresh = e => views[view]?.onEvent?.(JSON.parse(e.data).ticketId);
  es.addEventListener('ticket.created', refresh); es.addEventListener('ticket.updated', refresh);
  es.onerror = () => { es.close(); setTimeout(connect, 3000); };   // tickets are single-use, so reconnect with a fresh one
}
setInterval(() => token && me && views[view]?.onEvent?.(null), 30000);

// ---------- Shell ----------
function nav() {
  const tabs = me.role === 'admin' ? [['queue', 'Ticket Queue']] : [['books', 'My Books'], ['new', 'Submit Query'], ['tickets', 'My Tickets']];
  $('#nav').innerHTML = `<b>BookLeaf Support</b>${tabs.map(([k, l]) => `<a href="#" data-v="${k}" class="${k === view ? 'on' : ''}">${l}</a>`).join('')}<span>${esc(me.name)} (${me.role})</span><button id="out">Log out</button>`;
  $('#nav').querySelectorAll('a').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.v); });
  $('#out').onclick = logout;
}
function go(v) { view = v; nav(); views[v].render(); }
async function boot() {
  if (token) { try { me = (await api('/auth/me')).user; connect(); nav(); return go(me.role === 'admin' ? 'queue' : 'books'); } catch { } }
  $('#nav').innerHTML = '<b>BookLeaf Support</b>';
  $('#app').innerHTML = `<div class="card" style="max-width:380px;margin:40px auto"><h2>Log in</h2><form id="lf">
    <label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required>
    <button class="p">Log in</button></form><p class="hint">Demo: admin@bookleaf.com / Admin@123, or priya.sharma@email.com / Author@123</p></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/auth/login', { method: 'POST', body: f }); token = r.token; localStorage.setItem('bl_token', token); boot(); } catch (err) { toast(err.message); } };
}

// ---------- Shared thread renderer ----------
const thread = (msgs, admin) => msgs.map(m => `<div class="msg ${m.internal ? 'note' : m.sender_role}"><small>${m.internal ? '🔒 Internal note · ' : ''}${m.sender_role === 'admin' ? esc(m.sender_name || 'BookLeaf') : 'Author'} · ${when(m.created_at)}</small>${esc(m.body)}</div>`).join('');

const views = {
  // ===== Author: books =====
  books: { async render() {
    $('#app').innerHTML = '<p class="empty">Loading…</p>';
    const { books } = await api('/books');
    $('#app').innerHTML = '<h2>My Books</h2>' + (books.length ? books.map(b => {
      const live = !!b.publication_date;
      return `<div class="card"><h3>${esc(b.title)} ${badge(b.status, 'st-open')}</h3><div class="grid">
        <div class="kv">ISBN<b>${esc(b.isbn)}</b></div><div class="kv">Genre<b>${esc(b.genre)}</b></div><div class="kv">Published<b>${b.publication_date || '—'}</b></div><div class="kv">MRP<b>${inr(b.mrp)}</b></div>
        ${live ? `<div class="kv">Copies sold<b>${b.copies_sold}</b></div><div class="kv">Royalty earned<b>${inr(b.royalty_earned)}</b></div><div class="kv">Royalty paid<b>${inr(b.royalty_paid)}</b></div><div class="kv">Royalty pending<b>${inr(b.royalty_pending)}</b></div>` : ''}</div>
        ${live ? `<p class="hint">Last payout: ${b.last_payout_date || 'none yet'} · Available on: ${esc(b.available_on.join(', ') || '—')}</p>` : '<p class="hint">This book is still in production. Sales and royalty details will appear once it is published.</p>'}</div>`;
    }).join('') : '<p class="empty">No books on your account yet.</p>'); } },

  // ===== Author: new ticket =====
  new: { async render() {
    const { books } = await api('/books');
    $('#app').innerHTML = `<div class="card"><h2>Submit a Support Query</h2><form id="tf"><label>Which book is this about?</label>
      <select name="book_id"><option value="">General / Account Level</option>${books.map(b => `<option value="${b.book_id}">${esc(b.title)}</option>`).join('')}</select>
      <label>Subject</label><input name="subject" required minlength="3" maxlength="150"><label>Description</label><textarea name="description" required minlength="10" maxlength="5000" placeholder="Tell us what happened, with any dates, amounts or screenshots' details."></textarea>
      <p class="hint">We aim to respond within 48 hours. Critical issues are reviewed first.</p><label>Attachment (optional)</label><input type="file" name="file"><p class="hint">Attachment upload is UI-only in this version; the file name is recorded but the file is not stored.</p><button class="p">Submit query</button></form></div>`;
    $('#tf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('button'); btn.disabled = true;
      try { await api('/tickets', { method: 'POST', body: { book_id: f.get('book_id') || null, subject: f.get('subject'), description: f.get('description'), attachment_name: f.get('file')?.name || null } });
        toast('Query submitted. Our team will respond soon.'); go('tickets'); } catch (err) { toast(err.message); btn.disabled = false; } };
  } },

  // ===== Author: my tickets (live) =====
  tickets: { openId: null, detail: null, reply: {}, paint() { keepFocus(() => this._paint()); },
    async render() { const v = this; const { tickets } = await api('/tickets'); v.list = tickets; if (v.openId) v.detail = await api('/tickets/' + v.openId).catch(() => null); v.paint(); },
    _paint() { const v = this;
      $('#app').innerHTML = '<h2>My Tickets</h2>' + (v.list.length ? v.list.map(t => `<div class="card"><div style="cursor:pointer" data-id="${t.id}"><h3>#${t.id} ${esc(t.subject)} ${badge(t.status, 'st-' + slug(t.status))}</h3>
        <span class="hint">${esc(t.book_title || 'General / Account Level')} · ${when(t.created_at)}</span></div>
        ${v.openId === t.id && v.detail ? `<div class="msg author"><small>Your query</small>${esc(t.description)}${t.attachment_name ? `<br><span class="hint">📎 ${esc(t.attachment_name)}</span>` : ''}</div>${thread(v.detail.messages)}
          ${t.status === 'Closed' ? '<p class="hint">This ticket is closed.</p>' : `<textarea data-reply="${t.id}" placeholder="Add a follow-up…">${esc(v.reply[t.id] || '')}</textarea><button class="p" data-send="${t.id}">Send follow-up</button>`}` : ''}</div>`).join('') : '<p class="empty">You have not raised any queries yet.</p>');
      document.querySelectorAll('[data-id]').forEach(el => el.onclick = async () => { v.openId = v.openId === +el.dataset.id ? null : +el.dataset.id; await v.render(); });
      document.querySelectorAll('[data-reply]').forEach(el => el.oninput = () => v.reply[el.dataset.reply] = el.value);
      document.querySelectorAll('[data-send]').forEach(el => el.onclick = async () => { const id = el.dataset.send; if (!(v.reply[id] || '').trim()) return;
        try { await api(`/tickets/${id}/replies`, { method: 'POST', body: { body: v.reply[id] } }); v.reply[id] = ''; await v.render(); } catch (e) { toast(e.message); } }); },
    onEvent() { this.render().catch(() => { }); } },

  // ===== Admin: queue + detail =====
  queue: { f: { status: 'active', category: '', priority: '', assigned: '', from: '', to: '', sort: 'urgency', q: '' }, limit: 50, total: 0, sel: null, data: null, draft: {}, tried: {}, note: '', generating: false,
    async render() { await this.load(); },
    async load() { const v = this;
      const qs = new URLSearchParams([...Object.entries(v.f).filter(([, x]) => x), ['limit', v.limit]]).toString();
      const r = await api('/tickets?' + qs); v.list = r.tickets; v.total = r.total;
      if (v.sel) { v.data = await api('/tickets/' + v.sel).catch(() => null); if (v.data?.draft && !v.draft[v.sel]) v.draft[v.sel] = v.data.draft; }   // hydrate cached draft BEFORE painting so it is never regenerated
      v.paint(); },
    paint() { keepFocus(() => { this._paint(); }); },
    _paint() { const v = this, f = v.f;
      $('#app').innerHTML = `<h2>Ticket Queue</h2><div class="card"><div class="filters">
        <div><label>Search</label><input id="f-q" value="${esc(f.q)}" placeholder="Subject, author or #id"></div>
        <div><label>Status</label><select id="f-status"><option value="active" ${f.status === 'active' ? 'selected' : ''}>Active (Open + In Progress)</option>${opts(STATS, f.status, 'All')}</select></div>
        <div><label>Category</label><select id="f-category">${opts(CATS, f.category, 'All')}</select></div><div><label>Priority</label><select id="f-priority">${opts(PRIS, f.priority, 'All')}</select></div>
        <div><label>Assignee</label><select id="f-assigned"><option value="">Anyone</option><option value="me" ${f.assigned === 'me' ? 'selected' : ''}>Me</option><option value="unassigned" ${f.assigned === 'unassigned' ? 'selected' : ''}>Unassigned</option></select></div>
        <div><label>From</label><input type="date" id="f-from" value="${f.from}"></div><div><label>To</label><input type="date" id="f-to" value="${f.to}"></div>
        <div><label>Sort</label><select id="f-sort"><option value="urgency" ${f.sort === 'urgency' ? 'selected' : ''}>Most urgent first</option><option value="oldest" ${f.sort === 'oldest' ? 'selected' : ''}>Oldest</option><option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>Newest</option></select></div></div>
        ${v.list.length ? `<table><tr><th>#</th><th>Priority</th><th>Subject</th><th>Author</th><th>Category</th><th>Status</th><th>Age</th><th>Assignee</th></tr>${v.list.map(t => {
          const open = t.status === 'Open' || t.status === 'In Progress';
          return `<tr class="row ${v.sel === t.id ? 'sel' : ''} ${open && ageH(t.created_at) > 48 ? 'overdue' : ''}" data-id="${t.id}"><td>${t.id}</td><td>${badge(t.priority)}${t.ai_status === 'pending' ? ' <span class="hint">AI…</span>' : ''}</td><td>${esc(t.subject)}</td><td>${esc(t.author_name)}</td><td>${esc(t.category)}</td><td>${badge(t.status, 'st-' + slug(t.status))}</td><td>${ageTxt(t.created_at)}</td><td>${esc(t.assignee_name || '—')}</td></tr>`; }).join('')}</table>
        <p class="hint">Showing ${v.list.length} of ${v.total}. Red bar = unresolved for more than 48 hours. ${v.list.length < v.total ? '<button class="s" id="more">Load more</button>' : ''}</p>` : '<p class="empty">No tickets match these filters.</p>'}</div><div id="detail"></div>`;
      for (const k of Object.keys(f)) { const el = $('#f-' + k); if (el) el.onchange = () => { f[k] = el.value; v.limit = 50; v.load(); }; }
      $('#more') && ($('#more').onclick = () => { v.limit += 50; v.load(); });
      document.querySelectorAll('tr.row').forEach(r => r.onclick = () => { v.sel = +r.dataset.id; v.data = null; v.note = ''; v.load(); });
      if (v.sel) v.paintDetail(); },
    paintDetail() { const v = this, d = v.data; if (!d) return; const t = d.ticket, el = $('#detail'); const dr = v.draft[t.id];
      const active = t.status === 'Open' || t.status === 'In Progress';
      // Auto-draft once per ticket, only for active tickets; a failure shows a message instead of retrying in a loop.
      const willGen = !dr && !v.generating && !v.tried[t.id] && active;
      el.innerHTML = `<div class="card"><h3>#${t.id} ${esc(t.subject)}</h3><p class="hint">${esc(t.author_name)} · ${esc(t.book_title || 'General / Account Level')} · ${when(t.created_at)}${t.attachment_name ? ' · 📎 ' + esc(t.attachment_name) : ''}</p>
        <div class="grid"><div><label>Status</label><select id="d-status">${opts(STATS, t.status)}</select></div>
        <div><label>Category ${t.category_overridden ? '<span class="hint">(overridden)</span>' : ''}</label><select id="d-category">${opts(CATS, t.category)}</select><span class="hint">${t.ai_status === 'pending' ? 'AI classifying…' : t.ai_status === 'fallback' ? 'Rule-based (AI was unavailable)' : 'AI: ' + esc(t.ai_category)}</span>${t.ai_status !== 'done' ? ' <button class="s" id="d-reclass">Re-run AI</button>' : ''}</div>
        <div><label>Priority ${t.priority_overridden ? '<span class="hint">(overridden)</span>' : ''}</label><select id="d-priority">${opts(PRIS, t.priority)}</select><span class="hint">${t.ai_priority ? 'Suggested: ' + t.ai_priority : ''}</span></div>
        <div><label>Assigned to</label><div>${esc(t.assignee_name || 'Unassigned')}</div><button class="s" id="d-assign">${t.assigned_to ? 'Unassign' : 'Assign to me'}</button></div></div></div>
        <div class="cols"><div class="card"><h3>Conversation</h3><div class="msg author"><small>Original query</small>${esc(t.description)}</div>${thread(d.messages, true)}
          <label>Internal note (not visible to author)</label><textarea id="d-note" style="min-height:60px">${esc(v.note)}</textarea><button class="s" id="d-addnote">Add note</button></div>
        <div class="card"><h3>Response to author</h3>${dr ? `<p class="hint">${dr.source === 'ai' ? '✨ AI draft (review and edit before sending)' : ''}</p>${dr.source === 'template' ? '<div class="warn">AI is unavailable, so this is a basic template. Please complete it manually.</div>' : ''}` : `<p class="hint">${willGen || v.generating ? 'Generating AI draft…' : 'No draft yet. Write a response or generate one.'}</p>`}
          <textarea id="d-draft" style="min-height:230px">${esc(dr?.body || '')}</textarea>
          <button class="p" id="d-send">Send response</button> <button class="s" id="d-regen">${dr ? 'Regenerate' : 'Generate'} draft</button>
          <p class="hint">Sending moves an Open ticket to In Progress. Use the status selector above to resolve.</p></div></div>`;
      const patch = async b => { try { await api('/tickets/' + t.id, { method: 'PATCH', body: b }); if (b.category) { delete v.draft[t.id]; v.tried[t.id] = false; } await v.load(); } catch (e) { toast(e.message); } };
      $('#d-status').onchange = e => patch({ status: e.target.value }); $('#d-category').onchange = e => patch({ category: e.target.value });
      $('#d-priority').onchange = e => patch({ priority: e.target.value }); $('#d-assign').onclick = () => patch({ assigned_to: t.assigned_to ? null : 'me' });
      $('#d-reclass') && ($('#d-reclass').onclick = async () => { try { await api(`/tickets/${t.id}/classify`, { method: 'POST' }); await v.load(); } catch (e) { toast(e.message); } });
      $('#d-note').oninput = e => v.note = e.target.value; $('#d-draft').oninput = e => v.draft[t.id] = { ...(v.draft[t.id] || { source: 'manual' }), body: e.target.value };
      $('#d-addnote').onclick = async () => { if (!v.note.trim()) return; try { await api(`/tickets/${t.id}/notes`, { method: 'POST', body: { body: v.note } }); v.note = ''; await v.load(); } catch (e) { toast(e.message); } };
      $('#d-send').onclick = async () => { const body = (v.draft[t.id]?.body || '').trim(); if (!body) return toast('Write a response first');
        try { await api(`/tickets/${t.id}/replies`, { method: 'POST', body: { body } }); delete v.draft[t.id]; v.tried[t.id] = true; toast('Response sent'); await v.load(); } catch (e) { toast(e.message); } };
      $('#d-regen').onclick = () => v.generate(t.id);
      if (willGen) v.generate(t.id); },
    async generate(id) { const v = this; v.tried[id] = true; v.generating = true; $('#d-regen') && ($('#d-regen').disabled = true);
      try { const r = await api(`/tickets/${id}/draft`, { method: 'POST' }); v.draft[id] = r.draft; if (r.ai_error) toast('AI unavailable: template provided'); } catch (e) { toast(e.message); }
      v.generating = false; if (v.sel === id) v.paint(); },
    onEvent() { this.load().catch(() => { }); } },
};
boot();
