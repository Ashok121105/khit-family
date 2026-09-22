(function () {
    const translations = {
        "KHIT Family": "కెహెచ్ఐటి ఫ్యామిలీ",
        "Home": "హోమ్",
        "Dashboard": "డ్యాష్‌బోర్డ్",
        "Back to Dashboard": "డ్యాష్‌బోర్డ్‌కు తిరిగి వెళ్ళండి",
        "Login": "లాగిన్",
        "Student Login": "విద్యార్థి లాగిన్",
        "Student": "విద్యార్థి",
        "Faculty": "ఫ్యాకల్టీ",
        "Parent": "తల్లిదండ్రులు",
        "Register": "నమోదు",
        "Open Student Login": "విద్యార్థి లాగిన్ తెరవండి",
        "Open Faculty Login": "ఫ్యాకల్టీ లాగిన్ తెరవండి",
        "Open Parent Login": "తల్లిదండ్రుల లాగిన్ తెరవండి",
        "Register Now": "ఇప్పుడే నమోదు చేయండి",
        "Your College Your Campus Your Digital Family": "మీ కళాశాల  మీ క్యాంపస్  మీ డిజిటల్ కుటుంబం",
        "Access your academic, attendance, fees, and profile dashboard.": "మీ విద్యా సమాచారం, హాజరు, ఫీజులు మరియు ప్రొఫైల్ డ్యాష్‌బోర్డ్‌ను చూడండి.",
        "Review classes, attendance, notifications, and academic activity.": "తరగతులు, హాజరు, నోటిఫికేషన్లు మరియు విద్యా కార్యకలాపాలను సమీక్షించండి.",
        "Track your childs progress, fees, and academic updates.": "మీ పిల్లల పురోగతి, ఫీజులు మరియు విద్యా నవీకరణలను తెలుసుకోండి.",
        "Create a new student account and complete your profile setup.": "కొత్త విద్యార్థి ఖాతాను సృష్టించి మీ ప్రొఫైల్‌ను పూర్తి చేయండి.",
        "Public access is limited to Student, Parent, and Faculty portals. Admin access remains restricted to authorized accounts only.": "పబ్లిక్ ప్రాప్యత విద్యార్థి, తల్లిదండ్రులు మరియు ఫ్యాకల్టీ పోర్టల్స్‌కు మాత్రమే పరిమితం. అడ్మిన్ ప్రాప్యత అధీకృత ఖాతాలకు మాత్రమే ఉంటుంది.",
        "Prototype status": "ప్రోటోటైప్ స్థితి",
        "Demo-ready portal: core flows are in place": "డెమోకు సిద్ధమైన పోర్టల్: ప్రధాన విధులు అందుబాటులో ఉన్నాయి",
        "View demo creds": "డెమో వివరాలు చూడండి",
        "Student Registration": "విద్యార్థి నమోదు",
        "Create your KHIT Family student account": "మీ KHIT ఫ్యామిలీ విద్యార్థి ఖాతాను సృష్టించండి",
        "Important:": "ముఖ్యమైనది:",
        "Enter your college-assigned Roll Number. The portal will use it as your student identifier.": "కళాశాల కేటాయించిన రోల్ నంబర్‌ను నమోదు చేయండి. పోర్టల్ దాన్ని మీ విద్యార్థి గుర్తింపుగా ఉపయోగిస్తుంది.",
        "Prototype completion progress": "ప్రోటోటైప్ పూర్తి స్థాయి",
        "KHIT Family All Rights Reserved": "KHIT ఫ్యామిలీ అన్ని హక్కులు ప్రత్యేకించబడ్డాయి",
        "Account Details": "ఖాతా వివరాలు",
        "Personal Details": "వ్యక్తిగత వివరాలు",
        "Academic Details": "విద్యా వివరాలు",
        "Parent / Guardian Details": "తల్లిదండ్రులు / సంరక్షకుల వివరాలు",
        "Address Details": "చిరునామా వివరాలు",
        "Social & Professional Links (Optional)": "సామాజిక మరియు వృత్తిపరమైన లింకులు (ఐచ్ఛికం)",
        "(Optional)": "(ఐచ్ఛికం)",
        "Optional": "ఐచ్ఛికం",
        "Username": "వినియోగదారు పేరు",
        "Password": "పాస్‌వర్డ్",
        "Full Name": "పూర్తి పేరు",
        "Date of Birth": "పుట్టిన తేదీ",
        "Gender": "లింగం",
        "Mobile Number": "మొబైల్ నంబర్",
        "College Email": "కళాశాల ఈమెయిల్",
        "Roll Number": "రోల్ నంబర్",
        "Department / Branch": "విభాగం / బ్రాంచ్",
        "Current Year": "ప్రస్తుత సంవత్సరం",
        "Section": "సెక్షన్",
        "Academic Year": "విద్యా సంవత్సరం",
        "Fee Category": "ఫీజు వర్గం",
        "Parent / Guardian Name": "తల్లిదండ్రులు / సంరక్షకుల పేరు",
        "Parent / Guardian Mobile": "తల్లిదండ్రులు / సంరక్షకుల మొబైల్",
        "Relationship": "సంబంధం",
        "Parent Email": "తల్లిదండ్రుల ఈమెయిల్",
        "Address": "చిరునామా",
        "City / Town": "నగరం / పట్టణం",
        "District": "జిల్లా",
        "State": "రాష్ట్రం",
        "PIN Code": "పిన్ కోడ్",
        "Create Student Account": "విద్యార్థి ఖాతా సృష్టించండి",
        "Already have an account?": "ఇప్పటికే ఖాతా ఉందా?",
        "Admin Access": "అడ్మిన్ ప్రాప్యత",
        "Admin access": "అడ్మిన్ ప్రాప్యత",
        "Andhra Pradesh": "ఆంధ్రప్రదేశ్",
        "Social & Professional Links": "సామాజిక మరియు వృత్తిపరమైన లింకులు",
        "Create username": "వినియోగదారు పేరును నమోదు చేయండి",
        "Create password": "పాస్‌వర్డ్‌ను నమోదు చేయండి",
        "Enter full name": "పూర్తి పేరు నమోదు చేయండి",
        "Enter mobile number": "మొబైల్ నంబర్ నమోదు చేయండి",
        "College-assigned Roll Number": "కళాశాల కేటాయించిన రోల్ నంబర్",
        "Example: A": "ఉదాహరణ: A",
        "Example: 2026-27": "ఉదాహరణ: 2026-27",
        "Enter parent name": "తల్లిదండ్రుల పేరు నమోదు చేయండి",
        "Enter parent mobile": "తల్లిదండ్రుల మొబైల్ నమోదు చేయండి",
        "Optional": "ఐచ్ఛికం",
        "House / Door No., Street / Village": "ఇంటి / తలుపు నంబర్, వీధి / గ్రామం",
        "Other professional link": "ఇతర వృత్తిపరమైన లింక్",
        "Select Gender": "లింగాన్ని ఎంచుకోండి",
        "Male": "పురుషుడు",
        "Female": "స్త్రీ",
        "Other": "ఇతరం",
        "Select Department": "విభాగాన్ని ఎంచుకోండి",
        "Electronics & Communication Engineering": "ఎలక్ట్రానిక్స్ మరియు కమ్యూనికేషన్ ఇంజినీరింగ్",
        "Computer Science & Engineering": "కంప్యూటర్ సైన్స్ మరియు ఇంజినీరింగ్",
        "Electrical & Electronics Engineering": "ఎలక్ట్రికల్ మరియు ఎలక్ట్రానిక్స్ ఇంజినీరింగ్",
        "Mechanical Engineering": "మెకానికల్ ఇంజినీరింగ్",
        "Civil Engineering": "సివిల్ ఇంజినీరింగ్",
        "Select Year": "సంవత్సరాన్ని ఎంచుకోండి",
        "1st Year": "1వ సంవత్సరం",
        "2nd Year": "2వ సంవత్సరం",
        "3rd Year": "3వ సంవత్సరం",
        "4th Year": "4వ సంవత్సరం",
        "Select Fee Category": "ఫీజు వర్గాన్ని ఎంచుకోండి",
        "Management": "మేనేజ్‌మెంట్",
        "Fee Reimbursement": "ఫీజు రీయింబర్స్‌మెంట్",
        "Guardian": "సంరక్షకుడు",
        "Father": "తండ్రి",
        "Mother": "తల్లి",
        "Faculty Login": "ఫ్యాకల్టీ లాగిన్",
        "Management Login": "మేనేజ్‌మెంట్ లాగిన్",
        "Parent Login": "తల్లిదండ్రుల లాగిన్",
        "Logout": "లాగ్‌అవుట్",
        "Profile": "ప్రొఫైల్",
        "My Profile": "నా ప్రొఫైల్",
        "Students": "విద్యార్థులు",
        "Faculty": "ఫ్యాకల్టీ",
        "Parents": "తల్లిదండ్రులు",
        "Attendance": "హాజరు",
        "Fees": "ఫీజులు",
        "Results": "ఫలితాలు",
        "Exams & Results": "పరీక్షలు మరియు ఫలితాలు",
        "Assignments": "అసైన్‌మెంట్లు",
        "Study Materials": "అధ్యయన సామగ్రి",
        "Notifications": "నోటిఫికేషన్లు",
        "Documents": "పత్రాలు",
        "Leave": "సెలవు",
        "Leave Requests": "సెలవు అభ్యర్థనలు",
        "Bus": "బస్సు",
        "Bus Management": "బస్సు నిర్వహణ",
        "Transport": "రవాణా",
        "Reports": "నివేదికలు",
        "Settings": "సెట్టింగులు",
        "Search": "వెతకండి",
        "Language": "భాష",
        "Please wait...": "దయచేసి వేచి ఉండండి...",
        "No records available": "రికార్డులు అందుబాటులో లేవు",
        "No attendance records available yet.": "హాజరు రికార్డులు ఇంకా అందుబాటులో లేవు.",
        "No marks records available yet.": "మార్కుల రికార్డులు ఇంకా అందుబాటులో లేవు.",
        "No notifications available": "నోటిఫికేషన్లు అందుబాటులో లేవు",
        "Submit": "సమర్పించండి",
        "Save": "భద్రపరచండి",
        "Cancel": "రద్దు చేయండి",
        "Back": "వెనక్కి",
        "Loading...": "లోడ్ అవుతోంది...",
        "Loading": "లోడ్ అవుతోంది",
        "Error": "లోపం",
        "No data": "డేటా అందుబాటులో లేదు",
        "No demo records are available for this authorized view.": "ఈ అనుమతించబడిన విభాగానికి డెమో రికార్డులు అందుబాటులో లేవు.",
        "Unauthorized": "అనధికార ప్రాప్యత",
        "Access denied": "ప్రాప్యత నిరాకరించబడింది",
        "Permission profile": "అనుమతుల వివరాలు",
        "Session": "సెషన్",
        "Overview": "సారాంశం",
        "Academic results": "విద్యా ఫలితాలు",
        "Assigned Subjects": "కేటాయించిన సబ్జెక్టులు",
        "Department": "విభాగం",
        "Department overview": "విభాగం సారాంశం",
        "Department students": "విభాగ విద్యార్థులు",
        "Department faculty": "విభాగ ఫ్యాకల్టీ",
        "College-wide": "కళాశాల వ్యాప్తి",
        "System-wide": "సిస్టమ్ వ్యాప్తి",
        "Role": "పాత్ర",
        "HOD": "విభాగాధిపతి",
        "Associate HOD": "సహ విభాగాధిపతి",
        "Assistant HOD": "సహాయక విభాగాధిపతి",
        "AO": "పరిపాలనా అధికారి",
        "Principal": "ప్రిన్సిపాల్",
        "Director": "డైరెక్టర్",
        "Admin": "అడ్మిన్",
        "Super Admin": "సూపర్ అడ్మిన్",
        "Total Students": "మొత్తం విద్యార్థులు",
        "Total Faculty": "మొత్తం ఫ్యాకల్టీ",
        "Attendance Entries": "హాజరు నమోదులు",
        "Recent Attendance": "ఇటీవలి హాజరు",
        "Recent Marks": "ఇటీవలి మార్కులు",
        "Fee Summary": "ఫీజు సారాంశం",
        "Parent Notifications": "తల్లిదండ్రుల నోటిఫికేషన్లు",
        "Department Distribution": "విభాగాల పంపిణీ",
        "Attendance Summary": "హాజరు సారాంశం",
        "Fee Statuses": "ఫీజు స్థితులు",
        "Recent Notifications": "ఇటీవలి నోటిఫికేషన్లు",
        "View Child Profile": "పిల్ల ప్రొఫైల్ చూడండి",
        "Viewing child": "చూస్తున్న పిల్ల",
        "No linked children": "లింక్ చేసిన పిల్లలు లేరు",
        "Change Mobile Number": "మొబైల్ నంబర్ మార్చండి",
        "Current mobile": "ప్రస్తుత మొబైల్",
        "New mobile number": "కొత్త మొబైల్ నంబర్",
        "Request OTP": "OTP కోరండి",
        "Confirm Change": "మార్పును నిర్ధారించండి",
        "OTP": "OTP",
        "Requesting verification code...": "ధృవీకరణ కోడ్ కోరుతోంది...",
        "Confirming mobile number change...": "మొబైల్ నంబర్ మార్పును నిర్ధారిస్తోంది...",
        "Admin Reports": "అడ్మిన్ నివేదికలు",
        "Admin Dashboard": "అడ్మిన్ డ్యాష్‌బోర్డ్",
        "Student Dashboard": "విద్యార్థి డ్యాష్‌బోర్డ్",
        "Parent Portal": "తల్లిదండ్రుల పోర్టల్",
        "Parent Portal Login": "తల్లిదండ్రుల పోర్టల్ లాగిన్",
        "Parent Mobile": "తల్లిదండ్రుల మొబైల్",
        "Enter parent mobile number": "తల్లిదండ్రుల మొబైల్ నంబర్ నమోదు చేయండి",
        "Back to main portal": "ప్రధాన పోర్టల్‌కు తిరిగి వెళ్ళండి",
        "Forgot Password?": "పాస్‌వర్డ్ మర్చిపోయారా?",
        "Register as Student": "విద్యార్థిగా నమోదు చేయండి",
        "Management portal": "మేనేజ్‌మెంట్ పోర్టల్",
        "Management Dashboard": "మేనేజ్‌మెంట్ డ్యాష్‌బోర్డ్",
        "Faculty Dashboard": "ఫ్యాకల్టీ డ్యాష్‌బోర్డ్",
        "HOD Dashboard": "విభాగాధిపతి డ్యాష్‌బోర్డ్",
        "Associate HOD Dashboard": "సహ విభాగాధిపతి డ్యాష్‌బోర్డ్",
        "Assistant HOD Dashboard": "సహాయక విభాగాధిపతి డ్యాష్‌బోర్డ్",
        "AO Dashboard": "పరిపాలనా అధికారి డ్యాష్‌బోర్డ్",
        "Principal Dashboard": "ప్రిన్సిపాల్ డ్యాష్‌బోర్డ్",
        "Director Dashboard": "డైరెక్టర్ డ్యాష్‌బోర్డ్",
        "Admin Dashboard": "అడ్మిన్ డ్యాష్‌బోర్డ్",
        "Super Admin Dashboard": "సూపర్ అడ్మిన్ డ్యాష్‌బోర్డ్",
        "Coming soon": "త్వరలో అందుబాటులోకి వస్తుంది"
    };

    const reverseTranslations = Object.fromEntries(Object.entries(translations).map(([english, telugu]) => [telugu, english]));
    const storageKey = "khit_language";
    let applying = false;

    function selectedLanguage() {
        return localStorage.getItem(storageKey) === "te" ? "te" : "en";
    }

    function translateText(value, language) {
        const trimmed = value.trim();
        if (!trimmed) return value;
        const normalized = trimmed.replace(/\s+/g, " ");
        const key = language === "te" ? (translations[trimmed] ? trimmed : normalized) : (reverseTranslations[trimmed] || reverseTranslations[normalized] || trimmed);
        const translated = language === "te" ? (translations[key] || trimmed) : key;
        return value.replace(trimmed, translated);
    }

    function translateNode(node, language) {
        if (!node || node.nodeType !== Node.TEXT_NODE) return;
        const parent = node.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return;
        const next = translateText(node.nodeValue || "", language);
        if (next !== node.nodeValue) node.nodeValue = next;
    }

    function applyLanguage(language = selectedLanguage()) {
        applying = true;
        document.documentElement.lang = language === "te" ? "te" : "en";
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => translateNode(node, language));
        document.querySelectorAll("[placeholder]").forEach(input => {
            const original = input.dataset.khitPlaceholder || input.getAttribute("placeholder");
            input.dataset.khitPlaceholder = original;
            input.setAttribute("placeholder", translateText(original, language));
        });
        document.querySelectorAll("option").forEach(option => {
            const original = option.dataset.khitOption || option.textContent;
            option.dataset.khitOption = original;
            option.textContent = translateText(original, language);
        });
        applying = false;
        localStorage.setItem(storageKey, language);
        window.dispatchEvent(new CustomEvent("khit-language-change", { detail: { language } }));
    }

    function addSelector() {
        if (document.querySelector("[data-khit-language-selector]")) return;
        const target = document.querySelector("header .header-actions, header .top-actions, header .actions, header .topbar-left") || document.querySelector("header") || document.body;
        const wrapper = document.createElement("label");
        wrapper.dataset.khitLanguageSelector = "true";
        wrapper.title = "Choose language / భాషను ఎంచుకోండి";
        wrapper.style.cssText = "display:inline-flex;align-items:center;gap:6px;color:inherit;font:600 12px Arial,sans-serif;";
        wrapper.innerHTML = "<span aria-hidden=\"true\">文</span><span class=\"khit-language-label\">Language</span><select aria-label=\"Language\" style=\"padding:6px 8px;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;cursor:pointer;\"><option value=\"en\">English</option><option value=\"te\">తెలుగు</option></select>";
        target.appendChild(wrapper);
        const select = wrapper.querySelector("select");
        select.value = selectedLanguage();
        select.addEventListener("change", () => applyLanguage(select.value));
    }

    document.addEventListener("DOMContentLoaded", () => {
        addSelector();
        applyLanguage();
        const observer = new MutationObserver(mutations => {
            if (applying) return;
            mutations.forEach(mutation => {
                if (mutation.type === "characterData") translateNode(mutation.target, selectedLanguage());
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) translateNode(node, selectedLanguage());
                    else if (node.nodeType === Node.ELEMENT_NODE) {
                        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
                        while (walker.nextNode()) translateNode(walker.currentNode, selectedLanguage());
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    window.khitLanguage = { apply: applyLanguage, get: selectedLanguage, translations };
})();
