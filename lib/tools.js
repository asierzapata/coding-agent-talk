import fs from "fs/promises";
import path from "path";
import { executeTerminalCommand } from "./terminal.js";

const MAX_OUTPUT_LINES = 200;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function truncateLines(text, max = MAX_OUTPUT_LINES) {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  const kept = lines.slice(0, max).join("\n");
  return `${kept}\n... (truncated, ${lines.length - max} more lines)`;
}

function formatCommandResult({ stdout, stderr, exitCode }) {
  const parts = [];
  if (stdout) parts.push(stdout.trimEnd());
  if (stderr) parts.push(`[stderr]\n${stderr.trimEnd()}`);
  parts.push(`[exit code ${exitCode}]`);
  return parts.join("\n");
}

async function findToolFunction({ namePattern, searchPath = "." }) {
  let command = `find ${shellQuote(searchPath)} -path '*/node_modules' -prune -o -path '*/.git' -prune -o -type f`;
  if (namePattern) command += ` -name ${shellQuote(namePattern)}`;
  command += " -print";
  const { stdout, stderr, exitCode } = await executeTerminalCommand(command);
  if (exitCode !== 0) {
    return `find failed (exit ${exitCode})${stderr ? `: ${stderr.trim()}` : ""}`;
  }
  const files = stdout
    .split("\n")
    .filter(Boolean)
    .map((file) => path.resolve(process.cwd(), file));
  if (files.length === 0) return "No files found";
  return truncateLines(files.join("\n"));
}

async function grepToolFunction({
  pattern,
  searchPath = ".",
  globPattern,
  outputMode = "files_with_matches",
  caseInsensitive = false,
}) {
  let command = "grep -r";
  if (caseInsensitive) command += " -i";
  if (outputMode === "files_with_matches") command += " -l";
  else if (outputMode === "count") command += " -c";
  command += " --exclude-dir=node_modules --exclude-dir=.git";
  if (globPattern) command += ` --include=${shellQuote(globPattern)}`;
  command += ` ${shellQuote(pattern)} ${shellQuote(searchPath)}`;

  const { stdout, stderr, exitCode } = await executeTerminalCommand(command);
  // grep exits 1 when there are no matches — that's a normal outcome, not an error.
  if (exitCode === 1) return "No matches found";
  if (exitCode !== 0) {
    return `grep failed (exit ${exitCode})${stderr ? `: ${stderr.trim()}` : ""}`;
  }
  return truncateLines(stdout || "No matches found");
}

async function readToolFunction({ filePath, offset = 1, limit = MAX_OUTPUT_LINES }) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split("\n");
  const start = Math.max(1, offset) - 1;
  const slice = lines.slice(start, start + limit);
  const width = String(start + slice.length).length;
  const numbered = slice
    .map((line, i) => `${String(start + i + 1).padStart(width, " ")}\t${line}`)
    .join("\n");
  const remaining = lines.length - (start + slice.length);
  return remaining > 0
    ? `${numbered}\n... (truncated, ${remaining} more lines)`
    : numbered;
}

async function writeToolFunction({ filePath, content }) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return `Wrote ${content.length} bytes to ${filePath}`;
}

function findNearbyMatches(content, oldString) {
  const firstLine = oldString.split("\n")[0].trim();
  if (!firstLine) return [];
  const needle = firstLine.length > 40 ? firstLine.slice(0, 40) : firstLine;
  const lines = content.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < 3; i++) {
    if (lines[i].includes(needle)) hits.push(`  ${i + 1}: ${lines[i]}`);
  }
  return hits;
}

async function editToolFunction({
  filePath,
  oldString,
  newString,
  replaceAll = false,
}) {
  const content = await fs.readFile(filePath, "utf8");
  if (!content.includes(oldString)) {
    const hints = findNearbyMatches(content, oldString);
    const suffix = hints.length
      ? `\nDid you mean one of these lines?\n${hints.join("\n")}`
      : "";
    return `String not found in ${filePath}.${suffix}`;
  }
  const occurrences = content.split(oldString).length - 1;
  if (!replaceAll && occurrences > 1) {
    return `String appears ${occurrences} times in ${filePath}. Use replaceAll: true or provide a more specific string.`;
  }
  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  await fs.writeFile(filePath, updated, "utf8");
  const replaced = replaceAll ? occurrences : 1;
  return `Edited ${filePath} (${replaced} replacement${replaced === 1 ? "" : "s"})`;
}

async function terminalToolFunction({ command }) {
  const result = await executeTerminalCommand(command);
  return formatCommandResult(result);
}

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "find",
      description:
        "Find files using the shell `find` command. Skips node_modules and .git. Returns absolute paths, one per line.",
      parameters: {
        type: "object",
        properties: {
          namePattern: {
            type: "string",
            description:
              "Optional shell glob passed to `find -name` (e.g. '*.js', 'README*'). Omit to list all files.",
          },
          searchPath: {
            type: "string",
            description: "Directory to search in (defaults to '.')",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search for a regex pattern in files using grep.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex)" },
          searchPath: {
            type: "string",
            description: "Directory or file to search in (defaults to '.')",
          },
          globPattern: {
            type: "string",
            description: "Optional filename filter (e.g. '*.js')",
          },
          outputMode: {
            type: "string",
            description:
              "'files_with_matches' (default), 'count', or 'content'",
          },
          caseInsensitive: {
            type: "boolean",
            description: "Case-insensitive search (default false)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description:
        "Read a file's contents with line numbers (cat -n style). offset is 1-indexed; limit caps lines returned.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path to the file" },
          offset: {
            type: "integer",
            description: "Starting line (1-indexed, default 1)",
          },
          limit: {
            type: "integer",
            description: `Maximum lines to return (default ${MAX_OUTPUT_LINES})`,
          },
        },
        required: ["filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description:
        "Write content to a file. Creates parent directories as needed. Overwrites existing files.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["filePath", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit",
      description:
        "Replace a string in a file. By default oldString must be unique; set replaceAll for multiple. Pass content from `read` without the line-number prefix.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path to the file" },
          oldString: { type: "string", description: "String to find" },
          newString: { type: "string", description: "Replacement string" },
          replaceAll: {
            type: "boolean",
            description: "Replace every occurrence (default false)",
          },
        },
        required: ["filePath", "oldString", "newString"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal",
      description:
        "Execute a shell command. Always returns stdout, stderr, and exit code so failures are debuggable.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute" },
        },
        required: ["command"],
      },
    },
  },
];

const toolFunctions = {
  terminal: terminalToolFunction,
  find: findToolFunction,
  grep: grepToolFunction,
  read: readToolFunction,
  write: writeToolFunction,
  edit: editToolFunction,
};

export async function executeTool(name, args) {
  const handler = toolFunctions[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args || {});
}
