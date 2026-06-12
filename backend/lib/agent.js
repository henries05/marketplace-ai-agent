import { StateGraph, START, END } from "@langchain/langgraph";
import OpenAI from "openai";
import { getSupabaseAdmin } from "./supabase.js";

let openai = null;

function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.GEMINI_API_KEY;
    const baseURL = process.env.GEMINI_BASE_URL || "https://llm.wokushop.com/v1";
    if (apiKey) {
      openai = new OpenAI({ apiKey, baseURL });
    }
  }
  return openai;
}

async function executeReasoning(state) {
  const client = getOpenAI();
  if (!client) {
    return {
      decision: "ANSWER_USER",
      reply_text: "Hệ thống đang cấu hình, vui lòng thử lại sau."
    };
  }

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const prompt = `
    You are the Reasoning Engine of an AI Motorbike Marketplace Agent.
    Based on the current structured state, rolling summary, and recent messages, decide the next action.
    
    Current State:
    ${JSON.stringify(state.structured_state, null, 2)}
    
    Rolling Summary:
    "${state.rolling_summary}"
    
    Recent Messages:
    ${state.messages.slice(-5).map(m => `${m.actor}: ${m.text}`).join("\n")}
    
    You have access to these tools:
    1. "search_listings" (Args: { brand: string, model: string, min_price: number, max_price: number, location: string })
       Use this if the buyer is searching for bikes or if there is a price conflict and you need to propose alternatives.
    2. "book_appointment" (Args: { channel_id: string, time: string, location: string })
       Use this when BOTH buyer and seller agree on a time and place to meet/inspect the bike.
    3. "create_chat_bridge" (Args: { buyer_id: string, seller_id: string })
       Use this when the seller confirms vehicle availability and you want to connect the buyer and seller directly, or if the seller or buyer requests direct phone numbers/contact details, to create a safe anonymous chat.
    4. "get_listing_detail" (Args: { listing_id: number })
       Use this when the buyer asks for details about a specific listing (such as paperwork status, ODO, images, etc.).
       
    Your decision MUST be one of these:
    - "CALL_TOOL": Call one of the above tools. Provide "tool_name" and "tool_args".
    - "ANSWER_USER": Send a text message back to the users to help them move forward. Provide "reply_text".
    - "ESCALATE": Move the conversation to an operator if there is legal risk, papers missing, or suspicious activity. Provide "escalation_reason" and "reply_text".
    - "WAIT": Do nothing (use this if the users are actively chatting real-time and no milestone or risk requires agent intervention).

    Respond ONLY with a JSON object in this format (Note: reply_text and escalation_reason MUST be written in friendly and natural Vietnamese, matching the tone of Vucar marketplace):
    {
      "decision": "CALL_TOOL" | "ANSWER_USER" | "ESCALATE" | "WAIT",
      "tool_name": string (optional),
      "tool_args": object (optional),
      "reply_text": string (optional),
      "escalation_reason": string (optional)
    }
  `;

  try {
    const result = await client.chat.completions.create({
      model: modelName,
      messages: [
        { role: "user", content: prompt }
      ]
    });
    return JSON.parse(result.choices[0].message.content);
  } catch (error) {
    console.error("Agent Reasoning Error:", error);
    return { decision: "WAIT" };
  }
}

const reasoningNode = async (state) => {
  const result = await executeReasoning(state);
  return {
    action_taken: result.decision === "CALL_TOOL" ? { name: result.tool_name, args: result.tool_args } : null,
    agent_reply: result.reply_text || "",
    lead_stage: result.decision === "ESCALATE" ? "ESCALATED" : state.lead_stage,
    decision: result.decision
  };
};

const MOCK_LISTINGS = [
  { id: 1, brand: "Honda", model: "Air Blade", year: 2021, price: 32000000, odo: 19000, location: "HCM", paperwork_status: "clean_title" },
  { id: 2, brand: "Honda", model: "Vision", year: 2020, price: 24000000, odo: 12000, location: "HCM", paperwork_status: "waiting_original_file" },
  { id: 3, brand: "Yamaha", model: "Janus", year: 2022, price: 23000000, odo: 8000, location: "HCM", paperwork_status: "clean_title" },
  { id: 4, brand: "Honda", model: "Lead", year: 2019, price: 26000000, odo: 25000, location: "HN", paperwork_status: "clean_title" },
  { id: 5, brand: "Yamaha", model: "Exciter", year: 2021, price: 35000000, odo: 15000, location: "HCM", paperwork_status: "clean_title" },
  { id: 6, brand: "Vespa", model: "Sprint", year: 2022, price: 65000000, odo: 5000, location: "HCM", paperwork_status: "clean_title" }
];

const toolNode = async (state) => {
  const tool = state.action_taken;
  if (!tool) return {};

  let toolResult = "";

  if (tool.name === "search_listings") {
    const adminClient = getSupabaseAdmin();
    if (!adminClient) {
      // Mock fallback filtering
      let results = MOCK_LISTINGS;
      if (tool.args.brand) {
        results = results.filter(l => l.brand.toLowerCase().includes(tool.args.brand.toLowerCase()));
      }
      if (tool.args.location) {
        results = results.filter(l => l.location.toLowerCase().includes(tool.args.location.toLowerCase()));
      }
      if (tool.args.max_price) {
        results = results.filter(l => l.price <= tool.args.max_price);
      }
      results = results.slice(0, 3);
      toolResult = results.length > 0
        ? `Tìm thấy ${results.length} xe phù hợp: ${results.map(d => `${d.brand} ${d.model} (${d.year}) - ${Number(d.price).toLocaleString()}đ tại ${d.location}`).join("; ")}`
        : "Không tìm thấy xe phù hợp nào.";
    } else {
      let query = adminClient.from("listings").select("*");
      if (tool.args.brand) query = query.ilike("brand", `%${tool.args.brand}%`);
      if (tool.args.location) query = query.ilike("location", `%${tool.args.location}%`);
      if (tool.args.max_price) query = query.lte("price", tool.args.max_price);

      const { data } = await query.limit(3);
      toolResult = data && data.length > 0
        ? `Tìm thấy ${data.length} xe phù hợp: ${data.map(d => `${d.brand} ${d.model} (${d.year}) - ${Number(d.price).toLocaleString()}đ tại ${d.location}`).join("; ")}`
        : "Không tìm thấy xe phù hợp nào.";
    }
  } else if (tool.name === "get_listing_detail") {
    const adminClient = getSupabaseAdmin();
    if (!adminClient) {
      const detail = MOCK_LISTINGS.find(l => l.id === Number(tool.args.listing_id));
      toolResult = detail
        ? `Thông tin xe #${detail.id}: Hãng ${detail.brand}, mẫu ${detail.model}, đời ${detail.year}, giá ${Number(detail.price).toLocaleString()}đ, ODO ${detail.odo}km, địa điểm ${detail.location}, giấy tờ: ${detail.paperwork_status}.`
        : "Không tìm thấy xe với ID này.";
    } else {
      const { data, error } = await adminClient
        .from("listings")
        .select("*")
        .eq("id", tool.args.listing_id)
        .maybeSingle();

      toolResult = data
        ? `Thông tin xe #${data.id}: Hãng ${data.brand}, mẫu ${data.model}, đời ${data.year}, giá ${Number(data.price).toLocaleString()}đ, ODO ${data.odo}km, địa điểm ${data.location}, giấy tờ: ${data.paperwork_status}.`
        : "Không tìm thấy xe với ID này.";
    }
  } else if (tool.name === "book_appointment") {
    toolResult = `Đặt lịch hẹn thành công lúc ${tool.args.time} tại ${tool.args.location}.`;
  } else if (tool.name === "create_chat_bridge") {
    const channelId = `ch_bridge_${Math.random().toString(36).substring(2, 9)}`;
    toolResult = `Cầu nối ẩn danh được thiết lập. Channel ID: ${channelId}. Hai bên có thể tiếp tục nhắn tin an toàn.`;
  }

  const newMessages = [
    ...state.messages,
    { actor: "system", text: `[Tool Call] ${tool.name}(${JSON.stringify(tool.args)})` },
    { actor: "system", text: `[Tool Result] ${toolResult}` }
  ];

  return {
    messages: newMessages,
    action_taken: null,
    decision: "RE_EVALUATE"
  };
};

const escalateNode = async (state) => {
  const newMessages = [
    ...state.messages,
    { actor: "agent", text: state.agent_reply || "Để hỗ trợ quy trình, mình đã kết nối anh/chị với chuyên viên tư vấn pháp lý của Vucar nhé." }
  ];
  return {
    messages: newMessages,
    lead_stage: "ESCALATED",
    agent_reply: ""
  };
};

const responseNode = async (state) => {
  const newMessages = [
    ...state.messages,
    { actor: "agent", text: state.agent_reply }
  ];
  return {
    messages: newMessages,
    agent_reply: ""
  };
};

const shouldContinue = (state) => {
  if (state.decision === "CALL_TOOL") return "tools";
  if (state.decision === "ESCALATE") return "escalate";
  if (state.decision === "ANSWER_USER") return "respond";
  return END;
};

const graphBuilder = new StateGraph({
  channels: {
    messages: {
      value: (x, y) => y,
      default: () => []
    },
    structured_state: {
      value: (x, y) => ({ ...x, ...y }),
      default: () => ({})
    },
    rolling_summary: {
      value: (x, y) => y,
      default: () => ""
    },
    lead_stage: {
      value: (x, y) => y,
      default: () => "DISCOVERY"
    },
    action_taken: {
      value: (x, y) => y,
      default: () => null
    },
    agent_reply: {
      value: (x, y) => y,
      default: () => ""
    },
    decision: {
      value: (x, y) => y,
      default: () => ""
    }
  }
});

graphBuilder
  .addNode("reason", reasoningNode)
  .addNode("tools", toolNode)
  .addNode("escalate", escalateNode)
  .addNode("respond", responseNode);

graphBuilder
  .addEdge(START, "reason")
  .addConditionalEdges("reason", shouldContinue, {
    tools: "tools",
    escalate: "escalate",
    respond: "respond",
    [END]: END
  })
  .addEdge("tools", "reason")
  .addEdge("escalate", END)
  .addEdge("respond", END);

export const agentGraph = graphBuilder.compile();
