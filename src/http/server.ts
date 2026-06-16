import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createApplication, type Application } from "../bootstrap/createApplication.js";
import {
  resolvePdfPath,
  resolveGatewayBaseUrl,
  resolveGatewayHost,
  resolveGatewayPort
} from "../bootstrap/config.js";
import { createMappingHttpService } from "./createMappingHttpService.js";
import { buildRuntimeLogs } from "./runtimeLogs.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

interface MappingHttpServerOptions {
  application?: Application;
  rootDir?: string;
  host?: string;
  port?: number;
  gatewayBaseUrl?: string;
  pdfPath?: string;
  runtimeBaseDir?: string;
}

export interface RunningHttpServer {
  baseUrl: string;
  close(): Promise<void>;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": JSON_CONTENT_TYPE });
  response.end(JSON.stringify(payload, null, 2));
}

function writeText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function getContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".json":
      return JSON_CONTENT_TYPE;
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function resolveStaticFilePath(rootDir: string, pathname: string): string | null {
  const requested = pathname === "/" ? "/cross-validation.html" : pathname;
  const resolvedRoot = resolve(rootDir);
  const resolvedFile = resolve(resolvedRoot, `.${requested}`);
  if (!resolvedFile.startsWith(resolvedRoot)) {
    return null;
  }
  return resolvedFile;
}

function getActualPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP server address is not available.");
  }
  return address.port;
}

function createNotFoundPayload(pathname: string) {
  return {
    code: "NOT_FOUND",
    message: `Route not found: ${pathname}`
  };
}

export async function startHttpServer(options: MappingHttpServerOptions = {}): Promise<RunningHttpServer> {
  const ownsApplication = !options.application;
  const application = options.application ?? createApplication();
  const host = options.host ?? resolveGatewayHost();
  const port = options.port ?? resolveGatewayPort();
  const rootDir = options.rootDir ?? process.cwd();
  const pdfPath = resolvePdfPath(options.pdfPath);
  const runtimeBaseDir = resolve(options.runtimeBaseDir ?? join(process.cwd(), ".runtime"));

  let gatewayBaseUrl = options.gatewayBaseUrl ?? resolveGatewayBaseUrl({ host, port });
  let service = createMappingHttpService(application, gatewayBaseUrl);

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", gatewayBaseUrl);
    const pathname = requestUrl.pathname;

    try {
      if (method === "GET" && pathname === "/healthz") {
        writeJson(response, 200, service.health());
        return;
      }

      if (method === "POST" && pathname === "/api/mapping/jobs") {
        const payload = await readJsonBody(request);
        const created = await service.mappingCreateJob(payload);
        writeJson(response, 202, created);
        return;
      }

      if (method === "GET" && pathname === "/api/corpus/pdf") {
        try {
          const fileContents = await readFile(pdfPath);
          response.writeHead(200, { "Content-Type": "application/pdf" });
          response.end(fileContents);
          return;
        } catch {
          writeJson(response, 404, {
            code: "PDF_NOT_FOUND",
            message: `Configured PDF is not available: ${pdfPath}`
          });
          return;
        }
      }

      const jobStatusMatch = pathname.match(/^\/api\/mapping\/jobs\/([^/]+)$/);
      if (method === "GET" && jobStatusMatch) {
        const job = await service.mappingGetJob({ job_id: decodeURIComponent(jobStatusMatch[1]) });
        writeJson(response, 200, job);
        return;
      }

      const jobResultMatch = pathname.match(/^\/api\/mapping\/jobs\/([^/]+)\/result$/);
      if (method === "GET" && jobResultMatch) {
        const result = await service.mappingGetResult({ job_id: decodeURIComponent(jobResultMatch[1]) });
        writeJson(response, 200, result);
        return;
      }

      const jobLogsMatch = pathname.match(/^\/api\/mapping\/jobs\/([^/]+)\/logs$/);
      if (method === "GET" && jobLogsMatch) {
        const runtime = await buildRuntimeLogs({
          application,
          runtimeBaseDir,
          jobId: decodeURIComponent(jobLogsMatch[1])
        });
        writeJson(response, 200, runtime);
        return;
      }

      if (method === "GET") {
        const filePath = resolveStaticFilePath(rootDir, pathname);
        if (!filePath) {
          writeJson(response, 404, createNotFoundPayload(pathname));
          return;
        }

        try {
          const fileContents = await readFile(filePath);
          response.writeHead(200, { "Content-Type": getContentType(filePath) });
          response.end(fileContents);
          return;
        } catch {
          writeJson(response, 404, createNotFoundPayload(pathname));
          return;
        }
      }

      writeJson(response, 404, createNotFoundPayload(pathname));
    } catch (error) {
      const normalized = service.formatHttpError(error);
      writeJson(response, normalized.statusCode, {
        code: normalized.code,
        message: normalized.message
      });
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  if (!options.gatewayBaseUrl) {
    gatewayBaseUrl = resolveGatewayBaseUrl({ host, port: getActualPort(server) });
    service = createMappingHttpService(application, gatewayBaseUrl);
  }

  return {
    baseUrl: gatewayBaseUrl,
    async close() {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      });

      if (ownsApplication) {
        await application.dispose();
      }
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = await startHttpServer();
  console.log(`Mapping HTTP gateway listening on ${running.baseUrl}`);
}
