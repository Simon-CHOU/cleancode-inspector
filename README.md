# tk-personal-growth mapping service

本项目把“单个 `.java` 文件 -> 教材证据召回 -> LLM synthesis -> `MappingSchema` 可视化”做成了两种可复用入口：

- `MCP Server`：供 Trae / MCP Market 使用
- `HTTP Gateway + Viewer`：供浏览器上传文件、轮询 job、查看结果

## 环境变量

在项目根目录创建 `.env.local`：

```env
MAPPING_PDF_PATH=D:\Downloads\Clean_Code.pdf.split\Clean_Code.pdf
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
MAPPING_GATEWAY_HOST=127.0.0.1
MAPPING_GATEWAY_PORT=8765
```

`DEEPSEEK` 相关配置走 BYOK 模式，模型名固定为 `deepseek-v4-flash`。

## 本地启动

安装依赖：

```bash
npm install
```

启动 HTTP Gateway：

```bash
npm run start:http
```

启动 MCP Server：

```bash
npm run start:mcp
```

## Web 使用方式

1. 启动 `npm run start:http`
2. 打开 `http://127.0.0.1:8765/cross-validation.html`
3. 上传单个 `.java` 文件
4. 页面会自动创建 job、轮询状态，并在完成后刷新 mapping 结果
5. 也可以使用 `http://127.0.0.1:8765/cross-validation.html?demo=1` 查看静态 demo

## Trae / MCP Market 使用方式

可以用类似下面的 MCP 配置挂载本地 server：

```json
{
  "mcpServers": {
    "mapping-mcp-server": {
      "command": "npm",
      "args": ["run", "start:mcp"],
      "cwd": "d:\\ml\\ppt-vibe\\tk-personal-growth"
    }
  }
}
```

推荐调用顺序：

1. `mapping_create_job`
2. `mapping_get_job`
3. `mapping_get_result`
4. `mapping_open_viewer`

如果只想直接承载可视化结果，可以在 job 完成后调用 `mapping_open_viewer`，它会尝试打开默认浏览器并跳到该 job 的 viewer 页面。

## 常用脚本

```bash
npm run build
npm test
npm run start:http
npm run start:mcp
```
