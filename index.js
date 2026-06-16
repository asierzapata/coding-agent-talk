import { chat, getAgentConsolePrompt } from "./lib/chat.js";
import { Ollama } from "ollama";
import { TOOLS, executeTool } from "./lib/tools.js";
import { systemPrompt } from "./lib/system.js";

const messages = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const ollama = new Ollama();

let agentState = "waiting_for_input"; // "waiting_for_input" | "thinking" | "tool-calling" | "tool-result" | "responding"

async function agentTurn({ messages }) {
  while (true) {
    const response = await ollama.chat({
      model: "gemma4:26b",
      messages,
      tools: TOOLS,
      stream: true,
      think: true,
    });

    let content = "";
    let thinking = "";
    let toolCalls = [];

    for await (const chunk of response) {
      if (chunk.message.content) {
        if (agentState !== "responding") {
          process.stdout.write(
            `\n${getAgentConsolePrompt({ mode: "answering" })}`,
          );
          agentState = "responding";
        }
        process.stdout.write(chunk.message.content);
        content += chunk.message.content;
      }
      if (chunk.message.thinking) {
        if (agentState !== "thinking") {
          process.stdout.write(
            `\n${getAgentConsolePrompt({ mode: "thinking" })}`,
          );
          agentState = "thinking";
        }
        process.stdout.write(`${chunk.message.thinking}`);
        thinking += chunk.message.thinking;
      }
      if (chunk.message.tool_calls?.length) {
        if (agentState !== "tool-calling") {
          agentState = "tool-calling";
          process.stdout.write(
            `\n${getAgentConsolePrompt({ mode: "tool-calling" })}`,
          );
        }
        toolCalls.push(...chunk.message.tool_calls);
      }
    }

    if (content || thinking || toolCalls.length) {
      messages.push({
        role: "assistant",
        content,
        thinking,
        tool_calls: toolCalls,
      });
    }

    if (!toolCalls.length) {
      process.stdout.write("\n");
      break;
    }

    for (const call of toolCalls) {
      const args = call.function.arguments;
      const name = call.function.name;
      const result = await executeTool(name, args);
      messages.push({
        role: "tool",
        content: result,
        tool_name: name,
      });
    }
  }
}

chat({ messages, agentTurn });
