const StoreUI = (() => {
    const api = window.KHIT_API_BASE || window.location.origin;
    const token = localStorage.getItem("khit_token");

    function escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        }[character]));
    }

    function formatType(value) {
        return String(value || "Other").replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase());
    }

    function formatDate(value) {
        if (!value) return "-";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }

    function statusBadge(value) {
        const normalized = String(value || "PENDING").toLowerCase().replaceAll("_", "-");
        const label = String(value || "PENDING").replaceAll("_", " ");
        return `<span class="store-badge ${escape(normalized)}">${escape(label)}</span>`;
    }

    function showToast(message, type = "success") {
        const toast = document.getElementById("storeToast");
        if (!toast) return;
        toast.textContent = message;
        toast.className = `store-toast show ${type}`;
        window.clearTimeout(showToast.timeout);
        showToast.timeout = window.setTimeout(() => { toast.className = "store-toast"; }, 3600);
    }

    function setStatus(element, message, type = "") {
        if (!element) return;
        element.className = `store-status ${type ? `store-${type}` : "store-muted"}`;
        element.textContent = message;
    }

    async function request(path, options = {}) {
        if (!token) {
            window.location.href = "login.html";
            throw new Error("Session expired");
        }
        const response = await fetch(`${api}${path}`, {
            ...options,
            headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
        });
        let result = null;
        try { result = await response.json(); } catch (_error) { result = null; }
        if (response.status === 401) {
            localStorage.removeItem("khit_token");
            localStorage.removeItem("khit_user");
            localStorage.removeItem("khit_student");
            window.location.href = "login.html";
            throw new Error("Session expired");
        }
        if (!response.ok) {
            const error = new Error(result?.message || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function queryString(values) {
        const params = new URLSearchParams();
        Object.entries(values).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== "") params.set(key, value);
        });
        return params.toString();
    }

    function statusMessage(error) {
        if (error?.status === 403) return "You don't have permission to perform this action.";
        if (error?.status === 404) return "The requested Store record was not found.";
        if (error?.status === 409) return error.message || "The material was already collected or stock changed.";
        if (error?.status === 422) return error.message || "Please check the submitted values.";
        return error?.message || "Something went wrong. Please try again.";
    }

    function logout(destination = "login.html") {
        ["khit_token", "khit_user", "khit_student", "khit_faculty"].forEach(key => localStorage.removeItem(key));
        window.location.href = destination;
    }

    return { api, token, escape, formatType, formatDate, statusBadge, showToast, setStatus, request, queryString, statusMessage, logout };
})();
