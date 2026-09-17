const fs = require("node:fs");

const file = "launcher/electron/main.cjs";
let source = fs.readFileSync(file, "utf8");

const before = `    const executeSetup = (archivePath, forceNetwork) => {\n      const runSetup = afterRuntimeReady => withTunnelClientArchive(archivePath, forceNetwork, () => setup({\n        tunnelId: typeof input?.tunnelId === "string" ? input.tunnelId.trim() : "",\n        runtimeKey: typeof input?.runtimeKey === "string" ? input.runtimeKey : "",\n        replace: input?.replace === true,\n        interactionMode,\n      }, afterRuntimeReady));\n      return interactionModeChange\n        ? browserHost.withInteractionModeChange(interactionMode, runSetup)\n        : runSetup();\n    };`;

const after = `    const runSetup = afterRuntimeReady => setup({\n      tunnelId: typeof input?.tunnelId === "string" ? input.tunnelId.trim() : "",\n      runtimeKey: typeof input?.runtimeKey === "string" ? input.runtimeKey : "",\n      replace: input?.replace === true,\n      interactionMode,\n    }, afterRuntimeReady);\n    const executeSetup = (archivePath, forceNetwork) => withTunnelClientArchive(\n      archivePath,\n      forceNetwork,\n      async () => interactionModeChange\n        ? await browserHost.withInteractionModeChange(interactionMode, runSetup)\n        : await runSetup(),\n    );`;

if (source.includes(after)) process.exit(0);
if (!source.includes(before)) throw new Error("Could not find tunnel setup handler block");
source = source.replace(before, after);
fs.writeFileSync(file, source);
