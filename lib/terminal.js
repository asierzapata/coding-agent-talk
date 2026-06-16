import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Patterns that are refused before reaching the shell. Each entry is matched
// against the raw command string with a word-boundary regex.
const DENYLIST = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf / rm -fr
  /\b:\(\)\s*\{.*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\b[^|]*\bof=\/dev\//i,
  /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,
  /\bchown\s+-R\b.*\s\/(\s|$)/i,
  /\bchmod\s+-R\b.*\s\/(\s|$)/i,
  /\bsudo\b/i,
  />\s*\/dev\/(sd|nvme|hd)/i,
  /\bgit\s+push\b.*--force\b|\bgit\s+push\b.*-f\b/i,
];

function isDenied(command) {
  return DENYLIST.find((re) => re.test(command));
}

export async function executeTerminalCommand(command) {
  const denied = isDenied(command);
  if (denied) {
    return {
      stdout: "",
      stderr: `Command refused: matches denylist pattern ${denied}`,
      exitCode: 126,
    };
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10,
    });
    return { stdout: stdout || "", stderr: stderr || "", exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      exitCode: error.code ?? 1,
    };
  }
}
