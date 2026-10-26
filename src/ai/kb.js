// BookLeaf Knowledge Base, split into sections so each call only sends what the ticket category needs.
const SECTIONS = {
  company: `BookLeaf Publishing: self-publishing company in India and the US. Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (paid, with marketing and distribution add-ons). We handle cover design, typesetting, ISBN assignment, printing, distribution and royalty management. In-house printing facility and warehouse in Delhi; print partners Repro India and Epitome Books.`,
  royalty: `ROYALTY POLICY
- 80/20 split: 80% of net profit per book to the author, 20% to BookLeaf. Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of quarter end.
- Minimum payout threshold: ₹1,000. Below it, royalties roll over to the next quarter.
- Paid by bank transfer to the account linked in the author's dashboard. Authors can see a per-platform royalty breakdown in the dashboard.`,
  isbn: `ISBN POLICY
- Every BookLeaf book gets a unique ISBN assigned by BookLeaf, registered under BookLeaf's imprint. An author wanting an ISBN under their own imprint must obtain it independently.
- ISBN errors (duplicate, wrong book linked) are HIGH priority and escalated to the production team.`,
  printing: `PRINTING & QUALITY
- In-house printing handles most orders; overflow/specific formats go to Repro India or Epitome Books.
- Standard print turnaround: 5-7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): free reprint after verification; the author may need to share photos of the defective copy.`,
  distribution: `DISTRIBUTION & AVAILABILITY
- Listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.
- New listings go live 7-10 business days after publication is complete.
- A book showing unavailable on a platform is usually a stock sync issue; the team can trigger a re-sync within 24-48 hours.`,
  production: `PRODUCTION STAGES
Manuscript Received > Editing (if opted) > Cover Design > Typesetting > Proofreading > ISBN Assignment > Printing > Distribution Setup > Published & Live. Authors are emailed at each stage. Delays usually happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).`,
  general: `GENERAL
- Metadata updates (e.g. book description on Amazon) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3-5 business days.`,
};
const BY_CATEGORY = {
  'Royalty & Payments': ['royalty'], 'ISBN & Metadata Issues': ['isbn', 'general'],
  'Printing & Quality': ['printing'], 'Distribution & Availability': ['distribution'],
  'Book Status & Production Updates': ['production'], 'General Inquiry': ['general', 'distribution'],
};
const GUIDANCE = {
  'Royalty & Payments': `No royalty yet: acknowledge the frustration, explain the quarterly cycle and 45-day window, ask them to confirm bank details are linked in the dashboard, give the specific next payout date, and if genuinely overdue escalate with a 48-hour resolution timeline. Amount seems too low: explain the net-profit calculation (MRP minus printing, platform commission, shipping), offer a detailed line-by-line breakdown, do not be defensive.`,
  'ISBN & Metadata Issues': `Treat as high priority. Acknowledge it is a serious data issue, confirm escalation to the production team immediately, give a 48-hour resolution timeline.`,
  'Printing & Quality': `Apologise sincerely. Ask for photos of the defective copies. Confirm a free reprint once verified. Timeline: 5-7 business days for the reprint.`,
  'Distribution & Availability': `Explain this is typically a stock sync issue. Confirm you are triggering a re-sync with the distribution team. Set expectation: 24-48 hours to go live again.`,
  'Book Status & Production Updates': `Use the actual status from the account data. If delayed, be honest about why (e.g. waiting on proof approval) but never blame the author; frame it collaboratively. Give a specific updated timeline.`,
  'General Inquiry': `Answer directly and concisely from the knowledge base; say what to do next.`,
};
const kbFor = category => [SECTIONS.company, ...(BY_CATEGORY[category] || BY_CATEGORY['General Inquiry']).map(k => SECTIONS[k])].join('\n\n');
module.exports = { kbFor, GUIDANCE };
