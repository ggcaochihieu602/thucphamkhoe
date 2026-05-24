
    const API_BASE = "http://localhost:3000";

    (function ensureExpert() {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user.role !== 'expert') {
        alert('Bạn cần �Ēng nhập tài khoản chuyên gia �Ồ truy cập trang này.');
        window.location.href = 'login.html';
      }
    })();

    function setMsg(id, text, ok) {
      const el = document.getElementById(id);
      el.textContent = text || "";
      el.classList.toggle("ok", !!ok);
    }

    document.getElementById("btn-back").onclick = function () {
      window.location.href = "expert-articles.html";
    };

    document.getElementById("image").addEventListener("change", function () {
      const f = this.files && this.files[0];
      if (!f) return;
      document.getElementById("thumb").src = URL.createObjectURL(f);
    });

    document.getElementById("create-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      setMsg("form-msg", "", false);
      const btn = document.getElementById("btn-save");
      const title = document.getElementById("title").value.trim();
      const content = document.getElementById("content").value.trim();
      if (!title || !content) {
        setMsg("form-msg", "Vui lòng nhập tiêu �ề và n�"i dung.", false);
        return;
      }
      if (title.length > 200) {
        const m = "Tiêu �ề quá dài (t�i �a 200 ký tự).";
        setMsg("form-msg", m, false);
        alert(m);
        return;
      }
      const token = localStorage.getItem("token") || "";
      if (!token) {
        setMsg("form-msg", "Thiếu token. Hãy �Ēng nhập lại.", false);
        return;
      }
      const fd = new FormData();
      fd.append("title", title);
      fd.append("content", content);
      const file = document.getElementById("image").files[0];
      if (file) fd.append("image", file);
      try {
        btn.disabled = true;
        btn.textContent = "Đang �Ēng...";
        const res = await fetch(API_BASE + "/expert/articles", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token },
          body: fd
        });
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        const data = ct.includes("application/json") ? await res.json() : null;
        if (!res.ok || !data || !data.ok) {
          const m = (data && data.message) ? data.message : ("ĐĒng bài thất bại (" + res.status + ")");
          setMsg("form-msg", m, false);
          alert(m);
          return;
        }
        const okMsg = data.message || "ĐĒng bài thành công.";
        setMsg("form-msg", okMsg, true);
        alert(okMsg);
        setTimeout(() => { window.location.href = "expert-articles.html"; }, 600);
      } catch (err) {
        console.error(err);
        const m = "Không thỒ �Ēng bài lúc này.";
        setMsg("form-msg", m, false);
        alert(m);
      } finally {
        btn.disabled = false;
        btn.textContent = "ĐĒng bài";
      }
    });
  