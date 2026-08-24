// Site marketing — Inventaire D&D
// 1) la démo temps réel (le MD frappe, la fiche répond)
// 2) les entrées du registre se posent une fois (register-rise)
// 3) copier les commandes d'auto-hébergement

(() => {
  // Le JS s'annonce : sans lui, .rise reste visible (le contenu ne se cache jamais par défaut)
  document.documentElement.classList.add('js');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Démo temps réel ---------- */

  const MAX_HP = 31;
  const DAMAGE = 9;

  const demo = document.querySelector('.demo');
  const strikeBtn = document.querySelector('[data-strike]');
  const reads = demo?.querySelectorAll('[data-hp-read]');
  const bars = demo?.querySelectorAll('[data-hp-bar]');
  const fills = demo?.querySelectorAll('[data-hp-fill]');
  const chip = demo?.querySelector('[data-chip]');
  const conc = demo?.querySelector('[data-conc]');
  let hp = MAX_HP;
  let strikeTimer = null;

  const tierOf = (hpNow) => {
    if (hpNow <= Math.ceil(MAX_HP * 0.25)) return 'crit';
    if (hpNow <= Math.ceil(MAX_HP * 0.5)) return 'low';
    return 'ok';
  };

  const render = (hpNow) => {
    const pct = Math.round((hpNow / MAX_HP) * 100);
    const tier = tierOf(hpNow);
    reads?.forEach((read) => {
      read.textContent = read.textContent.includes('Lyra')
        ? `Lyra · ${hpNow}/${MAX_HP} PV`
        : `${hpNow}/${MAX_HP} PV`;
    });
    bars?.forEach((bar) => {
      bar.setAttribute('aria-valuenow', String(hpNow));
      bar.setAttribute('aria-valuetext', `${hpNow} sur ${MAX_HP} points de vie`);
    });
    fills?.forEach((fill) => {
      fill.style.width = `${pct}%`;
      if (tier === 'ok') {
        fill.removeAttribute('data-tier');
      } else {
        fill.setAttribute('data-tier', tier);
      }
    });
  };

  const strike = () => {
    if (!demo || strikeTimer) return; // une frappe à la fois
    const hit = Math.max(0, hp - DAMAGE);
    chip?.classList.add('is-visible');
    window.setTimeout(() => {
      hp = hit;
      render(hp);
      conc?.classList.add('is-visible');
    }, 450);
    strikeTimer = window.setTimeout(() => {
      // la séance continue : Lyra se soigne, la démo se réarme
      chip?.classList.remove('is-visible');
      conc?.classList.remove('is-visible');
      window.setTimeout(() => {
        hp = MAX_HP;
        render(hp);
        strikeTimer = null;
      }, 500);
    }, 3400);
  };

  const armDemo = () => {
    // Première frappe offerte quand la démo entre à l'écran
    if (!('IntersectionObserver' in window)) return;
    let seen = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !seen) {
            seen = true;
            window.setTimeout(strike, 700);
            io.disconnect();
          }
        }
      },
      { threshold: 0.6 },
    );
    io.observe(demo);
  };

  if (demo && strikeBtn) {
    strikeBtn.addEventListener('click', strike);
    if (reduceMotion) {
      // État final statique : la frappe a eu lieu, tout est lisible
      hp = MAX_HP - DAMAGE;
      render(hp);
      chip?.classList.add('is-visible');
      conc?.classList.add('is-visible');
    } else {
      armDemo();
    }
  }

  /* ---------- register-rise ---------- */

  const risers = document.querySelectorAll('.rise');

  const riseAll = () => {
    risers.forEach((el) => {
      el.classList.add('is-risen');
    });
  };

  if (reduceMotion || !('IntersectionObserver' in window)) {
    riseAll();
  } else {
    const riseIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-risen');
            riseIo.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.25 },
    );
    risers.forEach((el) => {
      riseIo.observe(el);
    });
  }

  /* ---------- Copier les commandes ---------- */

  const copyBtn = document.querySelector('[data-copy]');
  const code = document.querySelector('.terminal code');

  // État de retour honnête, comme le tampon copier de l'app
  const flashCopied = (ok) => {
    copyBtn.textContent = ok ? 'Copié ✓' : 'Copie impossible';
    window.setTimeout(() => {
      copyBtn.textContent = 'Copier';
    }, 2000);
  };

  copyBtn?.addEventListener('click', () => {
    const text = code?.textContent?.replace(/\$ /g, '') ?? '';
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => flashCopied(true),
        () => flashCopied(false),
      );
    } else {
      flashCopied(false);
    }
  });
})();
