/**
 * Unit tests for CLI upload command.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadCommand } from "../commands/upload.js";

describe("CLI uploadCommand validation", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cli-upload-"));
    testFile = path.join(tempDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("throws error when neither target nor selector is provided", async () => {
    await assert.rejects(
      async () => {
        await uploadCommand("", [testFile]);
      },
      {
        message: "缺少 ref 或 selector 参数",
      }
    );
  });

  it("throws error when files array is empty", async () => {
    await assert.rejects(
      async () => {
        await uploadCommand("@1", []);
      },
      {
        message: "缺少待上传的文件路径",
      }
    );
  });

  it("throws error when file does not exist", async () => {
    const nonExistent = path.join(tempDir, "not_found.png");
    await assert.rejects(
      async () => {
        await uploadCommand("@1", [nonExistent]);
      },
      (err: Error) => {
        assert.ok(err.message.includes("文件不存在"));
        assert.ok(err.message.includes(nonExistent));
        return true;
      }
    );
  });

  it("throws error when path is a directory", async () => {
    await assert.rejects(
      async () => {
        await uploadCommand("@1", [tempDir]);
      },
      (err: Error) => {
        assert.ok(err.message.includes("路径是目录而不是文件"));
        assert.ok(err.message.includes(tempDir));
        return true;
      }
    );
  });
});
