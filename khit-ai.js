(function () {
    if (window.khitAiAssistant) return;

    const storageKey = "khit_ai_ui_state";
    const defaultOpenVersion = 2;
    const defaultState = { x: null, y: null, panelX: null, panelY: null, open: false, minimized: false };
    const copy = {
        en: {
            label: "KHIT AI",
            subtitle: "Your KHIT Family Assistant",
            initial: "Hi! I'm KHIT AI. I can help you with information available through the KHIT Family Portal.",
            placeholder: "Ask KHIT AI...",
            send: "Send",
            minimize: "Minimize",
            close: "Close",
            results: "Check my results",
            attendance: "My attendance",
            fees: "My fees",
            notifications: "My notifications",
            events: "College events",
            announcements: "Announcements",
            materials: "Study materials",
            documents: "Documents",
            unavailable: "This feature will be connected to KHIT AI services.",
            working: "Checking authorized portal information...",
            unavailableData: "That information is currently unavailable in the KHIT Family Portal.",
            session: "Please sign in again to use KHIT AI.",
            language: "Language"
        },
        te: {
            label: "KHIT AI",
            subtitle: "మీ KHIT ఫ్యామిలీ సహాయకుడు",
            initial: "హాయ్! నేను KHIT AI. KHIT ఫ్యామిలీ పోర్టల్‌లో అందుబాటులో ఉన్న సమాచారంలో మీకు సహాయం చేయగలను.",
            placeholder: "KHIT AIని అడగండి...",
            send: "పంపండి",
            minimize: "చిన్నదిగా చూపండి",
            close: "మూసివేయండి",
            results: "నా ఫలితాలు చూడండి",
            attendance: "నా హాజరు",
            fees: "నా ఫీజులు",
            notifications: "నా నోటిఫికేషన్లు",
            events: "కళాశాల ఈవెంట్లు",
            announcements: "ప్రకటనలు",
            materials: "అధ్యయన సామగ్రి",
            documents: "పత్రాలు",
            unavailable: "ఈ ఫీచర్ KHIT AI సేవలకు అనుసంధానించబడుతుంది.",
            working: "అనుమతించబడిన పోర్టల్ సమాచారాన్ని పరిశీలిస్తోంది...",
            unavailableData: "ఆ సమాచారం ప్రస్తుతం KHIT ఫ్యామిలీ పోర్టల్‌లో అందుబాటులో లేదు.",
            session: "KHIT AI ఉపయోగించడానికి మళ్లీ సైన్ ఇన్ చేయండి.",
            language: "భాష"
        }
    };

    function readState() {
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
            const state = { ...defaultState, ...stored };
            if (stored.defaultOpenVersion !== defaultOpenVersion) {
                state.open = false;
                state.minimized = false;
                state.defaultOpenVersion = defaultOpenVersion;
                saveState(state);
            }
            return state;
        } catch (_error) {
            return { ...defaultState };
        }
    }

    function saveState(state) {
        localStorage.setItem(storageKey, JSON.stringify({ x: state.x, y: state.y, panelX: state.panelX, panelY: state.panelY, open: state.open, minimized: state.minimized, defaultOpenVersion }));
    }

    function currentLanguage() {
        return window.khitLanguage?.get?.() === "te" ? "te" : "en";
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), Math.max(min, max));
    }

    function injectStyles() {
        if (document.getElementById("khit-ai-styles")) return;
        const style = document.createElement("style");
        style.id = "khit-ai-styles";
        style.textContent = `
            .khit-ai-root { --ai-maroon:#5e1029; --ai-rose:#8f1738; --ai-gold:#c6a15b; --ai-ink:#30252a; position:fixed; z-index:2147483000; inset:0; pointer-events:none; font-family:Arial, sans-serif; }
            .khit-ai-launcher, .khit-ai-panel { pointer-events:auto; }
            .khit-ai-launcher { position:fixed !important; right:24px !important; bottom:24px !important; left:auto; top:auto; width:58px !important; height:58px !important; min-width:58px !important; min-height:58px !important; max-width:58px !important; max-height:58px !important; padding:0 !important; border:2px solid rgba(255,255,255,.8) !important; border-radius:50% !important; background:linear-gradient(145deg,var(--ai-maroon),var(--ai-rose)) !important; color:#fff !important; box-shadow:0 14px 30px rgba(94,16,41,.3); cursor:grab; display:grid !important; place-items:center; touch-action:none; transition:transform .18s ease, box-shadow .18s ease; }
            .khit-ai-launcher:hover, .khit-ai-launcher:focus-visible { transform:translateY(-3px) scale(1.03); box-shadow:0 18px 36px rgba(94,16,41,.38); outline:none; }
            .khit-ai-launcher:active { cursor:grabbing; }
            .khit-ai-mark { width:34px; height:34px; border:2px solid #fff; border-radius:10px; display:grid; place-items:center; font-size:13px; font-weight:800; letter-spacing:-.04em; position:relative; }
            .khit-ai-mark::after { content:""; position:absolute; width:6px; height:6px; right:-4px; top:-4px; border-radius:50%; background:var(--ai-gold); box-shadow:0 0 0 2px var(--ai-maroon); }
            .khit-ai-panel { position:fixed; right:24px; bottom:98px; width:370px; min-width:300px; height:520px; min-height:360px; max-width:calc(100vw - 32px); max-height:calc(100vh - 32px); display:flex; flex-direction:column; overflow:hidden; resize:both; border:1px solid rgba(255,255,255,.25); border-radius:18px; background:linear-gradient(160deg,#35121f 0%,#1d1720 55%,#111827 100%); color:#fff; box-shadow:0 24px 70px rgba(17,24,39,.35); opacity:0; transform:translateY(14px) scale(.98); pointer-events:none; transition:opacity .2s ease, transform .2s ease; }
            .khit-ai-panel.is-open { opacity:1; transform:translateY(0) scale(1); pointer-events:auto; }
            .khit-ai-panel.is-minimized { display:none; }
            .khit-ai-header { display:flex; align-items:center; gap:10px; padding:14px 14px 12px; background:linear-gradient(135deg,rgba(94,16,41,.98),rgba(143,23,56,.96)) !important; border-bottom:1px solid rgba(255,255,255,.16); color:#fff !important; cursor:move; user-select:none; touch-action:none; }
            .khit-ai-header .khit-ai-mark { flex:0 0 auto; width:30px; height:30px; border-radius:9px; font-size:11px; color:#fff !important; border-color:#fff !important; opacity:1 !important; }
            .khit-ai-heading { min-width:0; flex:1; }
            .khit-ai-heading strong { display:block; color:#fff !important; font-size:15px; }
            .khit-ai-heading span { display:block; margin-top:3px; color:#f8e8ed !important; font-size:11px; }
            .khit-ai-icon-btn { width:30px; height:30px; padding:0; border:1px solid rgba(255,255,255,.24); border-radius:8px; background:rgba(255,255,255,.08); color:#fff; cursor:pointer; font-size:16px; line-height:1; }
            .khit-ai-icon-btn:hover, .khit-ai-icon-btn:focus-visible { background:rgba(255,255,255,.18); outline:2px solid var(--ai-gold); outline-offset:2px; }
            .khit-ai-body { display:flex; flex:1; min-height:0; flex-direction:column; }
            .khit-ai-messages { flex:1; overflow:auto; padding:18px 16px 10px; }
            .khit-ai-message { max-width:88%; margin:0 0 12px; padding:11px 12px; border-radius:12px 12px 12px 3px; background:rgba(255,255,255,.1); color:#fff; font-size:13px; line-height:1.5; }
            .khit-ai-message.user { margin-left:auto; border-radius:12px 12px 3px 12px; background:#f7e8eb; color:var(--ai-ink); }
            .khit-ai-quick { display:flex; gap:7px; flex-wrap:wrap; padding:0 16px 12px; }
            .khit-ai-quick button { border:1px solid rgba(255,255,255,.24); border-radius:999px; padding:7px 9px; background:rgba(255,255,255,.08); color:#fff; cursor:pointer; font-size:11px; }
            .khit-ai-quick button:hover, .khit-ai-quick button:focus-visible { background:rgba(198,161,91,.24); outline:2px solid var(--ai-gold); outline-offset:2px; }
            .khit-ai-form { display:flex; gap:8px; padding:12px; border-top:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.16); }
            .khit-ai-form input { min-width:0; flex:1; border:1px solid rgba(255,255,255,.22); border-radius:9px; padding:10px; background:rgba(255,255,255,.1); color:#fff; font:13px Arial,sans-serif; }
            .khit-ai-form input::placeholder { color:#e8cbd4; }
            .khit-ai-form input:focus { outline:2px solid var(--ai-gold); outline-offset:1px; }
            .khit-ai-form button { border:0; border-radius:9px; padding:0 13px; background:var(--ai-gold); color:#301522; cursor:pointer; font-weight:800; }
            .khit-ai-form button:focus-visible { outline:2px solid #fff; outline-offset:2px; }
            @media (max-width:600px) { .khit-ai-launcher { right:16px; bottom:16px; width:58px; height:58px; } .khit-ai-panel { inset:12px; width:auto; height:auto; min-width:0; min-height:0; max-width:none; max-height:none; border-radius:16px; } .khit-ai-panel.is-minimized { inset:auto 12px 86px 12px; height:70px; } }
        `;
        document.head.appendChild(style);
    }

    function init() {
        if (document.querySelector("[data-khit-ai-root]")) return;
        injectStyles();
        const state = readState();
        const root = document.createElement("div");
        root.className = "khit-ai-root";
        root.dataset.khitAiRoot = "true";
        root.innerHTML = `<button class="khit-ai-launcher" type="button" aria-label="KHIT AI" title="KHIT AI"><span class="khit-ai-mark">AI</span></button><section class="khit-ai-panel" role="dialog" aria-modal="false" aria-label="KHIT AI" aria-hidden="true"><header class="khit-ai-header"><span class="khit-ai-mark">AI</span><div class="khit-ai-heading"><strong data-ai="label"></strong><span data-ai="subtitle"></span></div><button class="khit-ai-icon-btn" type="button" data-ai-action="minimize" aria-label="Minimize" title="Minimize">−</button><button class="khit-ai-icon-btn" type="button" data-ai-action="close" aria-label="Close" title="Close">×</button></header><div class="khit-ai-body"><div class="khit-ai-messages" aria-live="polite"></div><div class="khit-ai-quick"><button type="button" data-ai-quick="results"></button><button type="button" data-ai-quick="attendance"></button><button type="button" data-ai-quick="fees"></button><button type="button" data-ai-quick="notifications"></button><button type="button" data-ai-quick="events"></button><button type="button" data-ai-quick="announcements"></button><button type="button" data-ai-quick="materials"></button><button type="button" data-ai-quick="documents"></button></div><form class="khit-ai-form"><input type="text" autocomplete="off" data-ai-input><button type="submit" data-ai-send></button></form></div></section>`;
        document.body.appendChild(root);

        const launcher = root.querySelector(".khit-ai-launcher");
        const panel = root.querySelector(".khit-ai-panel");
        const messages = root.querySelector(".khit-ai-messages");
        const header = root.querySelector(".khit-ai-header");
        const input = root.querySelector("[data-ai-input]");
        let drag = null;
        let panelDrag = null;
        let hasInitialMessage = false;

        function savePosition(element, x, y, positionKey = "launcher") {
            if (positionKey === "panel") {
                state.panelX = x;
                state.panelY = y;
            } else {
                state.x = x;
                state.y = y;
            }
            saveState(state);
            element.style.left = `${x}px`;
            element.style.top = `${y}px`;
            element.style.right = "auto";
            element.style.bottom = "auto";
        }

        function positionLauncher() {
            if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
                savePosition(launcher, clamp(state.x, 0, window.innerWidth - launcher.offsetWidth), clamp(state.y, 0, window.innerHeight - launcher.offsetHeight));
            }
        }

        function positionPanel() {
            if (Number.isFinite(state.panelX) && Number.isFinite(state.panelY)) {
                const rect = panel.getBoundingClientRect();
                savePosition(panel, clamp(state.panelX, 0, window.innerWidth - rect.width), clamp(state.panelY, 0, window.innerHeight - rect.height), "panel");
            }
        }

        function addMessage(text, userMessage = false) {
            const item = document.createElement("div");
            item.className = `khit-ai-message${userMessage ? " user" : ""}`;
            item.textContent = text;
            messages.appendChild(item);
            messages.scrollTop = messages.scrollHeight;
            return item;
        }

        function getSessionToken() {
            return localStorage.getItem("khit_parent_token") || localStorage.getItem("khit_token");
        }

        async function askKhitAi(question) {
            const token = getSessionToken();
            if (!token) {
                addMessage(text("session"));
                return;
            }
            const body = { message: question };
            if (localStorage.getItem("khit_parent_token")) {
                const selectedChild = localStorage.getItem("khit_parent_selected_student_id");
                if (selectedChild) body.student_id = selectedChild;
            }
            const loadingMessage = addMessage(text("working"));
            try {
                const apiBase = window.KHIT_API_BASE || window.location.origin;
                const response = await fetch(`${apiBase}/api/khit-ai/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify(body)
                });
                const result = await response.json();
                if (response.status === 401) {
                    loadingMessage.remove();
                    addMessage(text("session"));
                    return;
                }
                if (!response.ok || result.success === false) {
                    loadingMessage.remove();
                    addMessage(result.message || text("unavailableData"));
                    return;
                }
                loadingMessage.remove();
                addMessage(result.message || text("unavailableData"));
            } catch (_error) {
                loadingMessage.remove();
                addMessage(text("unavailableData"));
            }
        }

        function text(key) { return copy[currentLanguage()][key]; }

        function renderText() {
            root.querySelector('[data-ai="label"]').textContent = text("label");
            root.querySelector('[data-ai="subtitle"]').textContent = text("subtitle");
            root.querySelector('[data-ai-action="minimize"]').title = text("minimize");
            root.querySelector('[data-ai-action="minimize"]').setAttribute("aria-label", text("minimize"));
            root.querySelector('[data-ai-action="close"]').title = text("close");
            root.querySelector('[data-ai-action="close"]').setAttribute("aria-label", text("close"));
            root.querySelector('[data-ai-send]').textContent = text("send");
            input.placeholder = text("placeholder");
            Object.keys({ results: 1, attendance: 1, fees: 1, notifications: 1, events: 1, announcements: 1, materials: 1, documents: 1 }).forEach(key => { root.querySelector(`[data-ai-quick="${key}"]`).textContent = text(key); });
            if (!hasInitialMessage) { messages.textContent = ""; addMessage(text("initial")); hasInitialMessage = true; }
        }

        function setOpen(open) {
            state.open = open;
            panel.classList.toggle("is-open", open);
            panel.setAttribute("aria-hidden", String(!open));
            if (open) { state.minimized = false; panel.classList.remove("is-minimized"); input.focus(); }
            saveState(state);
        }

        function setMinimized(minimized) {
            state.minimized = minimized;
            panel.classList.toggle("is-minimized", minimized);
            saveState(state);
        }

        function startDrag(event, element, target, positionKey = "launcher") {
            if (target !== launcher && event.target.closest("button, input")) return;
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            target = target || element;
            const origin = { x: event.clientX || event.touches?.[0]?.clientX, y: event.clientY || event.touches?.[0]?.clientY, left: rect.left, top: rect.top };
            let moved = false;
            const move = moveEvent => {
                const point = moveEvent.touches?.[0] || moveEvent;
                const x = clamp(origin.left + point.clientX - origin.x, 0, window.innerWidth - rect.width);
                const y = clamp(origin.top + point.clientY - origin.y, 0, window.innerHeight - rect.height);
                moved = moved || Math.abs(point.clientX - origin.x) > 3 || Math.abs(point.clientY - origin.y) > 3;
                savePosition(target, x, y, positionKey);
            };
            const end = () => { drag = null; panelDrag = null; if (target === launcher) launcher.dataset.suppressClick = moved ? "true" : "false"; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
            if (target === launcher) drag = true; else panelDrag = true;
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", end, { once: true });
        }

        launcher.addEventListener("pointerdown", event => startDrag(event, launcher, launcher, "launcher"));
        launcher.addEventListener("click", () => { if (launcher.dataset.suppressClick === "true") { launcher.dataset.suppressClick = "false"; return; } setOpen(true); });
        header.addEventListener("pointerdown", event => startDrag(event, panel, panel, "panel"));
        root.querySelector('[data-ai-action="close"]').addEventListener("click", () => setOpen(false));
        root.querySelector('[data-ai-action="minimize"]').addEventListener("click", () => setMinimized(!state.minimized));
        root.querySelectorAll("[data-ai-quick]").forEach(button => button.addEventListener("click", () => { const question = text(button.dataset.aiQuick); addMessage(question, true); askKhitAi(question); }));
        root.querySelector(".khit-ai-form").addEventListener("submit", event => { event.preventDefault(); const value = input.value.trim(); if (!value) return; addMessage(value, true); input.value = ""; askKhitAi(value); });
        launcher.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(true); } });
        window.addEventListener("resize", positionLauncher);
        window.addEventListener("khit-language-change", renderText);
        renderText();
        if (state.open) setOpen(true); else setOpen(false);
        if (state.minimized) setMinimized(true);
        requestAnimationFrame(positionLauncher);
        requestAnimationFrame(positionPanel);
        window.khitAiAssistant = { open: () => setOpen(true), close: () => setOpen(false), minimize: setMinimized };
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
