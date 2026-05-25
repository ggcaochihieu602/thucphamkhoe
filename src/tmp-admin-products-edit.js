
    const API_BASE = "http://localhost:3000";
    const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
    const token = localStorage.getItem("token") || "";

    if (currentUser.role !== "admin") {
      window.location.href = "login.html";
    }

    document.getElementById("logout-btn").onclick = function () {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      window.location.href = "index.html";
    };

    document.getElementById("back-btn").onclick = function () {
      window.location.href = "admin-products.html";
    };

    function getIdFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get("id");
    }

    function buildImageUrl(imagePath) {
      if (!imagePath) return "img/vegetable.jpg";
      if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) return imagePath;
      if (imagePath.startsWith("/img/")) return API_BASE + imagePath;
      if (imagePath.startsWith("img/")) return API_BASE + "/" + imagePath;
      // nếu user ch�0 nhập "spinach.jpg" thì map vào folder products
      const p = imagePath.includes("/") ? imagePath : ("products/" + imagePath);
      return API_BASE + "/img/" + p;
    }

    function setMsg(id, text, ok) {
      const el = document.getElementById(id);
      el.textContent = text || "";
      el.classList.toggle("ok", !!ok);
    }

    function parseNumberOrNull(v) {
      const s = String(v || "").trim();
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }

    async function loadProduct(id) {
      const res = await fetch(API_BASE + "/products/" + encodeURIComponent(id));
      const data = await res.json();
      if (!data.ok || !data.product) throw new Error(data.message || "Không tải �ược sản phẩm");
      return data.product;
    }

    async function saveProduct(id, payload, imageFile) {
      if (!token) throw new Error("Thiếu token admin, hãy �Ēng nhập lại");
      const fd = new FormData();
      Object.keys(payload || {}).forEach((k) => {
        const v = payload[k];
        fd.append(k, v === null || v === undefined ? "" : String(v));
      });
      if (imageFile) {
        fd.append("image", imageFile);
      }
      const res = await fetch(API_BASE + "/admin/products/" + encodeURIComponent(id), {
        method: "PUT",
        headers: {
          "Authorization": "Bearer " + token
        },
        body: fd
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Lưu thất bại");
      return data;
    }

    function fillForm(p) {
      document.getElementById("name").value = p.name || "";
      document.getElementById("price").value = p.price != null ? p.price : "";
      const catEl = document.getElementById("category");
      const catValue = String(p.category || "").trim() || "Khác";
      const hasOption = Array.from(catEl.options || []).some(o => o.value === catValue);
      if (!hasOption) {
        const opt = document.createElement("option");
        opt.value = catValue;
        opt.textContent = catValue;
        catEl.appendChild(opt);
      }
      catEl.value = catValue;
      document.getElementById("image_url").value = p.image_url || "";
      document.getElementById("description").value = p.description || "";

      document.getElementById("calories").value = p.calories != null ? p.calories : "";
      document.getElementById("protein").value = p.protein != null ? p.protein : "";
      document.getElementById("fat").value = p.fat != null ? p.fat : "";
      document.getElementById("carbs").value = p.carbs != null ? p.carbs : "";
      document.getElementById("sodium").value = p.sodium != null ? p.sodium : "";
      document.getElementById("sugar").value = p.sugar != null ? p.sugar : "";
      document.getElementById("saturated_fat").value = p.saturated_fat != null ? p.saturated_fat : "";
      document.getElementById("fiber").value = p.fiber != null ? p.fiber : "";
      document.getElementById("cholesterol").value = p.cholesterol != null ? p.cholesterol : "";

      const imgSrc = buildImageUrl(p.image_url);
      document.getElementById("thumb-img").src = imgSrc;
      document.getElementById("thumb-name").textContent = p.name || "";
      document.getElementById("thumb-id").textContent = p.id;
      document.getElementById("thumb-file").textContent = p.image_url || "(tr�ng)";
      document.getElementById("thumb-box").style.display = "flex";
    }

    (async function init() {
      const id = getIdFromUrl();
      if (!id) {
        setMsg("page-msg", "Thiếu tham s� id. Hãy quay lại danh sách và bấm Sửa.", false);
        return;
      }
      setMsg("page-msg", "Đang tải sản phẩm...", false);
      try {
        const p = await loadProduct(id);
        fillForm(p);
        document.getElementById("edit-form").style.display = "block";
        setMsg("page-msg", "", false);
      } catch (e) {
        setMsg("page-msg", e.message || "Không tải �ược sản phẩm", false);
      }
    })();

    document.getElementById("image_url").addEventListener("input", function () {
      const img = document.getElementById("thumb-img");
      if (!img) return;
      const v = this.value.trim();
      img.src = buildImageUrl(v);
      document.getElementById("thumb-file").textContent = v || "(tr�ng)";
    });

    document.getElementById("image_file").addEventListener("change", function () {
      const f = this.files && this.files[0];
      const img = document.getElementById("thumb-img");
      if (!img) return;
      if (!f) return;
      img.src = URL.createObjectURL(f);
      document.getElementById("thumb-file").textContent = "Ảnh m�:i: " + f.name;
    });

    document.getElementById("name").addEventListener("input", function () {
      const el = document.getElementById("thumb-name");
      if (el) el.textContent = this.value || "";
    });

    document.getElementById("edit-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const id = getIdFromUrl();
      if (!id) return;

      setMsg("form-msg", "", false);
      const payload = {
        name: document.getElementById("name").value.trim(),
        price: parseNumberOrNull(document.getElementById("price").value),
        category: document.getElementById("category").value.trim(),
        image_url: document.getElementById("image_url").value.trim(),
        description: document.getElementById("description").value.trim(),
        calories: parseNumberOrNull(document.getElementById("calories").value),
        protein: parseNumberOrNull(document.getElementById("protein").value),
        fat: parseNumberOrNull(document.getElementById("fat").value),
        carbs: parseNumberOrNull(document.getElementById("carbs").value),
        sodium: parseNumberOrNull(document.getElementById("sodium").value),
        sugar: parseNumberOrNull(document.getElementById("sugar").value),
        saturated_fat: parseNumberOrNull(document.getElementById("saturated_fat").value),
        fiber: parseNumberOrNull(document.getElementById("fiber").value),
        cholesterol: parseNumberOrNull(document.getElementById("cholesterol").value)
      };

      // chuẩn hóa nếu user ch�0 nhập "spinach.jpg" => "products/spinach.jpg"
      if (payload.image_url && !payload.image_url.includes("/") &&
          !payload.image_url.startsWith("http://") &&
          !payload.image_url.startsWith("https://")) {
        payload.image_url = "products/" + payload.image_url;
      }

      if (!payload.name || payload.price === null) {
        setMsg("form-msg", "Tên và giá sản phẩm là bắt bu�"c.", false);
        return;
      }

      setMsg("form-msg", "Đang lưu...", false);
      try {
        const imageFile = document.getElementById("image_file").files[0];
        await saveProduct(id, payload, imageFile);
        setMsg("form-msg", "Lưu thay ��"i thành công.", true);
      } catch (err) {
        setMsg("form-msg", err.message || "Lưu thất bại", false);
      }
    });
  