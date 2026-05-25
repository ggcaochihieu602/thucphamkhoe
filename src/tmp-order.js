
    const API_BASE = "http://localhost:3000";

    function formatPrice(n, item) {
      const val = Number(n || 0);
      let unit = "kg";
      if (item && item.price_unit) {
        const parts = item.price_unit.split("/");
        unit = parts[parts.length - 1] || "kg";
      }
      return val.toLocaleString("vi-VN") + "�/" + unit;
    }

    function formatPricePlain(n) {
      return Number(n || 0).toLocaleString("vi-VN") + "�";
    }

    function buildImageUrl(imagePath) {
      if (!imagePath) return "img/placeholder.jpg";
      if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) return imagePath;
      if (imagePath.startsWith("/img/")) return API_BASE + imagePath;
      if (imagePath.startsWith("img/")) return API_BASE + "/" + imagePath;
      return API_BASE + "/img/" + imagePath;
    }

    function getOrderIdFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get("id");
    }

    function formatStatus(st) {
      const s = String(st || "").toLowerCase();
      if (s === "pending" || s === "processing") return "Đang xử lý";
      if (s === "cancelled_by_admin") return "Đã hủy";
      if (s === "cancelled" || s === "canceled") return "Đã hủy";
      if (s === "delivered") return "Đã giao";
      return st || "Đang xử lý";
    }

    async function loadOrder() {
      const emptyEl = document.getElementById("order-empty");
      const container = document.getElementById("order-container");

      const orderId = getOrderIdFromUrl();
      const token = localStorage.getItem("token") || "";
      let order = null;
      let items = null;

      // Æ°u tiÃªn láº¥y tá»« API náº¿u cÃ³ id
      if (orderId && token) {
        try {
          const res = await fetch(API_BASE + "/orders/" + encodeURIComponent(orderId), {
            headers: { "Authorization": "Bearer " + token }
          });
          const data = await res.json();
          if (data.ok && data.order) {
            order = data.order;
            items = data.items || [];
          }
        } catch (_) {}
      }

      // fallback demo localStorage náº¿u khÃ´ng cÃ³ API
      if (!order) {
        const raw = localStorage.getItem("lastOrder");
      if (!raw) {
        emptyEl.style.display = "block";
        container.style.display = "none";
        return;
      }
      try {
        order = JSON.parse(raw);
          items = order.items || [];
      } catch {
        emptyEl.style.display = "block";
        container.style.display = "none";
        return;
      }
      }

      container.style.display = "block";
      emptyEl.style.display = "none";

      const headerDiv = document.getElementById("order-header");
      const created = new Date(order.created_at || order.createdAt || Date.now());
      headerDiv.innerHTML = `
        <h2>Đơn hàng #${order.id || ""}</h2>
        <p><strong>Trạng thái:</strong> ${formatStatus(order.status)}</p>
        <p><strong>Ng�y ��t:</strong> ${created.toLocaleString("vi-VN")}</p>
      `;

      const tbody = document.getElementById("order-products");
      let total = 0;
      tbody.innerHTML = (items || []).map(item => {
        const qty = item.quantity || 0;
        const price = item.unit_price != null ? item.unit_price : item.price;
        const line = (Number(item.price || 0) * item.quantity) || 0;
        const realLine = (Number(price || 0) * Number(qty || 0)) || 0;
        total += realLine;
        const img = item.image ? item.image : buildImageUrl(item.image_url);
        return `
          <tr>
            <td><img src="${img}" alt="${item.name}" class="order-product-img"></td>
            <td>${item.name}</td>
            <td>${qty}</td>
            <td>${formatPrice(price, item)}</td>
            <td>${formatPricePlain(realLine)}</td>
          </tr>
        `;
      }).join("");
      document.getElementById("order-total").textContent =
        "T�"ng thanh toï¿½n: " + formatPrice(order.total_price || order.total || total);
    }

    (function() {
      const nav = document.querySelector("nav ul");
      if (!nav) return;
      const user = localStorage.getItem("user");
      const loginLi = Array.from(nav.children).find(li => li.textContent.includes("ÄÄ’ng nháº­p"));
      if (user && loginLi) {
        loginLi.innerHTML = '<a href="profile.html">H� s�</a>';
      } else if (!user && loginLi) {
        loginLi.innerHTML = '<a href="login.html">Đ�ng nhập</a>';
      }
    })();

    loadOrder();
  