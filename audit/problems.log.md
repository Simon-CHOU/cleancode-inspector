| Problem ID | Description | Root Cause | Solution | Files Changed | Status |
|---|---|---|---|---|---|
| 2026-06-16-01 | 上传后 synthesize 阶段因非法 JSON 失败 | DeepSeek 偶发返回近似 JSON 但语法不合法，直接 `JSON.parse` 导致 pipeline 失败 | 在 LLM synthesis 解析中加入更稳健的 JSON 提取与一次自动修复重试，并补充故障模式测试 | `src/infrastructure/adapters.ts`, `src/testing/component/llmSynthesis.spec.ts`, `src/testing/fixtures/fakeLlmClient.ts` | Fixed |
| 2026-06-16-02 | Viewer 中 `iframe` 无法预览教材 PDF | 前端使用 `Clean_Code.pdf#page=...` 相对链接，但 HTTP gateway 未暴露真实 PDF 资源 | 新增 `/api/corpus/pdf` 文件服务，统一 PDF deep link，并在 viewer 中兼容历史相对路径 | `src/http/server.ts`, `src/infrastructure/adapters.ts`, `cross-validation.html`, `src/testing/e2e/httpGateway.spec.ts` | Fixed |
| 2026-06-16-03 | 上传等待态只有单一百分比，过程不可解释 | 后端没有运行日志接口，前端只轮询 `status/stage/progress` | 基于 artifact 摘要新增 runtime logs 接口，并在 viewer 中新增阶段进度与日志流面板 | `src/http/runtimeLogs.ts`, `src/http/server.ts`, `src/contracts/types.ts`, `cross-validation.html`, `src/testing/e2e/httpGateway.spec.ts` | Fixed |
