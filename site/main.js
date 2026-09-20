// Site marketing — Table Sync
// 0) la langue du site (FR par défaut · EN au choix)
// 1) la démo temps réel (le MD frappe, la fiche répond)
// 2) les entrées du registre se posent une fois (register-rise), les
//    ordinaux et les preuves se tamponnent
// 3) la marge du registre : le fil de lecture descend au fil du scroll
//    (styles.css porte en parallèle la couche scrubbée scroll-driven)
// 4) copier les commandes d'auto-hébergement
//
// ----- Langue : mécanisme retenu -----
// Le HTML porte des PAIRES d'éléments [lang="fr"]/[lang="en"] ; styles.css
// masque la langue inactive selon <html lang>. Choix retenu (plutôt que des
// data-attributs échangés par JS) : la page reste intégralement lisible en
// français sans JS, chaque langue garde sa ponctuation et ses entités
// propres, et les lecteurs d'écran prononcent l'anglais avec la bonne voix.
// La langue est posée AVANT le premier rendu par le script inline de <head>
// (localStorage « site-lang », clé distincte de l'app, ou ?lang=en partageable).
// Ce module gère le reste : bascule FR|EN, attributs (alt, aria-label),
// captures EN (assets/screenshots-en/), légendes des postes, <title>/meta
// et les chaînes pilotées par JS (démo, bouton copier).

(() => {
  // Le JS s'annonce : sans lui, .rise reste visible (le contenu ne se cache jamais par défaut)
  document.documentElement.classList.add('js');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Langue du site ---------- */

  const LANG_KEY = 'site-lang';
  let lang = document.documentElement.lang === 'en' ? 'en' : 'fr';

  const STRINGS = {
    fr: {
      title: 'Table Sync — le compagnon de campagne partagé, pour le MD et les joueurs',
      description:
        'Table Sync — le compagnon de campagne partagé, pour le MD et les joueurs. Fiches, inventaire en kg et combat D&D 5e, 100 % français, synchronisés en temps réel. Auto-hébergé.',
      hpReadGm: (hpNow) => `Lyra · ${hpNow}/${MAX_HP} PV`,
      hpReadPlayer: (hpNow) => `${hpNow}/${MAX_HP} PV`,
      hpValueText: (hpNow) => `${hpNow} sur ${MAX_HP} points de vie`,
      copyIdle: 'Copier',
      copyOk: 'Copié ✓',
      copyFail: 'Copie impossible',
      tocLabel: 'Le registre',
    },
    en: {
      title: 'Table Sync — the shared campaign companion, for the GM and the players',
      description:
        'Table Sync — the shared campaign companion, for the GM and the players. Character sheets, kilogram-based inventory and D&D 5e combat, synced in real time. Self-hosted.',
      hpReadGm: (hpNow) => `Lyra · ${hpNow}/${MAX_HP} HP`,
      hpReadPlayer: (hpNow) => `${hpNow}/${MAX_HP} HP`,
      hpValueText: (hpNow) => `${hpNow} of ${MAX_HP} hit points`,
      copyIdle: 'Copy',
      copyOk: 'Copied ✓',
      copyFail: 'Copy failed',
      tocLabel: 'The register',
    },
  };

  const SHOT_DIR = { fr: 'assets/screenshots/', en: 'assets/screenshots-en/' };

  // Attributs bilingues : la valeur FR vit dans l'attribut réel, la valeur EN
  // dans data-en-*. Le premier échange recopie l'original dans data-fr-* pour
  // pouvoir revenir en arrière sans dérive.
  const ATTR_SWAPS = [
    { selector: '[data-en-alt]', attr: 'alt', fr: 'data-fr-alt', en: 'data-en-alt' },
    {
      selector: '[data-en-aria-label]',
      attr: 'aria-label',
      fr: 'data-fr-aria-label',
      en: 'data-en-aria-label',
    },
  ];

  const captionFor = (pill) =>
    lang === 'en'
      ? (pill.dataset.enCaption ?? pill.dataset.caption ?? '')
      : (pill.dataset.caption ?? '');

  const applyToggle = () => {
    document.querySelectorAll('.lang-toggle [data-lang]').forEach((btn) => {
      const active = btn.dataset.lang === lang;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  const applyAttrs = () => {
    for (const swap of ATTR_SWAPS) {
      document.querySelectorAll(swap.selector).forEach((el) => {
        if (!el.hasAttribute(swap.fr)) {
          el.setAttribute(swap.fr, el.getAttribute(swap.attr) ?? '');
        }
        el.setAttribute(swap.attr, el.getAttribute(lang === 'en' ? swap.en : swap.fr) ?? '');
      });
    }
  };

  // Les captures EN vivent en assets/screenshots-en/<même nom> (copiées au
  // déploiement depuis docs/screenshots-en/) — un seul <img> par vue, le src
  // est échangé, jamais le DOM dupliqué. La fenêtre bureau (.deskframe) suit
  // le même échange que les cadres téléphone et portrait.
  const applyShots = () => {
    document
      .querySelectorAll('.shot-frame img, .portrait-frame img, .deskframe img')
      .forEach((img) => {
        const src = img.getAttribute('src') ?? '';
        const name = src.split('/').pop();
        if (src.startsWith('assets/screenshots')) {
          const next = SHOT_DIR[lang] + name;
          if (next !== src) {
            img.setAttribute('src', next);
          }
        }
      });
    // la visionneuse, si elle vient d'être ouverte, suit la langue active
    if (viewerImg) {
      viewerImg.src = viewerImg.src.replace(
        /\/assets\/screenshots(-en)?\//,
        `/assets/${lang === 'en' ? 'screenshots-en' : 'screenshots'}/`,
      );
    }
  };

  const applyCaptions = () => {
    document.querySelectorAll('.phonepost').forEach((post) => {
      const caption = post.querySelector('.phonepost-caption');
      const active = post.querySelector('.phonepost-dock button.is-active');
      if (caption && active) {
        caption.textContent = captionFor(active);
      }
    });
  };

  const applyStrings = () => {
    document.title = STRINGS[lang].title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', STRINGS[lang].description);
  };

  // La marge du registre (bâtie plus bas) se localise comme le reste :
  // aria-label du fil + infobulles des ordinaux
  let marginTocNav = null;

  function applyLang(next, { persist = false } = {}) {
    lang = next === 'en' ? 'en' : 'fr';
    document.documentElement.lang = lang;
    if (persist) {
      try {
        window.localStorage.setItem(LANG_KEY, lang);
      } catch {
        /* stockage indisponible — la préférence ne survivra pas au rechargement */
      }
    }
    applyToggle();
    applyAttrs();
    applyShots();
    applyCaptions();
    applyStrings();
    if (copyBtn && Date.now() >= copyFlashUntil) {
      copyBtn.textContent = STRINGS[lang].copyIdle;
    }
    localizeDemo();
    if (marginTocNav) {
      marginTocNav.setAttribute('aria-label', STRINGS[lang].tocLabel);
      marginTocNav.querySelectorAll('.toc-entry').forEach((link) => {
        const fr = link.dataset.tocTitleFr ?? '';
        const en = link.dataset.tocTitleEn ?? fr;
        const label = link.querySelector('.toc-label')?.textContent ?? '';
        const title = lang === 'en' ? en : fr;
        // la chip survolée et le nom accessible suivent la langue active
        if (title) {
          link.dataset.tocTitle = title;
          link.setAttribute('aria-label', `${label} — ${title}`);
        }
      });
    }
  }

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
        ? STRINGS[lang].hpReadGm(hpNow)
        : STRINGS[lang].hpReadPlayer(hpNow);
    });
    bars?.forEach((bar) => {
      bar.setAttribute('aria-valuenow', String(hpNow));
      bar.setAttribute('aria-valuetext', STRINGS[lang].hpValueText(hpNow));
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

  // Traduit l'état statique de la démo sans rejouer la séquence : la valeur
  // affichée (aria-valuenow) fait foi, pas le compteur interne (prêt à frapper).
  function localizeDemo() {
    if (!demo) return;
    const bar = demo.querySelector('[data-hp-bar]');
    const shown = Number.parseInt(bar?.getAttribute('aria-valuenow') ?? String(hp), 10);
    render(Number.isNaN(shown) ? hp : shown);
  }

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

  /* ---------- Le tampon des ordinaux ---------- */

  // Cadence des travaux liés au scroll : un rAF par défilement, AVEC filet
  // de secours. Dans un panneau intégré sans focus (navigateur embarqué,
  // onglet en arrière-plan), le rAF peut être étranglé — et un verrou
  // booléen « en attente » gèlerait le dispositif POUR DE BON si une seule
  // trame était perdue : le minuteur reprend alors la main.
  const frameGuarded = (work) => {
    let raf = 0;
    return () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        work();
      });
      window.setTimeout(() => {
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = 0;
          work();
        }
      }, 160);
    };
  };

  // L'ordinal tamponne quand il franchit la ligne des 42 % du viewport —
  // APRÈS l'encre du titre (achevée vers 45 %) : la plume écrit la ligne,
  // puis le sceau frappe. Un simple observateur manquerait les sauts
  // (ancre, fil de lecture, molette vive) et laisserait l'ordinal invisible ;
  // la ligne, elle, rattrape tout ce qui la dépasse. Déclenché une fois :
  // l'encre sèche, remonter ne l'efface pas.
  // (La couche scrubbée de styles.css s'occupe du filet et de l'encre du
  // titre ; le tampon, lui, reste un impact déclenché.)
  const ordinals = [...document.querySelectorAll('.entry-ordinal')];
  const stampPassedOrdinals = () => {
    const line = window.scrollY + window.innerHeight * 0.42;
    for (const ordinal of ordinals) {
      if (!ordinal.classList.contains('is-stamped')) {
        if (ordinal.getBoundingClientRect().top + window.scrollY <= line) {
          ordinal.classList.add('is-stamped');
        }
      }
    }
  };

  if (reduceMotion) {
    ordinals.forEach((ordinal) => {
      ordinal.classList.add('is-stamped');
    });
  } else {
    window.addEventListener('scroll', frameGuarded(stampPassedOrdinals), {
      passive: true,
    });
    window.addEventListener('resize', stampPassedOrdinals);
    stampPassedOrdinals();
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
        if (caption && (pill.dataset.caption || pill.dataset.enCaption)) {
          caption.textContent = captionFor(pill);
        }
      });
    });
  });

  /* ---------- La plume inscrit la page -----
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
      // Les vues élargies (tablette du joueur, écran du MD) se posent en fin
      // d'entrée, sous le poste de consultation
      entry.querySelectorAll('.entry-wide').forEach((wide, i) => {
        armReveal(wide, Math.max(delay, 180) + STEP * (i + 1));
      });
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

  /* ---------- La marge du registre (fil de lecture ≥1280px) ---------- */

  // Une règle d'encre descend la marge au fil du scroll, la plume en
  // pointe ; chaque entrée du registre y porte son ordinal, cliquable.
  // Bâtie ici (rien sans JS), masquée sous 1280px par styles.css. Elle ne
  // s'anime jamais d'elle-même : chaque état ne fait que suivre le doigt.
  const buildMarginToc = () => {
    const main = document.querySelector('main');
    const entries = [...document.querySelectorAll('main .entry[id]')];
    if (!main || entries.length === 0) return;

    const nav = document.createElement('nav');
    nav.className = 'margin-toc';
    nav.setAttribute('aria-label', STRINGS[lang].tocLabel);

    const line = document.createElement('div');
    line.className = 'toc-line';
    const fill = document.createElement('div');
    fill.className = 'toc-fill';
    line.append(fill);

    const nib = document.createElement('div');
    nib.className = 'toc-nib';
    nav.append(line, nib);

    const items = entries.map((entry) => {
      const head = entry.querySelector('.entry-head') ?? entry;
      const label = head.querySelector('.entry-ordinal')?.textContent ?? '';
      const link = document.createElement('a');
      link.className = 'toc-entry' + (entry.classList.contains('is-lead') ? ' is-lead' : '');
      link.href = `#${entry.id}`;
      const frTitle = head.querySelector('.entry-title [lang="fr"]')?.textContent ?? '';
      const enTitle = head.querySelector('.entry-title [lang="en"]')?.textContent ?? '';
      if (frTitle) {
        // data-toc-title porte la langue ACTIVE (la chip du survol le lit,
        // attr(data-toc-title) dans styles.css) ; les originaux fr/en
        // restent à part pour la bascule
        link.dataset.tocTitleFr = frTitle;
        if (enTitle) {
          link.dataset.tocTitleEn = enTitle;
        }
        link.dataset.tocTitle = frTitle;
        link.setAttribute('aria-label', `${label} — ${frTitle}`);
      }
      const text = document.createElement('span');
      text.className = 'toc-label';
      text.textContent = label;
      const tick = document.createElement('i');
      tick.className = 'toc-tick';
      link.append(text, tick);
      nav.append(link);
      return { head, link, y: 0 };
    });

    main.append(nav);
    marginTocNav = nav;

    let spanTop = 0;
    let spanHeight = 1;
    let currentIdx = -2;
    let mainTop = 0;

    const update = () => {
      // la ligne de lecture vit au milieu du viewport — ramenée dans le
      // repère de main (les tops du fil et des ordinaux y sont absolus,
      // et le hero précède main : sans ce retrait, le fil court une
      // entrée devant la lecture)
      const reading = window.scrollY + window.innerHeight * 0.5 - mainTop;
      const progress = Math.min(1, Math.max(0, (reading - spanTop) / spanHeight));
      fill.style.transform = `scaleY(${progress})`;
      nib.style.top = `${spanTop + progress * spanHeight}px`;

      let idx = -1;
      for (let i = 0; i < items.length; i++) {
        // grâce de 2 px : une tête posée PILE sur la ligne de lecture compte
        // comme courante (scrollY est entier, les tops ne le sont pas)
        if (reading + 2 >= items[i].y) idx = i;
      }
      if (idx !== currentIdx) {
        currentIdx = idx;
        items.forEach((item, i) => {
          const passed = i <= idx;
          const current = i === idx;
          item.link.classList.toggle('is-passed', passed);
          item.link.classList.toggle('is-current', current);
        });
      }
    };

    const measure = () => {
      mainTop = main.getBoundingClientRect().top + window.scrollY;
      for (const item of items) {
        item.y = item.head.getBoundingClientRect().top + window.scrollY - mainTop;
        // sans ce top, les ancres absolues s'empilent toutes à l'origine de
        // la nav (le sommet de main) — neuf ordinaux superposés, illisibles
        item.link.style.top = `${Math.round(item.y)}px`;
      }
      spanTop = items[0].y;
      spanHeight = Math.max(1, items[items.length - 1].y - spanTop);
      line.style.top = `${spanTop}px`;
      line.style.height = `${spanHeight}px`;
      update();
    };

    window.addEventListener('scroll', frameGuarded(update), { passive: true });
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    measure();
  };

  buildMarginToc();

  /* ---------- Copier les commandes ---------- */

  const copyBtn = document.querySelector('[data-copy]');
  const code = document.querySelector('.terminal code');
  let copyFlashUntil = 0;

  // État de retour honnête, comme le tampon copier de l'app
  const flashCopied = (ok) => {
    copyBtn.textContent = ok ? STRINGS[lang].copyOk : STRINGS[lang].copyFail;
    copyFlashUntil = Date.now() + 2000;
    window.setTimeout(() => {
      copyBtn.textContent = STRINGS[lang].copyIdle;
      copyFlashUntil = 0;
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

  /* ---------- Visionneuse plein écran -----
     Le vocabulaire de l'app : fondu du rideau, l'image se pose depuis 0.96,
     le zoom lui-même ne s'anime jamais (outil de lecture). */

  const viewer = document.querySelector('.viewer');
  const viewerFrame = viewer?.querySelector('.viewer-frame');
  const viewerCaption = viewer?.querySelector('.viewer-caption');
  const viewerClose = viewer?.querySelector('.viewer-close');
  let viewerImg = null;
  let lastFocus = null;

  const closeViewer = () => {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    document.body.style.overflow = '';
    lastFocus?.focus();
  };

  const openViewer = (img) => {
    if (!viewer || !viewerFrame) return;
    // l'image naît à la première ouverture — jamais de <img> vide dans la page
    if (!viewerImg) {
      viewerImg = document.createElement('img');
      viewerImg.className = 'viewer-img';
      viewerImg.decoding = 'async';
      viewerFrame.appendChild(viewerImg);
    }
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

  if (viewer && viewerFrame) {
    // Chaque écran de téléphone s'ouvre en plein écran ; dans un poste de
    // consultation, c'est la vue ACTIVE qui s'ouvre (les autres n'écoutent pas)
    document
      .querySelectorAll('.shot-frame img, .portrait-frame img, .deskframe img')
      .forEach((img) => {
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
      if (event.key === 'Tab' && !viewer.hidden) {
        // la visionneuse ne possède qu'un seul focusable : le piège tient en une ligne
        event.preventDefault();
        viewerClose?.focus();
      }
    });
  }

  /* ---------- Bascule FR|EN + synchronisation initiale ---------- */

  document.querySelectorAll('.lang-toggle [data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.lang === 'en' ? 'en' : 'fr';
      if (next !== lang) {
        applyLang(next, { persist: true });
      }
    });
  });

  // État initial idempotent : aligne bascule, attributs, légendes, <title>
  // et démo sur la langue posée avant rendu par le script de <head>.
  applyLang(lang);
})();
