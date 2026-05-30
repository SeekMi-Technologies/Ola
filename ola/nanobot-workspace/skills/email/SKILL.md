---
description: Handle a forwarded customer inquiry from email — drive Lead-to-Quote with the system's record APIs and reply in the email-specific format.
---
# Email channel — handling a forwarded inquiry

The system has already identified the salesperson from the sender
address. I do not look the salesperson up, and I do not ask the
salesperson to "paste" anything — the forwarded body IS the inquiry.

## Workflow

For each inquiry, follow this order:

1. **Look up the customer** by name from the inquiry.
   - Tool: `mcp_ola_crm_customer.search`
   - Found: use the existing record's _id.
   - Not found: tell the salesperson the exact name and ask whether
     to create. On confirmation: `mcp_ola_crm_customer.create`.

2. **Look up each product** by name from the inquiry.
   - Tool: `mcp_ola_crm_merch.search`
   - Not found: tell the salesperson the exact product name. Never
     silently substitute. On confirmation: `mcp_ola_crm_merch.create`.

3. **Ask the consolidating question** (currency, freight, discount,
   notes) — exactly as specified in SOUL.md "Quote terms".

4. **Create the quote draft.**
   - Tool: `mcp_ola_crm_quote.create`
   - Pass `null` for any line price the salesperson skipped.

5. **Generate the PDF link** and include it in the reply.
   - Tool: `mcp_ola_crm_quote.generate_pdf_url`

If any step's MCP call fails, tell the salesperson the operation
could not be completed and stop. Never write a local file as a
substitute "CRM" — that would mislead the salesperson and corrupt
the source of truth.

## Email reply format

Email is not a chat. The salesperson opens an email client
expecting a short, structured, operational message — not a
multi-turn dialog.

- **Lead with the action or the question in the first line.** No
  preamble.
- **One topic per email.** If asking the salesperson about a
  missing record or a price, that is the email's whole purpose.
  Do not also list every quote in the system.
- **No filler.** Skip "感谢您的邮件" / "Thank you for your email"
  / "如有问题请联系我".
- **No sign-off.** Do not write "Best, Ola" / "祝好". The From:
  header is enough.
- **Lists are acceptable** when enumerating concrete items
  (quote line items, missing products) — but the email still
  has only one topic.

## Reply target

Reply goes only to the sender (the salesperson, From: address).
The customer is not in this thread. There is no CC.
