(function () {
  const API_BASE = "http://localhost:3000";
  const TRACK_ENDPOINT = API_BASE + "/track";

  const KEY_ANON = "tpk_anonymous_id";
  const KEY_SESSION = "tpk_session_id";
  const KEY_QUEUE = "tpk_event_queue";

  function safeJsonParse(s, fallback) {
    try {
      return JSON.parse(s);
    } catch (_) {
      return fallback;
    }
  }

  function randomId(prefix) {
    return (
      (prefix ? prefix + "_" : "") +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(16).slice(2) +
      "_" +
      Math.random().toString(16).slice(2)
    );
  }

  function getAnonymousId() {
    try {
      let id = localStorage.getItem(KEY_ANON);
      if (!id) {
        id = randomId("anon");
        localStorage.setItem(KEY_ANON, id);
      }
      return id;
    } catch (_) {
      return randomId("anon");
    }
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem(KEY_SESSION);
      if (!id) {
        id = randomId("sess");
        sessionStorage.setItem(KEY_SESSION, id);
      }
      return id;
    } catch (_) {
      return randomId("sess");
    }
  }

  function getUserId() {
    try {
      const u = safeJsonParse(localStorage.getItem("user") || "{}", {});
      const id = u && u.id != null ? u.id : null;
      if (id === null || id === undefined || id === "") return null;
      const n = Number(id);
      return Number.isFinite(n) ? n : null;
    } catch (_) {
      return null;
    }
  }

  function getUserIdFromToken() {
    try {
      const t = localStorage.getItem("token") || "";
      if (!t) return null;
      const parts = t.split(".");
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = atob(b64);
      const payload = safeJsonParse(json, {});
      const id = payload && payload.id != null ? payload.id : null;
      const n = Number(id);
      return Number.isFinite(n) ? n : null;
    } catch (_) {
      return null;
    }
  }

  function getResolvedUserId() {
    const id = getUserId();
    if (id != null) return id;
    return getUserIdFromToken();
  }

  function getQueue() {
    try {
      const q = safeJsonParse(localStorage.getItem(KEY_QUEUE) || "[]", []);
      return Array.isArray(q) ? q : [];
    } catch (_) {
      return [];
    }
  }

  function setQueue(queue) {
    try {
      localStorage.setItem(KEY_QUEUE, JSON.stringify(Array.isArray(queue) ? queue : []));
    } catch (_) {}
  }

  function enqueueEvent(payload) {
    const q = getQueue();
    q.push(payload);
    if (q.length > 100) q.splice(0, q.length - 100);
    setQueue(q);
  }

  function normalizeProperties(eventName, properties) {
    const p = properties && typeof properties === "object" ? { ...properties } : {};

    // normalize common key variants
    if (p.product_id == null && p.productId != null) p.product_id = p.productId;

    // infer product_id for important events when missing
    const ev = String(eventName || "").trim();
    if ((ev === "product_view" || ev === "product_view_long" || ev === "add_to_cart") && (p.product_id == null || p.product_id === "")) {
      try {
        if (window.location && window.location.pathname && window.location.pathname.endsWith("product-detail.html")) {
          const params = new URLSearchParams(window.location.search || "");
          const id = params.get("id");
          if (id) p.product_id = id;
        }
      } catch (_) {}
    }

    return p;
  }

  function buildPayload(eventName, properties) {
    const props = normalizeProperties(eventName, properties);
    return {
      event_name: String(eventName || "").trim() || "unknown",
      event_time: new Date().toISOString(),
      user_id: getResolvedUserId(),
      anonymous_id: getAnonymousId(),
      session_id: getSessionId(),
      page_url: window.location && window.location.href ? String(window.location.href) : "",
      referrer: document.referrer ? String(document.referrer) : "",
      properties: props
    };
  }

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;

  function sendNow(payload) {
    try {
      const body = JSON.stringify(payload);

      // Prefer fetch so we can detect non-2xx responses (otherwise events can silently disappear)
      if (originalFetch) {
        originalFetch(TRACK_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true
        })
          .then(function (res) {
            if (!res || !res.ok) enqueueEvent(payload);
          })
          .catch(function () {
            enqueueEvent(payload);
          });
        return true;
      }

      // Fallback: sendBeacon (cannot reliably observe server response)
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        const ok = navigator.sendBeacon(TRACK_ENDPOINT, blob);
        if (ok) return true;
      }

      enqueueEvent(payload);
      return false;
    } catch (_) {
      enqueueEvent(payload);
      return false;
    }
  }

  function flushQueue() {
    const q = getQueue();
    if (!q.length) return;

    setQueue([]);

    for (let i = 0; i < q.length; i++) {
      sendNow(q[i]);
    }
  }

  function track(eventName, properties) {
    const payload = buildPayload(eventName, properties);
    return sendNow(payload);
  }

  // expose global
  window.trackEvent = track;

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      fn();
      return;
    }
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  // auto page view
  onReady(function () {
    flushQueue();
    track("page_view", {
      title: document.title || "",
      path: window.location && window.location.pathname ? window.location.pathname : "",
      search: window.location && window.location.search ? window.location.search : ""
    });

    // articles list view
    if (window.location && window.location.pathname && window.location.pathname.endsWith("articles.html")) {
      track("article_list_view", {});
    }

    // article detail view
    if (window.location && window.location.pathname && window.location.pathname.endsWith("article-detail.html")) {
      const params = new URLSearchParams(window.location.search || "");
      const id = params.get("id");
      if (id) track("article_view", { article_id: id });
    }

    // products list view
    if (window.location && window.location.pathname && window.location.pathname.endsWith("products.html")) {
      track("products_list_view", {});
    }

    // product detail view
    if (window.location && window.location.pathname && window.location.pathname.endsWith("product-detail.html")) {
      const params = new URLSearchParams(window.location.search || "");
      const id = params.get("id");
      if (id) track("product_view", { product_id: id });
    }

    // checkout view
    if (window.location && window.location.pathname && window.location.pathname.endsWith("checkout.html")) {
      track("checkout_view", {});
    }

    // profile view
    if (window.location && window.location.pathname && window.location.pathname.endsWith("profile.html")) {
      track("profile_view", {});
    }

    // order view
    if (window.location && window.location.pathname && window.location.pathname.endsWith("order.html")) {
      const params = new URLSearchParams(window.location.search || "");
      const id = params.get("id");
      if (id) track("order_view", { order_id: id });
    }
  });

  // click tracking (lightweight + important actions)
  document.addEventListener(
    "click",
    function (e) {
      const articleRow = e.target.closest(".article-row");
      if (articleRow) {
        const articleId = articleRow.getAttribute("data-id") || "";
        track("article_click", { article_id: articleId });
      }

      const productCardClick = e.target.closest(".product-card");
      if (productCardClick && !e.target.closest(".add-cart-btn")) {
        const pid = productCardClick.dataset ? productCardClick.dataset.id : null;
        if (pid) {
          track("product_card_click", { product_id: pid });
        }
      }

      const a = e.target.closest("a");
      if (a && a.getAttribute) {
        const href = a.getAttribute("href") || "";
        const text = (a.textContent || "").trim().slice(0, 120);
        if (href && href !== "#") {
          track("link_click", { href, text });
        }
      }

      const catBtn = e.target.closest("button[data-category]");
      if (catBtn) {
        const category = catBtn.getAttribute("data-category") || "";
        track("filter_category", { category });
      }

      const addBtn = e.target.closest(".add-cart-btn");
      if (addBtn) {
        const card = addBtn.closest(".product-card");
        const qtyInput = card ? card.querySelector(".quantity-input") : null;
        const quantity = qtyInput ? Number(qtyInput.value || 1) : 1;
        let productId = card && card.dataset ? card.dataset.id : null;
        if (!productId) {
          const attrId = addBtn.getAttribute("data-product-id") || "";
          if (attrId) productId = attrId;
        }
        if (!productId) {
          try {
            if (window.location && window.location.pathname && window.location.pathname.endsWith("product-detail.html")) {
              const params = new URLSearchParams(window.location.search || "");
              productId = params.get("id");
            }
          } catch (_) {}
        }

        const name = card && card.dataset ? card.dataset.name : null;
        const price = card && card.dataset ? card.dataset.price : null;
        track("add_to_cart", {
          product_id: productId,
          product_name: name,
          price: price,
          quantity: Number.isFinite(quantity) ? quantity : 1
        });
      }

      const cartAction = e.target.closest("[data-action]");
      if (cartAction) {
        const action = cartAction.getAttribute("data-action") || "";
        if (action === "plus" || action === "minus") {
          track("update_cart_quantity", { action });
        } else if (action === "remove") {
          track("remove_from_cart", {});
        } else if (action === "use-cart") {
          const cartId = cartAction.getAttribute("data-cart-id") || "";
          track("switch_active_cart", { cart_id: cartId });
        } else if (action === "checkout") {
          const cartId = cartAction.getAttribute("data-cart-id") || "";
          track("checkout_started", { cart_id: cartId });
        }
      }

      const analyzeBtn = e.target.closest("#btn-analyze");
      if (analyzeBtn) {
        track("checkout_ai_analyze_click", {});
      }

      const placeBtn = e.target.closest("#btn-place-order");
      if (placeBtn) {
        track("checkout_place_order_click", {});
      }

      const logoutLink = e.target.closest("#logout-link");
      if (logoutLink) {
        track("logout", {});
      }

      const reportSubmit = e.target.closest("#report-submit");
      if (reportSubmit) {
        track("order_report_submit_click", {});
      }
    },
    true
  );

  // search tracking
  let searchDebounce = null;
  document.addEventListener(
    "input",
    function (e) {
      const el = e.target;
      if (!el || !el.id) return;

      if (el.id === "product-search") {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(function () {
          const q = String(el.value || "").trim();
          track("search_products", { query: q });
        }, 250);
      }
    },
    true
  );

  // form submit tracking
  document.addEventListener(
    "submit",
    function (e) {
      const form = e.target;
      if (!form || !form.id) return;

      if (form.id === "login-form") {
        track("login_submit", {});
      } else if (form.id === "register-form") {
        track("register_submit", {});
      } else if (form.id === "form") {
        // profile-edit form uses id="form"
        track("profile_update_submit", {});
      } else if (form.id === "report-form") {
        track("order_report_submit", {});
      }
    },
    true
  );

  // fetch interception: detect important API calls and emit higher-quality events
  if (originalFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url ? input.url : "");
      const method = String((init && init.method) || "GET").toUpperCase();

      return originalFetch(input, init).then(function (res) {
        try {
          const u = String(url || "");

          // Avoid self-tracking noise
          if (u.indexOf("/track") !== -1) return res;

          const clone = res.clone();
          const isJson = (clone.headers.get("content-type") || "").includes("application/json");

          if (isJson && method === "POST" && u.indexOf("/orders") !== -1 && /\/orders(\?|$)/.test(u)) {
            clone
              .json()
              .then(function (data) {
                if (data && data.ok) {
                  track("order_placed", {
                    order_id: data.order_id,
                    total_price: data.total_price
                  });
                }
              })
              .catch(function () {});
          }

          if (isJson && method === "POST" && u.indexOf("/auth/login") !== -1) {
            clone
              .json()
              .then(function (data) {
                if (data && data.ok && data.user) {
                  track("login_success", { role: data.user.role || "" });
                } else {
                  track("login_failed", {});
                }
              })
              .catch(function () {});
          }

          if (isJson && method === "POST" && u.indexOf("/auth/register") !== -1) {
            clone
              .json()
              .then(function (data) {
                track(data && data.ok ? "register_success" : "register_failed", {});
              })
              .catch(function () {});
          }

          if (isJson && method === "PUT" && /\/me\/profile(\?|$)/.test(u)) {
            clone
              .json()
              .then(function (data) {
                track(data && data.ok ? "profile_update_success" : "profile_update_failed", {});
              })
              .catch(function () {});
          }

          if (isJson && method === "POST" && /\/orders\/.+\/report(\?|$)/.test(u)) {
            clone
              .json()
              .then(function (data) {
                track(data && data.ok ? "order_report_success" : "order_report_failed", {});
              })
              .catch(function () {});
          }

          if (isJson && method === "PUT" && /\/orders\/.+\/received(\?|$)/.test(u)) {
            clone
              .json()
              .then(function (data) {
                track(data && data.ok ? "order_received_success" : "order_received_failed", {});
              })
              .catch(function () {});
          }
        } catch (_) {}

        return res;
      });
    };
  }
})();
