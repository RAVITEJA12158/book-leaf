// Deterministic fallbacks used when the AI API is down, rate-limited or unconfigured.
// Category = the one with the most keyword hits (ties resolved by list order, most specific first).
const RULES = [
  ['ISBN & Metadata Issues', /isbn|wrong book|duplicate|barcode|metadata/gi],
  ['Printing & Quality', /print|blurry|binding|misprint|misalign|defect|quality|colou?r|torn|damaged|reprint/gi],
  ['Royalty & Payments', /royalt|payout|payment|paid|bank|earn|commission|₹|\brs\.?\s?\d|\bcopies sold|sold \d+/gi],
  ['Distribution & Availability', /unavailable|out of stock|not showing|not listed|listing|availab|flipkart|amazon/gi],
  ['Book Status & Production Updates', /typesett|cover design|proof|editing|production|status|when will|how long|stage/gi],
];
const hits = (re, text) => (text.match(re) || []).length;
function heuristicClassify({ subject, description }) {
  const text = `${subject} ${description}`;
  let best = ['General Inquiry', 0];
  for (const [cat, re] of RULES) { const n = hits(re, text); if (n > best[1]) best = [cat, n]; }
  const category = best[0];
  let priority = 'Medium';
  const noMoneyForLong = /never received|not received any|haven'?t received (any|a single)|over a year|\b([6-9]|1\d)\s*months?\b/i;
  if (/legal|lawyer|fraud|scam|cheat/i.test(text) || (category === 'Royalty & Payments' && noMoneyForLong.test(text))) priority = 'Critical';
  else if (category === 'ISBN & Metadata Issues' || /urgent|immediately|asap|terrible|unacceptable|still waiting/i.test(text)) priority = 'High';
  else if (category === 'General Inquiry' || /\b(update|change|bio|description|how (do|can) i|can i)\b/i.test(text)) priority = 'Low';
  return { category, priority };
}
const TEMPLATES = {
  'Royalty & Payments': "Royalties are calculated quarterly and paid within 45 days of quarter end (minimum payout ₹1,000). [Add the author's figures and next payout date.] Our team will review this and get back to you within 48 hours.",
  'ISBN & Metadata Issues': 'This is a serious data issue and we are escalating it to our production team immediately. You will hear back from us within 48 hours.',
  'Printing & Quality': 'We are sorry about the quality of your copies. Please share photos of the defective copies; once verified we will arrange a free reprint, which takes 5-7 business days.',
  'Distribution & Availability': 'This is usually a stock sync issue. We are triggering a re-sync with our distribution team; the book should be live again within 24-48 hours.',
  'Book Status & Production Updates': '[Add the current production stage and updated timeline.] We will keep you updated at every stage.',
  'General Inquiry': '[Add the answer.]',
};
function templateDraft(ticket, authorName) {
  return `Hi ${String(authorName).split(' ')[0]},\n\nThank you for reaching out about "${ticket.subject}", and we understand why this matters to you.\n\n${TEMPLATES[ticket.category] || TEMPLATES['General Inquiry']}\n\nNext step: our team will follow up on this ticket.\n\nWarm regards,\nTeam BookLeaf`;
}
module.exports = { heuristicClassify, templateDraft };
