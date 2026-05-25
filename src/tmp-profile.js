
    const API_BASE = "http://localhost:3000";

    function translateRole(role) {
      if (role === 'admin') return 'Qu�n tr�9 vi�n';
      if (role === 'expert') return 'Chuyên gia';
      return 'Khách hàng';
    }

    function formatMoney(value, product) {
      const n = Number(value || 0);
      if (!n) return "Li�n h�!";
      let unit = "kg";
      if (product && product.price_unit) {
        const parts = product.price_unit.split("/");
        unit = parts[parts.length - 1] || "kg";
      }
      return n.toLocaleString('vi-VN') + "�/" + unit;
    }

    function formatStatus(st) {
      const s = String(st || "").toLowerCase();
      if (s === "pending" || s === "processing") return "Đang xử lý";
      if (s === "shipping") return "Đang vận chuy�n";
      if (s === "cancelled_by_admin") return "Đã hủy";
      if (s === "cancelled" || s === "canceled") return "Đã hủy";
      if (s === "delivered") return "Đã giao";
      return st || "Đang xử lý";
    }

    function formatDate(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString("vi-VN");
    }

    function buildImageUrl(imagePath) {
      if (!imagePath) return API_BASE + "/img/assets/hello.jpg";
      if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) return imagePath;
      if (imagePath.startsWith("/img/")) return API_BASE + imagePath;
      if (imagePath.startsWith("img/")) return API_BASE + "/" + imagePath;
      return API_BASE + "/img/" + imagePath;
    }

    function getStoredToken() {
      const raw = localStorage.getItem("token");
      if (!raw) return "";

      let token = String(raw).trim();
      if (token.startsWith("\"") && token.endsWith("\"")) {
        token = token.slice(1, -1).trim();
      }

      if (token && token !== raw) {
        localStorage.setItem("token", token);
      }

      return token;
    }

    function clearAuthAndRedirect(message) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      alert(message || "Phi�n �ng nh�p �� h�t h�n. Vui l�ng �ng nh�p l�i.");
      window.location.href = "login.html";
    }

    async function loadProfile() {
      const token = getStoredToken();
      if (!token) {
        alert("B�n c�n �ng nh�p �� xem h� s�.");
        window.location.href = "login.html";
        return;
      }

      // fallback: lï¿½y tï¿½ localStorage nï¿½u API lï¿½i
      let fallbackUser = {};
      try { fallbackUser = JSON.parse(localStorage.getItem("user") || "{}"); } catch {}

      try {
        const res = await fetch(API_BASE + "/me/profile", {
          headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        if (res.status === 401) {
          clearAuthAndRedirect(data.message || "Phi�n �ng nh�p �� h�t h�n. Vui l�ng �ng nh�p l�i.");
          return;
        }
        if (!data.ok || !data.profile) throw new Error(data.message || "Kh�ng t�i ���c h� s�");

        const p = data.profile;
        document.getElementById("profile-name").textContent = p.name || "Người dùng";
        document.getElementById("profile-email").textContent = p.email || "";
        document.getElementById("profile-role").textContent = translateRole(p.role);
        document.getElementById("profile-avatar").src = buildImageUrl(p.avatar_url);

        // sync lï¿½i localStorage.user ï¿½ï¿½ cï¿½c trang khï¿½c dï¿½ng
        localStorage.setItem("user", JSON.stringify({
          ...(fallbackUser || {}),
          id: p.id,
          name: p.name,
          email: p.email,
          role: p.role,
          avatar: p.avatar_url || "",
          phone: p.phone || "",
          address: p.address || "",
          age: p.age || null,
          gender: p.gender || "",
          height: p.height || null,
          weight: p.weight || null,
          activity_level: p.activity_level || "",
          health_conditions: p.health_conditions || [],
          diet_preferences: p.diet_preferences || []
        }));
      } catch (e) {
        document.getElementById("profile-name").textContent = fallbackUser.name || "Người dùng";
        document.getElementById("profile-email").textContent = fallbackUser.email || "";
        document.getElementById("profile-role").textContent = translateRole(fallbackUser.role);
        document.getElementById("profile-avatar").src = buildImageUrl(fallbackUser.avatar || "");
    }
    }

    async function loadOrdersFromApi() {
      const tbody = document.getElementById('order-history-body');
      const token = getStoredToken();
      if (!token) {
        tbody.innerHTML = '<tr><td colspan="6">Thi�u token. H�y �ng nh�p l�i.</td></tr>';
        return;
      }

      tbody.innerHTML = '<tr><td colspan="6">ang t�i ��n h�ng...</td></tr>';
      try {
        const res = await fetch(API_BASE + "/orders", {
          headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        if (res.status === 401) {
          clearAuthAndRedirect(data.message || "Phi�n �ng nh�p �� h�t h�n. Vui l�ng �ng nh�p l�i.");
          return;
        }
        if (!data.ok) {
          tbody.innerHTML = '<tr><td colspan="6">Kh�ng t�i ���c ��n h�ng.</td></tr>';
          return;
        }
        const orders = data.orders || [];
        if (orders.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6">Ch�a c� ��n h�ng n�o.</td></tr>';
        return;
      }

        // hiï¿½n thï¿½9 tï¿½i ï¿½a 8 ï¿½ï¿½n gï¿½n nhï¿½t + lï¿½y vï¿½i tï¿½n sï¿½n phï¿½m (khï¿½ng quï¿½ dï¿½i)
        const recent = orders.slice(0, 8);
        const details = await Promise.all(
          recent.map(async (o) => {
            try {
              const r = await fetch(API_BASE + "/orders/" + encodeURIComponent(o.id), {
                headers: { "Authorization": "Bearer " + token }
              });
              const j = await r.json();
              return { id: o.id, items: j.items || [], has_report: !!j.has_report };
            } catch (_) {
              return { id: o.id, items: [], has_report: false };
            }
          })
        );
        const itemsMap = {};
        const reportMap = {};
        details.forEach(d => {
          itemsMap[String(d.id)] = d.items || [];
          reportMap[String(d.id)] = !!d.has_report;
        });

        function buildItemsPreview(orderId) {
          const items = itemsMap[String(orderId)] || [];
          const names = items.map(it => it.name).filter(Boolean);
          if (names.length === 0) return "<i>�</i>";
          const top = names.slice(0, 3);
          const more = names.length > top.length ? ` +${names.length - top.length}` : "";
          return top.join(", ") + more;
        }

        function buildReportCell(orderId) {
          const reported = !!reportMap[String(orderId)];
          if (reported) {
            return `<span class="order-link disabled">Báo cáo</span>`;
          }
          return `<a href="javascript:void(0)" class="order-link" data-action="report" data-id="${orderId}">Báo cáo</a>`;
        }

        function buildReceiveCell(orderId, status) {
          const s = String(status || "").toLowerCase();
          // chï¿½0 hiï¿½!n "ï¿½ nhï¿½n hï¿½ng" khi ï¿½ang vï¿½n chuyï¿½n
          if (s !== "shipping") return "";
          return `<a href="javascript:void(0)" class="order-link" data-action="received" data-id="${orderId}">Đã nhận hàng</a>`;
        }

        tbody.innerHTML = recent.map(o => `
        <tr>
            <td><a href="order.html?id=${encodeURIComponent(o.id)}" class="order-link">#${o.id}</a></td>
            <td>${formatDate(o.created_at)}</td>
            <td>${buildItemsPreview(o.id)}</td>
            <td>${formatStatus(o.status)}</td>
            <td>${formatMoney(o.total_price)}</td>
            <td>
              <a href="order.html?id=${encodeURIComponent(o.id)}" class="order-link">Xem</a>
              &nbsp;|&nbsp;
              ${buildReportCell(o.id)}
              ${buildReceiveCell(o.id, o.status) ? "&nbsp;|&nbsp;" + buildReceiveCell(o.id, o.status) : ""}
            </td>
        </tr>
        `).join("");
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6">Kh�ng k�t n�i ���c t�:i API.</td></tr>';
      }
    }

    // Reporting modal
    const REPORT_ISSUES = [
      "Giao sai sản phẩm",
      "Thi�u s�n ph�m trong ��n",
      "S�n ph�m h�ng, d�p n�t, ch�y n��:c",
      "Sản phẩm hết hạn hoặc gần hết hạn",
      "Kh�i l��ng ho�c s� l��ng kh�ng �� nh� �� ��t",
      "Bao b� r�ch, b�n, kh�ng ��m b�o v�! sinh",
      "�n h�ng giao tr�& so v�:i th�i gian d� ki�n",
      "Shipper c� th�i ��" hoï¿½c hï¿½nh vi khï¿½ng phï¿½ hï¿½p",
      "Lï¿½i thanh toï¿½n, bï¿½9 trï¿½ tiï¿½n nhï¿½ng ï¿½ï¿½n khï¿½ng xï¿½c nhï¿½n",
      "ï¿½n hï¿½ng bï¿½9 hï¿½y mï¿½ khï¿½ng biï¿½t lï¿½ do",
      "LÃ½ do khÃ¡c"
    ];
    let REPORT_ORDER_ID = null;

    function openReportModal(orderId) {
      REPORT_ORDER_ID = orderId;
      document.getElementById("report-title").textContent = "Bï¿½o cï¿½o ï¿½ï¿½n hï¿½ng #" + orderId;
      document.getElementById("report-msg").textContent = "";
      const list = document.getElementById("issue-list");
      list.innerHTML = REPORT_ISSUES.map((t, idx) => `
        <label>
          <input type="radio" name="issue" value="${t}" ${idx === 0 ? "checked" : ""}>
          ${t}
        </label>
      `).join("");
      document.getElementById("issue-note").value = "";
      toggleNote();
      document.getElementById("report-modal").classList.add("open");
    }
    function closeReportModal() {
      document.getElementById("report-modal").classList.remove("open");
      REPORT_ORDER_ID = null;
    }
    function getSelectedIssue() {
      const el = document.querySelector('input[name="issue"]:checked');
      return el ? el.value : "";
    }
    function toggleNote() {
      const issue = getSelectedIssue();
      const noteEl = document.getElementById("issue-note");
      if (issue === "LÃ½ do khÃ¡c") noteEl.classList.add("show");
      else noteEl.classList.remove("show");
    }

    document.getElementById("report-close").onclick = closeReportModal;
    document.getElementById("report-cancel").onclick = closeReportModal;
    document.getElementById("report-modal").addEventListener("click", function (e) {
      if (e.target.id === "report-modal") closeReportModal();
    });
    document.getElementById("issue-list").addEventListener("change", toggleNote);

    document.getElementById("report-submit").onclick = async function () {
      const token = localStorage.getItem("token") || "";
      const msg = document.getElementById("report-msg");
      msg.style.color = "#d90429";
      msg.textContent = "";
      const issue = getSelectedIssue();
      const desc = document.getElementById("issue-note").value.trim();
      if (!issue) {
        msg.textContent = "Vui lÃ²ng chá»n 1 lÃ½ do.";
        return;
      }
      if (issue === "LÃ½ do khÃ¡c" && !desc) {
        msg.textContent = "Vui lÃ²ng nháº­p mÃ´ táº£ cho 'Lý do khác'.";
        return;
      }
      if (!REPORT_ORDER_ID) return;

      msg.style.color = "#555";
      msg.textContent = "Äang gá»­i bÃ¡o cÃ¡o...";
      try {
        const res = await fetch(API_BASE + "/orders/" + encodeURIComponent(REPORT_ORDER_ID) + "/report", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({ issue_type: issue, description: desc })
        });
        const data = await res.json();
        if (!data.ok) {
          msg.style.color = "#d90429";
          msg.textContent = data.message || "Gá»­i bÃ¡o cÃ¡o tháº¥t báº¡i";
          return;
        }
        msg.style.color = "#2d6a4f";
        msg.textContent = data.message || "ÄÃ£ gá»­i bÃ¡o cÃ¡o.";
        setTimeout(() => closeReportModal(), 600);
      } catch (e) {
        msg.style.color = "#d90429";
        msg.textContent = "Khï¿½ng kï¿½t nï¿½i ï¿½ï¿½ï¿½c tï¿½:i API.";
      }
    };

    document.addEventListener("click", function (e) {
      const a = e.target.closest('a[data-action="report"]');
      if (!a) return;
      const id = a.getAttribute("data-id");
      if (!id) return;
      openReportModal(id);
    });

    document.addEventListener("click", async function (e) {
      const a = e.target.closest('a[data-action="received"]');
      if (!a) return;
      const id = a.getAttribute("data-id");
      if (!id) return;
      const token = localStorage.getItem("token") || "";
      if (!token) return;
      const ok = confirm("Xï¿½c nhï¿½n bï¿½n ï¿½ï¿½ nhï¿½n hï¿½ng cho ï¿½ï¿½n #" + id + "?");
      if (!ok) return;
      try {
        const res = await fetch(API_BASE + "/orders/" + encodeURIComponent(id) + "/received", {
          method: "PUT",
          headers: { "Authorization": "Bearer " + token }
        });
        const data = await res.json();
        if (!data.ok) {
          alert(data.message || "Khï¿½ng cï¿½p nhï¿½t ï¿½ï¿½ï¿½c trï¿½ng thï¿½i");
          return;
        }
        await loadOrdersFromApi();
      } catch (_) {
        alert("Khï¿½ng kï¿½t nï¿½i ï¿½ï¿½ï¿½c tï¿½:i API.");
      }
    });

    document.getElementById('logout-link').addEventListener('click', function(e) {
      e.preventDefault();
      localStorage.removeItem('user');
      alert('B�n �� �ng xu�t.');
      window.location.href = 'login.html';
    });

    document.addEventListener('DOMContentLoaded', function() {
      loadProfile();
      loadOrdersFromApi();
    });
  