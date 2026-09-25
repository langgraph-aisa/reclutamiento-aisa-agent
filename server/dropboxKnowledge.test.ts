import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DROPBOX_API_BASE,
  DROPBOX_CONTENT_BASE,
} from "./dropboxStorage";
import {
  encryptAgentSecret,
  integrationSecretContext,
} from "./agentSettings";

/**
 * Custodia del webhook en Dropbox.
 *
 * Valida el trayecto completo del adjunto: el webhook de ApiChat incorpora el
 * documento al RAG personal con la clave `applications/<postulación>/<uuid>` y
 * `writeKnowledgeFile` lo escribe en la carpeta visible
 * `Proyecto/Plaza/Candidato` de la cuenta que respalda el proyecto. Ninguna
 * prueba toca la red real.
 */

const mocks = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  query: vi.fn(),
}));

vi.mock("./db", () => ({
  currentPool: async () => ({ query: mocks.query }),
  getPool: async () => ({ query: mocks.query }),
  getUserById: async () => null,
}));

import { writeKnowledgeFile } from "./knowledge";

const PLATFORM_ROWS = () => [
  {
    setting_key: "oauth_client_id",
    setting_value: "dropbox-app-key",
    is_secret: false,
  },
  {
    setting_key: "oauth_client_secret",
    setting_value: encryptAgentSecret(
      "secret",
      integrationSecretContext("dropbox", "oauth_client_secret")
    ),
    is_secret: true,
  },
  {
    setting_key: "refresh:9",
    setting_value: encryptAgentSecret(
      JSON.stringify({
        refreshToken: "refresh",
        email: "propietario@aisa.com.gt",
        accountId: "dbid:propietario",
      }),
      integrationSecretContext("dropbox", "refresh:9")
    ),
    is_secret: true,
  },
];

const localVolume = fs.mkdtempSync(path.join(os.tmpdir(), "rag-dropbox-webhook-"));

beforeEach(() => {
  vi.stubEnv(
    "AGENT_SETTINGS_ENCRYPTION_KEY",
    "test-key-material-with-more-than-thirty-two-characters"
  );
  vi.stubEnv("KNOWLEDGE_STORAGE_DIR", localVolume);
  mocks.files.clear();
  mocks.query.mockImplementation(async (sql: string) => {
    const text = String(sql).replace(/\s+/g, " ");
    if (text.includes("FROM integration_settings"))
      return { rows: PLATFORM_ROWS() };
    if (text.includes("SELECT job_position_id FROM applications"))
      return { rows: [{ job_position_id: 21 }] };
    if (text.includes("FROM knowledge_project_positions"))
      return { rows: [{ project_id: 7 }] };
    if (text.includes("SELECT name FROM knowledge_projects"))
      return { rows: [{ name: "Solar Guatemala" }] };
    if (text.includes("FROM knowledge_projects"))
      return {
        rows: [
          {
            storage_mode: "dropbox",
            dropbox_connection_user_id: 9,
            created_by_user_id: 9,
          },
        ],
      };
    if (text.includes("SELECT p.name AS project_name"))
      return {
        rows: [
          {
            project_name: "Solar Guatemala",
            position_title: "Ingeniero Solar",
            full_name: "José Ardón",
            candidate_id: 5,
          },
        ],
      };
    return { rows: [] };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => {
  fs.rmSync(localVolume, { recursive: true, force: true });
});

function stubDropboxFetch() {
  vi.stubGlobal(
    "fetch",
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers as Record<string, string>) ?? {};
      if (url === "https://api.dropboxapi.com/oauth2/token") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "access" }),
        } as unknown as Response;
      }
      if (url === `${DROPBOX_API_BASE}/files/create_folder_v2`) {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }
      if (url === `${DROPBOX_CONTENT_BASE}/files/upload`) {
        const args = JSON.parse(headers["Dropbox-API-Arg"] ?? "{}") as {
          path: string;
        };
        mocks.files.set(args.path, new Uint8Array(init?.body as Buffer));
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch
  );
}

describe("el adjunto del webhook aterriza en la carpeta del candidato", () => {
  it("escribe el documento del RAG personal bajo Proyecto/Plaza/Candidato", async () => {
    stubDropboxFetch();
    const key = "applications/11/11111111-2222-3333-4444-555555555555.pdf";

    await writeKnowledgeFile(key, Buffer.from("%PDF-1.7 contenido"));

    const stored = mocks.files.get(
      "/JARVI RH/Solar Guatemala/Ingeniero Solar/José Ardón/11111111-2222-3333-4444-555555555555.pdf"
    );
    expect(stored).toBeDefined();
    expect(Buffer.from(stored!).toString("utf8")).toBe("%PDF-1.7 contenido");
  });

  it("conserva el volumen local cuando el proyecto no está activado", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mocks.query.mockImplementation(async (sql: string) => {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes("SELECT storage_mode FROM knowledge_projects"))
        return { rows: [{ storage_mode: "local" }] };
      if (text.includes("FROM knowledge_projects"))
        return {
          rows: [
            { dropbox_connection_user_id: null, created_by_user_id: 9 },
          ],
        };
      return { rows: [] };
    });

    await expect(
      writeKnowledgeFile(
        "applications/11/22222222-3333-4444-5555-666666666666.pdf",
        Buffer.from("local")
      )
    ).resolves.toContain("22222222-3333-4444-5555-666666666666.pdf");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.files.size).toBe(0);
  });
});
