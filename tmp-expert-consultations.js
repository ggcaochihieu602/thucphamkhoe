
    const API_BASE = "http://localhost:3000";
    let consultations = [];
    let currentConsultationId = null;

    function getToken() { return localStorage.getItem("token") || ""; }
    function getHeaders() {
      return {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken()
      };
    }

    (function ensureExpert() {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.role !== "expert") {
        alert("Bạn cần �Ēng nhập tài khoản chuyên gia �Ồ truy cập trang này.");
        window.location.href = "login.html";
      }
    })();

    function formatDateTime(value) {
      if (!value) return "";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString("vi-VN");
    }

    function formatTopic(topic) {
      const map = {
        giam_can: "Giảm cân",
        tang_can: "TĒng cân",
        an_uong_lanh_manh: "�n u�ng lành mạnh",
        benh_ly: "B�!nh lý",
        san_pham_cu_the: "Sản phẩm cụ thỒ",
        gio_hang: "Giỏ hàng hi�!n tại",
        khac: "Khác"
      };
      return map[String(topic || "")] || "";
    }

    function statusClass(status) {
      return status === "answered" || status === "closed" ? "answered" : "";
    }

    async function loadConsultations() {
      const status = document.getElementById("statusFilter").value;
      const qs = status ? ("?status=" + encodeURIComponent(status)) : "";
      const res = await fetch(API_BASE + "/expert/consultations" + qs, {
        headers: { "Authorization": "Bearer " + getToken() }
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Không tải �ược danh sách tư vấn");
      consultations = data.consultations || [];
      renderConsultationList();
      if (!currentConsultationId && consultations.length) {
        currentConsultationId = consultations[0].id;
      }
      if (currentConsultationId) {
        const exists = consultations.some((item) => String(item.id) === String(currentConsultationId));
        if (exists) await openConsultation(currentConsultationId);
      }
    }

    function renderConsultationList() {
      const list = document.getElementById("consultationList");
      if (!consultations.length) {
        list.innerHTML = '<div class="empty" style="padding:24px 16px;">Chưa có câu hỏi nào cần xử lý.</div>';
        return;
      }
      list.innerHTML = consultations.map((item) => `
        <div class="consultation-item ${String(item.id) === String(currentConsultationId) ? "active" : ""}" data-id="${item.id}">
          <div class="consultation-top">
            <div class="consultation-user">${item.user_name || "Người dùng"}</div>
            <div class="consultation-status ${statusClass(item.status)}">${item.status}</div>
          </div>
          <div class="consultation-meta">${formatTopic(item.topic) || "Không chọn chủ �ề"} ⬢ ${item.user_email || ""}</div>
          <div class="consultation-preview">${item.latest_message_text || "Chưa có nội dung"}</div>
          <div class="consultation-preview" style="margin-top:6px;font-size:0.82rem;">${formatDateTime(item.latest_message_at || item.created_at)}</div>
        </div>
      `).join("");
    }

    function renderUserContext(profile) {
      const container = document.getElementById("userContext");
      if (!profile) {
        container.innerHTML = "<p>Người dùng không �ính kèm thông tin sức khỏe.</p>";
        return;
      }
      container.innerHTML = `
        <p><b>${profile.name || "Người dùng"}</b></p>
        <p>Email: ${profile.email || "Chưa có"}</p>
        <p>Tu�"i / Gi�:i tính: ${profile.age || "?"} / ${profile.gender || "?"}</p>
        <p>Chiều cao / Cân nặng: ${profile.height || "?"} cm / ${profile.weight || "?"} kg</p>
        <p>Mức vận ��"ng: ${profile.activity_level || "Chưa có"}</p>
        <p>B�!nh lý: ${(profile.health_conditions || []).join(", ") || "Không có"}</p>
        <p>�n u�ng: ${(profile.diet_preferences || []).join(", ") || "Không có"}</p>
      `;
    }

    function renderProductContext(product) {
      const container = document.getElementById("productContext");
      if (!product) {
        container.innerHTML = "<p>Không có sản phẩm �ược �ính kèm.</p>";
        return;
      }
      container.innerHTML = `
        <p><b>${product.name || "Sản phẩm"}</b></p>
        <p>Loại: ${product.category || "Khác"}</p>
        <p>food_role: ${product.food_role || "Chưa có"}</p>
        <p>Calories / Protein / Fat / Carbs: ${product.calories || 0} / ${product.protein || 0} / ${product.fat || 0} / ${product.carbs || 0}</p>
      `;
    }

    function renderCartContext(cartSnapshot) {
      const container = document.getElementById("cartContext");
      if (!Array.isArray(cartSnapshot) || !cartSnapshot.length) {
        container.innerHTML = "<p>Không có giỏ hàng �ính kèm.</p>";
        return;
      }
      container.innerHTML = cartSnapshot.slice(0, 6).map((item) => `<p>${item.name || "Sản phẩm"} x ${item.quantity || 1}</p>`).join("") +
        (cartSnapshot.length > 6 ? `<p>+ ${cartSnapshot.length - 6} món khác</p>` : "");
    }

    function renderMessages(messages) {
      const el = document.getElementById("detailMessages");
      if (!messages.length) {
        el.innerHTML = '<div class="empty">Chưa có tin nhắn.</div>';
        return;
      }
      el.innerHTML = messages.map((message) => `
        <div class="message ${message.sender_type === "expert" ? "expert" : "user"}">
          <div class="message-meta">${message.sender_name || (message.sender_type === "expert" ? "Chuyên gia" : "Người dùng")} ⬢ ${formatDateTime(message.created_at)}</div>
          ${Array.isArray(message.quick_flags) && message.quick_flags.length ? `<div class="message-flags">${message.quick_flags.map((flag) => `<span class="message-flag">${flag.replace(/_/g, " ")}</span>`).join("")}</div>` : ""}
          <div>${String(message.message || "").replace(/\n/g, "<br>")}</div>
        </div>
      `).join("");
      el.scrollTop = el.scrollHeight;
    }

    async function openConsultation(id) {
      currentConsultationId = id;
      renderConsultationList();
      const res = await fetch(API_BASE + "/expert/consultations/" + encodeURIComponent(id), {
        headers: { "Authorization": "Bearer " + getToken() }
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Không tải được chi tiết tư vấn");
      const item = data.consultation;
      document.getElementById("detailHeading").textContent = item.user_name || "Người dùng";
      document.getElementById("detailMeta").textContent = (formatTopic(item.topic) || "Không chọn chủ �ề") + " ⬢ " + (item.user_email || "") + " ⬢ " + formatDateTime(item.created_at);
      document.getElementById("detailChips").innerHTML = [
        `<span class="chip">Trạng thái: ${item.status}</span>`,
        item.expert_name ? `<span class="chip">Chuyên gia: ${item.expert_name}</span>` : "",
        item.attached_product_snapshot ? `<span class="chip">Có sản phẩm �ính kèm</span>` : "",
        Array.isArray(item.cart_snapshot) && item.cart_snapshot.length ? `<span class="chip">Có giỏ hàng �ính kèm</span>` : ""
      ].filter(Boolean).join("");
      document.getElementById("statusSelect").value = item.status || "in_progress";
      renderUserContext(item.profile_snapshot);
      renderProductContext(item.attached_product_snapshot);
      renderCartContext(item.cart_snapshot);
      renderMessages(data.messages || []);
    }

    function getQuickFlags() {
      return Array.from(document.querySelectorAll('.quick-flags input:checked')).map((input) => input.value);
    }

    async function sendReply() {
      if (!currentConsultationId) throw new Error("Hãy chọn m�"t yêu cầu tư vấn trư�:c");
      const message = document.getElementById("replyInput").value.trim();
      if (!message) throw new Error("Vui lòng nhập nội dung phản hồi");
      const status = document.getElementById("statusSelect").value;
      const quick_flags = getQuickFlags();

      const res = await fetch(API_BASE + "/expert/consultations/" + encodeURIComponent(currentConsultationId) + "/reply", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ message, status, quick_flags })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Không gửi �ược phản h�i");
      document.getElementById("replyInput").value = "";
      document.querySelectorAll('.quick-flags input:checked').forEach((input) => { input.checked = false; });
      document.getElementById("replyMsg").textContent = data.message || "Đã gửi phản h�i.";
      await loadConsultations();
      await openConsultation(currentConsultationId);
    }

    async function updateStatusOnly() {
      if (!currentConsultationId) throw new Error("Hãy chọn m�"t yêu cầu tư vấn trư�:c");
      const status = document.getElementById("statusSelect").value;
      const res = await fetch(API_BASE + "/expert/consultations/" + encodeURIComponent(currentConsultationId) + "/status", {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Không cập nhật �ược trạng thái");
      document.getElementById("replyMsg").textContent = data.message || "Đã cập nhật trạng thái.";
      await loadConsultations();
      await openConsultation(currentConsultationId);
    }

    document.getElementById("consultationList").addEventListener("click", async function (e) {
      const item = e.target.closest(".consultation-item");
      if (!item) return;
      try { await openConsultation(item.getAttribute("data-id")); } catch (error) { document.getElementById("replyMsg").textContent = error.message || "Không tải �ược yêu cầu tư vấn"; }
    });

    document.getElementById("statusFilter").addEventListener("change", async function () {
      try { await loadConsultations(); } catch (error) { document.getElementById("replyMsg").textContent = error.message || "Không tải �ược danh sách"; }
    });

    document.getElementById("sendReplyBtn").addEventListener("click", async function () {
      try { await sendReply(); } catch (error) { document.getElementById("replyMsg").textContent = error.message || "Không gửi �ược phản h�i"; }
    });

    document.getElementById("updateStatusBtn").addEventListener("click", async function () {
      try { await updateStatusOnly(); } catch (error) { document.getElementById("replyMsg").textContent = error.message || "Không cập nhật �ược trạng thái"; }
    });

    document.addEventListener("DOMContentLoaded", async function () {
      try { await loadConsultations(); } catch (error) { document.getElementById("replyMsg").textContent = error.message || "Không tải �ược dữ li�!u tư vấn"; }
    });
  