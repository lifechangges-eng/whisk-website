/* ============================================================
   WHISK · app.js (ES module)
   GSAP ScrollTrigger orchestration + interactions
   Now: real preloader tied to GLB model load progress.
============================================================ */
(async () => {
  gsap.registerPlugin(ScrollTrigger);

  // Lenis smooth scroll — wired into GSAP ticker so ScrollTrigger stays in sync
  const lenis = new Lenis({ lerp: 0.08, syncTouch: true }); // POLISH — 0.1→0.08: weightier luxury scroll
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.on('scroll', ScrollTrigger.update);

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches;
  const reduce  = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     PRELOADER — driven by real GLB load progress (12 models)
  ============================================================ */
  const preloader  = $('#preloader');
  const preBar     = $('#preloader .preloader-bar span');
  const prePct     = $('#preloaderPct');

  // Wait for scene.js (ES module) to finish loading.
  // It populates window.WHISK_SCENES when its top-level code runs.
  // Modules execute in declared <script> order so by the time we run here it should be set.
  // (Safety: a tiny poll just in case.)
  while (!window.WHISK_SCENES) {
    await new Promise(r => setTimeout(r, 16));
  }

  // Smooth progress (eases from current to target — avoids jumpy jumps)
  let displayedPct = 0;
  let targetPct = 0;
  const renderBar = () => {
    displayedPct += (targetPct - displayedPct) * 0.15;
    const round = Math.round(displayedPct);
    prePct.textContent = round;
    preBar.style.width = round + '%';
    if (Math.abs(targetPct - displayedPct) > 0.4) requestAnimationFrame(renderBar);
  };
  const setProgress = (pct) => {
    targetPct = pct;
    requestAnimationFrame(renderBar);
  };

  function startReveal(){
    preloader.classList.add('hide');
    document.body.classList.add('loaded');
    revealHero();
    setTimeout(() => preloader.remove(), 800);
    // Refresh ScrollTrigger now that the page is fully laid out
    ScrollTrigger.refresh();
  }

  /* ============================================================
     HERO TITLE — letter-by-letter + flour burst
  ============================================================ */
  function revealHero(){
    const chars = $$('.hero-title .char');
    if (!reduce){
      gsap.to(chars, {
        opacity: 1,
        y: 0,
        rotateX: 0,
        duration: 1.4,          // POLISH — 1.2→1.4: more time to breathe
        ease: 'expo.out',
        stagger: 0.10,          // POLISH — 0.08→0.10: each letter lands deliberately
        delay: 0.25,            // POLISH — pause after preloader fades, then letters emerge
        onStart: () => spawnFlourBurst(),
        // FASE 10 — release GPU layers once chars are static post-reveal
        onComplete: () => chars.forEach(c => { c.style.willChange = 'auto'; }),
      });
    } else {
      gsap.set(chars, { opacity: 1, y: 0, rotateX: 0 });
      chars.forEach(c => { c.style.willChange = 'auto'; });
    }
  }

  /* DOM-based flour-dust burst behind the title */
  function spawnFlourBurst(){
    const hero = $('.hero');
    const burst = document.createElement('div');
    burst.style.cssText = `
      position:absolute; inset:0; pointer-events:none; z-index:2;
      overflow:hidden;
    `;
    hero.appendChild(burst);
    // POLISH — 60→22 particles: whisper of flour, not a cloud. Shorter travel, longer fade.
    const count = 22;
    for (let i = 0; i < count; i++){
      const p = document.createElement('span');
      const s = 1.5 + Math.random() * 4;
      p.style.cssText = `
        position:absolute; left:50%; top:50%;
        width:${s}px; height:${s}px; border-radius:50%;
        background:rgba(245,240,230,${0.25 + Math.random()*0.3});
        filter: blur(${0.5 + Math.random()*2.5}px);
        transform: translate(-50%, -50%);
      `;
      burst.appendChild(p);
      const angle = Math.random() * Math.PI * 2;
      const dist  = 30 + Math.random() * 140; // POLISH — 80-440→30-170: contained, elegant
      gsap.to(p, {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 30,
        opacity: 0,
        duration: 2.4 + Math.random() * 2.0, // POLISH — longer fade: particles linger like dust
        ease: 'power2.out',
        onComplete: () => p.remove()
      });
    }
    setTimeout(() => burst.remove(), 6000);
  }

  /* ============================================================
     NAV scrolled style
  ============================================================ */
  const nav = $('#nav');
  ScrollTrigger.create({
    start: 'top -80', end: 99999,
    onUpdate: self => nav.classList.toggle('scrolled', self.scroll() > 60)
  });

  /* ============================================================
     CUSTOM CURSOR
  ============================================================ */
  if (!isTouch){
    const dot  = $('#cursorDot');
    const ring = $('#cursorRing');
    let dx = -100, dy = -100, rx = -100, ry = -100;
    let tx = -100, ty = -100;
    window.addEventListener('pointermove', e => {
      tx = e.clientX; ty = e.clientY;
    });
    const renderCursor = () => {
      dx = lerp(dx, tx, 0.65);
      dy = lerp(dy, ty, 0.65);
      rx = lerp(rx, tx, 0.18);
      ry = lerp(ry, ty, 0.18);
      dot.style.transform  = `translate3d(${dx}px, ${dy}px, 0) translate(-50%, -50%)`;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      requestAnimationFrame(renderCursor);
    };
    requestAnimationFrame(renderCursor);

    const hoverables = 'a, button, .tab, .product, .testi, .ig-tile, input, select, textarea';
    document.addEventListener('pointerover', e => {
      if (e.target.closest(hoverables)){
        ring.classList.add('is-hover');
        dot.classList.add('is-hover');
      }
    });
    document.addEventListener('pointerout', e => {
      if (e.target.closest(hoverables)){
        ring.classList.remove('is-hover');
        dot.classList.remove('is-hover');
      }
    });
  }

  function lerp(a,b,t){ return a + (b-a)*t; }

  /* ============================================================
     THREE.js scenes — both kick off GLB loading in parallel
     ModelManager caches, so HeroScene's 6 models overlap with
     BakeScene's 12 (loaded only once).
  ============================================================ */
  const heroCanvas = $('#heroCanvas');
  const bakeCanvas = $('#bakeCanvas');

  // BakeScene loads all 12 — its progress is the truthful global load %
  const bake = new WHISK_SCENES.BakeScene(bakeCanvas, {
    onProgress: (loaded, total) => setProgress(Math.floor((loaded / total) * 100))
  });
  // HeroScene loads its 6 (cached after BakeScene fetches them too)
  const hero = new WHISK_SCENES.HeroScene(heroCanvas);

  // Register ScrollTriggers immediately — methods exist on instances even before .ready resolves
  ScrollTrigger.create({
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: true,
    onUpdate: self => hero.setScroll(self.progress)
  });

  ScrollTrigger.create({
    trigger: '.sequence',
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: self => bake.setProgress(self.progress)
  });

  /* Guía 2 FASE 0B — solo renderizar la BakeScene cuando .sequence está visible */
  const sequenceEl = $('.sequence');
  if (sequenceEl && 'IntersectionObserver' in window) {
    // rootMargin '600px' — preload stages 2-5 models before user arrives
    const lazyIO = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          bake.loadLateModels?.();
          obs.disconnect();
        }
      });
    }, { rootMargin: '600px 0px' });
    lazyIO.observe(sequenceEl);

    const io = new IntersectionObserver(entries => {
      entries.forEach(e => bake.setSequenceVisible?.(e.isIntersecting));
    }, { rootMargin: '200px 0px' });
    io.observe(sequenceEl);
  } else {
    bake.loadLateModels?.();
    bake.setSequenceVisible?.(true);
  }

  /* FASE 10 — pause HeroScene when hero section is off viewport */
  const heroSection = document.querySelector('.hero');
  if (heroSection && 'IntersectionObserver' in window) {
    const heroIO = new IntersectionObserver(entries => {
      entries.forEach(e => hero.setHeroVisible?.(e.isIntersecting));
    }, { rootMargin: '100px 0px' });
    heroIO.observe(heroSection);
  } else {
    hero.setHeroVisible?.(true);
  }

  /* Guía 2 FASE 0B — lazy-cargar el iframe de Vimeo cuando .about-video entre al viewport */
  const aboutVideoFrame = $('.about-video iframe');
  if (aboutVideoFrame && 'IntersectionObserver' in window) {
    const realSrc = aboutVideoFrame.getAttribute('data-src') || aboutVideoFrame.getAttribute('src');
    // Diferir: quitar el src hasta que entre al viewport
    aboutVideoFrame.removeAttribute('src');
    aboutVideoFrame.setAttribute('data-src', realSrc);
    const vio = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          aboutVideoFrame.src = realSrc;
          obs.disconnect();
        }
      });
    }, { rootMargin: '300px 0px' });
    vio.observe(aboutVideoFrame);
  }

  // Step copy reveal
  $$('.seq-step').forEach((step, i) => {
    const copy = step.querySelector('.seq-copy');
    const items = [
      step.querySelector('.seq-num'),
      step.querySelector('.seq-title'),
      step.querySelector('.seq-text'),
    ];
    gsap.set(items, { opacity: 0, y: 24 }); // POLISH — 40→24px: restrained reveal distance
    ScrollTrigger.create({
      trigger: step,
      start: 'top 75%',
      end: 'bottom 25%',
      onEnter:     () => gsap.to(items, { opacity:1, y:0,  duration:1.1, ease:'expo.out', stagger:.14 }),
      onLeave:     () => gsap.to(items, { opacity:0, y:-20, duration:.7, ease:'power2.in' }),
      onEnterBack: () => gsap.to(items, { opacity:1, y:0,  duration:.7, ease:'power2.out' }),
      onLeaveBack: () => gsap.to(items, { opacity:0, y:24,  duration:.7, ease:'power2.in' }),
    }); // POLISH — duration .9→1.1, stagger .12→.14, onLeave y:-30→-20
  });

  /* ============================================================
     ABOUT scene (3D whisk)
  ============================================================ */
  const aboutCanvas = $('#aboutCanvas');
  if (aboutCanvas) new WHISK_SCENES.AboutScene(aboutCanvas);

  /* ============================================================
     ABOUT packaging chips — scroll parallax
     Each chip drifts vertically at its own rate as user scrolls
     past the About section. Keeps base rotation, adds translateY.
  ============================================================ */
  const chips = $$('.pkg-chip');
  if (chips.length){
    const baseRot = new WeakMap();
    chips.forEach(chip => {
      const style = getComputedStyle(chip);
      // capture the static rotation from CSS class so we can preserve it
      baseRot.set(chip, style.transform === 'none' ? '' : style.transform);
    });

    ScrollTrigger.create({
      trigger: '.about',
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
      onUpdate: self => {
        const p = self.progress; // 0 → 1 across the whole section visibility
        const center = (p - 0.5) * 2; // -1 .. 1
        chips.forEach(chip => {
          const speed = parseFloat(chip.dataset.parallax || '0');
          const offsetY = center * 120 * speed;
          const offsetX = center * 30 * speed;
          chip.style.setProperty('--pX', offsetX + 'px');
          chip.style.setProperty('--pY', offsetY + 'px');
          const base = baseRot.get(chip) || '';
          chip.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) ${base}`;
        });
      }
    });
  }

  /* ============================================================
     STATS — counters
  ============================================================ */
  $$('.stat').forEach(stat => {
    const numEl = stat.querySelector('.stat-num span');
    const target = +stat.dataset.target;
    ScrollTrigger.create({
      trigger: stat,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        const obj = { v: 0 };
        gsap.to(obj, {
          v: target,
          duration: 1.8,
          ease: 'power3.out',
          onUpdate: () => numEl.textContent = Math.floor(obj.v)
        });
        gsap.from(stat, { y: 18, opacity: 0, duration: 1.2, ease: 'expo.out', clearProps: 'transform' }); // POLISH
      }
    });
  });

  /* ============================================================
     Cinematic scroll reveals — bottom half of the page
     Custom per-section choreography (not a single generic loop).
  ============================================================ */

  // ---- Section heads: FASE 9 — rotateX(-12°) 3D rise, 1.0s expo.out ----
  // Covers ALL section-head elements site-wide (products, testimonials, ig, about)
  // ig-handle excluded: it has its own scale+letterSpacing animation below
  $$('.section-head')
    .forEach(head => {
      const kids = Array.from(head.children).filter(el => !el.classList.contains('ig-handle'));
      if (!kids.length) return;
      gsap.set(kids, { opacity: 0, y: 18, rotateX: -12, transformPerspective: 800, transformOrigin: '50% 100%' });
      ScrollTrigger.create({
        trigger: head, start: 'top 85%', once: true,
        onEnter: () => gsap.to(kids, {
          opacity: 1, y: 0, rotateX: 0,
          duration: 1.0, ease: 'expo.out', stagger: 0.10,
          clearProps: 'transform',
        })
      });
    });

  // ---- About badges (pills) — stagger fade-up after copy slides in ----
  $$('.about-badges li').forEach((badge, i) => {
    gsap.set(badge, { opacity: 0, y: 12, scale: 0.96 });
    ScrollTrigger.create({
      trigger: badge, start: 'top 88%', once: true,
      onEnter: () => gsap.to(badge, {
        opacity: 1, y: 0, scale: 1,
        duration: 0.7, ease: 'expo.out',
        delay: i * 0.08,
        clearProps: 'transform',
      })
    });
  });

  // ---- Contact title + eyebrow — rotateX reveal (separate from contact-left slide) ----
  const contactTitle = $('.contact-title');
  if (contactTitle) {
    gsap.set(contactTitle, { opacity: 0, y: 20, rotateX: -10, transformPerspective: 800 });
    ScrollTrigger.create({
      trigger: contactTitle, start: 'top 82%', once: true,
      onEnter: () => gsap.to(contactTitle, {
        opacity: 1, y: 0, rotateX: 0,
        duration: 1.1, ease: 'expo.out', clearProps: 'transform',
      })
    });
  }

  // ---- Stats section-eyebrow — fade-up antes de que los números cuenten ----
  const statsEyebrow = $('.stats .section-eyebrow, .stats-title');
  if (statsEyebrow) {
    gsap.set(statsEyebrow, { opacity: 0, y: 14 });
    ScrollTrigger.create({
      trigger: statsEyebrow, start: 'top 88%', once: true,
      onEnter: () => gsap.to(statsEyebrow, {
        opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', clearProps: 'transform',
      })
    });
  }

  // ---- Brownies-fly fotos: stagger scale-up reveal (complementa parallax de FASE 8) ----
  $$('.fly-img').forEach((img, i) => {
    ScrollTrigger.create({
      trigger: img, start: 'top 95%', once: true,
      onEnter: () => gsap.to(img, {
        opacity: 1, scale: 1,
        duration: 1.1 + i * 0.12,
        ease: 'expo.out',
        delay: i * 0.10,
      })
    });
  });

  // ---- About cursive title: scale + fade + parallax during scroll ----
  const aboutScript = $('.about-script');
  if (aboutScript){
    // POLISH — y:80→28 (far less dramatic), scale:0.92→0.97 (barely perceptible, not cheap)
    gsap.set(aboutScript, { opacity: 0, y: 28, scale: 0.97 });
    ScrollTrigger.create({
      trigger: aboutScript, start: 'top 80%', once: true,
      onEnter: () => gsap.to(aboutScript, {
        opacity: 1, y: 0, scale: 1,
        duration: 1.4, ease: 'expo.out'
      })
    });
    // Subtle parallax drift while in viewport
    ScrollTrigger.create({
      trigger: aboutScript,
      start: 'top bottom', end: 'bottom top', scrub: 1.5,
      onUpdate: self => {
        gsap.set(aboutScript, { y: (self.progress - 0.5) * 60 });
      }
    });
  }

  // ---- About copy column + visual: side-slide ----
  const aboutCopy = $('.about-copy');
  const aboutVisual = $('.about-visual');
  if (aboutVisual){
    // POLISH — x:-80→-36: restrained horizontal entry (±80 is web-template territory)
    gsap.set(aboutVisual, { opacity: 0, x: -36 });
    ScrollTrigger.create({
      trigger: aboutVisual, start: 'top 80%', once: true,
      onEnter: () => gsap.to(aboutVisual, {
        opacity: 1, x: 0, duration: 1.3, ease: 'expo.out'
      })
    });
  }
  if (aboutCopy){
    const items = aboutCopy.children;
    // POLISH — x:80→36: matches visual-side restraint, stagger 0.10→0.12 for breathing
    gsap.set(items, { opacity: 0, x: 36 });
    ScrollTrigger.create({
      trigger: aboutCopy, start: 'top 80%', once: true,
      onEnter: () => gsap.to(items, {
        opacity: 1, x: 0,
        duration: 1.1, ease: 'expo.out', stagger: 0.12,
      })
    });
  }

  // ---- About Vimeo: zoom-in reveal ----
  const aboutVideo = $('.about-video');
  if (aboutVideo){
    // POLISH — scale:0.92→0.97, y:60→24: video appears to float gently into place
    gsap.set(aboutVideo, { opacity: 0, scale: 0.97, y: 24 });
    ScrollTrigger.create({
      trigger: aboutVideo, start: 'top 82%', once: true,
      onEnter: () => gsap.to(aboutVideo, {
        opacity: 1, scale: 1, y: 0, duration: 1.4, ease: 'expo.out'
      })
    });
    // Parallax on the iframe inside (subtle Ken Burns)
    const iframe = aboutVideo.querySelector('iframe');
    if (iframe){
      ScrollTrigger.create({
        trigger: aboutVideo, start: 'top bottom', end: 'bottom top', scrub: 1.5,
        onUpdate: self => {
          const p = self.progress;
          iframe.style.transform = `scale(${1 + Math.abs(p - 0.5) * 0.06}) translateY(${(p - 0.5) * -40}px)`;
        }
      });
    }
  }

  // ---- Filter tabs: drop in ----
  const filterTabs = $('.filter-tabs');
  if (filterTabs){
    // POLISH — y:30→14, scale:0.9→0.97 (the scale was too dramatic for a pill container)
    gsap.set(filterTabs, { opacity: 0, y: 14, scale: 0.97 });
    ScrollTrigger.create({
      trigger: filterTabs, start: 'top 85%', once: true,
      onEnter: () => gsap.to(filterTabs, {
        opacity: 1, y: 0, scale: 1, duration: 1.0, ease: 'expo.out',
        clearProps: 'transform',
      })
    });
  }

  // ---- Product cards: FASE 9 — y(40)→0 fade-up + image scale(0.95)→1 ----
  // clearProps:'transform' lets CSS :hover translateY(-8px) work after reveal
  $$('.product').forEach((card, i) => {
    const img = card.querySelector('.product-visual img');
    // POLISH — y:40→20 (restrained), img scale:0.95→0.97 (barely-there reveal), duration:0.8→1.0
    gsap.set(card, { opacity: 0, y: 20 });
    if (img) gsap.set(img, { scale: 0.97 });
    const rowDelay = (i % 3) * 0.12; // POLISH — 0.1→0.12: slightly more breathing between columns
    ScrollTrigger.create({
      trigger: card, start: 'top 90%', once: true,
      onEnter: () => {
        gsap.to(card, {
          opacity: 1, y: 0,
          duration: 1.0, ease: 'expo.out',
          delay: rowDelay,
          clearProps: 'transform',
        });
        if (img) gsap.to(img, {
          scale: 1, duration: 1.2, ease: 'expo.out',
          delay: rowDelay + 0.06,
          clearProps: 'transform',
        });
      }
    });
  });

  // ---- Testimonial cards: FASE 9 — staggered fade-up, premium restraint ----
  // No scale overshoot — clean y(40)→0, expo.out 0.8s, 0.1s stagger
  // POLISH — y:40→20, duration:0.8→1.0, stagger delay 0.1→0.16 (more breathing between cards)
  $$('.testi').forEach((card, i) => {
    gsap.set(card, { opacity: 0, y: 20 });
    ScrollTrigger.create({
      trigger: card, start: 'top 88%', once: true,
      onEnter: () => gsap.to(card, {
        opacity: 1, y: 0,
        duration: 1.0, ease: 'expo.out',
        delay: i * 0.16, clearProps: 'transform',
      })
    });
  });

  // ---- IG handle: huge scale entry; tiles: grid stagger with rotate ----
  const igHandle = $('.ig-handle');
  if (igHandle){
    // POLISH — scale:0.7→0.9 (30%→10% growth on a 160px script font — the old value was too dramatic)
    gsap.set(igHandle, { opacity: 0, scale: 0.9, letterSpacing: '-0.03em' });
    ScrollTrigger.create({
      trigger: igHandle, start: 'top 78%', once: true,
      onEnter: () => gsap.to(igHandle, {
        opacity: 1, scale: 1, letterSpacing: '-0.005em',
        duration: 2.0, ease: 'expo.out' // POLISH — 1.8→2.0: handle deserves more time to settle
      })
    });
  }
  // POLISH — y:50→24, scale:0.92→0.96, delay:i*0.08→i*0.10, keep ±3deg rotation (nice stagger effect)
  $$('.ig-tile').forEach((tile, i) => {
    gsap.set(tile, { opacity: 0, y: 24, rotate: i % 2 === 0 ? -3 : 3, scale: 0.96 });
    ScrollTrigger.create({
      trigger: tile, start: 'top 88%', once: true,
      onEnter: () => gsap.to(tile, {
        opacity: 1, y: 0, rotate: 0, scale: 1,
        duration: 1.1, ease: 'expo.out', delay: i * 0.10, clearProps: 'transform'
      })
    });
  });

  // ---- Contact: split entry (left slides from L, right from R) ----
  const contactLeft = $('.contact-left');
  const contactRight = $('.contact-right');
  if (contactLeft){
    const items = contactLeft.children;
    gsap.set(items, { opacity: 0, x: -28 }); // POLISH — x:-60→-28: restrained horizontal
    ScrollTrigger.create({
      trigger: contactLeft, start: 'top 80%', once: true,
      onEnter: () => gsap.to(items, {
        opacity: 1, x: 0, duration: 1.1, ease: 'expo.out', stagger: 0.10
      })
    });
  }
  if (contactRight){
    const items = contactRight.children;
    gsap.set(items, { opacity: 0, x: 28 }); // POLISH — x:60→28: matches left-side restraint
    ScrollTrigger.create({
      trigger: contactRight, start: 'top 80%', once: true,
      onEnter: () => gsap.to(items, {
        opacity: 1, x: 0, duration: 1.1, ease: 'expo.out', stagger: 0.10
      })
    });
  }

  // ---- Footer: graceful rise ----
  // POLISH — y:40→20, stagger delay 0.08→0.10: footer rises like a slow curtain
  $$('.footer-top > *').forEach((el, i) => {
    gsap.set(el, { opacity: 0, y: 20 });
    ScrollTrigger.create({
      trigger: el, start: 'top 92%', once: true,
      onEnter: () => gsap.to(el, {
        opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', delay: i * 0.10
      })
    });
  });
  const footerBottom = $('.footer-bottom');
  if (footerBottom){
    gsap.set(footerBottom, { opacity: 0 });
    ScrollTrigger.create({
      trigger: footerBottom, start: 'top 95%', once: true,
      onEnter: () => gsap.to(footerBottom, { opacity: 1, duration: 1.2, ease: 'power2.out' })
    });
  }

  // ---- Subtle parallax on products and testimonials sections ----
  // Section titles drift slightly upward as user scrolls past them
  $$('.products .section-title, .testimonials .section-title')
    .forEach(title => {
      ScrollTrigger.create({
        trigger: title, start: 'top bottom', end: 'bottom top', scrub: 1.2,
        onUpdate: self => {
          gsap.set(title, { y: (self.progress - 0.5) * -30 });
        }
      });
    });

  // ---- FASE 8 — Brownies Volando: parallax individual por foto ----
  // Cada foto tiene data-speed que controla qué tan rápido sube
  const flySection = $('.brownies-fly');
  if (flySection) {
    // Reveal de entrada: fotos suben desde abajo al entrar la sección
    $$('.fly-img').forEach((img, i) => {
      const speed = parseFloat(img.dataset.speed || '0.2');
      // Entry animation: aparece desde más abajo
      gsap.set(img, { y: 80, opacity: 0 });
      ScrollTrigger.create({
        trigger: flySection,
        start: 'top 90%',
        once: true,
        onEnter: () => gsap.to(img, {
          y: 0, opacity: 1,
          duration: 1.2 + i * 0.15,
          ease: 'expo.out',
          delay: i * 0.12,
        })
      });
      // Parallax continuo mientras la sección está en viewport
      ScrollTrigger.create({
        trigger: flySection,
        start: 'top bottom', end: 'bottom top',
        scrub: 1.5,
        onUpdate: self => {
          // Las fotos suben progresivamente al hacer scroll hacia abajo
          const offset = (self.progress - 0.3) * -160 * speed;
          gsap.set(img, { y: offset });
        }
      });
    });

    // Reveal del texto central
    const flyText = $('.brownies-fly-text');
    if (flyText) {
      gsap.set(flyText, { opacity: 0, y: 24 });
      ScrollTrigger.create({
        trigger: flySection, start: 'top 75%', once: true,
        onEnter: () => gsap.to(flyText, {
          opacity: 1, y: 0, duration: 1.4, ease: 'expo.out', delay: 0.3
        })
      });
    }
  }

  /* ============================================================
     PRODUCT filter tabs
  ============================================================ */
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
      tab.classList.add('active'); tab.setAttribute('aria-selected','true');
      const f = tab.dataset.filter;
      $$('.product').forEach(p => {
        const show = (f === 'all') || (p.dataset.cat === f);
        if (show){
          p.classList.remove('hidden');
          gsap.fromTo(p, { opacity: 0, y: 20 }, { opacity:1, y:0, duration:.5, ease:'power3.out' });
        } else {
          gsap.to(p, { opacity: 0, y: 20, duration: .25, onComplete: () => p.classList.add('hidden') });
        }
      });
    });
  });

  /* ============================================================
     3D TILT for product + testi cards + about badge
  ============================================================ */
  if (!isTouch){
    $$('.tilt').forEach(card => {
      const maxTiltX = 5;  // POLISH — 8→5: luxury tilt is subtle, present but not theatrical
      const maxTiltY = 6;  // POLISH — 10→6
      let raf;
      let cur = { rx: 0, ry: 0, tz: 0 };
      let tgt = { rx: 0, ry: 0, tz: 0 };
      let rect = null; // FASE 10 — cache rect on enter, avoids forced reflow on every pointermove

      const apply = () => {
        cur.rx = lerp(cur.rx, tgt.rx, 0.12);
        cur.ry = lerp(cur.ry, tgt.ry, 0.12);
        cur.tz = lerp(cur.tz, tgt.tz, 0.12);
        card.style.transform = `perspective(900px) rotateX(${cur.rx}deg) rotateY(${cur.ry}deg) translateZ(${cur.tz}px)`;
        raf = requestAnimationFrame(apply);
      };

      card.addEventListener('pointerenter', () => {
        rect = card.getBoundingClientRect(); // FASE 10 — cache once per hover session
        if (!raf) raf = requestAnimationFrame(apply);
      });
      card.addEventListener('pointermove', (e) => {
        if (!rect) return;
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top)  / rect.height;
        tgt.ry = (px - 0.5) * maxTiltY * 2;
        tgt.rx = -(py - 0.5) * maxTiltX * 2;
        tgt.tz = 8; // POLISH — 14→8px lift: whisper of depth, not a pop
      });
      card.addEventListener('pointerleave', () => {
        tgt.rx = 0; tgt.ry = 0; tgt.tz = 0;
        rect = null; // FASE 10 — release cached rect
        setTimeout(() => { cancelAnimationFrame(raf); raf = null; card.style.transform = ''; }, 600);
      });
    });
  }

  /* ============================================================
     ORDER FORM → WhatsApp
  ============================================================ */
  /* ============================================================
     PRODUCT CARDS — botones Vista Rápida + Añadir (Guía 3 FASE 4B)
     · "Añadir" dispara animación verde "Agregado ✓" por 2 segundos
     · Emite evento 'whisk:add-to-cart' con los data-attributes del producto
       → la FASE 5 (carrito) escucha este evento y agrega al estado global.
     · "Vista Rápida" es placeholder por ahora (FASE futura definirá modal).
  ============================================================ */
  const ADDED_CHECK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ADDED_BAG_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6.5 7h11l-1.3 11.2A2 2 0 0 1 14.2 20H9.8a2 2 0 0 1-2-1.8L6.5 7Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';

  $$('.product-btn-add').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-added')) return;   // anti double-click durante la animación

      // Extraer datos del producto desde el <article> padre
      const card = btn.closest('.product');
      if (!card) return;
      const product = {
        id:    card.dataset.productId,
        name:  card.dataset.productName,
        price: parseInt(card.dataset.productPrice, 10) || 0,
        image: card.dataset.productImage,
        tag:   card.dataset.productTag,
      };

      // Disparar evento para la FASE 5 (carrito lo escuchará y agregará al estado)
      window.dispatchEvent(new CustomEvent('whisk:add-to-cart', { detail: product }));

      // Estado visual "Agregado ✓" por 2 segundos
      btn.classList.add('is-added');
      const label = btn.querySelector('.product-btn-label');
      const svg = btn.querySelector('svg');
      const originalLabel = label ? label.textContent : '';
      if (label) label.textContent = 'Agregado';
      if (svg) svg.outerHTML = ADDED_CHECK_SVG;

      setTimeout(() => {
        btn.classList.remove('is-added');
        if (label) label.textContent = originalLabel;
        // restaurar el SVG de bolsa (el outerHTML lo reemplazó, hay que buscarlo de nuevo)
        const newSvg = btn.querySelector('svg');
        if (newSvg) newSvg.outerHTML = ADDED_BAG_SVG;
      }, 2000);
    });
  });

  // Stub "Vista Rápida" — placeholder, scroll al producto + hover effect por ahora
  $$('.product-btn-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.product');
      if (!card) return;
      // Por ahora: scroll suave al card y un pulse visual sutil
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.transition = 'transform .5s var(--ease-emph)';
      card.style.transform = 'translateY(-12px) scale(1.02)';
      setTimeout(() => { card.style.transform = ''; }, 700);
    });
  });

  window.whiskSubmit = function(e){
    e.preventDefault();
    const f = e.target;
    const nombre = f.nombre.value.trim();
    const tel = f.telefono.value.trim();
    const postre = f.postre.value;
    const msg = f.mensaje.value.trim();
    const text =
`Hola WHISK, mi nombre es ${nombre} (${tel}).
Me gustaría pedir: ${postre}.
${msg ? 'Detalles: ' + msg : ''}`.trim();
    const url = 'https://wa.me/573016003637?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener');
    return false;
  };

  /* ============================================================
     Footer year + smooth anchor offset
  ============================================================ */
  $('#year').textContent = new Date().getFullYear();
  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id.length > 1){
        const target = document.querySelector(id);
        if (target){
          e.preventDefault();
          lenis.scrollTo(target, { offset: -30 });
        }
      }
    });
  });

  /* Refresh ST after fonts load (avoid layout jump) */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  /* ============================================================
     FASE 10 — PERFORMANCE FINAL
  ============================================================ */

  // ── will-change: auto en elementos con GPU layers tras finalizar animaciones ──
  // GSAP los pone en 'transform' durante la animación; los liberamos al completar
  // para que el browser no mantenga capas innecesarias en memoria GPU.
  const releaseWillChange = (el) => {
    if (el) el.style.willChange = 'auto';
  };

  // Hero chars: ya liberados con clearProps:'willChange' en revealHero() ✅
  // Product cards: clearProps:'transform' ya en onComplete ✅

  // Liberar will-change de testi/ig-tile una vez que las cardFloat animations
  // ya no necesitan la capa agresiva (la transición CSS del hover es suficiente)
  // Solo en desktop — en mobile no hay float animation
  if (!IS_MOBILE && !reduce) {
    setTimeout(() => {
      $$('.testi, .ig-tile').forEach(el => {
        // Quitar will-change agresivo — la transición CSS de hover lo reactiva si hace falta
        el.addEventListener('pointerenter', () => { el.style.willChange = 'transform'; }, { once: false });
        el.addEventListener('pointerleave', () => { el.style.willChange = 'auto'; }, { once: false });
      });
    }, 2000); // Delay 2s para no interferir con animaciones de entrada
  }

  // ── Intersection Observer para pausar About 3D whisk cuando está off-screen ──
  const aboutCanvas2 = $('#aboutCanvas');
  if (aboutCanvas && 'IntersectionObserver' in window) {
    const aboutIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        aboutCanvas.style.visibility = e.isIntersecting ? 'visible' : 'hidden';
      });
    }, { rootMargin: '200px 0px' });
    aboutIO.observe(aboutCanvas.closest('.about') || aboutCanvas);
  }

  // ── Preconnect dinámico para WhatsApp CDN (badge, imágenes de preview) ──
  const waPreconnect = document.createElement('link');
  waPreconnect.rel = 'preconnect'; waPreconnect.href = 'https://static.whatsapp.net';
  document.head.appendChild(waPreconnect);

  // ── ScrollTrigger: limitar actualizaciones mientras lenis está activo ──
  // Ya lo hace el ticker de GSAP — confirmación de que está correctamente enlazado ✅

  // ── requestIdleCallback: ScrollTrigger.refresh() diferido para no bloquear LCP ──
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => ScrollTrigger.refresh(), { timeout: 1000 });
  }

  /* ============================================================
     WAIT for 3D models, then reveal
  ============================================================ */
  // Timeout de 4 segundos: si los modelos no cargaron, la página entra igual
  const LOAD_TIMEOUT = 4000;
  const timeoutPromise = new Promise(res => setTimeout(res, LOAD_TIMEOUT));
  try {
    await Promise.race([
      Promise.all([bake.ready, hero.ready]),
      timeoutPromise,
    ]);
  } catch (err) {
    console.warn('Model load error (entering anyway):', err);
  }
  // Ensure bar visually reaches 100% even if onProgress rounded down
  setProgress(100);
  // Tiny breath, then unveil
  setTimeout(startReveal, 350);
})();
