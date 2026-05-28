# Ola — Release Log / 发布日志

**Ola is the AI sales agent for foreign-trade businesses.** Lead to Quote, in Minutes.
**Ola 是给外贸团队用的 AI 销售助手——从 Lead 到 Quote，几分钟搞定。**

This log captures the changes a salesperson, a customer, or a partner would actually feel. Engineering-only changes are intentionally omitted.
本日志只记录销售、客户、合作方能感受到的变化，纯工程改动不收录。

The current version is shown inside the product under **Settings → sidebar footer**.
当前版本号能在产品里直接看到：**Settings → 左侧边栏底部**。

---

## v1.7.0 — 2026-05-20

**Voice goes into the Lead-to-Quote loop.**

- **Drop a sales call into Ask Ola.** Upload an audio recording in the Ask Ola composer — Ola transcribes it in the background and brings the transcript into the conversation. Ask "what did the customer push back on?" or "how should I close this deal?" and Ola answers from the actual call.
- **A Files page for every recording.** Past uploads now live at `/file` — see transcription status, re-open transcripts in a side drawer, and search past calls without re-uploading.
- **Per-salesperson safety.** Each salesperson's conversation history, uploaded files, and Ola's memory are scoped to their account — even when a team shares the same Ola.

**语音也进入 Lead-to-Quote 流程了。**

- **把销售通话拖进 Ask Ola。** 在 Ask Ola 输入框上传录音，Ola 后台自动转写并把内容带进对话。可以问「客户最担心什么」「这单怎么 close」，Ola 直接基于真实通话回答。
- **Files 页统一管所有录音。** `/file` 显示每条录音的转写状态，可以侧拉抽屉看 transcript，也能搜历史通话，不用重传。
- **每个销售各管各的数据。** 每个销售的对话历史、上传文件、Ola 的记忆都在自己账号范围里 — 团队共用 Ola 也不会串号。

---

## v1.6.0 — 2026-05-12

**Bilingual, complete.**

- **English and 中文 across the entire product.** Settings, Profile, Onboarding, Ask Ola, Merchandise, Factory — every page now switches language cleanly with the salesperson's preference, finishing the bilingual promise from v1.4.
- **Language toggle in one place.** A new language switch lives in the header — flip it once and the whole product follows.

**双语支持，全产品完成。**

- **中英双语覆盖所有页面。** Settings、Profile、Onboarding、Ask Ola、商品、工厂 — 每个页面都按销售本人的语言偏好切换，把 v1.4 的双语承诺补完了。
- **顶部统一切换。** 顶部新加语言切换 — 切一次，整个产品跟着走。

---

## v1.5.0 — 2026-05-06

**Email becomes a Lead-to-Quote channel.**

- **Send Ola your inquiries.** Email or forward any customer inquiry to **`ola@olatech.ai`**. Ola reads it, identifies the products, and runs the Lead-to-Quote loop end-to-end. No copy-paste, no switching tabs.
- **Quote PDF, in the chat.** Ask Ola can hand back a customer-ready Quote PDF directly in the conversation — one click to download and send.
- **Account-scoped by default.** Every Ola action runs in the context of the salesperson who sent the request — the safety guarantee that makes the email channel and shared workspaces possible.

**邮件成为 Lead-to-Quote 的新入口。**

- **把询盘直接发给 Ola。** 给 **`ola@olatech.ai`** 发邮件，或者把客户的询盘转过去，Ola 会读邮件、认产品、把 Lead-to-Quote 一路跑完。不用复制粘贴，也不用切窗口。
- **Quote PDF 当场给你。** Ask Ola 在对话里就能生成可发客户的 Quote PDF——下载好就能发出去。
- **每个销售各管各的数据。** Ola 每次动作都按发起请求的销售身份来执行——所以邮件通道和团队共用都不会串号。

---

## v1.4.0 — 2026-05-02

**Bilingual, per salesperson.**

- **Each salesperson picks their language.** Ask Ola, quote drafts, and product copy switch between English and 中文 based on the salesperson's preference. Customer-facing output (a Quote PDF, an email reply) follows along.
- **English-first by default** — matching Ola's foreign-trade customer base.

**中英双语，每个销售用自己的语言。**

- **跟着销售本人的语言切。** Ask Ola、Quote 草稿、产品文案都在英文和中文之间走；最后发给客户的 Quote PDF 和邮件回复也跟着走。
- **默认英文优先**——外贸场景里 Ola 的用户大多面向英文客户。

---

## v1.3.0 — 2026-04-27

**Lead-to-Quote, in plain sight.**

- **You see Ola think.** Ask Ola streams its reasoning and tool calls live — searching merchandise, drafting a quote, pulling customer history — so the salesperson knows exactly what's happening before the reply lands.
- **Quote preview in the chat.** A drafted quote shows up inline with a one-click PDF download. Hand it straight to the customer.

**Lead-to-Quote，全程可见。**

- **看 Ola 现场思考。** Ask Ola 把推理过程和工具调用都实时展开——查商品、起草 Quote、翻客户历史——结果出来之前你就知道它在做什么。
- **Quote 在对话里直接预览。** 起草好的 Quote 就在对话里，一键下载 PDF，直接发给客户。

---

## v1.2.0 — 2026-04-20

**A new home.**

- **Ola is now live at `app.olatech.ai`.**
- **Faster product entry.** Adding merchandise takes three required fields, not a long form — everything else can be filled in later.

**换新家。**

- **Ola 正式搬到 `app.olatech.ai`。**
- **加商品更快。** 必填只剩三个字段，不再是一张长表，其它的之后再补。

---

## v1.1.0 — 2026-04-19

**Brand identity.**

- **Lead to Quote, in Minutes.** Login and onboarding lead with Ola's positioning and the new logo — the product's promise is visible from the first screen.

**品牌正式亮相。**

- **Lead to Quote, in Minutes。** 登录和注册的第一屏就是 Ola 的定位和新 logo——产品要做什么，第一眼就看到。

---

## v1.0.0 — 2026-04-19

**Ola goes live.**

- **The Lead-to-Quote loop, end-to-end.** A customer sends a WhatsApp inquiry. Ola extracts the product needs, matches them against your merchandise catalog, and helps the salesperson draft a Quote — leaving the price for the salesperson to fill. Ola never invents prices.
- **Quote PDF, branded and ready to send.** Generated with your company logo, scoped to the salesperson's account, and formatted for a customer.
- **Ask Ola, your sales agent.** A chat assistant powered by an internal AI runtime — the foundation that v1.1 through v1.5 build on.

**Ola 正式上线。**

- **Lead-to-Quote 全链路打通。** 客户在 WhatsApp 发来询盘，Ola 抽产品需求、匹配商品库、帮销售起草 Quote——价格留给销售自己填，Ola 不编价格。
- **可直接发客户的 Quote PDF。** 自动带公司 logo，按销售账号隔离，开出来就能发。
- **Ask Ola——你的销售 Agent。** 内部 AI 驱动的对话助手——v1.1 到 v1.5 都建在这上面。
