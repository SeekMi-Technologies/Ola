/**
 * Mission Control Mock Data — Palantir-style lead-to-quote command center.
 *
 * Shape = front/back contract. Backend Mission model must return objects of
 * this shape from GET /mission/list.
 *
 * `report[]` reuses the AskOla block/widget schema so the drawer renders
 * it with existing block components. It is the condensed agent work log —
 * NOT raw emails.
 */

const MOCK_MISSIONS = [
  // ── 1. Inquiry · processing ────────────────────────────────────────────
  {
    id: 'm_001',
    client: { name: 'Shanghai Steel Trading Co.', contact: 'Mr. Wang', country: '🇨🇳' },
    channel: 'whatsapp',
    stage: 'inquiry',
    agentState: 'processing',
    summary: 'Parsing inquiry PDF — 5 wire-rope SKUs requested, matching against catalog.',
    lastActivityAt: '2026-06-04T13:48:00Z',
    assignedTo: { name: 'Yuandong', initial: 'Y' },
    linkedQuote: null,
    pendingActionCount: 0,
    goal: 'Extract product needs → match catalog → assist drafting a quote',
    linkedEntities: [
      { type: 'client', label: 'Shanghai Steel Trading Co.' },
      { type: 'merch', label: 'WR-6001' },
    ],
    tools: ['merch-matcher', 'quote-drafter'],
    report: [
      { type: 'thinking', content: 'Parsing PDF attachment...\nExtracted 5 product requirements\nMatching against merchandise catalog...' },
      { type: 'text', content: 'Parsing the customer\'s inquiry file. Extracted **5 product requirements** — matching results coming shortly.' },
    ],
  },

  // ── 2. Inquiry · awaiting approval ─────────────────────────────────────
  {
    id: 'm_002',
    client: { name: 'Jakarta Hardware Imports', contact: 'Budi', country: '🇮🇩' },
    channel: 'whatsapp',
    stage: 'inquiry',
    agentState: 'awaiting_approval',
    summary: '3 of 5 SKUs matched (98% / 95% / 91%). 2 unmatched — needs your call before quoting.',
    lastActivityAt: '2026-06-04T13:20:00Z',
    assignedTo: { name: 'Ziyue', initial: 'Z' },
    linkedQuote: null,
    pendingActionCount: 2,
    goal: 'Confirm matches → resolve 2 unmatched SKUs → draft quote',
    linkedEntities: [
      { type: 'client', label: 'Jakarta Hardware Imports' },
      { type: 'merch', label: 'WR-6001' },
      { type: 'merch', label: 'WR-8002' },
    ],
    tools: ['merch-matcher', 'quote-drafter'],
    report: [
      {
        type: 'text',
        content: 'Parsed inquiry. **3 matched**, **2 unmatched**. Please confirm whether to draft a quote from the matched items only.',
      },
      {
        type: 'widget',
        widgetType: 'merch_match',
        data: {
          matched: [
            { serialNumber: 'WR-6001', name: '6mm Galvanized Wire Rope (6×19)', confidence: 98 },
            { serialNumber: 'WR-8002', name: '8mm Stainless Wire Rope (7×7)', confidence: 95 },
            { serialNumber: 'WR-1003', name: '10mm PVC-Coated Wire Rope (6×37)', confidence: 91 },
          ],
          unmatched: ['12mm Special Alloy Wire Rope', '5mm Copper-Core Wire Rope'],
        },
      },
      {
        type: 'action',
        actions: [
          { label: 'Approve & draft quote', actionId: 'create_quote', primary: true },
          { label: 'Add unmatched to catalog', actionId: 'add_unmatched' },
          { label: 'Reject', actionId: 'reject' },
        ],
      },
    ],
  },

  // ── 3. Negotiation · idle ──────────────────────────────────────────────
  {
    id: 'm_003',
    client: { name: 'Hamburg Marine Supply', contact: 'Klaus', country: '🇩🇪' },
    channel: 'email',
    stage: 'negotiation',
    agentState: 'idle',
    summary: 'Customer requested 8% volume discount on a 2,000m order. Awaiting your pricing decision.',
    lastActivityAt: '2026-06-04T09:10:00Z',
    assignedTo: { name: 'Yuandong', initial: 'Y' },
    linkedQuote: { number: 'QT-20260603-014', total: 16400, currency: 'USD' },
    pendingActionCount: 0,
    goal: 'Negotiate price within margin floor → re-issue quote',
    linkedEntities: [
      { type: 'client', label: 'Hamburg Marine Supply' },
      { type: 'quote', label: 'QT-20260603-014' },
    ],
    tools: ['price-researcher', 'quote-drafter'],
    report: [
      {
        type: 'text',
        content: 'Customer is requesting an **8% discount** on a 2,000m commitment. Current unit price is at market average — a 5% counter-offer keeps margin above floor. Recommend countering at **5%**.',
      },
    ],
  },

  // ── 4. Quote drafting · processing ─────────────────────────────────────
  {
    id: 'm_004',
    client: { name: 'São Paulo Construções', contact: 'Carla', country: '🇧🇷' },
    channel: 'whatsapp',
    stage: 'quote_drafting',
    agentState: 'processing',
    summary: 'Drafting quote QT-20260604-021 from matched catalog — 3 line items, pricing pending.',
    lastActivityAt: '2026-06-04T13:05:00Z',
    assignedTo: { name: 'Ziyue', initial: 'Z' },
    linkedQuote: { number: 'QT-20260604-021', total: 6220, currency: 'CNY' },
    pendingActionCount: 0,
    goal: 'Generate draft quote → salesperson fills final pricing',
    linkedEntities: [
      { type: 'client', label: 'São Paulo Construções' },
      { type: 'quote', label: 'QT-20260604-021' },
    ],
    tools: ['quote-drafter'],
    report: [
      {
        type: 'text',
        content: 'Generated quote draft from the 3 confirmed items. **Unit prices left blank for the salesperson** — agent never invents prices.',
      },
      {
        type: 'widget',
        widgetType: 'quote_draft',
        data: {
          quoteNumber: 'QT-20260604-021',
          clientName: 'São Paulo Construções',
          items: [
            { serialNumber: 'WR-6001', name: '6mm Galvanized Wire Rope (6×19)', quantity: 500, unit: 'm', price: 4.5 },
            { serialNumber: 'WR-8002', name: '8mm Stainless Wire Rope (7×7)',   quantity: 300, unit: 'm', price: 8.2 },
            { serialNumber: 'WR-1003', name: '10mm PVC-Coated Wire Rope (6×37)', quantity: 200, unit: 'm', price: 6.8 },
          ],
        },
      },
    ],
  },

  // ── 5. Quote finalization · awaiting approval ──────────────────────────
  {
    id: 'm_005',
    client: { name: 'Lagos Industrial Ltd', contact: 'Chioma', country: '🇳🇬' },
    channel: 'email',
    stage: 'quote_finalization',
    agentState: 'awaiting_approval',
    summary: 'Quote ready to send — drafted email + PDF. Approve to send via Email.',
    lastActivityAt: '2026-06-04T11:40:00Z',
    assignedTo: { name: 'Yuandong', initial: 'Y' },
    linkedQuote: { number: 'QT-20260603-009', total: 23800, currency: 'USD' },
    pendingActionCount: 1,
    goal: 'Finalize pricing + terms → send quote to customer',
    linkedEntities: [
      { type: 'client', label: 'Lagos Industrial Ltd' },
      { type: 'quote', label: 'QT-20260603-009' },
    ],
    tools: ['quote-drafter', 'email-composer'],
    report: [
      {
        type: 'text',
        content: 'Quote **QT-20260603-009** is finalized (FOB terms included). Draft email is ready — **awaiting your approval to send**.',
      },
      {
        type: 'action',
        actions: [
          { label: 'Approve & send via Email', actionId: 'send_quote', primary: true },
          { label: 'Edit draft', actionId: 'edit_draft' },
        ],
      },
    ],
  },

  // ── 6. Won · done ──────────────────────────────────────────────────────
  {
    id: 'm_006',
    client: { name: 'Dubai Trading FZE', contact: 'Omar', country: '🇦🇪' },
    channel: 'whatsapp',
    stage: 'won',
    agentState: 'done',
    summary: 'Quote accepted ✓ — customer confirmed PO. Summary synced to client notes.',
    lastActivityAt: '2026-06-03T16:30:00Z',
    assignedTo: { name: 'Ziyue', initial: 'Z' },
    linkedQuote: { number: 'QT-20260602-003', total: 41250, currency: 'USD' },
    pendingActionCount: 0,
    goal: 'Quote accepted → hand off to order fulfillment',
    linkedEntities: [
      { type: 'client', label: 'Dubai Trading FZE' },
      { type: 'quote', label: 'QT-20260602-003' },
    ],
    tools: [],
    report: [
      {
        type: 'text',
        content: 'Customer **accepted quote** QT-20260602-003 for **$41,250**. Closing summary synced to client notes. Recommend handing off to the purchase order flow.',
      },
    ],
  },
];

export default MOCK_MISSIONS;
