import { useEffect } from "react";

export default function StateMonitor({ buyerConv, sellerConv, bridgeConv, activeConvId = "c1" }) {
  return (
    <div className="chat-panel">
      <div className="glass-card">
        <div style={{ background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.15)", padding: "10px 16px", borderRadius: "6px", marginBottom: "20px", fontSize: "0.88rem", color: "#059669" }}>
          <strong>📊 Decoupled State Monitor:</strong> Trạng thái của Người mua và Người bán được tách biệt độc lập trong giai đoạn khám phá. Khi kết nối thương lượng trực tiếp, các trạng thái được tự động trộn động (dynamic merge) vào phòng chat chung.
        </div>

        <h2 className="panel-title title-monitor" style={{ border: "none", padding: 0, marginBottom: "24px" }}>
          Giám sát trạng thái hội thoại (State Monitor)
        </h2>

        <div className="state-monitor-grid">
          {/* Column 1: Buyer State */}
          <div className="state-monitor-col">
            <h3 className="state-col-title title-buyer-state">🙋‍♂️ Trạng thái Người mua ({activeConvId}_buyer_agent)</h3>
            <div className="state-item">
              <span className="state-label">Giai đoạn (Stage)</span>
              <div className="lead-stage-badge buyer-badge">
                {buyerConv?.lead_stage || "DISCOVERY"}
              </div>
            </div>
            <div className="state-item">
              <span className="state-label">Tóm tắt (Summary)</span>
              <div className="rolling-summary-box buyer-box">
                {buyerConv?.rolling_summary || "Chưa có tóm tắt."}
              </div>
            </div>
            <div className="state-item">
              <span className="state-label">Dữ liệu trích xuất (JSON)</span>
              <pre className="state-value-box">
                {JSON.stringify(buyerConv?.structured_state || {}, null, 2)}
              </pre>
            </div>
          </div>

          {/* Column 2: Seller State */}
          <div className="state-monitor-col">
            <h3 className="state-col-title title-seller-state">🚗 Trạng thái Người bán ({activeConvId}_seller_agent)</h3>
            <div className="state-item">
              <span className="state-label">Giai đoạn (Stage)</span>
              <div className="lead-stage-badge seller-badge">
                {sellerConv?.lead_stage || "DISCOVERY"}
              </div>
            </div>
            <div className="state-item">
              <span className="state-label">Tóm tắt (Summary)</span>
              <div className="rolling-summary-box seller-box">
                {sellerConv?.rolling_summary || "Chưa có tóm tắt."}
              </div>
            </div>
            <div className="state-item">
              <span className="state-label">Dữ liệu trích xuất (JSON)</span>
              <pre className="state-value-box">
                {JSON.stringify(sellerConv?.structured_state || {}, null, 2)}
              </pre>
            </div>
          </div>

          {/* Column 3: Bridge State */}
          <div className="state-monitor-col">
            <h3 className="state-col-title title-bridge-state">👥 Trạng thái Kênh chung ({activeConvId}_bridge)</h3>
            <div className="state-item">
              <span className="state-label">Giai đoạn (Stage)</span>
              <div className="lead-stage-badge bridge-badge">
                {bridgeConv?.lead_stage || "OFFLINE / INACTIVE"}
              </div>
            </div>
            <div className="state-item">
              <span className="state-label">Tóm tắt (Summary)</span>
              <div className="rolling-summary-box bridge-box">
                {bridgeConv?.rolling_summary || "Chưa có tóm tắt."}
              </div>
            </div>
            <div className="state-item">
              <span className="state-label">Dữ liệu trích xuất (JSON)</span>
              <pre className="state-value-box">
                {JSON.stringify(bridgeConv?.structured_state || {}, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
