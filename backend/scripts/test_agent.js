import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { extractStateUpdate } from "../lib/gemini.js";
import { agentGraph } from "../lib/agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function runTest() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not defined in backend env");
    process.exit(1);
  }

  const message = "Chào bạn, mình muốn tìm xe Honda tay ga tầm 25tr ở HCM, xe đẹp chút";
  const initialState = {};
  
  console.log("--- Testing Extraction Engine ---");
  console.log(`Input message: "${message}"`);
  
  const extracted = await extractStateUpdate(message, initialState, "buyer");
  console.log("Extracted updates JSON:\n", JSON.stringify(extracted, null, 2));

  const mergedState = { ...initialState, ...extracted };

  console.log("\n--- Testing LangGraph Reasoning Agent ---");
  
  const graphInput = {
    messages: [
      { actor: "buyer", text: message }
    ],
    structured_state: mergedState,
    rolling_summary: "",
    lead_stage: "DISCOVERY",
    action_taken: null,
    agent_reply: "",
    decision: ""
  };

  const graphOutput = await agentGraph.invoke(graphInput);
  console.log("Agent Graph Output JSON:\n", JSON.stringify(graphOutput, null, 2));
}

runTest().catch(console.error);
