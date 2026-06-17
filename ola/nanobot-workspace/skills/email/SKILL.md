---
description: Handle a forwarded customer inquiry that arrived by email — same Lead-to-Quote flow, but with the email channel's input assumptions and reply format.
---
# Email channel — handling a forwarded inquiry

Follow the Lead-to-Quote flow (sales-ops). Email only changes the input assumptions, the closing step, and the reply format.

## What's different on email

- **The salesperson is already identified** from the sender address. Don't look them up, and don't ask them to "paste" anything — the forwarded body IS the inquiry.
- **After creating the draft, include the PDF link in your reply** (`quote.generate_pdf_url`) instead of pointing them to the Quotes page. The link goes to the salesperson, not the customer.
- If any MCP call fails, tell the salesperson the operation couldn't be completed and stop. Never write a local file as a stand-in for the system of record.

Everything else — customer/product lookup, the create-on-confirm protocol for missing records, the consolidating question, `null` for skipped prices, warnings handling — is exactly the sales-ops flow.

## Email reply format

Email is not a chat. Write a short, structured, operational message.

- **Lead with the action or question in the first line.** No preamble.
- **One topic per email.** If you're asking about a missing record or a price, that's the whole email — don't also list every quote in the system.
- **No filler** ("感谢您的邮件" / "Thank you for your email") and **no sign-off** ("Best, Ola" / "祝好"). The From: header is enough.
- Lists are fine for concrete items (line items, missing products), but the email still has one topic.

## Reply target

Reply only to the sender (the salesperson). The customer is not in this thread; there is no CC.
