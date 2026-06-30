# E2E 测试指南 — 综合多文件分析（issue #388）

**变更内容**：SOUL.md 新增 `## Comprehensive multi-file analysis` 规则段  
**测试目标**：验证 agent 在收到"综合/整体/全部"评估意图时，走批量收集→一次输出路径，而非逐个录音分析路径

---

## 前置条件

- 本地 Ola CRM（`npm run dev`，backend 8888 / frontend 3000）和 nanobot（`nanobot serve`）均正常运行
- 已上传至少 2 个音频文件并完成转写（status = done）
- 登录 askola 界面，确认可以正常发送消息
- 如需测试 WhatsApp 路径，需要 WhatsApp 频道已连接（或使用 nanobot CLI 模拟）

---

## Case 1：Web UI — 多文件综合评估（Path A，有 hint）

**步骤**：
1. 在 askola 界面，通过 PaperClip 同时选中 **2 个或以上**已转写完成的录音文件并发送
2. 消息内容填写：`帮我综合评估一下这几段录音`

**期望行为**：
- agent **不**输出"正在分析第 1 段…"类的中间进度文字
- agent **只**输出**一份**结构化报告，包含三个部分：
  - 共同主题
  - 关键差异
  - 综合结论
- 报告末尾有"需要我做什么？"或类似收尾
- DevTools Network tab 中，MCP `file.get_transcript` 调用**同时发出**（非串行），可通过 Timing 面板确认

**不应出现**：
- 多份独立的"录音 1 分析"/"录音 2 分析"输出
- 逐条滚动输出，每条录音后都有 agent 回复

---

## Case 2：Web UI — 无 hint，通过 file.search 发现（Path A，无 hint）

**步骤**：
1. **不附加任何文件**，直接在 askola 输入框发送：`帮我把所有录音综合评估一下`

**期望行为**：
- agent 调用 `file.search`（可在 nanobot 控制台日志看到 `Tool call: file.search`）
- 接着批量调用所有 status=done 文件的 `file.get_transcript`
- 输出一份综合报告（同 Case 1 格式）

**边界情况**：
- 如无任何已转写文件 → agent 告知"未找到已转写录音，请通过 PaperClip 上传"
- 如有部分文件仍在转写（processing）→ 报告末尾注明哪些文件被跳过（by originalName）

---

## Case 3：Web UI — 单文件，确认不误触发（回归）

**步骤**：
1. 附加**一个**录音文件，发送：`分析一下这段录音`

**期望行为**：
- 走**原来的单文件路径**（sugar）
- 输出 2-4 句摘要，末尾"需要我做什么？"
- **不**出现"共同主题"/"关键差异"/"综合结论"结构

---

## Case 4：WhatsApp — 多条语音消息综合（Path B）

**步骤**：
1. 通过 WhatsApp 连续发送 2 条以上语音消息（PTT 按住说话）
2. agent 分别给出每条语音的 sugar 回复后
3. 再发送文字消息：`对这几段录音综合评估一下`

**期望行为**：
- agent **不**调用任何 `file.*` 工具（nanobot 日志中无 `Tool call: file.search` 或 `file.get_transcript`）
- agent 直接从对话 history 中的转写内容综合
- 输出一份报告（共同主题 / 关键差异 / 综合结论）

**验证方法**（nanobot 日志）：

```bash
# 在 nanobot serve 终端，确认无 file.* tool call
grep "Tool call: file" ~/.nanobot/logs/nanobot.log | tail -20
# 应该没有任何输出（或仅有之前单条语音分析时的调用）
```

---

## Case 5：WhatsApp — 询问已上传文件（Path A via WhatsApp）

**步骤**：
1. 在 WhatsApp 中发送：`帮我把上传的录音综合评估`（不发语音，发文字）

**期望行为**：
- 无 `[语音消息转写]` 前缀在 history 中，走 Path A
- agent 调用 `file.search` → 批量 `file.get_transcript` → 综合报告
- nanobot 日志可见 `Tool call: file.search`

---

## 自动化验证（Jest）

```bash
cd Ola/backend
npx jest test/soul.comprehensive.test.js --no-coverage
```

所有 assertions 通过 → SOUL.md 结构完整，无规则被意外删除。

---

## 自动化验证（Python，nanobot repo）

```bash
cd nanobot
pytest tests/agent/test_comprehensive_analysis.py -v
```

**测试覆盖**：
- `TestSoulComprehensiveSection`：SOUL.md 结构断言（6 项）
- `TestRunnerBatchToolCalls::test_all_get_transcript_calls_executed_in_one_iteration`：runner 在一次 LLM iteration 内批量执行 3 个 file.get_transcript
- `TestRunnerBatchToolCalls::test_no_output_before_all_transcripts_collected`：收集阶段无中间文字输出

---

## 判定标准

| Case | 通过条件 |
|---|---|
| Case 1 | 一份报告，含三段结构，无逐条分析 |
| Case 2 | 日志见 file.search，输出一份综合报告 |
| Case 3 | 单文件 sugar，无综合报告结构 |
| Case 4 | 日志无 file.* tool call，输出综合报告 |
| Case 5 | 日志见 file.search，输出综合报告 |
| Jest   | `npx jest soul.comprehensive.test.js` → 全绿 |
| pytest | `pytest test_comprehensive_analysis.py` → 全绿 |
