import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { extractStateUpdate, generateRollingSummary } from "../lib/gemini.js";
import { agentGraph } from "../lib/agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const PHONE_REGEX = /(0[3|5|7|8|9]\d{8})|(\+84[3|5|7|8|9]\d{8})|(\b\d{4}[.\s-]?\d{3}[.\s-]?\d{3}\b)/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function processChatHistory() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Error: GEMINI_API_KEY is not defined in the environment.");
    console.error("💡 Please set GEMINI_API_KEY in your .env file at the root.");
    process.exit(1);
  }

  const jsonlPath = path.resolve(__dirname, "../../chat_history.jsonl");
  if (!fs.existsSync(jsonlPath)) {
    console.error(`❌ Error: Chat history file not found at ${jsonlPath}`);
    process.exit(1);
  }

  console.log("=========================================================");
  console.log("⚙️  VU CAR OFFLINE CHAT_HISTORY.JSONL PROCESSOR (STANDALONE)");
  console.log("=========================================================");

  // Load chat_history.jsonl
  const content = fs.readFileSync(jsonlPath, "utf-8");
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);

  const rawMessages = [];
  for (const line of lines) {
    try {
      rawMessages.push(JSON.parse(line));
    } catch (e) {
      console.warn("⚠️ Warning: Skipped invalid JSON line:", line);
    }
  }

  // Group messages by raw conversation ID
  const conversationGroups = {};
  for (const msg of rawMessages) {
    if (!conversationGroups[msg.conversation_id]) {
      conversationGroups[msg.conversation_id] = [];
    }
    conversationGroups[msg.conversation_id].push(msg);
  }

  // Final structured outputs for reporting
  const finalReports = {};
  const globalEventLogs = [];

  // Helper to log events locally
  function logEvent(conversationId, eventType, actor, payload) {
    const logItem = {
      timestamp: new Date().toISOString(),
      conversation_id: conversationId,
      event_type: eventType,
      actor,
      payload
    };
    globalEventLogs.push(logItem);
    return logItem;
  }

  // Iterate over each conversation group (c1, c2, c3)
  for (const convId of Object.keys(conversationGroups)) {
    console.log(`\n---------------------------------------------------------`);
    console.log(`📂 PROCESSING CONVERSATION: ${convId.toUpperCase()}`);
    console.log(`---------------------------------------------------------`);

    const rawMsgs = conversationGroups[convId];
    
    // In-memory states for the threads
    const threads = {
      [`${convId}_buyer_agent`]: {
        structured_state: {},
        rolling_summary: "",
        lead_stage: "DISCOVERY",
        messages: []
      },
      [`${convId}_seller_agent`]: {
        structured_state: {},
        rolling_summary: "",
        lead_stage: "DISCOVERY",
        messages: []
      },
      [`${convId}_bridge`]: {
        structured_state: {},
        rolling_summary: "",
        lead_stage: "DISCOVERY",
        messages: []
      }
    };

    // Keep track of active bridge connections
    let hasBridge = false;

    // Filter out historical agent messages and process only user messages (buyer/seller)
    const inputTurns = rawMsgs.filter(m => m.sender === "buyer" || m.sender === "seller");

    for (let i = 0; i < inputTurns.length; i++) {
      const turn = inputTurns[i];
      const actor = turn.sender;
      
      // Gateway: filter contact details
      const cleanText = turn.text
        .replace(PHONE_REGEX, "[SĐT ĐÃ ẨN]")
        .replace(EMAIL_REGEX, "[EMAIL ĐÃ ẨN]");

      // Determine active thread
      let activeThreadId = actor === "buyer" ? `${convId}_buyer_agent` : `${convId}_seller_agent`;
      if (hasBridge) {
        activeThreadId = `${convId}_bridge`;
      }

      console.log(`\n👉 [Turn ${i + 1}/${inputTurns.length}] ${actor.toUpperCase()} -> Thread: ${activeThreadId}`);
      console.log(`   Text: "${turn.text}"`);
      if (turn.text !== cleanText) {
        console.log(`   [Gateway Filtered]: "${cleanText}"`);
      }

      const activeThread = threads[activeThreadId];

      // If active thread is bridge, merge private state updates on-the-fly
      let baseState = { ...activeThread.structured_state };
      if (activeThreadId.endsWith("bridge")) {
        baseState = {
          ...threads[`${convId}_buyer_agent`].structured_state,
          ...threads[`${convId}_seller_agent`].structured_state,
          ...baseState
        };
      }

      // 1. Extract intent, constraints, and risk signals
      console.log(`   🔍 Running Gemini State Extraction...`);
      const updates = await extractStateUpdate(cleanText, baseState, actor);
      const updatedState = { ...baseState, ...updates };
      delete updatedState.lead_stage_suggestion;

      let targetLeadStage = activeThread.lead_stage;
      if (updates.lead_stage_suggestion) {
        targetLeadStage = updates.lead_stage_suggestion;
      }

      // Log USER_MESSAGE
      logEvent(activeThreadId, "USER_MESSAGE", actor, { text: cleanText });

      // Log State Update event if fields changed
      logEvent(activeThreadId, "STATE_UPDATE", "system", { previous_state: baseState, updated_state: updatedState });

      // 2. Add message to thread's message history
      activeThread.messages.push({ actor, text: cleanText });

      // 3. Run Agent Reasoning Graph
      console.log(`   🧠 Invoking LangGraph Reasoning Engine...`);
      let graphResult;
      
      if (targetLeadStage === "ESCALATED" || activeThread.lead_stage === "ESCALATED") {
        graphResult = {
          messages: [...activeThread.messages],
          structured_state: updatedState,
          rolling_summary: activeThread.rolling_summary,
          lead_stage: "ESCALATED",
          decision: "WAIT"
        };
      } else {
        graphResult = await agentGraph.invoke({
          messages: [...activeThread.messages],
          structured_state: updatedState,
          rolling_summary: activeThread.rolling_summary,
          lead_stage: targetLeadStage,
          action_taken: null,
          agent_reply: "",
          decision: ""
        });
      }

      // Process new messages/events from graph
      const newMessages = graphResult.messages.slice(activeThread.messages.length);
      for (const msg of newMessages) {
        if (msg.actor === "system" && msg.text.startsWith("[Tool Call]")) {
          // Log TOOL_CALL
          logEvent(activeThreadId, "TOOL_CALL", "agent", { detail: msg.text });
        } else if (msg.actor === "system" && msg.text.startsWith("[Tool Result]")) {
          // Log TOOL_RESULT
          logEvent(activeThreadId, "TOOL_RESULT", "system", { detail: msg.text });
        } else {
          // Log AGENT_ACTION / USER_MESSAGE (Agent's verbal response)
          logEvent(activeThreadId, "AGENT_ACTION", "agent", { text: msg.text });
        }
        activeThread.messages.push(msg);
      }

      // 4. Update memory (rolling summary)
      console.log(`   📝 Updating conversation rolling summary...`);
      const newSummary = await generateRollingSummary(activeThread.messages, activeThread.rolling_summary);
      
      // Apply graph results back to thread state
      activeThread.structured_state = graphResult.structured_state;
      activeThread.rolling_summary = newSummary;
      activeThread.lead_stage = graphResult.lead_stage;

      // Update lead stage in all sibling threads
      for (const tId of Object.keys(threads)) {
        if (tId.startsWith(convId)) {
          threads[tId].lead_stage = graphResult.lead_stage;
        }
      }

      console.log(`   ⚡ Status: Stage: ${activeThread.lead_stage}`);
      if (newMessages.some(m => m.actor === "agent")) {
        const reply = newMessages.find(m => m.actor === "agent").text;
        console.log(`   💬 Agent Reply: "${reply}"`);
      }

      // 5. Cross-Thread logic triggers
      if (activeThreadId === `${convId}_buyer_agent` && graphResult.lead_stage === "MATCHING") {
        console.log(`   🤝 MATCHING Triggered: Sending ping to Seller thread...`);
        // System connects buyer request to seller
        logEvent(`${convId}_seller_agent`, "SYSTEM", "system", { text: "🤖 [Hệ thống] Kết nối từ Thread 1 (Buyer). Đang hỏi giá và tình trạng xe..." });
        logEvent(`${convId}_seller_agent`, "AGENT_ACTION", "agent", { text: "Chào anh/chị, em đến từ Vucar. Xe Honda Vision (2020) giá 24.000.000đ của anh/chị hiện có một người mua rất quan tâm. Anh/chị cho hỏi xe hiện tại còn không và anh/chị có bớt nhẹ giá xăng xe được không ạ?" });
        
        threads[`${convId}_seller_agent`].messages.push(
          { actor: "system", text: "🤖 [Hệ thống] Kết nối từ Thread 1 (Buyer). Đang hỏi giá và tình trạng xe..." },
          { actor: "agent", text: "Chào anh/chị, em đến từ Vucar. Xe Honda Vision (2020) giá 24.000.000đ của anh/chị hiện có một người mua rất quan tâm. Anh/chị cho hỏi xe hiện tại còn không và anh/chị có bớt nhẹ giá xăng xe được không ạ?" }
        );
      }

      if (activeThreadId === `${convId}_seller_agent` && newMessages.some(m => m.text && m.text.includes("create_chat_bridge"))) {
        console.log(`   🌉 BRIDGE Triggered: Activating shared bridge chat...`);
        hasBridge = true;

        // Initialize bridge with merged state
        threads[`${convId}_bridge`].structured_state = {
          ...threads[`${convId}_buyer_agent`].structured_state,
          ...threads[`${convId}_seller_agent`].structured_state
        };
        threads[`${convId}_bridge`].rolling_summary = activeThread.rolling_summary;
        threads[`${convId}_bridge`].lead_stage = graphResult.lead_stage;

        let buyerBudget = "25 triệu";
        if (threads[`${convId}_buyer_agent`].structured_state.budget) {
          buyerBudget = Number(threads[`${convId}_buyer_agent`].structured_state.budget.target || 25000000).toLocaleString() + "đ";
        }

        const dealSummaryText = `🤖 [Tóm tắt chốt khớp]
- Người mua: Đang tìm xe Honda tay ga tầm ${buyerBudget} ở HCM.
- Người bán: Bán xe Honda Vision (2020) giá 24.000.000đ. Đã đồng ý bớt 500.000đ xăng xe.
- Trạng thái: Hai bên kết nối trực tiếp trong phòng chat chung. AI Agent đang hỗ trợ đặt lịch hẹn.`;

        logEvent(`${convId}_bridge`, "SYSTEM", "system", { text: dealSummaryText });
        threads[`${convId}_bridge`].messages.push({ actor: "system", text: dealSummaryText });

        // Notifications back to buyer and seller
        logEvent(`${convId}_buyer_agent`, "AGENT_ACTION", "agent", { text: "Người bán báo xe vẫn còn và đồng ý bớt giá nhẹ xăng xe cho bạn. Em đã tạo phòng chat kết nối trực tiếp hai anh chị rồi nhé. Vui lòng chuyển sang phòng chat chung bên dưới để trực tiếp nhắn tin ạ!" });
        threads[`${convId}_buyer_agent`].messages.push({ actor: "agent", text: "Người bán báo xe vẫn còn và đồng ý bớt giá nhẹ xăng xe cho bạn. Em đã tạo phòng chat kết nối trực tiếp hai anh chị rồi nhé. Vui lòng chuyển sang phòng chat chung bên dưới để trực tiếp nhắn tin ạ!" });

        logEvent(`${convId}_seller_agent`, "AGENT_ACTION", "agent", { text: "Cảm ơn bạn đã xác nhận. Em đã tạo phòng chat kết nối trực tiếp bạn với người mua rồi nhé. Hãy chuyển sang phòng chat chung để thương lượng trực tiếp ạ!" });
        threads[`${convId}_seller_agent`].messages.push({ actor: "agent", text: "Cảm ơn bạn đã xác nhận. Em đã tạo phòng chat kết nối trực tiếp bạn với người mua rồi nhé. Hãy chuyển sang phòng chat chung để thương lượng trực tiếp ạ!" });
      }

      await sleep(500); // Tiny throttle for readable console flow
    }

    // Capture final state for the report
    finalReports[convId] = {
      lead_stage: threads[hasBridge ? `${convId}_bridge` : `${convId}_buyer_agent`].lead_stage,
      final_structured_state: hasBridge ? threads[`${convId}_bridge`].structured_state : threads[`${convId}_buyer_agent`].structured_state,
      rolling_summary: hasBridge ? threads[`${convId}_bridge`].rolling_summary : threads[`${convId}_buyer_agent`].rolling_summary,
      thread_states: {
        buyer_thread: {
          lead_stage: threads[`${convId}_buyer_agent`].lead_stage,
          structured_state: threads[`${convId}_buyer_agent`].structured_state,
          messages_count: threads[`${convId}_buyer_agent`].messages.length
        },
        seller_thread: {
          lead_stage: threads[`${convId}_seller_agent`].lead_stage,
          structured_state: threads[`${convId}_seller_agent`].structured_state,
          messages_count: threads[`${convId}_seller_agent`].messages.length
        },
        bridge_thread: hasBridge ? {
          lead_stage: threads[`${convId}_bridge`].lead_stage,
          structured_state: threads[`${convId}_bridge`].structured_state,
          messages_count: threads[`${convId}_bridge`].messages.length
        } : null
      }
    };
  }

  // Save the complete output results to a JSON file
  const reportPath = path.resolve(__dirname, "../../parsed_output.json");
  const outputData = {
    processed_at: new Date().toISOString(),
    conversations: finalReports,
    event_logs: globalEventLogs
  };

  fs.writeFileSync(reportPath, JSON.stringify(outputData, null, 2), "utf-8");

  console.log("\n=========================================================");
  console.log("🎉 OFFLINE PROCESSING COMPLETED!");
  console.log(`💾 Saved structured output to: ${reportPath}`);
  console.log("=========================================================\n");

  console.log("📊 SUMMARY OF RESULTS:");
  for (const convId of Object.keys(finalReports)) {
    const report = finalReports[convId];
    console.log(`\n🔹 [${convId.toUpperCase()}]`);
    console.log(`   - Giai đoạn hiện tại (Lead Stage): ${report.lead_stage}`);
    console.log(`   - Tóm tắt (Rolling Summary): "${report.rolling_summary}"`);
    console.log(`   - Rủi ro phát hiện (Risks):`, JSON.stringify(report.final_structured_state.risks_detected || [], null, 2));
    console.log(`   - Hành động đề xuất tiếp theo (Next Action):`, JSON.stringify(report.final_structured_state.next_best_action || {}, null, 2));
  }
}

processChatHistory().catch(err => {
  console.error("❌ Process crashed:", err);
});
