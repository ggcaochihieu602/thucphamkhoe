
    const API_BASE = "http://localhost:3000";

    function getIdFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get("id");
    }

    function buildImageUrl(imagePath) {
      if (!imagePath) return API_BASE + "/img/assets/hello.jpg";
      if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) return imagePath;
      if (imagePath.startsWith("/img/")) return API_BASE + imagePath;
      if (imagePath.startsWith("img/")) return API_BASE + "/" + imagePath;
      return API_BASE + "/img/" + imagePath;
    }

    function setMsg(id, text, ok) {
      const el = document.getElementById(id);
      el.textContent = text || "";
      el.classList.toggle("ok", !!ok);
    }

    async function fetchArticle(id) {
      const token = localStorage.getItem("token") || "";
      if (!token) throw new Error("Thiếu token. Hãy �Ēng nhập lại.");
      const res = await fetch(API_BASE + "/expert/articles/" + encodeURIComponent(id), {
        headers: { "Authorization": "Bearer " + token }
      });
      const data = await res.json();
      if (!data.ok || !data.article) throw new Error(data.message || "Không tải �ược bài viết");
      return data.article;
    }

    async function saveArticle(id, formData) {
      const token = localStorage.getItem("token") || "";
      if (!token) throw new Error("Thiếu token. Hãy �Ēng nhập lại.");
      const res = await fetch(API_BASE + "/expert/articles/" + encodeURIComponent(id), {
        method: "PUT",
        headers: { "Authorization": "Bearer " + token },
        body: formData
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Lưu thất bại");
      return data;
    }

    document.getElementById("btn-back").onclick = function () {
      window.location.href = "expert-articles.html";
    };

    document.getElementById("image").addEventListener("change", function () {
      const f = this.files && this.files[0];
      if (!f) return;
      document.getElementById("thumb").src = URL.createObjectURL(f);
    });

    (async function init() {
      const articleId = getIdFromUrl();
      if (!articleId) {
        // Náº¿u thiáº¿u id, chuyá»ƒn sang trang táº¡o bÃ i má»›i
        window.location.href = "expert-article-upload.html";
        return;
      }
      setMsg("page-msg", "Đang tải...", false);
      try {
        const a = await fetchArticle(articleId);
        document.getElementById("title").value = a.title || "";
        document.getElementById("content").value = a.content || "";
        document.getElementById("thumb").src = buildImageUrl(a.image_url);
        document.getElementById("edit-form").style.display = "block";
        setMsg("page-msg", "", false);
      } catch (e) {
        setMsg("page-msg", e.message || "Không tải �ược bài viết", false);
      }
    })();

    document.getElementById("edit-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      setMsg("form-msg", "", false);
      const id = getIdFromUrl();
      if (!id) return;
      const title = document.getElementById("title").value.trim();
      const content = document.getElementById("content").value.trim();
      if (!title || !content) {
        setMsg("form-msg", "Vui lòng nhập tiêu �ề và n�"i dung.", false);
        return;
      }
      const fd = new FormData();
      fd.append("title", title);
      fd.append("content", content);
      const file = document.getElementById("image").files[0];
      if (file) fd.append("image", file);
      try {
        await saveArticle(id, fd);
        setMsg("form-msg", "Đã lưu bài viết.", true);
        setTimeout(() => { window.location.href = "expert-articles.html"; }, 600);
      } catch (err) {
        setMsg("form-msg", err.message || "Lưu thất bại", false);
      }
    });
  