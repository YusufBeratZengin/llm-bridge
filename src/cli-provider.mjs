import { classifyError, failure } from "./errors.mjs";
import { providerInput } from "./input.mjs";
import { runProcess } from "./process.mjs";

/** @import {Provider, ProviderConfig, GateConfig, RunRequest} from './types.mjs' */

/** @param {string} name @param {ProviderConfig} defaults @param {ProviderConfig} [config] @param {GateConfig} [gate] @returns {Provider} */
export function createCliProvider(name, defaults, config = {}, gate = {}) {
  const settings = { ...defaults, ...config };
  const command = settings.command ?? name;
  return {
    name,
    async detect(cwd = process.cwd()) {
      const result = await runProcess(command, settings.detectArgs ?? ["--version"], {
        cwd,
        timeoutMs: 5000,
      });
      if (result.missing) return { installed: false, auth: "unknown", errorKind: "not_installed" };
      if (result.timedOut) return { installed: true, auth: "unknown", errorKind: "timeout" };
      if (result.exitCode !== 0 || result.overflow)
        return { installed: true, auth: "unknown", errorKind: "nonzero_exit" };
      if (!settings.authArgs) return { installed: true, auth: "unknown", errorKind: null };
      const auth = await runProcess(command, settings.authArgs, { cwd, timeoutMs: 5000 });
      const kind = auth.timedOut
        ? "timeout"
        : auth.exitCode
          ? classifyError(auth.exitCode, auth.stderr + auth.stdout, settings.errorPatterns)
          : null;
      return {
        installed: true,
        auth: kind === "auth_required" ? "required" : kind ? "unknown" : "ready",
        errorKind: kind,
      };
    },
    async run(request) {
      const input = providerInput(request, gate);
      const modeArgs = settings.modeArgs?.[request.mode];
      if (!modeArgs)
        throw new Error("CLI provider must configure explicit modeArgs for the requested mode.");
      const model = request.model ?? settings.model;
      const modelArgs = model
        ? (settings.modelArgs ?? ["--model", "{model}"]).map((arg) =>
            arg.replaceAll("{model}", model),
          )
        : [];
      const result = await runProcess(
        command,
        [...(settings.args ?? []), ...modeArgs, ...modelArgs],
        { cwd: request.cwd, input, timeoutMs: request.timeoutMs },
      );
      if (result.missing) return failure("not_installed", 127);
      if (result.timedOut) return failure("timeout", 124);
      if (result.overflow) return failure("nonzero_exit");
      if (result.exitCode !== 0)
        return failure(
          classifyError(
            result.exitCode,
            `${result.stderr}\n${result.stdout}`,
            settings.errorPatterns,
          ),
          result.exitCode,
        );
      if (!result.stdout.trim()) return failure("empty_output");
      return { text: result.stdout.trim(), exitCode: 0, errorKind: null };
    },
  };
}
