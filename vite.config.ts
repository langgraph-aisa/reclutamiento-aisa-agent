import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

function gitOutput(args: string[], fallback: string) {
  try {
    return execFileSync("git", args, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

function githubSyncPercentage() {
  const divergence = gitOutput(
    ["rev-list", "--left-right", "--count", "HEAD...origin/main"],
    ""
  )
    .split(/\s+/)
    .map(Number);
  if (
    divergence.length !== 2 ||
    divergence.some(value => !Number.isFinite(value))
  ) {
    return 0;
  }
  return Math.max(0, 100 - Math.min(100, (divergence[0] + divergence[1]) * 10));
}

function repositoryLanguages() {
  const languageByExtension: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".typ": "Typst",
    ".js": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".css": "CSS",
    ".sql": "PLpgSQL",
    ".html": "Other",
    ".sh": "Other",
    ".yaml": "Other",
    ".yml": "Other",
  };
  const bytes = new Map<string, number>();
  const files = gitOutput(["ls-files"], "").split("\n").filter(Boolean);
  for (const file of files) {
    const language = languageByExtension[path.extname(file).toLowerCase()];
    if (!language) continue;
    try {
      const size = fs.statSync(path.join(PROJECT_ROOT, file)).size;
      bytes.set(language, (bytes.get(language) ?? 0) + size);
    } catch {
      // El archivo pudo cambiar entre el índice Git y la lectura del build.
    }
  }
  const total = Array.from(bytes.values()).reduce(
    (sum, value) => sum + value,
    0
  );
  if (!total) return [];
  const languages = Array.from(bytes.entries())
    .map(([name, size]) => ({
      name,
      percentage: Math.round((size / total) * 1000) / 10,
    }))
    .sort((a, b) => b.percentage - a.percentage);
  const roundedTotal = languages.reduce(
    (sum, language) => sum + language.percentage,
    0
  );
  languages[0].percentage =
    Math.round((languages[0].percentage + 100 - roundedTotal) * 10) / 10;
  return languages;
}

const buildMetadata = {
  branch:
    process.env.GITHUB_REF_NAME ??
    gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], "main"),
  commit:
    process.env.GITHUB_SHA?.slice(0, 8) ??
    gitOutput(["rev-parse", "--short=8", "HEAD"], "local"),
  githubSyncPercentage: githubSyncPercentage(),
  languages: repositoryLanguages(),
};

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map(entry => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", chunk => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

const plugins = [
  react(),
  tailwindcss(),
  jsxLocPlugin(),
  vitePluginManusRuntime(),
  vitePluginManusDebugCollector(),
];

export default defineConfig({
  plugins,
  define: {
    "import.meta.env.VITE_BUILD_BRANCH": JSON.stringify(buildMetadata.branch),
    "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(buildMetadata.commit),
    "import.meta.env.VITE_GITHUB_SYNC_PERCENTAGE": JSON.stringify(
      String(buildMetadata.githubSyncPercentage)
    ),
    "import.meta.env.VITE_REPOSITORY_LANGUAGES": JSON.stringify(
      JSON.stringify(buildMetadata.languages)
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
