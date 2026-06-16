import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";

import { createApplication } from "../bootstrap/createApplication.js";
import { createMappingMcpService } from "./createMappingMcpService.js";

const application = createApplication();
const service = createMappingMcpService(application);

const server = new Server(
  {
    name: "mapping-mcp-server",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mapping_create_job",
      description: "接收单个 .java 文件内容，创建异步 mapping job。",
      inputSchema: {
        type: "object",
        properties: {
          file_name: { type: "string" },
          language: { type: "string", enum: ["java"] },
          source_code: { type: "string" },
          corpus_id: { type: "string" },
          mapping_profile_id: { type: "string" },
          model_profile_id: { type: "string" }
        },
        required: ["file_name", "language", "source_code"]
      }
    },
    {
      name: "mapping_get_job",
      description: "查询 mapping job 的状态、阶段、错误与结果 ID。",
      inputSchema: {
        type: "object",
        properties: {
          job_id: { type: "string" }
        },
        required: ["job_id"]
      }
    },
    {
      name: "mapping_get_result",
      description: "在 job 完成后返回结构化 mapping schema 结果。",
      inputSchema: {
        type: "object",
        properties: {
          job_id: { type: "string" }
        },
        required: ["job_id"]
      }
    },
    {
      name: "mapping_open_viewer",
      description: "根据 job_id 打开浏览器 viewer，用于承载 mapping 可视化结果。",
      inputSchema: {
        type: "object",
        properties: {
          job_id: { type: "string" }
        },
        required: ["job_id"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "mapping_create_job": {
        const result = await service.mappingCreateJob(request.params.arguments ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      case "mapping_get_job": {
        const result = await service.mappingGetJob(request.params.arguments ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      case "mapping_get_result": {
        const result = await service.mappingGetResult(request.params.arguments ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      case "mapping_open_viewer": {
        const result = await service.mappingOpenViewer(request.params.arguments ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    const normalized = service.formatToolError(error);
    throw new McpError(ErrorCode.InvalidParams, `${normalized.code}: ${normalized.message}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
