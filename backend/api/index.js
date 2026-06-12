import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { extractStateUpdate, generateRollingSummary } from "../lib/gemini.js";
import { agentGraph } from "../lib/agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method === "POST") {
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

const PHONE_REGEX = /(0[3|5|7|8|9]\d{8})|(\+84[3|5|7|8|9]\d{8})|(\b\d{4}[.\s-]?\d{3}[.\s-]?\d{3}\b)/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function getSiblingConversationIds(supabaseAdmin, conversationId) {
  try {
    const { data: connection } = await supabaseAdmin
      .from("conversation_connections")
      .select("buyer_conv_id, seller_conv_id, bridge_id")
      .or(`buyer_conv_id.eq.${conversationId},seller_conv_id.eq.${conversationId},bridge_id.eq.${conversationId}`)
      .maybeSingle();

    if (connection) {
      return [connection.buyer_conv_id, connection.seller_conv_id, connection.bridge_id].filter(Boolean);
    }
  } catch (err) {
    console.error("Failed to query conversation_connections:", err.message);
  }
  
  if (conversationId.startsWith("c1_")) {
    return ["c1_buyer_agent", "c1_seller_agent", "c1_bridge"];
  }
  return [conversationId];
}

app.post("/api/chat/send", async (req, res) => {
  const supabaseAdmin = getSupabaseAdmin();
  try {
    const { conversation_id, actor, text } = req.body;

    if (!conversation_id || !actor || !text) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const cleanText = text
      .replace(PHONE_REGEX, "[SĐT ĐÃ ẨN]")
      .replace(EMAIL_REGEX, "[EMAIL ĐÃ ẨN]");

    // Ensure conversation exists first to satisfy foreign key constraint
    let { data: conversation, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("conversation_id, structured_state, rolling_summary, lead_stage")
      .eq("conversation_id", conversation_id)
      .maybeSingle();

    if (convError) {
      console.error("[Database Error] Failed to check conversation:", convError);
      return res.status(500).json({ error: convError.message });
    }

    if (!conversation) {
      // Find sibling to inherit state
      const { data: siblingData } = await supabaseAdmin
        .from("conversations")
        .select("structured_state, rolling_summary, lead_stage")
        .in("conversation_id", ["c1_buyer_agent", "c1_seller_agent", "c1_bridge"])
        .limit(1);
      
      const sibling = siblingData?.[0];

      const { error: createError } = await supabaseAdmin
        .from("conversations")
        .insert([
          {
            conversation_id,
            buyer_id: actor === "buyer" ? "buyer_id" : "unknown",
            seller_id: actor === "seller" ? "seller_id" : "unknown",
            lead_stage: sibling ? sibling.lead_stage : "DISCOVERY",
            structured_state: sibling && conversation_id === "c1_bridge" ? sibling.structured_state : {},
            rolling_summary: sibling && conversation_id === "c1_bridge" ? sibling.rolling_summary : ""
          }
        ]);

      if (createError) {
        console.error("[Database Error] Failed to create conversation:", createError);
        return res.status(500).json({ error: createError.message });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("conversation_events")
      .insert([
        {
          conversation_id,
          event_type: "USER_MESSAGE",
          actor,
          payload: { text: cleanText }
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("[Database Error] Failed to insert chat event:", error);
      return res.status(500).json({ error: error.message });
    }

    const host = req.headers.host || "127.0.0.1:5000";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    
    let webhookUrl = `${protocol}://${host}/api/agent/process`;
    if (host.includes("localhost") || host.includes("127.0.0.1") || !req.headers["x-forwarded-proto"]) {
      webhookUrl = `http://127.0.0.1:5000/api/agent/process`;
    }

    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: data.id,
        conversation_id,
        actor,
        event_type: "USER_MESSAGE",
        payload: { text: cleanText }
      })
    })
      .then((r) => {
        if (!r.ok) {
          console.error(`[Webhook Alert] Failed to trigger agent: ${r.status}`);
        }
      })
      .catch((err) => {
        console.error("[Webhook Connection Error]:", err.message);
      });

    return res.json({ success: true, message: data });
  } catch (err) {
    console.error("[API Error] send route exception:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/agent/process", async (req, res) => {
  const supabaseAdmin = getSupabaseAdmin();
  try {
    const { conversation_id, actor, payload } = req.body;

    if (!conversation_id) {
      return res.status(400).json({ error: "Missing conversation_id" });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    let { data: conversation, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("conversation_id", conversation_id)
      .single();

    if (convError && convError.code === "PGRST116") {
      // Find sibling to inherit state
      const { data: siblingData } = await supabaseAdmin
        .from("conversations")
        .select("structured_state, rolling_summary, lead_stage")
        .in("conversation_id", ["c1_buyer_agent", "c1_seller_agent", "c1_bridge"])
        .limit(1);
      
      const sibling = siblingData?.[0];

      const { data: newConv, error: createError } = await supabaseAdmin
        .from("conversations")
        .insert([
          {
            conversation_id,
            buyer_id: actor === "buyer" ? "buyer_id" : "unknown",
            seller_id: actor === "seller" ? "seller_id" : "unknown",
            lead_stage: sibling ? sibling.lead_stage : "DISCOVERY",
            structured_state: sibling && conversation_id === "c1_bridge" ? sibling.structured_state : {},
            rolling_summary: sibling && conversation_id === "c1_bridge" ? sibling.rolling_summary : ""
          }
        ])
        .select()
        .single();

      if (createError) {
        return res.status(500).json({ error: createError.message });
      }
      conversation = newConv;
    } else if (convError) {
      return res.status(500).json({ error: convError.message });
    }

    let baseState = { ...conversation.structured_state };
    if (conversation_id.includes("bridge")) {
      const siblingIds = await getSiblingConversationIds(supabaseAdmin, conversation_id);
      const privateIds = siblingIds.filter(id => id !== conversation_id);
      
      if (privateIds.length > 0) {
        const { data: siblings } = await supabaseAdmin
          .from("conversations")
          .select("conversation_id, structured_state")
          .in("conversation_id", privateIds);
        
        const buyerState = siblings?.find(c => c.conversation_id.includes("buyer"))?.structured_state || {};
        const sellerState = siblings?.find(c => c.conversation_id.includes("seller"))?.structured_state || {};
        
        baseState = {
          ...buyerState,
          ...sellerState,
          ...baseState
        };
      }
    }

    const updates = await extractStateUpdate(payload.text, baseState, actor);
    const updatedState = { ...baseState, ...updates };
    delete updatedState.lead_stage_suggestion;

    let targetLeadStage = conversation.lead_stage;
    if (updates.lead_stage_suggestion) {
      targetLeadStage = updates.lead_stage_suggestion;
    }

    const { data: rawEvents } = await supabaseAdmin
      .from("conversation_events")
      .select("*")
      .eq("conversation_id", conversation_id)
      .order("id", { ascending: true });

    const formattedMessages = (rawEvents || []).map(event => ({
      actor: event.actor,
      text: event.payload.text || JSON.stringify(event.payload)
    }));

    let graphResult;
    if (targetLeadStage === "ESCALATED" || conversation.lead_stage === "ESCALATED") {
      graphResult = {
        messages: formattedMessages,
        structured_state: updatedState,
        rolling_summary: conversation.rolling_summary,
        lead_stage: "ESCALATED",
        decision: "WAIT"
      };
    } else {
      graphResult = await agentGraph.invoke({
        messages: formattedMessages,
        structured_state: updatedState,
        rolling_summary: conversation.rolling_summary,
        lead_stage: targetLeadStage,
        action_taken: null,
        agent_reply: "",
        decision: ""
      });
    }

    const newMessages = graphResult.messages.slice(formattedMessages.length);
    if (newMessages.length > 0) {
      const insertPayloads = newMessages.map(msg => ({
        conversation_id,
        event_type: msg.actor === "agent" ? "USER_MESSAGE" : "TOOL_CALL",
        actor: msg.actor,
        payload: { text: msg.text }
      }));

      await supabaseAdmin.from("conversation_events").insert(insertPayloads);
    }

    const updatedEvents = [...formattedMessages, ...newMessages];
    const newSummary = await generateRollingSummary(updatedEvents, conversation.rolling_summary);

    // Update ONLY the active conversation
    await supabaseAdmin
      .from("conversations")
      .update({
        structured_state: graphResult.structured_state,
        rolling_summary: newSummary,
        lead_stage: graphResult.lead_stage
      })
      .eq("conversation_id", conversation_id);

    // Keep only the lead_stage synchronized for siblings
    const siblingIds = await getSiblingConversationIds(supabaseAdmin, conversation_id);
    const otherSiblingIds = siblingIds.filter(id => id !== conversation_id);
    if (otherSiblingIds.length > 0) {
      await supabaseAdmin
        .from("conversations")
        .update({
          lead_stage: graphResult.lead_stage
        })
        .in("conversation_id", otherSiblingIds);
    }

    // --- CROSS-THREAD TRIGGERS ---
    if (conversation_id === "c1_buyer_agent" && graphResult.lead_stage === "MATCHING") {
      // 1. Ensure c1_seller_agent exists in conversations
      let { data: sellerConv } = await supabaseAdmin
        .from("conversations")
        .select("conversation_id")
        .eq("conversation_id", "c1_seller_agent")
        .maybeSingle();

      if (!sellerConv) {
        await supabaseAdmin
          .from("conversations")
          .insert([{
            conversation_id: "c1_seller_agent",
            buyer_id: "buyer_id",
            seller_id: "seller_id",
            lead_stage: "DISCOVERY",
            structured_state: {},
            rolling_summary: ""
          }]);
      }

      // 2. Check if we have already sent the ping to the seller
      const { data: sellerEvents } = await supabaseAdmin
        .from("conversation_events")
        .select("id")
        .eq("conversation_id", "c1_seller_agent")
        .limit(1);

      if (!sellerEvents || sellerEvents.length === 0) {
        const pingMessages = [
          {
            conversation_id: "c1_seller_agent",
            event_type: "SYSTEM",
            actor: "system",
            payload: { text: "🤖 [Hệ thống] Kết nối từ Thread 1 (Buyer). Đang hỏi giá và tình trạng xe..." }
          },
          {
            conversation_id: "c1_seller_agent",
            event_type: "USER_MESSAGE",
            actor: "agent",
            payload: { text: "Chào anh/chị, em đến từ Vucar. Xe Honda Vision (2020) giá 24.000.000đ của anh/chị hiện có một người mua rất quan tâm. Anh/chị cho hỏi xe hiện tại còn không và anh/chị có bớt nhẹ giá xăng xe được không ạ?" }
          }
        ];
        await supabaseAdmin.from("conversation_events").insert(pingMessages);
      }
    }

    if (conversation_id === "c1_seller_agent" && newMessages.some(m => m.text && m.text.includes("create_chat_bridge"))) {
      // 1. Ensure c1_bridge exists in conversations
      let { data: bridgeConv } = await supabaseAdmin
        .from("conversations")
        .select("conversation_id")
        .eq("conversation_id", "c1_bridge")
        .maybeSingle();

      if (!bridgeConv) {
        // Fetch sibling states to populate the initial bridge state
        const { data: siblings } = await supabaseAdmin
          .from("conversations")
          .select("conversation_id, structured_state")
          .in("conversation_id", ["c1_buyer_agent", "c1_seller_agent"]);
        
        const buyerState = siblings?.find(c => c.conversation_id === "c1_buyer_agent")?.structured_state || {};
        const sellerState = siblings?.find(c => c.conversation_id === "c1_seller_agent")?.structured_state || {};
        
        const initialBridgeState = {
          ...buyerState,
          ...sellerState,
          ...graphResult.structured_state
        };

        await supabaseAdmin
          .from("conversations")
          .insert([{
            conversation_id: "c1_bridge",
            buyer_id: "buyer_id",
            seller_id: "seller_id",
            lead_stage: graphResult.lead_stage,
            structured_state: initialBridgeState,
            rolling_summary: newSummary
          }]);

        // Insert linkage row into conversation_connections table
        await supabaseAdmin
          .from("conversation_connections")
          .insert([{
            buyer_conv_id: "c1_buyer_agent",
            seller_conv_id: "c1_seller_agent",
            bridge_id: "c1_bridge"
          }]);
      }

      // 2. Fetch the Buyer's summary or last messages to build Thread 3 summary
      let { data: buyerConversation } = await supabaseAdmin
        .from("conversations")
        .select("rolling_summary, structured_state")
        .eq("conversation_id", "c1_buyer_agent")
        .maybeSingle();

      let buyerBudget = "25 triệu";
      if (buyerConversation && buyerConversation.structured_state && buyerConversation.structured_state.budget) {
        buyerBudget = Number(buyerConversation.structured_state.budget.target || 25000000).toLocaleString() + "đ";
      }

      const dealSummaryText = `🤖 [Tóm tắt chốt khớp]
- Người mua: Đang tìm xe Honda tay ga tầm ${buyerBudget} ở HCM.
- Người bán: Bán xe Honda Vision (2020) giá 24.000.000đ. Đã đồng ý bớt 500.000đ xăng xe.
- Trạng thái: Hai bên kết nối trực tiếp trong phòng chat chung. AI Agent đang hỗ trợ đặt lịch hẹn.`;

      // 3. Insert summary and initial system prompt to c1_bridge (Thread 3)
      const bridgeEvents = [
        {
          conversation_id: "c1_bridge",
          event_type: "SYSTEM",
          actor: "system",
          payload: { text: dealSummaryText }
        }
      ];
      await supabaseAdmin.from("conversation_events").insert(bridgeEvents);

      // 4. Send notification back to Buyer on Thread 1
      await supabaseAdmin.from("conversation_events").insert([
        {
          conversation_id: "c1_buyer_agent",
          event_type: "USER_MESSAGE",
          actor: "agent",
          payload: { text: "Người bán báo xe vẫn còn và đồng ý bớt giá nhẹ xăng xe cho bạn. Em đã tạo phòng chat kết nối trực tiếp hai anh chị rồi nhé. Vui lòng chuyển sang phòng chat chung bên dưới để trực tiếp nhắn tin ạ!" }
        }
      ]);

      // 5. Send confirmation to Seller on Thread 2
      await supabaseAdmin.from("conversation_events").insert([
        {
          conversation_id: "c1_seller_agent",
          event_type: "USER_MESSAGE",
          actor: "agent",
          payload: { text: "Cảm ơn bạn đã xác nhận. Em đã tạo phòng chat kết nối trực tiếp bạn với người mua rồi nhé. Hãy chuyển sang phòng chat chung để thương lượng trực tiếp ạ!" }
        }
      ]);
    }

    return res.json({
      success: true,
      stage: graphResult.lead_stage,
      state: graphResult.structured_state,
      summary: newSummary
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
