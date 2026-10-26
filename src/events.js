// Server-Sent Events hub. Admins receive every event; authors only events for their own tickets.
const clients = new Set();
function subscribe(req, res, user) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const client = { res, user };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(client); });
}
function publish(type, { ticketId, authorId, adminOnly = false }) {
  for (const c of clients) {
    const allowed = c.user.role === 'admin' || (!adminOnly && c.user.author_id === authorId);
    if (allowed) c.res.write(`event: ${type}\ndata: ${JSON.stringify({ ticketId })}\n\n`);
  }
}
module.exports = { subscribe, publish };
