import { useEffect } from "react";

// Faithful port of the scroll-reveal behaviour from the server-rendered shell:
// the page sections start hidden (.js-reveal on <html>) and fade in as they
// enter the viewport (.is-visible). Honours reduced-motion and degrades to
// "show everything" when IntersectionObserver is unavailable (e.g. jsdom).
export function useReveal(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js-reveal");

    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        "main > section:not(.landing-hero), .site-footer",
      ),
    );

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || !("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return () => root.classList.remove("js-reveal");
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          observer.unobserve(el);
          el.classList.add("is-visible");
        });
      },
      { rootMargin: "200px 0px 200px 0px", threshold: 0 },
    );

    targets.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      root.classList.remove("js-reveal");
    };
  }, []);
}
