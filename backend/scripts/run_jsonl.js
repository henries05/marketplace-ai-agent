import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getSupabaseAdmin } from "../lib/supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runSimulator() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("❌ Configuration error: Supabase variables not loaded.");
    process.exit(1);
  }

  const jsonlPath = path.resolve(__dirname, "../../chat_history.jsonl");
  if (!fs.existsSync(jsonlPath)) {
    console.error(`❌ Chat history sample file not found at ${jsonlPath}`);
    process.exit(1);
  }

  console.log("=========================================================");
  console.log("🚀 RUNNING VU CAR AI AGENT CHAT_HISTORY.JSONL SIMULATOR");
  console.log("=========================================================");

  // Reset database before simulation
  console.log("\n🧹 Resetting database states (conversations, events, connections)...");
  try {
    await supabase.from("conversation_connections").delete().neq("id", 0);
    await supabase.from("conversation_events").delete().neq("id", 0);
    await supabase.from("conversations").delete().neq("conversation_id", "");
    console.log("✅ Database reset complete.");
  } catch (err) {
    console.warn("⚠️ Warning during DB wipe:", err.message);
  }

  const content = fs.readFileSync(jsonlPath, "utf-8");
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);

  const rawMessages = [];
  for (const line of lines) {
    try {
      rawMessages.push(JSON.parse(line));
    } catch (e) {
      console.warn("⚠️ Skipped invalid JSON line:", line);
    }
  }

  // Filter user messages (buyer and seller) for simulation
  const userMessages = rawMessages.filter(m => m.sender === "buyer" || m.sender === "seller");

  console.log(`\n📋 Loaded ${rawMessages.length} total messages from log.`);
  console.log(`👉 Running ${userMessages.length} user inputs through Agent processing pipeline...`);

  // Group by conversation_id to run sequentially
  const groups = {};
  for (const msg of userMessages) {
    if (!groups[msg.conversation_id]) {
      groups[msg.conversation_id] = [];
    }
    groups[msg.conversation_id].push(msg);
  }

  for (const convId of Object.keys(groups)) {
    console.log(`\n=========================================================`);
    console.log(`🔷 PROCESSING SIMULATION GROUP: ${convId}`);
    console.log(`=========================================================`);

    const convMessages = groups[convId];
    for (let index = 0; index < convMessages.length; index++) {
      const msg = convMessages[index];
      const targetThreadId = msg.sender === "buyer" ? `${convId}_buyer_agent` : `${convId}_seller_agent`;

      console.log(`\n[Turn ${index + 1}/${convMessages.length}] Sender: ${msg.sender.toUpperCase()} | Thread: ${targetThreadId}`);
      console.log(`💬 Message: "${msg.text}"`);
      console.log(`⏳ Querying Agent API...`);

      try {
        const response = await fetch("http://localhost:5000/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: targetThreadId,
            actor: msg.sender,
            text: msg.text
          })
        });

        if (!response.ok) {
          console.error(`❌ HTTP Error: ${response.status}`);
          const errText = await response.text();
          console.error(`   Details: ${errText}`);
          continue;
        }

        const data = await response.json();
        if (data.success) {
          // Poll database until state updates or agent message is generated (max 10s)
          let conv = null;
          let latestAgentMsg = null;
          const pollStart = Date.now();

          while (Date.now() - pollStart < 10000) {
            await sleep(1000);

            const { data: c } = await supabase
              .from("conversations")
              .select("lead_stage, structured_state")
              .eq("conversation_id", targetThreadId)
              .maybeSingle();

            const { data: m } = await supabase
              .from("conversation_events")
              .select("payload")
              .eq("conversation_id", targetThreadId)
              .eq("actor", "agent")
              .order("id", { ascending: false })
              .limit(1)
              .maybeSingle();

            conv = c;
            latestAgentMsg = m;

            // Break if background worker has processed and updated state or generated reply
            if (c && (Object.keys(c.structured_state).length > 0 || m)) {
              break;
            }
          }

          console.log(`✨ Agent Response:`);
          console.log(`   - Lead Stage: ${conv?.lead_stage || "DISCOVERY"}`);
          console.log(`   - Agent Reply: "${latestAgentMsg?.payload?.text || "No verbal reply (Wait/Tool call)"}"`);
          if (conv?.structured_state) {
            console.log(`   - Structured State:`, JSON.stringify(conv.structured_state, null, 2));
          }
        } else {
          console.error(`❌ Processing Error:`, data.error);
        }
      } catch (err) {
        console.error(`❌ Connection failed:`, err.message);
        console.log("💡 (Ensure your backend API server is running on http://localhost:5000)");
      }

      // Buffer delay before the next turn
      await sleep(1000);
    }
  }

  console.log("\n=========================================================");
  console.log("🎉 ALL SIMULATIONS COMPLETED SUCCESSFULLY!");
  console.log("=========================================================");
}

runSimulator().catch(console.error);
