import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("integration secret governance", () => {
  it("uses the PostgreSQL vault instead of ApiChat environment variables", () => {
    const runtimeSources = ["server/apichat.ts", "server/cvRequest.ts"].map(
      file => fs.readFileSync(path.resolve(file), "utf8")
    );
    const settings = fs.readFileSync(
      path.resolve("server/apiChatSettings.ts"),
      "utf8"
    );

    for (const source of runtimeSources) {
      expect(source).not.toContain("process.env");
      expect(source).not.toContain("APICHAT_");
    }
    expect(settings).toContain("integration_settings");
    expect(settings).toContain("encryptAgentSecret");
    expect(settings).toContain("enc:v1:");
  });
});
