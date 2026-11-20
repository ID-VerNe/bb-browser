/**
 * Unit & Contract tests for bb-browser upload command.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMMANDS,
  getCommand,
  commandToJsonSchema,
  type Request,
  type RefInfo,
} from "@bb-browser/shared";
import { TabStateManager, type TabState } from "../tab-state.js";
import { dispatchRequest } from "../command-dispatch.js";
import type { CdpConnection } from "../cdp-connection.js";

describe("Upload Command Contract & Registry Tests", () => {
  it("COMMANDS registry contains upload command in interact group", () => {
    const cmd = getCommand("upload");
    assert.ok(cmd, "upload command should be registered");
    assert.equal(cmd?.group, "interact");
    assert.equal(cmd?.requiresTab, true);
    assert.ok(cmd?.params.files, "should have files param");
    assert.ok(cmd?.params.tab, "should have tab param");
  });

  it("commandToJsonSchema generates valid schema for upload", () => {
    const cmd = getCommand("upload")!;
    const schemaStr = commandToJsonSchema(cmd);
    const schema = JSON.parse(schemaStr);
    assert.equal(schema.type, "object");
    assert.ok(schema.properties.files);
    assert.ok(schema.properties.ref);
    assert.ok(schema.properties.selector);
  });

  it("TabState records upload action and preserves detail fields", () => {
    const manager = new TabStateManager();
    const tab = manager.addTab("target-test");
    const session = manager.traceStart();

    const seq = tab.recordAction({
      action: "upload",
      ref: 5,
      selector: "input[type=file]",
      text: "photo.jpg, doc.pdf",
    });

    assert.ok(seq > 0);
    assert.equal(tab.lastActionSeq, seq);

    const timeline = session.timeline;
    const uploadEntry = timeline.find((e) => e.type === "action" && e.action === "upload");
    assert.ok(uploadEntry, "upload action should be recorded in trace timeline");
    if (uploadEntry && uploadEntry.type === "action") {
      assert.equal(uploadEntry.ref, 5);
      assert.equal(uploadEntry.selector, "input[type=file]");
      assert.equal(uploadEntry.text, "photo.jpg, doc.pdf");
    }

    manager.traceStop();
  });
});

describe("dispatchRequest upload handler", () => {
  let tempDir: string;
  let tempFile1: string;
  let tempFile2: string;
  let tabManager: TabStateManager;
  let tab: TabState;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-upload-test-"));
    tempFile1 = path.join(tempDir, "sample1.txt");
    tempFile2 = path.join(tempDir, "sample2.png");
    fs.writeFileSync(tempFile1, "hello upload 1");
    fs.writeFileSync(tempFile2, "fake png content");

    tabManager = new TabStateManager();
    tab = tabManager.addTab("target-1234");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createMockCdp(recordedCalls: Array<{ method: string; params: any }>): CdpConnection {
    return {
      tabManager,
      ensurePageTarget: async (tabId?: string) => {
        return { id: "target-1234", type: "page", title: "Test", url: "http://example.com" };
      },
      sessionCommand: async <T = unknown>(targetId: string, method: string, params: any = {}): Promise<T> => {
        recordedCalls.push({ method, params });
        if (method === "DOM.setFileInputFiles") {
          return {} as T;
        }
        return {} as T;
      },
      pageCommand: async <T = unknown>(targetId: string, method: string, params: any = {}): Promise<T> => {
        recordedCalls.push({ method, params });
        if (method === "DOM.getDocument") {
          return { root: { nodeId: 1 } } as T;
        }
        if (method === "DOM.querySelector") {
          if (params.selector === "#missing-input") {
            return { nodeId: 0 } as T;
          }
          return { nodeId: 10 } as T;
        }
        if (method === "DOM.describeNode") {
          return { node: { backendNodeId: 999 } } as T;
        }
        return {} as T;
      },
    } as unknown as CdpConnection;
  }

  it("fails when files parameter is missing or empty", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdp = createMockCdp(calls);

    const res = await dispatchRequest(cdp, {
      method: "upload",
      tabId: tab.shortId,
      ref: "1",
      files: [],
    });

    assert.ok(res.error, "Should return error");
    assert.match(res.error!.message, /Missing files parameter/);
  });

  it("fails when specified file does not exist", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdp = createMockCdp(calls);

    const nonExistent = path.join(tempDir, "non_existent_file.bin");
    const res = await dispatchRequest(cdp, {
      method: "upload",
      tabId: tab.shortId,
      ref: "1",
      files: [nonExistent],
    });

    assert.ok(res.error, "Should return error for missing file");
    assert.match(res.error!.message, /File not found/);
  });

  it("fails when neither ref nor selector is provided", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdp = createMockCdp(calls);

    const res = await dispatchRequest(cdp, {
      method: "upload",
      tabId: tab.shortId,
      files: [tempFile1],
    });

    assert.ok(res.error);
    assert.match(res.error!.message, /Missing ref or selector parameter/);
  });

  it("successfully uploads using snapshot ref with backendDOMNodeId", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdp = createMockCdp(calls);

    // Prepopulate ref in tab
    tab.refs["3"] = {
      backendDOMNodeId: 777,
      role: "button",
      name: "Upload Photo",
      tagName: "input",
    } as RefInfo;

    const res = await dispatchRequest(cdp, {
      method: "upload",
      tabId: tab.shortId,
      ref: "@3",
      files: [tempFile1, tempFile2],
    });

    assert.ifError(res.error);
    assert.ok(res.result);
    assert.equal(res.result.tab, tab.shortId);
    assert.equal(res.result.files?.length, 2);

    const uploadCall = calls.find((c) => c.method === "DOM.setFileInputFiles");
    assert.ok(uploadCall, "DOM.setFileInputFiles should be invoked");
    assert.equal(uploadCall?.params.backendNodeId, 777);
    assert.deepEqual(uploadCall?.params.files, [
      path.resolve(tempFile1),
      path.resolve(tempFile2),
    ]);
  });

  it("successfully uploads using CSS selector", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdp = createMockCdp(calls);

    const res = await dispatchRequest(cdp, {
      method: "upload",
      tabId: tab.shortId,
      selector: "input[type='file']",
      files: [tempFile1],
    });

    assert.ifError(res.error);
    assert.ok(res.result);

    const queryCall = calls.find((c) => c.method === "DOM.querySelector");
    assert.ok(queryCall);
    assert.equal(queryCall?.params.selector, "input[type='file']");

    const uploadCall = calls.find((c) => c.method === "DOM.setFileInputFiles");
    assert.ok(uploadCall);
    assert.equal(uploadCall?.params.backendNodeId, 999);
    assert.deepEqual(uploadCall?.params.files, [path.resolve(tempFile1)]);
  });

  it("fails when CSS selector finds no element", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdp = createMockCdp(calls);

    const res = await dispatchRequest(cdp, {
      method: "upload",
      tabId: tab.shortId,
      selector: "#missing-input",
      files: [tempFile1],
    });

    assert.ok(res.error);
    assert.match(res.error!.message, /Element not found for selector: #missing-input/);
  });

  it("treats non-numeric ref string without snapshot entry as CSS selector fallback", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdp = createMockCdp(calls);

    const res = await dispatchRequest(cdp, {
      method: "upload",
      tabId: tab.shortId,
      ref: "input[type='file']",
      files: [tempFile1],
    });

    assert.ifError(res.error);
    assert.ok(res.result);

    const uploadCall = calls.find((c) => c.method === "DOM.setFileInputFiles");
    assert.ok(uploadCall);
    assert.equal(uploadCall?.params.backendNodeId, 999);
  });
});
