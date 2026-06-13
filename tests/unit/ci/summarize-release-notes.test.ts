import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..", "..");
const SCRIPT = resolve(ROOT, ".github", "scripts", "summarize-release-notes.mjs");
const SCRIPT_URL = pathToFileURL(SCRIPT).href;

const COMMITS = [
  "- fix(ws): add connection timeout and abort handling in ws-transport",
  "- feat: dashboard credit balance visualization",
  "- fix: resolve ws response before codex.rate_limits bypass",
].join("\n");

const LLM_ENV = {
  RELEASE_NOTES_BASE_URL: "https://llm.example/v1",
  RELEASE_NOTES_API_KEY: "test-key",
  RELEASE_NOTES_MODEL: "test-model",
};

const VALID_LLM_JSON = JSON.stringify({
  highlights_zh: ["修复 WebSocket 连接超时导致的请求卡死", "新增账号额度余额可视化面板"],
  highlights_en: ["Fixed WebSocket timeouts hanging requests", "Added credit balance visualization"],
});

function runModule<T>(body: string): T {
  const source = `
    import * as mod from ${JSON.stringify(SCRIPT_URL)};
    const COMMITS = ${JSON.stringify(COMMITS)};
    const LLM_ENV = ${JSON.stringify(LLM_ENV)};
    const VALID_LLM_JSON = ${JSON.stringify(VALID_LLM_JSON)};
    const result = await (async () => {
      ${body}
    })();
    console.log(JSON.stringify(result));
  `;
  const out = execFileSync("node", ["--input-type=module", "-e", source], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return JSON.parse(out) as T;
}

function runScript(input: string, env: Record<string, string | undefined> = {}): string {
  return execFileSync("node", [SCRIPT, "v9.9.9"], {
    encoding: "utf-8",
    input,
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

describe("summarize-release-notes.mjs module behavior", () => {
  beforeAll(() => {
    expect(existsSync(SCRIPT), `script missing: ${SCRIPT}`).toBe(true);
  });

  it("produces bilingual notes from a valid LLM response, with raw commits in details", () => {
    const result = runModule<{ out: string; requests: { url: string; body: { model: string; messages: { content: string }[] } }[] }>(`
      const requests = [];
      const fetchImpl = async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", content: VALID_LLM_JSON } }] }) };
      };
      const out = await mod.generateNotes({ tag: "v9.9.9", input: COMMITS, env: LLM_ENV, fetchImpl });
      return { out, requests };
    `);

    expect(result.out).toContain("## ✨ 本次更新");
    expect(result.out).toContain("修复 WebSocket 连接超时导致的请求卡死");
    expect(result.out).toContain("## What's New");
    expect(result.out).toContain("Fixed WebSocket timeouts hanging requests");
    expect(result.out).toContain("<details>");
    expect(result.out).toContain("fix(ws): add connection timeout and abort handling in ws-transport");
    expect(result.requests[0].url).toBe("https://llm.example/v1/chat/completions");
    expect(result.requests[0].body.model).toBe("test-model");
    expect(result.requests[0].body.messages.some((message) => message.content.includes("ws-transport"))).toBe(true);
  });

  it("falls back to grouped English list when LLM env is not configured", () => {
    const out = runModule<string>(`
      return await mod.generateNotes({ tag: "v9.9.9", input: COMMITS, env: {} });
    `);

    expect(out).toContain("connection timeout and abort handling");
    expect(out).toContain("dashboard credit balance visualization");
    expect(out).not.toContain("中文版 (翻译)");
    expect(out).not.toMatch(/[\u4e00-\u9fff]/);
    expect(out).toContain("### Fixes");
    expect(out).toContain("### Features");
  });

  it("falls back after retry when the LLM returns non-JSON garbage", () => {
    const result = runModule<{ out: string; requestCount: number }>(`
      const requests = [];
      const fetchImpl = async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", content: "Sure! Here are the notes." } }] }) };
      };
      const out = await mod.generateNotes({ tag: "v9.9.9", input: COMMITS, env: LLM_ENV, fetchImpl });
      return { out, requestCount: requests.length };
    `);

    expect(result.out).toContain("### Fixes");
    expect(result.out).not.toContain("## ✨ 本次更新");
    expect(result.requestCount).toBe(2);
  });

  it("falls back when Chinese highlights contain no CJK", () => {
    const out = runModule<string>(`
      const fetchImpl = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ highlights_zh: ["all english"], highlights_en: ["all english"] }) } }] }),
      });
      return await mod.generateNotes({ tag: "v9.9.9", input: COMMITS, env: LLM_ENV, fetchImpl });
    `);

    expect(out).toContain("### Fixes");
  });

  it("falls back when the LLM endpoint errors", () => {
    const out = runModule<string>(`
      const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
      return await mod.generateNotes({ tag: "v9.9.9", input: COMMITS, env: LLM_ENV, fetchImpl });
    `);

    expect(out).toContain("### Fixes");
  });

  it("accepts JSON wrapped in markdown fences", () => {
    const out = runModule<string>(`
      const fetchImpl = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "~~~json".replaceAll("~", "\`") + "\\n" + VALID_LLM_JSON + "\\n" + "~~~".replaceAll("~", "\`") } }] }),
      });
      return await mod.generateNotes({ tag: "v9.9.9", input: COMMITS, env: LLM_ENV, fetchImpl });
    `);

    expect(out).toContain("## ✨ 本次更新");
  });

  it("passes through non-commit single-line input", () => {
    const out = runModule<string>(`
      return await mod.generateNotes({ tag: "v9.9.9", input: "Initial release", env: {} });
    `);

    expect(out).toBe("Initial release");
  });

  it("includes the changelog excerpt in the prompt when provided", () => {
    const prompt = runModule<string>(`
      return mod.buildPrompt("v1.0.0", ["- fix: a"], "## [Unreleased]\\n- 修复某问题");
    `);

    expect(prompt).toContain("修复某问题");
    expect(prompt).toContain("highlights_zh");
  });

  it("rejects unsafe highlight payloads", () => {
    const result = runModule<{ multiline: null; oversized: null; empty: null; mixed: null; invalid: null }>(`
      return {
        multiline: mod.parseHighlights(JSON.stringify({ highlights_zh: ["修复\\n## 假标题"], highlights_en: ["ok"] })),
        oversized: mod.parseHighlights(JSON.stringify({ highlights_zh: ["修" + "复".repeat(400)], highlights_en: ["ok"] })),
        empty: mod.parseHighlights(JSON.stringify({ highlights_zh: [], highlights_en: ["x"] })),
        mixed: mod.parseHighlights(JSON.stringify({ highlights_zh: ["中文", 42], highlights_en: ["x", "y"] })),
        invalid: mod.parseHighlights("not json at all"),
      };
    `);

    expect(result).toEqual({ multiline: null, oversized: null, empty: null, mixed: null, invalid: null });
  });

  it("accepts a valid bilingual payload", () => {
    const parsed = runModule<{ zh: string[]; en: string[] }>(`
      return mod.parseHighlights(VALID_LLM_JSON);
    `);

    expect(parsed.zh).toHaveLength(2);
    expect(parsed.en).toHaveLength(2);
  });

  it("groups fallback commits by conventional type and strips prefixes", () => {
    const out = runModule<string>(`
      return mod.renderFallback(["- fix(ws): repair sockets", "- feat: shiny thing", "- perf: faster", "- 1.2.3 misc"]);
    `);

    expect(out).toContain("### Fixes\n\n- repair sockets");
    expect(out).toContain("### Features\n\n- shiny thing");
    expect(out).toContain("### Performance\n\n- faster");
    expect(out).toContain("### Other\n\n- 1.2.3 misc");
  });

  it("groups breaking-change commits under their type", () => {
    const out = runModule<string>(`
      return mod.renderFallback(["- feat!: breaking thing", "- fix(scope)!: breaking fix"]);
    `);

    expect(out).toContain("### Features\n\n- breaking thing");
    expect(out).toContain("### Fixes\n\n- breaking fix");
    expect(out).not.toContain("### Other");
  });

  it("neutralizes HTML in commit lines so details blocks cannot be broken", () => {
    const out = runModule<string>(`
      const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", content: VALID_LLM_JSON } }] }) });
      return await mod.generateNotes({ tag: "v9.9.9", input: "- fix: close </details> tag <b>bold</b>", env: LLM_ENV, fetchImpl });
    `);

    expect(out).not.toContain("close </details>");
    expect(out).toContain("&lt;/details&gt;");
    expect(out.match(/<\/details>/g)).toHaveLength(1);
  });
});

describe("summarize-release-notes.mjs CLI", () => {
  it("exits zero and emits grouped fallback without LLM env", () => {
    const out = runScript(COMMITS, {
      RELEASE_NOTES_BASE_URL: "",
      RELEASE_NOTES_API_KEY: "",
      RELEASE_NOTES_MODEL: "",
    });

    expect(out).toContain("### Fixes");
    expect(out).toContain("### Features");
  });

  it("passes through single-line input", () => {
    expect(runScript("Initial release").trim()).toBe("Initial release");
  });

  it("exits zero with fallback when the LLM endpoint is unreachable", () => {
    const out = runScript(COMMITS, {
      RELEASE_NOTES_BASE_URL: "http://release-notes-test.invalid/v1",
      RELEASE_NOTES_API_KEY: "k",
      RELEASE_NOTES_MODEL: "m",
    });

    expect(out).toContain("### Fixes");
  });
});
