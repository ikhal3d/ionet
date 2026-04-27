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

  // ---- Contact form (client-side validation + mailto fallback) ----
  const form = document.getElementById("contactForm");
  const status = document.getElementById("formStatus");
  if (form && status) {
    form.addEventListener("submit", (e) => {
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
      const subject = encodeURIComponent(`Website enquiry from ${data.firstName} ${data.lastName}`);
      const body = encodeURIComponent(
        `Name: ${data.firstName} ${data.lastName}\n` +
        `Email: ${data.email}\n` +
        `Phone: ${data.phone || "—"}\n\n` +
        `${data.message}`
      );
      window.location.href = `mailto:hello@ionet.com.au?subject=${subject}&body=${body}`;
      status.textContent = "Opening your email client…";
      status.style.color = "";
      form.reset();
    });
  }
})();
