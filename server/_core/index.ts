import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
// Nota: registerOAuthRoutes fue removido, ya que el sistema nuevo usa códigos por correo.
import { registerStorageProxy } from "./storageProxy";
import { appRouter, auditPublishedPublicCopy } from "../routers";
import { registerApiChatInboundWebhook } from "../apiChatWebhook";
import { getPool } from "../db";
import { APP_VERSION } from "../../shared/release";
import {
  initializeLangfuseFromDatabase,
  shutdownLangfuse,
} from "../observability/langfuse";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const pool = await getPool();
  if (pool) {
    const observability = await initializeLangfuseFromDatabase(pool, {
      release: APP_VERSION,
    });
    console.log(
      `[Observability] Langfuse state=${observability.state}${observability.reasonCode ? ` reason=${observability.reasonCode}` : ""}.`
    );
  } else {
    console.warn("[Observability] Langfuse state=disabled reason=DATABASE_UNAVAILABLE.");
  }

  const app = express();
  const server = createServer(app);
  // Contrato controlado para n8n. Se registra antes del parser global para
  // imponer un límite pequeño y no aceptar cargas multimedia por esta ruta.
  registerApiChatInboundWebhook(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app); // Esto sirve el frontend para TODAS las rutas, incluyendo /login
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    void Promise.resolve(pool ? auditPublishedPublicCopy(pool) : null)
      .then(result => {
        if (result && !result.skipped) {
          console.log(
            `[PublicCopyAudit] Completed: ${result.audited} position(s), ${result.failed} failure(s).`
          );
        }
      })
      .catch(error => {
        console.warn(
          `[PublicCopyAudit] Startup audit failed (${error instanceof Error ? error.name : "unknown"}).`
        );
      });
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Lifecycle] ${signal}: cierre ordenado iniciado.`);
    const forcedClose = setTimeout(() => server.closeAllConnections(), 10_000);
    forcedClose.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await shutdownLangfuse();
      if (pool) await pool.end();
      console.log("[Lifecycle] Cierre ordenado completado.");
    } catch (error) {
      process.exitCode = 1;
      console.error(
        `[Lifecycle] Cierre incompleto (${error instanceof Error ? error.name : "unknown"}).`
      );
    } finally {
      clearTimeout(forcedClose);
    }
  };
  process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
}

startServer().catch(console.error);
