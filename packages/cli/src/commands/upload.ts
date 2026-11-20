/**
 * upload 命令 - 上传本地文件到文件输入框
 * 用法：bb-browser upload <ref|selector> <file_paths...>
 */

import path from "node:path";
import { existsSync } from "node:fs";
import type { Request, Response } from "@bb-browser/shared";
import { sendCommand } from "../client.js";
import { ensureDaemonRunning } from "../daemon-manager.js";

export interface UploadOptions {
  json?: boolean;
  tabId?: string | number;
  selector?: string;
}

function isRef(target: string): boolean {
  return target.startsWith("@") || /^\d+$/.test(target);
}

function cleanRef(ref: string): string {
  return ref.startsWith("@") ? ref.slice(1) : ref;
}

export async function uploadCommand(
  target: string,
  files: string[],
  options: UploadOptions = {}
): Promise<void> {
  if (!target && !options.selector) {
    throw new Error("缺少 ref 或 selector 参数");
  }
  if (!files || files.length === 0) {
    throw new Error("缺少待上传的文件路径");
  }

  // Resolve absolute paths and verify files exist
  const absoluteFiles = files.map((f) => path.resolve(process.cwd(), f));
  for (let i = 0; i < absoluteFiles.length; i++) {
    if (!existsSync(absoluteFiles[i])) {
      throw new Error(`文件不存在: ${files[i]} (解析路径: ${absoluteFiles[i]})`);
    }
  }

  await ensureDaemonRunning();

  const request: Request = {
    method: "upload",
    tabId: options.tabId,
    files: absoluteFiles,
  };

  if (options.selector) {
    request.selector = options.selector;
    if (target && isRef(target)) {
      request.ref = cleanRef(target);
    }
  } else if (isRef(target)) {
    request.ref = cleanRef(target);
  } else {
    request.selector = target;
  }

  const response: Response = await sendCommand(request);

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    if (response.result) {
      const fileList = absoluteFiles.map((f) => path.basename(f)).join(", ");
      const targetDesc = request.ref ? `@${request.ref}` : request.selector;
      console.log(`已上传文件至 [${targetDesc}]: ${fileList}`);
    } else {
      console.error(`错误: ${response.error?.message}`);
      process.exit(1);
    }
  }
}
