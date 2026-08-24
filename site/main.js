// Site marketing — Table Sync
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

  /* ---------- Poste de consultation (série de captures, entrée II) ---------- */

  // Chaque poste de consultation (série multi-captures) est câblé indépendamment
  document.querySelectorAll('.phonepost').forEach((post) => {
    const views = post.querySelectorAll('.phonepost-view');
    const pills = post.querySelectorAll('.phonepost-dock button');
    const caption = post.querySelector('.phonepost-caption');

    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const index = Number.parseInt(pill.dataset.view ?? '0', 10);
        views.forEach((view, i) => {
          view.classList.toggle('is-active', i === index);
        });
        pills.forEach((p) => {
          const active = p === pill;
          p.classList.toggle('is-active', active);
          p.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (caption && pill.dataset.caption) {
          caption.textContent = pill.dataset.caption;
        }
      });
    });
  });

  /* ---------- La plume inscrit la page ----------
     Chaque bloc reçoit .reveal + --reveal-delay ; l'observateur déclenche
     .is-risen quand l'entrée entre à l'écran. Une seule liste réglée en
     stagger par entrée (le geste du registre de l'app), délais plafonnés. */

  const STEP = 70; // ms entre deux entrées réglées
  const armed = [];
  const heroArmed = [];

  const armReveal = (el, delay) => {
    if (!el) return;
    el.classList.add('reveal');
    el.style.setProperty('--reveal-delay', `${Math.round(delay)}ms`);
    armed.push(el);
  };

  // Les pas d'une entrée du registre : la tête trace son filet, les entrées
  // réglées se posent l'une après l'autre, les preuves tamponnent, la
  // colonne visuelle arrive en fin
  const armEntry = (entry) => {
    const head = entry.querySelector('.entry-head');
    const copy = entry.querySelector('.entry-copy');
    const media = entry.querySelector('.entry-body > :not(.entry-copy)');
    const deployPanel = entry.querySelector('.deploy');

    if (head && !deployPanel) {
      armReveal(head, 0);
    }

    let delay = 90;
    if (deployPanel) {
      // Repos long : la tête compacte vit dans le panneau avec le reste de
      // la copie, le terminal clôt la séquence
      const parts = deployPanel.querySelector('.entry-copy').children;
      for (const part of parts) {
        armReveal(part, delay);
        delay += STEP;
      }
      armReveal(deployPanel.querySelector('.terminal'), delay + 40);
    } else {
      const subs = copy?.querySelector('.subentries');
      if (subs) {
        const items = [...subs.querySelectorAll('li')].slice(0, 6);
        for (const li of items) {
          armReveal(li, delay);
          delay += STEP;
        }
        armReveal(copy.querySelector('.proof'), delay);
      } else if (copy) {
        for (const child of copy.children) {
          armReveal(child, delay);
          delay += STEP;
        }
      }
      if (media) {
        armReveal(media, Math.max(delay, 180));
      }
    }
  };

  // La fiche du hero se remplit d'elle-même à l'ouverture : nom, slogan,
  // offre, champs, verbes, puis les six tuiles FOR→CHA
  const armHero = () => {
    const pieces = ['.hero-name', '.hero-tagline', '.hero-offer', '.sheet-fields', '.cta-row'];
    let delay = 0;
    for (const selector of pieces) {
      const el = document.querySelector(selector);
      if (el) heroArmed.push(el);
      armReveal(el, delay);
      delay += STEP;
    }
    document.querySelectorAll('.ability').forEach((tile, i) => {
      heroArmed.push(tile);
      armReveal(tile, delay + 60 + i * 60);
    });
  };

  // Les quadrants de personnalité (entrée à part entière, révélés par
  // l'observateur des entrées) puis le pied de page (observé à part)
  const armPersonality = () => {
    document.querySelectorAll('.personality article').forEach((article, i) => {
      armReveal(article, i * 90);
    });
  };

  const armFooter = () => {
    const footerCols = document.querySelectorAll('.site-footer .footer-cols > div');
    footerCols.forEach((col, i) => {
      armReveal(col, i * 80);
    });
    armReveal(document.querySelector('.footer-seal-row'), footerCols.length * 80);
  };

  const riseAll = () => {
    for (const el of armed) {
      el.classList.add('is-risen');
    }
  };

  const riseHero = () => {
    for (const el of heroArmed) {
      el.classList.add('is-risen');
    }
  };

  if (reduceMotion || !('IntersectionObserver' in window)) {
    armHero();
    document.querySelectorAll('.entry').forEach(armEntry);
    armPersonality();
    armFooter();
    riseAll();
  } else {
    armHero();
    armPersonality();
    document.querySelectorAll('.entry').forEach(armEntry); // armées d'emblée, révélées au scroll
    riseHero(); // la fiche s'inscrit dès l'arrivée

    const entryIo = new IntersectionObserver(
      (entries) => {
        for (const observed of entries) {
          if (observed.isIntersecting) {
            for (const el of armed) {
              if (observed.target.contains(el) || el.contains(observed.target)) {
                el.classList.add('is-risen');
              }
            }
            entryIo.unobserve(observed.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    document.querySelectorAll('.entry').forEach((entry) => {
      entryIo.observe(entry);
    });

    // Le pied se lève à son tour quand on y arrive
    const footer = document.querySelector('.site-footer');
    if (footer) {
      const footerIo = new IntersectionObserver(
        (entries) => {
          for (const observed of entries) {
            if (observed.isIntersecting) {
              armFooter();
              riseAll();
              footerIo.disconnect();
            }
          }
        },
        { threshold: 0.2 },
      );
      footerIo.observe(footer);
    }
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

  /* ---------- Visionneuse plein écran ----------
     Le vocabulaire de l'app : fondu du rideau, l'image se pose depuis 0.96,
     le zoom lui-même ne s'anime jamais (outil de lecture). */

  const viewer = document.querySelector('.viewer');
  const viewerImg = viewer?.querySelector('.viewer-img');
  const viewerCaption = viewer?.querySelector('.viewer-caption');
  const viewerClose = viewer?.querySelector('.viewer-close');
  let lastFocus = null;

  const closeViewer = () => {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    document.body.style.overflow = '';
    lastFocus?.focus();
  };

  const openViewer = (img) => {
    if (!viewer || !viewerImg) return;
    lastFocus = document.activeElement;
    viewerImg.src = img.src;
    viewerImg.alt = img.alt;
    if (viewerCaption) {
      viewerCaption.textContent = img.alt;
    }
    viewer.hidden = false;
    document.body.style.overflow = 'hidden';
    viewerClose?.focus();
  };

  if (viewer && viewerImg) {
    // Chaque écran de téléphone s'ouvre en plein écran ; dans un poste de
    // consultation, c'est la vue ACTIVE qui s'ouvre (les autres n'écoutent pas)
    document.querySelectorAll('.shot-frame img, .portrait-frame img').forEach((img) => {
      img.addEventListener('click', () => {
        if (img.classList.contains('phonepost-view') && !img.classList.contains('is-active')) {
          return;
        }
        openViewer(img);
      });
    });

    viewer.addEventListener('click', (event) => {
      if (event.target === viewer || event.target === viewerClose) closeViewer();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeViewer();
    });
  }
})();
