
    const API_BASE = "http://localhost:3000";
    let ALL_PRODUCTS = [];

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

    const tbody = document.getElementById("admin-products-tbody");
    const productsMessage = document.getElementById("products-message");
    const filterCategory = document.getElementById("filter-category");
    const filterName = document.getElementById("filter-name");
    const filterClear = document.getElementById("filter-clear");

    const DEFAULT_CATEGORIES = ["Rau xanh", "Củ quả", "Ngi c�c", "Sữa", "Khác"];

    function formatMoney(v, product) {
      const n = Number(v || 0);
      if (!n) return "Liên h�!";
      let unit = "kg";
      if (product && product.price_unit) {
        const parts = product.price_unit.split("/");
        unit = parts[parts.length - 1] || "kg";
      }
      return n.toLocaleString("vi-VN") + "�/" + unit;
    }

    function buildImageUrl(imageFile) {
      const file = imageFile || "vegetable.jpg";
      return API_BASE + "/img/" + file;
    }

    function normalizeText(s) {
      return String(s || "").trim().toLowerCase();
    }

    function populateCategoryOptions(products) {
      const cats = Array.from(
        new Set((products || []).map(p => (p.category || "").trim()).filter(Boolean))
      );

      const merged = Array.from(new Set([...(DEFAULT_CATEGORIES || []), ...(cats || [])]))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "vi"));

      filterCategory.innerHTML =
        `<option value="">Tất cả loại</option>` +
        merged.map(c => `<option value="${c}">${c}</option>`).join("");
    }

    function applyFilters() {
      const cat = (filterCategory.value || "").trim();
      const q = normalizeText(filterName.value);
      const filtered = (ALL_PRODUCTS || []).filter((p) => {
        const okCat = !cat || (p.category || "").trim() === cat;
        const okName = !q || normalizeText(p.name).includes(q);
        return okCat && okName;
      });
      renderProducts(filtered);
    }

    function renderProducts(products) {
      productsMessage.textContent = "";
      if (!products || products.length === 0) {
        tbody.innerHTML = "<tr><td colspan='5'>Không có sản phẩm phù hợp.</td></tr>";
        return;
      }

      tbody.innerHTML = products.map(p => {
        const imgSrc = buildImageUrl(p.image_url);
        return `
          <tr>
            <td>${p.id}</td>
            <td>
              <div class="product-name-cell">
                <img src="${imgSrc}" alt="${p.name}" class="thumb-img">
                <div>${p.name}</div>
              </div>
            </td>
            <td>${formatMoney(p.price, p)}</td>
            <td>${p.category || ""}</td>
            <td class="col-actions">
              <button class="edit-link-btn" type="button"
                onclick="window.location.href='admin-products-edit.html?id=${encodeURIComponent(p.id)}'">
                Sửa
              </button>
              <button class="delete-btn" type="button" onclick="deleteProduct(${p.id})">
                Xóa
              </button>
            </td>
          </tr>
        `;
      }).join("");
    }

    async function loadProducts() {
      productsMessage.textContent = "";
      tbody.innerHTML = "<tr><td colspan='5'>Đang tải dữ li�!u...</td></tr>";

      try {
        const res = await fetch(API_BASE + "/products");
        const data = await res.json();

        if (!data.ok) {
          tbody.innerHTML = "";
          productsMessage.textContent = "L�i khi lấy danh sách sản phẩm";
          return;
        }

        ALL_PRODUCTS = data.products || [];
        populateCategoryOptions(ALL_PRODUCTS);
        renderProducts(ALL_PRODUCTS);
      } catch (err) {
        console.error(err);
        tbody.innerHTML = "";
        productsMessage.textContent = "Không kết n�i �ược t�:i API";
      }
    }

    async function deleteProduct(id) {
      if (!confirm("Xóa sản phẩm này? Hành động không thể hoàn tác.")) return;
      if (!token) {
        alert("Thiếu token admin, hãy �Ēng nhập lại");
        return;
      }
      try {
        const res = await fetch(API_BASE + "/admin/products/" + encodeURIComponent(id), {
          method: "DELETE",
          headers: { Authorization: "Bearer " + token }
        });
        const data = await res.json();
        if (!data.ok) {
          alert(data.message || "Xóa thất bại");
          return;
        }
        ALL_PRODUCTS = ALL_PRODUCTS.filter(p => String(p.id) !== String(id));
        applyFilters();
      } catch (err) {
        console.error(err);
        alert("Không xóa �ược sản phẩm");
      }
    }

    document.getElementById("show-add-form-btn").onclick = function () {
      const f = document.getElementById("add-form");
      f.style.display = f.style.display === "none" ? "block" : "none";
    };

    document.getElementById("add-product-btn").onclick = async function () {
      const name = document.getElementById("new-name").value.trim();
      const price = parseInt(document.getElementById("new-price").value, 10);
      const category = document.getElementById("new-category").value.trim();
      const description = document.getElementById("new-description").value.trim();
      const calories = document.getElementById("new-calories").value.trim();
      const protein = document.getElementById("new-protein").value.trim();
      const fat = document.getElementById("new-fat").value.trim();
      const carbs = document.getElementById("new-carbs").value.trim();
      const sodium = document.getElementById("new-sodium").value.trim();
      const sugar = document.getElementById("new-sugar").value.trim();
      const saturatedFat = document.getElementById("new-saturated-fat").value.trim();
      const fiber = document.getElementById("new-fiber").value.trim();
      const cholesterol = document.getElementById("new-cholesterol").value.trim();
      const imageFile = document.getElementById("new-image-file").files[0];
      const msgEl = document.getElementById("add-message");
      msgEl.style.color = "#d00000";
      msgEl.textContent = "";

      if (!name || !price) {
        msgEl.textContent = "Tên và giá sản phẩm là bắt bu�"c";
        return;
      }

      if (!imageFile) {
        msgEl.textContent = "Vui lòng chọn ảnh JPG/PNG cho sản phẩm";
        return;
      }

      if (!token) {
        msgEl.textContent = "Thiếu token admin, hãy �Ēng nhập lại";
        return;
      }

      try {
        const fd = new FormData();
        fd.append("name", name);
        fd.append("price", String(price));
        fd.append("category", category);
        fd.append("description", description);
        fd.append("calories", calories);
        fd.append("protein", protein);
        fd.append("fat", fat);
        fd.append("carbs", carbs);
        fd.append("sodium", sodium);
        fd.append("sugar", sugar);
        fd.append("saturated_fat", saturatedFat);
        fd.append("fiber", fiber);
        fd.append("cholesterol", cholesterol);
        fd.append("image", imageFile);

        const res = await fetch(API_BASE + "/admin/products", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token
          },
          body: fd
        });

        const data = await res.json();

        if (!data.ok) {
          msgEl.textContent = data.message || "L�i khi thêm sản phẩm";
          return;
        }

        msgEl.style.color = "#2d6a4f";
        msgEl.textContent = "Thêm sản phẩm thành công";
        document.getElementById("new-name").value = "";
        document.getElementById("new-price").value = "";
        document.getElementById("new-category").value = "Khác";
        document.getElementById("new-description").value = "";
        document.getElementById("new-calories").value = "";
        document.getElementById("new-protein").value = "";
        document.getElementById("new-fat").value = "";
        document.getElementById("new-carbs").value = "";
        document.getElementById("new-sodium").value = "";
        document.getElementById("new-sugar").value = "";
        document.getElementById("new-saturated-fat").value = "";
        document.getElementById("new-fiber").value = "";
        document.getElementById("new-cholesterol").value = "";
        document.getElementById("new-image-file").value = "";
        const prev = document.getElementById("new-image-preview");
        prev.style.display = "none";
        prev.src = "";

        loadProducts();
      } catch (err) {
        console.error(err);
        msgEl.textContent = "Không kết n�i �ược t�:i API";
      }
    };

    // preview ảnh upload
    document.getElementById("new-image-file").addEventListener("change", function () {
      const f = this.files && this.files[0];
      const prev = document.getElementById("new-image-preview");
      if (!f) {
        prev.style.display = "none";
        prev.src = "";
        return;
      }
      prev.src = URL.createObjectURL(f);
      prev.style.display = "block";
    });

    // lọc theo tên / loại (frontend filter)
    let nameDebounce = null;
    filterCategory.addEventListener("change", applyFilters);
    filterName.addEventListener("input", function () {
      clearTimeout(nameDebounce);
      nameDebounce = setTimeout(applyFilters, 180);
    });
    filterClear.addEventListener("click", function () {
      filterCategory.value = "";
      filterName.value = "";
      applyFilters();
    });

    loadProducts();
  