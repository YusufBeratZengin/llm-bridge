import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { validateTimeout } from "./config.mjs";

/** Resolve native executables and standard npm .cmd shims without a shell.
 * @param {string} command @param {string} cwd
 * @returns {Promise<{command: string, prefix: string[]}|null>}
 */
export async function resolveCommand(command, cwd) {
  const roots =
    isAbsolute(command) || /[/\\]/.test(command)
      ? [resolve(cwd, command)]
      : (process.env.PATH ?? "")
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir.replace(/^"|"$/g, ""), command));
  const extensions =
    process.platform === "win32" && !extname(command) ? [".exe", ".com", ".cmd", ""] : [""];
  for (const root of roots)
    for (const suffix of extensions) {
      const path = root + suffix;
      try {
        await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        if (/\.cmd$/i.test(path)) {
          const shim = await readFile(path, "utf8");
          const match = shim.match(/"%[~]?dp0[%]?[/\\](node_modules[/\\][^"\r\n]+\.(?:[cm]?js))"/i);
          if (!match) continue;
          const script = resolve(dirname(path), match[1]);
          await access(script);
          return { command: process.execPath, prefix: [script] };
        }
        if (/\.(?:bat|ps1)$/i.test(path)) continue;
        return { command: path, prefix: [] };
      } catch {
        /* Try the next executable candidate. */
      }
    }
  return null;
}

/** @typedef {{stdout: string, stderr: string, exitCode: number, timedOut: boolean, missing: boolean, overflow: boolean}} ProcessResult */

/** @param {string} command @param {string[]} args @param {{cwd: string, input?: string, timeoutMs: number, maxBytes?: number}} options @returns {Promise<ProcessResult>} */
export async function runProcess(command, args, options) {
  validateTimeout(options.timeoutMs);
  const target = await resolveCommand(command, options.cwd);
  if (!target)
    return {
      stdout: "",
      stderr: "",
      exitCode: 127,
      timedOut: false,
      missing: true,
      overflow: false,
    };
  return new Promise((resolveResult) => {
    /** @type {import('node:child_process').ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = spawn(target.command, [...target.prefix, ...args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolveResult({
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        missing: false,
        overflow: false,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    let done = false;
    /** @type {NodeJS.Timeout|undefined} */
    let hardStop;
    /** @param {number} code @param {boolean} [missing] */
    function finish(code, missing = false) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      resolveResult({ stdout, stderr, exitCode: code, timedOut, missing, overflow });
    }
    function killTree() {
      if (!child.pid) return finish(1);
      if (process.platform === "win32") {
        let killer;
        try {
          killer = spawn(
            join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
            ["/pid", String(child.pid), "/t", "/f"],
            { windowsHide: true, stdio: "ignore" },
          );
        } catch {
          child.kill();
          finish(1);
          return;
        }
        killer.on("error", () => {
          child.kill();
          finish(1);
        });
        killer.on("close", () => finish(1));
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      hardStop = setTimeout(() => {
        child.kill("SIGKILL");
        finish(1);
      }, 2000);
    }
    function interrupt() {
      killTree();
    }
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, options.timeoutMs);
    /** @param {'stdout'|'stderr'} stream @param {string} chunk */
    function collect(stream, chunk) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxBytes ?? 8 * 1024 * 1024)) {
        if (!overflow) {
          overflow = true;
          killTree();
        }
        return;
      }
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    }
    child.stdout.setEncoding("utf8").on("data", (chunk) => collect("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => collect("stderr", chunk));
    child.stdin.on("error", () => {}); // EPIPE: provider exited before reading stdin.
    child.on("error", (error) =>
      finish(1, /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT"),
    );
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.end(options.input ?? "");
  });
}
