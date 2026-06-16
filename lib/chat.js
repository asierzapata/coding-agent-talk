import { styleText } from "node:util";
import * as readline from "node:readline/promises";

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export function getUserConsolePromt() {
  return `${styleText(["blueBright", "bold"], "You")}: `;
}

export function getAgentConsolePrompt(
  { mode: mode } = {
    mode: "answering",
  },
) {
  if (mode === "thinking") {
    return `${styleText(["yellowBright", "bold"], "Eddie is thinking")}\n`;
  }
  if (mode === "tool-calling") {
    return `${styleText(["yellowBright", "bold"], "Eddie is calling a tool")}\n`;
  }
  if (mode === "tool-result") {
    return `${styleText(["yellowBright", "bold"], `Eddie got the tool result`)}\n`;
  }
  return `${styleText(["yellowBright", "bold"], "Eddie")}: `;
}

export async function chat({ messages, agentTurn }) {
  console.log(
    styleText(["green", "bold"], "\nWelcome to Eddie! Type 'exit' to quit.\n"),
  );
  while (true) {
    const userInput = await terminal.question(getUserConsolePromt());

    if (userInput.toLowerCase() === "exit") {
      console.log(styleText(["green", "bold"], "\nGoodbye!\n"));
      process.exit(0);
    }

    messages.push({ role: "user", content: userInput });

    await agentTurn({ messages });
  }
}
