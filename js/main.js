/* Header / nav / form / reveal animations */

(function () {
  // ---- Year stamp ----
  const yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  // ---- Header shadow on scroll ----
  const header = document.getElementById("siteHeader");
  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- Mobile nav toggle ----
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      })
    );
  }

  // ---- Reveal on scroll ----
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -50px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("visible"));
  }

  // ---- Service card hover spotlight ----
  document.querySelectorAll(".service").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * 100;
      const my = ((e.clientY - r.top) / r.height) * 100;
      card.style.setProperty("--mx", mx + "%");
      card.style.setProperty("--my", my + "%");
    });
  });

  // ---- Click-to-reveal phone number ----
  // The number is built up from base-36 chunks at runtime so it doesn't
  // appear verbatim in the page source. This keeps it invisible to most
  // search-engine crawlers and casual scrapers (still readable to a user
  // who clicks once). Decoded value: 0433 392 777.
  const revealPhone = document.getElementById("revealPhone");
  if (revealPhone) {
    revealPhone.addEventListener("click", () => {
      // Base-36 chunks decode to 433, 392, 777 (leading 0 prepended below).
      const parts = ["c1", "aw", "ll"].map((c) => parseInt(c, 36).toString());
      const display = "0" + parts[0] + " " + parts[1] + " " + parts[2];
      const link = document.createElement("a");
      link.href = "tel:" + display.replace(/\s/g, "");
      link.textContent = display;
      link.style.color = "var(--accent-2)";
      revealPhone.replaceWith(link);
    });
  }

  // ---- Contact form ----
  // Submissions are POSTed to Web3Forms which forwards them to info@ionet.com.au.
  //
  // SETUP (one-time, free, ~60 seconds):
  //   1. Visit https://web3forms.com/
  //   2. Enter info@ionet.com.au — they'll send you an access key
  //   3. Replace WEB3FORMS_ACCESS_KEY below with the key
  //   4. Done — submissions arrive in your inbox without opening the
  //      visitor's email client.
  //
  // Until the key is set, the form falls back to mailto: (opens the
  // visitor's email client) so it still has a path to delivery.
  const WEB3FORMS_ACCESS_KEY = "YOUR-WEB3FORMS-KEY";   // ← paste your key here
  const FORM_ENDPOINT = "https://api.web3forms.com/submit";
  const FALLBACK_EMAIL = "info@ionet.com.au";

  const form = document.getElementById("contactForm");
  const status = document.getElementById("formStatus");
  if (form && status) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (!data.firstName || !data.lastName || !data.email || !data.message) {
        status.textContent = "Please fill in all required fields.";
        status.style.color = "#ff6b6b";
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        status.textContent = "Please enter a valid email address.";
        status.style.color = "#ff6b6b";
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const keyConfigured = WEB3FORMS_ACCESS_KEY && !WEB3FORMS_ACCESS_KEY.startsWith("YOUR-");

      if (keyConfigured) {
        try {
          if (submitBtn) submitBtn.disabled = true;
          status.textContent = "Sending…";
          status.style.color = "";
          const resp = await fetch(FORM_ENDPOINT, {
            method: "POST",
            headers: {
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              access_key: WEB3FORMS_ACCESS_KEY,
              subject: `Website enquiry from ${data.firstName} ${data.lastName}`,
              from_name: `${data.firstName} ${data.lastName}`,
              name: `${data.firstName} ${data.lastName}`,
              email: data.email,
              phone: data.phone || "",
              message: data.message,
            }),
          });
          const result = await resp.json().catch(() => ({}));
          if (resp.ok && result.success) {
            status.textContent = "Thanks — we'll be in touch within one business day.";
            status.style.color = "";
            form.reset();
          } else {
            throw new Error(result.message || "Server error");
          }
        } catch (err) {
          status.textContent = `Couldn't send. Please email us directly at ${FALLBACK_EMAIL}.`;
          status.style.color = "#ff6b6b";
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
        return;
      }

      // Fallback: Web3Forms key not configured yet — open mail client
      const subject = encodeURIComponent(`Website enquiry from ${data.firstName} ${data.lastName}`);
      const body = encodeURIComponent(
        `Name: ${data.firstName} ${data.lastName}\n` +
        `Email: ${data.email}\n` +
        `Phone: ${data.phone || "—"}\n\n` +
        `${data.message}`
      );
      window.location.href = `mailto:${FALLBACK_EMAIL}?subject=${subject}&body=${body}`;
      status.textContent = "Opening your email client…";
      status.style.color = "";
      form.reset();
    });
  }
})();
