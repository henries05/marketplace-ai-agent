import { useState, useEffect, useRef } from "react";

export default function ChatWindow({
  buyerMessages,
  sellerMessages,
  bridgeMessages,
  operatorMessages,
  onSendMessage,
  thinkingStatus,
  isBridgeActive,
  isBuyerJoinedBridge,
  isSellerJoinedBridge,
  isOperatorActive,
  operatorThreadId,
  escalatedThreadId,
  onJoinBridge,
  onJoinOperator,
  activeConvId = "c1"
}) {
  const [buyerInput, setBuyerInput] = useState("");
  const [sellerInput, setSellerInput] = useState("");
  const [operatorInput, setOperatorInput] = useState("");

  const [buyerActiveTab, setBuyerActiveTab] = useState("bridge");
  const [sellerActiveTab, setSellerActiveTab] = useState("bridge");
  
  const buyerEndRef = useRef(null);
  const sellerEndRef = useRef(null);
  const operatorEndRef = useRef(null);

  useEffect(() => {
    buyerEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [buyerMessages, buyerActiveTab]);

  useEffect(() => {
    sellerEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sellerMessages, sellerActiveTab]);

  useEffect(() => {
    operatorEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [operatorMessages]);

  const handleSend = (e, actor, text, setInput, activeTab) => {
    e.preventDefault();
    if (!text.trim()) return;
    
    let threadId;
    if (actor === "buyer") {
      threadId = activeTab === "bridge" ? `${activeConvId}_bridge` : `${activeConvId}_buyer_agent`;
    } else if (actor === "seller") {
      threadId = activeTab === "bridge" ? `${activeConvId}_bridge` : `${activeConvId}_seller_agent`;
    } else {
      threadId = operatorThreadId;
    }

    onSendMessage(actor, text, threadId);
    setInput("");
  };

  const renderBubble = (msg, perspective) => {
    if (msg.actor === "agent") {
      return (
        <div key={msg.id} className="message-bubble msg-agent">
          <strong>AI Agent:</strong> {msg.payload.text}
        </div>
      );
    }
    
    if (msg.actor === "system") {
      return (
        <div key={msg.id} className="message-bubble msg-system">
          {msg.payload.text}
        </div>
      );
    }

    if (msg.actor === "operator") {
      const isMe = perspective === "operator";
      return (
        <div
          key={msg.id}
          className={`message-bubble ${isMe ? "msg-me-operator" : "msg-operator"}`}
        >
          <strong>Nhân viên hỗ trợ:</strong> {msg.payload.text}
        </div>
      );
    }

    const isMe = msg.actor === perspective;
    return (
      <div
        key={msg.id}
        className={`message-bubble ${isMe ? "msg-me" : "msg-other"}`}
      >
        <strong>{msg.actor === "buyer" ? "Người mua" : "Người bán"}:</strong> {msg.payload.text}
      </div>
    );
  };

  const renderThinkingBubble = (threadId) => {
    const step = thinkingStatus?.[threadId];
    if (!step) return null;
    return (
      <div className="thinking-bubble">
        <div className="thinking-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span>
          {step === "extracting" && "🤖 AI Agent: Đang trích xuất..."}
          {step === "reasoning" && "🤖 AI Agent: Đang lập luận..."}
          {step === "tool_call" && "🤖 AI Agent: Đang gọi công cụ..."}
          {step === "writing" && "🤖 AI Agent: Đang soạn phản hồi..."}
          {step !== "extracting" && step !== "reasoning" && step !== "tool_call" && step !== "writing" && "🤖 AI Agent: Đang xử lý..."}
        </span>
      </div>
    );
  };

  return (
    <div className="chat-windows-container">
      {/* Column 1: Buyer View */}
      <div className="glass-card chat-column" style={{ position: "relative" }}>
        <h2 className="panel-title title-buyer">
          🙋‍♂️ Người mua (Buyer) — {buyerActiveTab === "bridge" ? "👥 Đang chat với đối tác" : "💬 Chat riêng với AI Agent"}
        </h2>

        {/* Tab Switcher is ALWAYS visible */}
        <div className="tab-switcher">
          <button 
            type="button"
            className={`tab-btn ${buyerActiveTab === "private" ? "active" : ""}`}
            onClick={() => setBuyerActiveTab("private")}
          >
            🤖 Trợ lý AI (Riêng)
          </button>
          <button 
            type="button"
            className={`tab-btn ${buyerActiveTab === "bridge" ? "active" : ""}`}
            onClick={() => setBuyerActiveTab("bridge")}
          >
            👥 Thương lượng (Chung)
          </button>
        </div>

        {buyerActiveTab === "private" ? (
          /* Private AI Tab View */
          <div className="messages-list-wrapper" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="messages-list" style={{ flex: 1 }}>
              {buyerMessages.map((msg) => renderBubble(msg, "buyer"))}
              {renderThinkingBubble(`${activeConvId}_buyer_agent`)}
              <div ref={buyerEndRef} />
            </div>
            <form
              className="chat-input-form"
              onSubmit={(e) => handleSend(e, "buyer", buyerInput, setBuyerInput, "private")}
            >
              <input
                type="text"
                className="chat-input"
                placeholder="Hỏi trợ lý AI riêng tư..."
                value={buyerInput}
                onChange={(e) => setBuyerInput(e.target.value)}
              />
              <button type="submit" className="btn-send">Gửi</button>
            </form>
          </div>
        ) : (
          /* Shared Bridge Tab View */
          <div className="messages-list-wrapper" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative" }}>
            {!isBridgeActive ? (
              /* Bridge is not active yet */
              <div className="bridge-placeholder" style={{ flex: 1 }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🔍</div>
                <h4>Chưa kết nối đối tác</h4>
                <p>AI Agent đang tìm kiếm và khớp nối xe phù hợp. Bạn hãy trao đổi nhu cầu chi tiết ở tab "Trợ lý AI" nhé!</p>
              </div>
            ) : !isBuyerJoinedBridge ? (
              /* Bridge is active but not joined yet */
              <div className="bridge-placeholder" style={{ flex: 1 }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🤝</div>
                <h4>Đã kết nối người bán</h4>
                <p>Nhân viên AI đã tạo phòng chat thương lượng trực tiếp. Bấm nút bên dưới để bắt đầu đàm phán.</p>
                <button 
                  type="button" 
                  className="btn-join-bridge" 
                  onClick={() => onJoinBridge("buyer")}
                  style={{ maxWidth: "200px", margin: "0 auto" }}
                >
                  Tham gia đàm phán
                </button>
              </div>
            ) : (
              /* Joined Bridge Chat */
              <>
                <div className="messages-list" style={{ flex: 1 }}>
                  {bridgeMessages.map((msg) => renderBubble(msg, "buyer"))}
                  {renderThinkingBubble(`${activeConvId}_bridge`)}
                  <div ref={buyerEndRef} />
                </div>
                <form
                  className="chat-input-form"
                  onSubmit={(e) => handleSend(e, "buyer", buyerInput, setBuyerInput, "bridge")}
                >
                  <input
                    type="text"
                    className="chat-input"
                    placeholder="Nhắn tin trực tiếp cho người bán..."
                    value={buyerInput}
                    onChange={(e) => setBuyerInput(e.target.value)}
                  />
                  <button type="submit" className="btn-send">Gửi</button>
                </form>
              </>
            )}
          </div>
        )}
      </div>

      {/* Column 2: Seller View */}
      <div className="glass-card chat-column" style={{ position: "relative" }}>
        <h2 className="panel-title title-seller">
          🚗 Người bán (Seller) — {sellerActiveTab === "bridge" ? "👥 Đang chat với đối tác" : "💬 Chat riêng với AI Agent"}
        </h2>

        {/* Tab Switcher is ALWAYS visible */}
        <div className="tab-switcher">
          <button 
            type="button"
            className={`tab-btn ${sellerActiveTab === "private" ? "active" : ""}`}
            onClick={() => setSellerActiveTab("private")}
          >
            🤖 Trợ lý AI (Riêng)
          </button>
          <button 
            type="button"
            className={`tab-btn ${sellerActiveTab === "bridge" ? "active" : ""}`}
            onClick={() => setSellerActiveTab("bridge")}
          >
            👥 Thương lượng (Chung)
          </button>
        </div>

        {sellerActiveTab === "private" ? (
          /* Private AI Tab View */
          <div className="messages-list-wrapper" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="messages-list" style={{ flex: 1 }}>
              {sellerMessages.map((msg) => renderBubble(msg, "seller"))}
              {renderThinkingBubble(`${activeConvId}_seller_agent`)}
              <div ref={sellerEndRef} />
            </div>
            <form
              className="chat-input-form"
              onSubmit={(e) => handleSend(e, "seller", sellerInput, setSellerInput, "private")}
            >
              <input
                type="text"
                className="chat-input"
                placeholder="Hỏi trợ lý AI riêng tư..."
                value={sellerInput}
                onChange={(e) => setSellerInput(e.target.value)}
              />
              <button type="submit" className="btn-send">Gửi</button>
            </form>
          </div>
        ) : (
          /* Shared Bridge Tab View */
          <div className="messages-list-wrapper" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative" }}>
            {!isBridgeActive ? (
              /* Bridge is not active yet */
              <div className="bridge-placeholder" style={{ flex: 1 }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🔍</div>
                <h4>Chưa kết nối đối tác</h4>
                <p>AI Agent đang tìm kiếm và khớp nối xe phù hợp. Bạn hãy trao đổi nhu cầu chi tiết ở tab "Trợ lý AI" nhé!</p>
              </div>
            ) : !isSellerJoinedBridge ? (
              /* Bridge is active but not joined yet */
              <div className="bridge-placeholder" style={{ flex: 1 }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🤝</div>
                <h4>Đã kết nối người mua</h4>
                <p>Nhân viên AI đã tạo phòng chat thương lượng trực tiếp. Bấm nút bên dưới để bắt đầu đàm phán.</p>
                <button 
                  type="button" 
                  className="btn-join-bridge" 
                  onClick={() => onJoinBridge("seller")}
                  style={{ maxWidth: "200px", margin: "0 auto" }}
                >
                  Tham gia đàm phán
                </button>
              </div>
            ) : (
              /* Joined Bridge Chat */
              <>
                <div className="messages-list" style={{ flex: 1 }}>
                  {bridgeMessages.map((msg) => renderBubble(msg, "seller"))}
                  {renderThinkingBubble(`${activeConvId}_bridge`)}
                  <div ref={sellerEndRef} />
                </div>
                <form
                  className="chat-input-form"
                  onSubmit={(e) => handleSend(e, "seller", sellerInput, setSellerInput, "bridge")}
                >
                  <input
                    type="text"
                    className="chat-input"
                    placeholder="Nhắn tin trực tiếp cho người mua..."
                    value={sellerInput}
                    onChange={(e) => setSellerInput(e.target.value)}
                  />
                  <button type="submit" className="btn-send">Gửi</button>
                </form>
              </>
            )}
          </div>
        )}
      </div>

      {/* Column 3: Operator View */}
      {!isOperatorActive && !escalatedThreadId && (
        <div className="glass-card chat-column operator-column standby">
          <h2 className="panel-title title-operator">
            📞 Nhân viên (Operator) — 💤 Chờ yêu cầu
          </h2>
          <div className="operator-standby-content">
            <div className="pulse-icon">💤</div>
            <p>Đang chờ yêu cầu hỗ trợ từ AI Agent...</p>
          </div>
        </div>
      )}

      {!isOperatorActive && escalatedThreadId && (
        <div className="glass-card chat-column operator-column alert-active">
          <h2 className="panel-title title-operator" style={{ color: "#ef4444" }}>
            ⚠️ Nhân viên (Operator) — 🚨 Phát hiện rủi ro!
          </h2>
          <div className="operator-alert-content">
            <div className="warning-pulse">🚨</div>
            <h3>Phát hiện xung đột / rủi ro bảo mật</h3>
            <p>AI Agent đã tạm dừng hoạt động trên luồng này. Vui lòng can thiệp để hỗ trợ khách hàng ngay lập tức.</p>
            <button className="btn-join-operator" onClick={() => onJoinOperator(escalatedThreadId)}>
              Tham gia hỗ trợ ngay
            </button>
          </div>
        </div>
      )}

      {isOperatorActive && (
        <div className="glass-card chat-column operator-column active">
          <h2 className="panel-title title-operator" style={{ color: "#059669" }}>
            📞 Nhân viên (Operator) — 🛠️ Đang hỗ trợ {operatorThreadId === `${activeConvId}_bridge` ? "Kênh chung" : "Kênh riêng"}
          </h2>
          <div className="messages-list">
            {operatorMessages.map((msg) => renderBubble(msg, "operator"))}
            <div ref={operatorEndRef} />
          </div>
          <form
            className="chat-input-form"
            onSubmit={(e) => handleSend(e, "operator", operatorInput, setOperatorInput)}
          >
            <input
              type="text"
              className="chat-input"
              placeholder="Nhập tin nhắn hỗ trợ từ phía hệ thống..."
              value={operatorInput}
              onChange={(e) => setOperatorInput(e.target.value)}
            />
            <button type="submit" className="btn-send">Gửi</button>
          </form>
        </div>
      )}
    </div>
  );
}



