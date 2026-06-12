import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import ChatWindow from "./components/ChatWindow";
import StateMonitor from "./components/StateMonitor";

const MOCK_MESSAGES = [
  // Buyer private chat
  { id: 1, conversation_id: "c1_buyer_agent", actor: "buyer", payload: { text: "Chào bạn, mình tìm xe tay ga tầm 25tr ở HCM, xe đẹp chút" }, timestamp: new Date().toISOString() },
  { id: 2, conversation_id: "c1_buyer_agent", actor: "agent", payload: { text: "Dạ bạn có ưu tiên hãng hay đời xe khoảng bao nhiêu không ạ?" }, timestamp: new Date().toISOString() },
  { id: 3, conversation_id: "c1_buyer_agent", actor: "buyer", payload: { text: "Honda hoặc Yamaha, đời 2020 trở lên, odo thấp" }, timestamp: new Date().toISOString() },
  { id: 4, conversation_id: "c1_buyer_agent", actor: "agent", payload: { text: "Để mình tìm và kết nối với xe phù hợp nhé." }, timestamp: new Date().toISOString() },

  // Seller private chat
  { id: 5, conversation_id: "c1_seller_agent", actor: "seller", payload: { text: "Mình muốn bán xe Honda Air Blade đời 2021, odo 19k, xe nhà đi giữ kỹ." }, timestamp: new Date().toISOString() },
  { id: 6, conversation_id: "c1_seller_agent", actor: "agent", payload: { text: "Chào bạn, bạn muốn bán xe giá bao nhiêu và giấy tờ thế nào ạ?" }, timestamp: new Date().toISOString() },
  { id: 7, conversation_id: "c1_seller_agent", actor: "seller", payload: { text: "Mình muốn bán tầm 32 triệu, bao sang tên rút hồ sơ." }, timestamp: new Date().toISOString() },

  // Bridge chat (shared)
  { id: 8, conversation_id: "c1_bridge", actor: "system", payload: { text: "🤖 [Hệ thống] Bắt đầu phòng chat thương lượng trực tiếp giữa Người mua và Người bán." }, timestamp: new Date().toISOString() },
  { id: 9, conversation_id: "c1_bridge", actor: "buyer", payload: { text: "Chào bạn, chiếc Air Blade 2021 của bạn 28 triệu bán được không ạ?" }, timestamp: new Date().toISOString() },
  { id: 10, conversation_id: "c1_bridge", actor: "seller", payload: { text: "Bớt tối đa được xăng xe thôi bạn ơi, 31.5 triệu nha." }, timestamp: new Date().toISOString() },
  { id: 11, conversation_id: "c1_bridge", actor: "agent", payload: { text: "Hai bên có chênh lệch giá khoảng 3.5 triệu. Các bạn có muốn tham khảo chính sách trả góp của hệ thống không ạ?" }, timestamp: new Date().toISOString() }
];

const MOCK_CONVERSATION = {
  conversation_id: "c1",
  lead_stage: "NEGOTIATION",
  rolling_summary: "Người mua đang tìm xe ga tầm 25tr ở HCM. Người bán chào bán Air Blade 2021 giá 32tr. Đang đàm phán thương lượng giá vì chênh lệch ngân sách.",
  structured_state: {
    location: "HCM",
    budget: { target: 25000000, max: 26000000 },
    preferences: { types: ["scooter"], brands: ["Honda", "Yamaha"], min_year: 2020 },
    seller_profile: {
      asking_price: 32000000,
      vehicle_info: { brand: "Honda", model: "Air Blade", year: 2021, odo: 19000 }
    },
    risks_detected: [
      { category: "pricing_conflict", severity: "high", description: "Chênh lệch giá thương lượng > 20% (6,000,000đ)" }
    ]
  }
};

export default function App() {
  const [activeConvId, setActiveConvId] = useState("c1");
  const [buyerMessages, setBuyerMessages] = useState([]);
  const [sellerMessages, setSellerMessages] = useState([]);
  const [bridgeMessages, setBridgeMessages] = useState([]);

  const [buyerConv, setBuyerConv] = useState({ conversation_id: "c1_buyer_agent", lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
  const [sellerConv, setSellerConv] = useState({ conversation_id: "c1_seller_agent", lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
  const [bridgeConv, setBridgeConv] = useState(null);

  const [isBridgeActive, setIsBridgeActive] = useState(false);
  const [isBuyerJoinedBridge, setIsBuyerJoinedBridge] = useState(() => {
    return localStorage.getItem("vucar_buyer_joined") === "true";
  });
  const [isSellerJoinedBridge, setIsSellerJoinedBridge] = useState(() => {
    return localStorage.getItem("vucar_seller_joined") === "true";
  });
  const [isOperatorActive, setIsOperatorActive] = useState(() => {
    return localStorage.getItem("vucar_operator_active") === "true";
  });
  const [operatorThreadId, setOperatorThreadId] = useState(() => {
    return localStorage.getItem("vucar_operator_thread_id") || null;
  });
  const [supabaseActive, setSupabaseActive] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState({});

  const [isSimulating, setIsSimulating] = useState(false);
  const [simIndex, setSimIndex] = useState(0);
  const [simTotal, setSimTotal] = useState(0);

  const [pendingGroups, setPendingGroups] = useState([]);
  const [activeGroupIdx, setActiveGroupIdx] = useState(-1);
  const [isGroupRunning, setIsGroupRunning] = useState(false);

  const runGroup = async (groupIdx, groupsList) => {
    const activeList = groupsList || pendingGroups;
    if (groupIdx < 0 || groupIdx >= activeList.length) return;

    setIsGroupRunning(true);
    const group = activeList[groupIdx];
    const messages = group.messages;
    setSimIndex(0);
    setSimTotal(messages.length);

    // Update active conversation context and activate bridge state
    setActiveConvId(group.convId);
    setIsBridgeActive(true);
    setIsBuyerJoinedBridge(true);
    setIsSellerJoinedBridge(true);
    localStorage.setItem("vucar_buyer_joined", "true");
    localStorage.setItem("vucar_seller_joined", "true");

    console.log(`[Simulator UI] Bắt đầu chạy cuộc hội thoại ${group.convId.toUpperCase()} trong kênh Thương lượng chung`);

    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx];
      setSimIndex(idx + 1);

      // Force target to bridge thread
      const targetThreadId = `${group.convId}_bridge`;
      console.log(`[Simulator UI] Gửi tin nhắn ${idx + 1}/${messages.length}: Thread ${targetThreadId} | Actor ${msg.sender}`);

      await handleSendMessage(msg.sender, msg.text, targetThreadId);

      // Wait between messages for LLM webhook updates
      await new Promise(r => setTimeout(r, 4500));
    }

    setIsGroupRunning(false);
    console.log(`[Simulator UI] Đã dừng sau khi hoàn tất cuộc hội thoại ${group.convId.toUpperCase()}`);
  };

  const handleJsonlUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      
      const conversationGroups = {};
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.sender === "buyer" || parsed.sender === "seller") {
            if (!conversationGroups[parsed.conversation_id]) {
              conversationGroups[parsed.conversation_id] = [];
            }
            conversationGroups[parsed.conversation_id].push(parsed);
          }
        } catch (err) {
          console.warn("Skipped invalid JSONL line:", line);
        }
      }

      const groups = Object.keys(conversationGroups).map(id => ({
        convId: id,
        messages: conversationGroups[id]
      }));

      if (groups.length === 0) {
        alert("Không tìm thấy tin nhắn hợp lệ của người mua/người bán trong tệp.");
        return;
      }

      setPendingGroups(groups);
      setActiveGroupIdx(0);
      setIsSimulating(true);

      // Reset database and frontend state first
      await handleReset();
      await new Promise(r => setTimeout(r, 1500));

      // Run the first group
      await runGroup(0, groups);
    };
    reader.readAsText(file);
  };

  const handleNextGroup = async () => {
    const nextIdx = activeGroupIdx + 1;
    if (nextIdx >= pendingGroups.length) {
      setIsSimulating(false);
      setPendingGroups([]);
      setActiveGroupIdx(-1);
      alert("Đã chạy xong tất cả các cuộc hội thoại.");
      return;
    }

    setActiveGroupIdx(nextIdx);
    await handleReset();
    await new Promise(r => setTimeout(r, 1500));
    await runGroup(nextIdx);
  };

  const handleCancelSimulation = () => {
    setIsSimulating(false);
    setPendingGroups([]);
    setActiveGroupIdx(-1);
    setIsGroupRunning(false);
  };

  useEffect(() => {
    if (supabase) {
      setSupabaseActive(true);
    } else {
      setBuyerMessages(MOCK_MESSAGES.filter(m => m.conversation_id === "c1_buyer_agent"));
      setSellerMessages(MOCK_MESSAGES.filter(m => m.conversation_id === "c1_seller_agent"));
      setBridgeMessages(MOCK_MESSAGES.filter(m => m.conversation_id === "c1_bridge"));
      setBuyerConv(MOCK_CONVERSATION);
      setSellerConv({ ...MOCK_CONVERSATION, conversation_id: "c1_seller_agent" });
      setBridgeConv({ ...MOCK_CONVERSATION, conversation_id: "c1_bridge" });
      setIsBridgeActive(true);
    }
  }, []);

  useEffect(() => {
    const keys = Object.keys(thinkingStatus);
    if (keys.length === 0) return;
    const timers = keys.map(threadId => {
      return setTimeout(() => {
        setThinkingStatus(prev => {
          const updated = { ...prev };
          delete updated[threadId];
          return updated;
        });
      }, 15000);
    });
    return () => timers.forEach(clearTimeout);
  }, [thinkingStatus]);

  useEffect(() => {
    if (!supabaseActive) return;

    const fetchInitialData = async () => {
      // 1. Fetch conversations
      const { data: convs } = await supabase
        .from("conversations")
        .select("*")
        .in("conversation_id", [`${activeConvId}_buyer_agent`, `${activeConvId}_seller_agent`, `${activeConvId}_bridge`]);

      const buyer = convs?.find(c => c.conversation_id === `${activeConvId}_buyer_agent`);
      const seller = convs?.find(c => c.conversation_id === `${activeConvId}_seller_agent`);
      const bridge = convs?.find(c => c.conversation_id === `${activeConvId}_bridge`);

      if (buyer) setBuyerConv(buyer);
      if (seller) setSellerConv(seller);
      if (bridge) {
        setBridgeConv(bridge);
        setIsBridgeActive(true);
      } else {
        setBridgeConv(null);
        setIsBridgeActive(false);
      }

      // 2. Fetch events
      const { data: events } = await supabase
        .from("conversation_events")
        .select("*")
        .in("conversation_id", [`${activeConvId}_buyer_agent`, `${activeConvId}_seller_agent`, `${activeConvId}_bridge`])
        .order("id", { ascending: true });

      if (events) {
        setBuyerMessages(events.filter(e => e.conversation_id === `${activeConvId}_buyer_agent`));
        setSellerMessages(events.filter(e => e.conversation_id === `${activeConvId}_seller_agent`));
        setBridgeMessages(events.filter(e => e.conversation_id === `${activeConvId}_bridge`));
      }
    };

    fetchInitialData();

    // 3. Realtime listener for all conversation_events
    const channelEvents = supabase
      .channel("realtime-events-all")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_events"
        },
        (payload) => {
          const newMsg = payload.new;

          // Agent thinking indicator toggle
          if (newMsg.actor === "buyer" || newMsg.actor === "seller") {
            setThinkingStatus(prev => ({ ...prev, [newMsg.conversation_id]: "extracting" }));
          } else if (newMsg.event_type === "TOOL_CALL" || newMsg.actor === "system") {
            setThinkingStatus(prev => ({ ...prev, [newMsg.conversation_id]: "tool_call" }));
          } else if (newMsg.actor === "agent") {
            setThinkingStatus(prev => ({ ...prev, [newMsg.conversation_id]: "writing" }));
          }

          // Distribute message
          if (newMsg.conversation_id === `${activeConvId}_buyer_agent`) {
            setBuyerMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
          } else if (newMsg.conversation_id === `${activeConvId}_seller_agent`) {
            setSellerMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
          } else if (newMsg.conversation_id === `${activeConvId}_bridge`) {
            setBridgeMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
          }
        }
      )
      .subscribe();

    // 4. Realtime listener for all conversations rows updates
    const channelConv = supabase
      .channel("realtime-conv-all")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations"
        },
        (payload) => {
          const eventType = payload.eventType;
          if (eventType === "DELETE") {
            const oldId = payload.old.conversation_id;
            if (oldId === `${activeConvId}_buyer_agent`) setBuyerConv({ conversation_id: `${activeConvId}_buyer_agent`, lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
            if (oldId === `${activeConvId}_seller_agent`) setSellerConv({ conversation_id: `${activeConvId}_seller_agent`, lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
            if (oldId === `${activeConvId}_bridge`) {
              setBridgeConv(null);
              setIsBridgeActive(false);
            }
          } else {
            const newConv = payload.new;
            if (newConv.conversation_id === `${activeConvId}_buyer_agent`) setBuyerConv(newConv);
            if (newConv.conversation_id === `${activeConvId}_seller_agent`) setSellerConv(newConv);
            if (newConv.conversation_id === `${activeConvId}_bridge`) {
              setBridgeConv(newConv);
              setIsBridgeActive(true);
            }
            // Clear thinking indicator once state update transaction is saved
            setThinkingStatus(prev => {
              const updated = { ...prev };
              delete updated[newConv.conversation_id];
              return updated;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelEvents);
      supabase.removeChannel(channelConv);
    };
  }, [supabaseActive, activeConvId]);

  const handleSendMessage = async (actor, text, customThreadId) => {
    let targetThreadId = customThreadId;
    if (!targetThreadId) {
      if (actor === "buyer") {
        targetThreadId = isBridgeActive && isBuyerJoinedBridge ? `${activeConvId}_bridge` : `${activeConvId}_buyer_agent`;
      } else if (actor === "seller") {
        targetThreadId = isBridgeActive && isSellerJoinedBridge ? `${activeConvId}_bridge` : `${activeConvId}_seller_agent`;
      } else if (actor === "operator") {
        targetThreadId = operatorThreadId;
      }
    }

    if (!targetThreadId) return;

    const tempId = `temp-${Date.now()}`;
    const tempMsg = {
      id: tempId,
      conversation_id: targetThreadId,
      actor,
      payload: { text },
      timestamp: new Date().toISOString()
    };
    
    // Optimistic UI updates
    if (targetThreadId === `${activeConvId}_buyer_agent`) {
      setBuyerMessages(prev => [...prev, tempMsg]);
    } else if (targetThreadId === `${activeConvId}_seller_agent`) {
      setSellerMessages(prev => [...prev, tempMsg]);
    } else if (targetThreadId === `${activeConvId}_bridge`) {
      setBridgeMessages(prev => [...prev, tempMsg]);
    }

    if (!supabaseActive) {
      setThinkingStatus(prev => ({ ...prev, [targetThreadId]: "extracting" }));
      setTimeout(() => {
        setThinkingStatus(prev => ({ ...prev, [targetThreadId]: "reasoning" }));
      }, 500);
      setTimeout(() => {
        setThinkingStatus(prev => ({ ...prev, [targetThreadId]: "writing" }));
      }, 1000);
      setTimeout(() => {
        setThinkingStatus(prev => {
          const updated = { ...prev };
          delete updated[targetThreadId];
          return updated;
        });
        const replyEvent = {
          id: `agent-${Date.now()}`,
          conversation_id: targetThreadId,
          actor: "agent",
          payload: { text: "Em đã nhận thông tin. Trong chế độ Offline, vui lòng cấu hình tệp .env ở cả hai thư mục để chạy kết nối đầy đủ các luồng AI Agent!" },
          timestamp: new Date().toISOString()
        };
        if (targetThreadId === `${activeConvId}_buyer_agent`) {
          setBuyerMessages(prev => [...prev, replyEvent]);
        } else if (targetThreadId === `${activeConvId}_seller_agent`) {
          setSellerMessages(prev => [...prev, replyEvent]);
        } else if (targetThreadId === `${activeConvId}_bridge`) {
          setBridgeMessages(prev => [...prev, replyEvent]);
        }
      }, 1800);
      return;
    }

    try {
      setThinkingStatus(prev => ({ ...prev, [targetThreadId]: "extracting" }));
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: targetThreadId,
          actor,
          text
        })
      });
      const data = await response.json();
      if (data.success) {
        if (targetThreadId === "c1_buyer_agent") {
          setBuyerMessages(prev => prev.map(m => m.id === tempId ? data.message : m));
        } else if (targetThreadId === "c1_seller_agent") {
          setSellerMessages(prev => prev.map(m => m.id === tempId ? data.message : m));
        } else if (targetThreadId === "c1_bridge") {
          setBridgeMessages(prev => prev.map(m => m.id === tempId ? data.message : m));
        }
      }
    } catch (err) {
      setThinkingStatus(prev => {
        const updated = { ...prev };
        delete updated[targetThreadId];
        return updated;
      });
      if (targetThreadId === "c1_buyer_agent") {
        setBuyerMessages(prev => prev.filter(m => m.id !== tempId));
      } else if (targetThreadId === "c1_seller_agent") {
        setSellerMessages(prev => prev.filter(m => m.id !== tempId));
      } else if (targetThreadId === "c1_bridge") {
        setBridgeMessages(prev => prev.filter(m => m.id !== tempId));
      }
    }
  };

  const handleReset = async () => {
    localStorage.removeItem("vucar_buyer_joined");
    localStorage.removeItem("vucar_seller_joined");
    localStorage.removeItem("vucar_operator_active");
    localStorage.removeItem("vucar_operator_thread_id");

    if (!supabaseActive) {
      setBuyerMessages([]);
      setSellerMessages([]);
      setBridgeMessages([]);
      setBuyerConv({ conversation_id: `${activeConvId}_buyer_agent`, lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
      setSellerConv({ conversation_id: `${activeConvId}_seller_agent`, lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
      setBridgeConv(null);
      setIsBridgeActive(false);
      setIsBuyerJoinedBridge(false);
      setIsSellerJoinedBridge(false);
      setIsOperatorActive(false);
      setOperatorThreadId(null);
      return;
    }
    
    // Clear all connections, events, and conversations from database
    await supabase.from("conversation_connections").delete().neq("id", 0);
    await supabase.from("conversation_events").delete().neq("id", 0);
    await supabase.from("conversations").delete().neq("conversation_id", "");
    
    setBuyerMessages([]);
    setSellerMessages([]);
    setBridgeMessages([]);
    setBuyerConv({ conversation_id: `${activeConvId}_buyer_agent`, lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
    setSellerConv({ conversation_id: `${activeConvId}_seller_agent`, lead_stage: "DISCOVERY", structured_state: {}, rolling_summary: "" });
    setBridgeConv(null);
    setIsBridgeActive(false);
    setIsBuyerJoinedBridge(false);
    setIsSellerJoinedBridge(false);
    setIsOperatorActive(false);
    setOperatorThreadId(null);
  };

  // Resolve which thread is currently escalated
  let escalatedThreadId = null;
  if (isBridgeActive) {
    if (bridgeConv?.lead_stage === "ESCALATED") {
      escalatedThreadId = `${activeConvId}_bridge`;
    }
  } else {
    if (buyerConv?.lead_stage === "ESCALATED") {
      escalatedThreadId = `${activeConvId}_buyer_agent`;
    }
  }


  return (
    <div className="dashboard-container">
      <header className="header">
        <h1>AI Motorbike Marketplace Agent Dashboard</h1>
        <div className="header-meta">
          <div className="badge">
            Status: {isBridgeActive ? "Connected Bridge" : "Discovery Channels"}
          </div>
          <label 
            className="btn-send" 
            style={{ 
              background: "rgba(99, 102, 241, 0.15)", 
              border: "1px solid var(--accent-blue)", 
              color: "var(--accent-blue)", 
              padding: "6px 16px",
              cursor: isSimulating ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
              borderRadius: "6px",
              fontWeight: "500"
            }}
          >
            📁 Nhập file .jsonl
            <input 
              type="file" 
              accept=".jsonl" 
              onChange={handleJsonlUpload} 
              style={{ display: "none" }} 
              disabled={isSimulating}
            />
          </label>
          <button 
            onClick={handleReset} 
            className="btn-send" 
            style={{ background: "rgba(244, 63, 94, 0.15)", border: "1px solid var(--accent-rose)", color: "var(--accent-rose)", padding: "6px 16px" }}
            disabled={isSimulating}
          >
            Reset Chat State
          </button>
        </div>
      </header>

      {isSimulating && (
        <div 
          className="config-banner" 
          style={{ 
            background: "rgba(99, 102, 241, 0.08)", 
            border: "1px solid var(--accent-blue)", 
            color: "var(--text-primary)", 
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 20px",
            borderRadius: "8px"
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontWeight: "700", color: "#1e3a8a" }}>
              🔄 Trình mô phỏng JSONL (Chạy từng cuộc hội thoại)
            </div>
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
              Đang ở cuộc hội thoại: <strong style={{ color: "var(--accent-blue)", textTransform: "uppercase" }}>{pendingGroups[activeGroupIdx]?.convId}</strong> | 
              Trạng thái: {isGroupRunning ? `Đang chạy tin nhắn ${simIndex}/${simTotal}` : "Đang tạm dừng (Chờ bấm chạy tiếp)"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {!isGroupRunning && activeGroupIdx < pendingGroups.length - 1 && (
              <button
                onClick={handleNextGroup}
                className="btn-send"
                style={{ 
                  background: "var(--accent-blue)", 
                  color: "#fff", 
                  border: "none", 
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Reset & Chạy tiếp {pendingGroups[activeGroupIdx + 1]?.convId.toUpperCase()} ➡️
              </button>
            )}
            {!isGroupRunning && activeGroupIdx === pendingGroups.length - 1 && (
              <button
                onClick={() => {
                  setIsSimulating(false);
                  setPendingGroups([]);
                  setActiveGroupIdx(-1);
                }}
                className="btn-send"
                style={{ 
                  background: "#059669", 
                  color: "#fff", 
                  border: "none", 
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Hoàn tất Mô phỏng ✅
              </button>
            )}
            <button
              onClick={handleCancelSimulation}
              className="btn-send"
              style={{ 
                background: "rgba(244, 63, 94, 0.1)", 
                color: "var(--accent-rose)", 
                border: "1px solid var(--accent-rose)", 
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: "600",
                cursor: "pointer"
              }}
            >
              Hủy mô phỏng
            </button>
          </div>
        </div>
      )}

      {!supabaseActive && (
        <div className="config-banner">
          <div>
            <strong>📢 Chế độ Demo (Offline Mode):</strong> Bạn chưa cấu hình Supabase URL và Anon Key ở tệp <code>.env</code> của frontend. Hệ thống đang tự động tải dữ liệu mẫu và giả lập các phản hồi của Agent cục bộ. Điền thông tin cấu hình để kết nối Database thực tế.
          </div>
        </div>
      )}

      <main className="grid-layout">
        <ChatWindow 
          buyerMessages={buyerMessages} 
          sellerMessages={sellerMessages} 
          bridgeMessages={bridgeMessages}
          operatorMessages={operatorThreadId === `${activeConvId}_buyer_agent` ? buyerMessages : operatorThreadId === `${activeConvId}_bridge` ? bridgeMessages : []}
          onSendMessage={handleSendMessage} 
          thinkingStatus={thinkingStatus}
          isBridgeActive={isBridgeActive}
          isBuyerJoinedBridge={isBuyerJoinedBridge}
          isSellerJoinedBridge={isSellerJoinedBridge}
          isOperatorActive={isOperatorActive}
          operatorThreadId={operatorThreadId}
          escalatedThreadId={escalatedThreadId}
          onJoinBridge={(role) => {
            if (role === "buyer") {
              setIsBuyerJoinedBridge(true);
              localStorage.setItem("vucar_buyer_joined", "true");
            }
            if (role === "seller") {
              setIsSellerJoinedBridge(true);
              localStorage.setItem("vucar_seller_joined", "true");
            }
          }}
          onJoinOperator={(threadId) => {
            setIsOperatorActive(true);
            setOperatorThreadId(threadId);
            localStorage.setItem("vucar_operator_active", "true");
            localStorage.setItem("vucar_operator_thread_id", threadId);
          }}
          activeConvId={activeConvId}
        />
        <StateMonitor 
          buyerConv={buyerConv}
          sellerConv={sellerConv}
          bridgeConv={bridgeConv}
          activeConvId={activeConvId}
        />
      </main>
    </div>
  );
}
