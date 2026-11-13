#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { openMCPDatabase } from "./database.js";
import { createMCPTools } from "./tools.js";
import { runMCPStdio } from "./transport.js";

export function parseMCPArguments(args, env = process.env) {
  let databasePath = env.DATABASE_PATH;
  let help = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--database" && !seen.has(argument)) {
      seen.add(argument);
      databasePath = args[++index];
      if (!databasePath || databasePath.startsWith("--"))
        throw new Error(
          "--database requires an absolute existing database path.",
        );
    } else throw new Error(`Unknown or repeated argument: ${argument}`);
  }
  return { databasePath, help };
}

export async function main(args = process.argv.slice(2)) {
  const { databasePath, help } = parseMCPArguments(args);
  if (help) {
    process.stdout.write(
      "Pitchary MCP (stdio)\n\nnode src/mcp/server.js --database /absolute/path/pitchary.sqlite\n\nDATABASE_PATH may also specify the existing database. Node.js 26 is required.\nOnly new customers, people and services can be created; edit and delete actions stay in the app.\n",
    );
    return;
  }
  const db = openMCPDatabase(databasePath);
  let tools;
  const stop = () => {
    tools?.close();
    process.stdin.destroy();
  };
  const brokenPipe = () => stop();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  process.stdout.on("error", brokenPipe);
  try {
    tools = createMCPTools(db);
    await runMCPStdio({
      input: process.stdin,
      output: process.stdout,
      tools,
    });
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"])
      process.removeListener(signal, stop);
    process.stdout.removeListener("error", brokenPipe);
    tools?.close();
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(`Pitchary MCP: ${error.message}\n`);
    process.exitCode = 1;
  });
