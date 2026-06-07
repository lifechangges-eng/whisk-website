# WHISK · Little Bites & Big Bliss

Sitio web cinematográfico 3D scroll-driven para **WHISK**, repostería artesanal en Medellín, Colombia.

- Tagline: *Little Bites & Big Bliss*
- Instagram: [@whisk__little__bites](https://instagram.com/whisk__little__bites)
- WhatsApp: [+57 301 600 3637](https://wa.me/573016003637)

## Stack

- HTML5 + CSS3 (sin frameworks, paleta marca pura: cream `#F5F0E6` / black `#1A1C20` / warm `#FAF7F0`)
- **Three.js** (r128, CDN) — escenas 3D
- **GSAP + ScrollTrigger** (CDN) — animaciones scroll-driven
- Tipografías Google Fonts: Playfair Display 900, Pinyon Script, DM Sans, Libre Baskerville

## Estructura

```
whisk-website/
├── index.html        # Markup completo: hero, secuencia 3D, stats, productos, about, testimonials, IG, contacto, footer
├── styles.css        # CSS de producción (cinematográfico, paleta marca, tilt, cursor, reveals)
├── scene.js          # HeroScene / BakeScene / AboutScene (Three.js)
├── app.js            # GSAP ScrollTrigger, contadores, cursor custom, filtros, form, tilt 3D
├── vercel.json       # Headers + cleanUrls
├── package.json      # Scripts: dev, deploy
└── README.md
```

## Local dev

Abre `index.html` en el navegador, o sirve estático:

```bash
npx serve . -p 5173
# http://localhost:5173
```

## Deploy a Vercel

```bash
npx vercel --prod
# o desde Vercel dashboard: importar este folder como proyecto static
```

`vercel.json` ya tiene los headers de cache y seguridad.

## Animaciones clave

| Sección | Animación |
|---|---|
| Preloader | Whisk SVG girando + barra de progreso |
| Hero | Postres 3D flotando + parallax con mouse + partículas tipo harina |
| Hero título | Letras aparecen con burst de partículas de harina |
| Sequence | Scroll-driven 3D: torta se arma capa por capa → huevos se rompen + whisk gira → postres flotan |
| Stats | Contadores animados al entrar viewport |
| Productos | Tilt 3D perspective con mouse + filtros (Exclusivos / Clásicos / Todos) |
| About | Whisk 3D girando + badge "100% Artesanal" con rotación |
| Testimonials | 3 cards con tilt 3D, centro invertido (negro) |
| Instagram | Grid 4 con hover zoom + corazón overlay |
| Form | Envía a WhatsApp pre-formateado |
| Cursor | Dot crema + ring que escala en hover (mix-blend-mode difference) |

## Paleta (lock estricto — no gold, no otros colores)

- Cream `#F5F0E6`
- Deep Black `#1A1C20`
- Warm White `#FAF7F0`

Cualquier tono usado en visuals 3D deriva de esta base (fresa muy desaturada, choco neutral).
