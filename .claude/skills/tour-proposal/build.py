#!/usr/bin/env python3
"""Como On Boat - Tour Proposal generator.

Reads a proposal described as JSON and renders a single self-contained,
animated, scroll-driven HTML page ready to send to a client.

Usage:
    python build.py path/to/content.json [--out proposte/slug.html] [--no-embed]

By default all images and the logo are base64-embedded so the output is ONE
portable file. Use --no-embed to keep relative <img src> paths (lighter file,
but you must ship the assets/ folder alongside it).
"""
import argparse, base64, html, json, mimetypes, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(HERE, "assets", "img")
LOGO_PATH = os.path.join(HERE, "assets", "logo", "como-on-boat-logo.png")


# ---------------------------------------------------------------- helpers ----
def esc(s):
    return html.escape(str(s)) if s is not None else ""


def slugify(s):
    s = re.sub(r"[^\w\s-]", "", str(s).lower()).strip()
    return re.sub(r"[\s_]+", "-", s) or "proposal"


def find_image(key):
    """Resolve an image key to a file path. Accepts a library key
    (e.g. 'villa-pliniana-1'), a bare filename, or an absolute/relative path."""
    if not key:
        return None
    for cand in (key, key + ".jpg", key + ".jpeg", key + ".png"):
        p = os.path.join(IMG_DIR, cand)
        if os.path.exists(p):
            return p
    if os.path.exists(key):
        return key
    return None


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def img_src(key, embed, rel_prefix="assets/img"):
    p = find_image(key)
    if not p:
        # graceful: a neutral navy placeholder
        return "data:image/svg+xml;base64," + base64.b64encode(
            b"<svg xmlns='http://www.w3.org/2000/svg' width='4' height='3'>"
            b"<rect width='4' height='3' fill='%23152038'/></svg>"
        ).decode()
    if embed:
        return data_uri(p)
    if os.path.dirname(p) == IMG_DIR:
        return f"{rel_prefix}/{os.path.basename(p)}"
    return p


def logo_src(embed):
    if embed and os.path.exists(LOGO_PATH):
        return data_uri(LOGO_PATH)
    return "assets/logo/como-on-boat-logo.png"


# --------------------------------------------------------------- sections ----
def render_highlights(highlights, embed):
    out = []
    for i, h in enumerate(highlights):
        imgs = h.get("images") or []
        side = "right" if i % 2 else "left"
        gallery = "".join(
            f'<div class="hl-img reveal" style="--d:{0.05*j:.2f}s">'
            f'<img loading="lazy" src="{img_src(im, embed)}" alt="{esc(h.get("name"))}"></div>'
            for j, im in enumerate(imgs)
        )
        out.append(f"""
    <section class="highlight side-{side}">
      <div class="hl-gallery count-{min(len(imgs),3)}">{gallery}</div>
      <div class="hl-card reveal">
        <span class="hl-num">{i+1:02d}</span>
        <span class="eyebrow">{esc(h.get('tagline','Tour Highlight'))}</span>
        <h3>{esc(h.get('name'))}</h3>
        <p>{esc(h.get('desc'))}</p>
      </div>
    </section>""")
    return "".join(out)


def render_itinerary(stops):
    if not stops:
        return ""
    items = "".join(
        f'<li class="reveal" style="--d:{0.04*i:.2f}s"><span class="dot"></span>{esc(s)}</li>'
        for i, s in enumerate(stops)
    )
    return f"""
    <section class="route">
      <div class="wrap">
        <span class="eyebrow center">The Route</span>
        <h2 class="center">Your journey, stop by stop</h2>
        <ul class="route-list">{items}</ul>
      </div>
    </section>"""


def render_boat(boat, embed):
    if not boat:
        return ""
    imgs = boat.get("images") or []
    tiles = "".join(
        f'<div class="boat-tile reveal" style="--d:{0.06*i:.2f}s">'
        f'<img loading="lazy" src="{img_src(im, embed)}" alt="{esc(boat.get("name"))}"></div>'
        for i, im in enumerate(imgs)
    )
    return f"""
    <section class="boat">
      <div class="wrap">
        <span class="eyebrow center">The Boat</span>
        <h2 class="center">{esc(boat.get('name'))}</h2>
        <p class="lead center">{esc(boat.get('desc'))}</p>
      </div>
      <div class="boat-grid">{tiles}</div>
    </section>"""


def render_extras(extras, embed):
    if not extras:
        return ""
    cards = "".join(
        f"""<div class="extra-card reveal" style="--d:{0.08*i:.2f}s">
          <div class="extra-img"><img loading="lazy" src="{img_src(e.get('image'), embed)}" alt="{esc(e.get('title'))}"></div>
          <h4>{esc(e.get('title'))}</h4>
          <p>{esc(e.get('desc',''))}</p>
        </div>"""
        for i, e in enumerate(extras)
    )
    return f"""
    <section class="extras">
      <div class="wrap">
        <span class="eyebrow center">Make it unforgettable</span>
        <h2 class="center">Extra services</h2>
        <div class="extra-grid">{cards}</div>
      </div>
    </section>"""


def render_pricing(p, included):
    if not p:
        return ""
    cur = p.get("currency", "€")
    inc = "".join(f"<li>{esc(x)}</li>" for x in (included or []))
    base = p.get("base")
    extras_total = p.get("extras_total")
    total = p.get("total", base or 0)
    breakdown = ""
    if base is not None and extras_total:
        breakdown = (f'<div class="price-breakdown">'
                     f'<span>{base:,}{cur}</span><span class="plus">+</span>'
                     f'<span>{extras_total:,}{cur} <em>extra services</em></span></div>')
    return f"""
    <section class="pricing">
      <div class="wrap reveal">
        <span class="eyebrow center">Pricing</span>
        <h2 class="center">{esc(p.get('label','One exclusive boat, all inclusive'))}</h2>
        <ul class="included">{inc}</ul>
        {breakdown}
        <div class="total">
          <span class="total-label">{esc(p.get('note',''))} total</span>
          <span class="total-num" data-target="{total}">{cur}0</span>
        </div>
      </div>
    </section>"""


# --------------------------------------------------------------- template ----
def render(data, embed):
    c = data.get("contacts", {})
    sched = data.get("schedule", {})
    chips = []
    for label, key in (("Departure", "departure"), ("Return", "return"),
                       ("Duration", "duration"), ("Guests", "guests")):
        if sched.get(key):
            chips.append(f'<div class="chip reveal"><span class="chip-l">{label}</span>'
                         f'<span class="chip-v">{esc(sched[key])}</span></div>')
    chips_html = "".join(chips)

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{esc(data.get('title','Tour Proposal'))} · Como On Boat</title>
<link rel="icon" type="image/png" href="{logo_src(embed)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{{
  --navy:#152038; --navy-2:#0f1830; --navy-3:#1c2c4d;
  --ink:#0b1426; --paper:#f4efe6; --paper-2:#ede4d4;
  --gold:#c9a24b; --gold-soft:#e3c987; --white:#ffffff;
  --muted:#9fb0cd; --line:rgba(255,255,255,.12);
  --serif:'Cormorant Garamond',Georgia,serif;
  --sans:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth}}
body{{font-family:var(--sans);background:var(--navy);color:var(--white);overflow-x:hidden;-webkit-font-smoothing:antialiased}}
img{{display:block;width:100%;height:100%;object-fit:cover}}
h2{{font-family:var(--serif);font-weight:600;font-size:clamp(2.1rem,5vw,3.6rem);line-height:1.05;letter-spacing:-.01em}}
h3{{font-family:var(--serif);font-weight:600;font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.05}}
.wrap{{max-width:1080px;margin:0 auto;padding:0 28px}}
.eyebrow{{display:inline-block;font-size:.72rem;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--gold-soft)}}
.eyebrow.center,.center{{text-align:center}}
.eyebrow.center{{display:block;margin-bottom:14px}}
.lead{{font-size:clamp(1rem,2vw,1.18rem);font-weight:300;line-height:1.7;color:var(--muted);max-width:760px;margin:18px auto 0}}

/* ---- reveal animation ---- */
.reveal{{opacity:0;transform:translateY(34px);transition:opacity 1s cubic-bezier(.16,.84,.44,1) var(--d,0s),transform 1s cubic-bezier(.16,.84,.44,1) var(--d,0s)}}
.reveal.in{{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){{.reveal{{opacity:1!important;transform:none!important}}}}

/* ---- top bar ---- */
.topbar{{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;
  padding:18px 28px;transition:background .4s,padding .4s;mix-blend-mode:normal}}
.topbar.scrolled{{background:rgba(15,24,48,.82);backdrop-filter:blur(12px);padding:12px 28px;border-bottom:1px solid var(--line)}}
.topbar .brand{{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:.18em;font-size:.78rem;text-transform:uppercase}}
.topbar .brand img{{width:38px;height:38px;object-fit:contain}}
.topbar .tb-contact{{font-size:.74rem;color:var(--muted);letter-spacing:.04em}}
@media(max-width:640px){{.topbar .tb-contact{{display:none}}}}

/* ---- hero ---- */
.hero{{position:relative;height:100vh;min-height:600px;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden}}
.hero-parallax{{position:absolute;inset:0;will-change:transform}}
.hero-bg{{position:absolute;inset:-8% 0;background-size:cover;background-position:center;animation:kenburns 22s ease-out infinite alternate;will-change:transform}}
@keyframes kenburns{{from{{transform:scale(1.04)}}to{{transform:scale(1.16) translateY(-1.5%)}}}}
.hero::after{{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,20,38,.55) 0%,rgba(11,20,38,.25) 40%,rgba(21,32,56,.9) 100%)}}
.hero-inner{{position:relative;z-index:2;padding:0 24px}}
.hero .eyebrow{{margin-bottom:18px;opacity:0;animation:fadeUp 1s ease .2s forwards}}
.hero h1{{font-family:var(--serif);font-weight:600;font-size:clamp(2.8rem,8vw,6rem);line-height:.98;letter-spacing:-.015em;
  text-shadow:0 4px 40px rgba(0,0,0,.4);opacity:0;animation:fadeUp 1.1s ease .35s forwards}}
.hero .meta{{margin-top:22px;display:flex;gap:26px;justify-content:center;flex-wrap:wrap;font-size:.82rem;letter-spacing:.16em;
  text-transform:uppercase;color:#e9eef7;opacity:0;animation:fadeUp 1s ease .6s forwards}}
.hero .meta span{{position:relative}}
.hero .meta span+span::before{{content:"";position:absolute;left:-14px;top:50%;width:4px;height:4px;border-radius:50%;background:var(--gold-soft);transform:translateY(-50%)}}
@keyframes fadeUp{{from{{opacity:0;transform:translateY(26px)}}to{{opacity:1;transform:none}}}}
.scrollcue{{position:absolute;bottom:26px;left:50%;transform:translateX(-50%);z-index:3;width:24px;height:40px;border:2px solid rgba(255,255,255,.55);border-radius:14px;opacity:0;animation:fadeUp 1s ease 1s forwards}}
.scrollcue::before{{content:"";position:absolute;top:7px;left:50%;width:4px;height:8px;background:#fff;border-radius:2px;transform:translateX(-50%);animation:cue 1.6s ease-in-out infinite}}
@keyframes cue{{0%{{opacity:0;transform:translate(-50%,0)}}40%{{opacity:1}}80%{{opacity:0;transform:translate(-50%,12px)}}100%{{opacity:0}}}}

/* ---- intro / experience ---- */
.intro{{padding:clamp(80px,12vw,150px) 0}}
.intro h2{{max-width:780px;margin:0 auto;text-align:center}}
.chips{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:48px}}
.chip{{background:var(--navy-3);border:1px solid var(--line);border-radius:14px;padding:18px 20px;text-align:center}}
.chip-l{{display:block;font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold-soft);margin-bottom:6px}}
.chip-v{{font-family:var(--serif);font-size:1.35rem;font-weight:600;color:#fff}}

/* ---- highlights ---- */
.highlight{{display:grid;grid-template-columns:1.15fr .85fr;gap:0;align-items:stretch;min-height:80vh}}
.highlight.side-right{{grid-template-columns:.85fr 1.15fr}}
.highlight.side-right .hl-card{{order:-1}}
.hl-gallery{{display:grid;gap:6px;padding:6px}}
.hl-gallery.count-1{{grid-template-columns:1fr}}
.hl-gallery.count-2{{grid-template-columns:1fr 1fr}}
.hl-gallery.count-3{{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}}
.hl-gallery.count-3 .hl-img:first-child{{grid-column:1 / span 2}}
.hl-img{{overflow:hidden;border-radius:8px;min-height:200px}}
.hl-img img{{transition:transform 1.2s cubic-bezier(.16,.84,.44,1)}}
.hl-img:hover img{{transform:scale(1.06)}}
.hl-card{{display:flex;flex-direction:column;justify-content:center;padding:clamp(30px,5vw,70px);position:relative;background:var(--navy-2)}}
.hl-num{{font-family:var(--serif);font-size:clamp(3rem,7vw,5.5rem);line-height:1;color:transparent;-webkit-text-stroke:1px var(--gold);margin-bottom:8px;opacity:.55}}
.hl-card .eyebrow{{margin-bottom:10px}}
.hl-card p{{margin-top:18px;font-weight:300;line-height:1.75;color:var(--muted);font-size:1.02rem}}
@media(max-width:820px){{.highlight,.highlight.side-right{{grid-template-columns:1fr}}.highlight.side-right .hl-card{{order:0}}.hl-gallery{{min-height:46vh}}}}

/* ---- route ---- */
.route{{padding:clamp(70px,10vw,120px) 0;background:var(--navy-2)}}
.route-list{{list-style:none;max-width:680px;margin:40px auto 0;display:flex;flex-direction:column;gap:2px;position:relative}}
.route-list::before{{content:"";position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:linear-gradient(var(--gold),transparent)}}
.route-list li{{position:relative;padding:12px 0 12px 34px;font-size:1.05rem;font-weight:300;color:#e9eef7}}
.route-list .dot{{position:absolute;left:0;top:50%;transform:translateY(-50%);width:14px;height:14px;border-radius:50%;background:var(--navy-2);border:2px solid var(--gold)}}

/* ---- boat ---- */
.boat{{padding:clamp(70px,10vw,120px) 0}}
.boat-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:46px;padding:0 8px}}
.boat-tile{{overflow:hidden;border-radius:8px;aspect-ratio:3/4}}
.boat-tile img{{transition:transform 1.2s cubic-bezier(.16,.84,.44,1)}}
.boat-tile:hover img{{transform:scale(1.07)}}
.boat-tile:nth-child(4n+1){{aspect-ratio:3/4}}
@media(max-width:820px){{.boat-grid{{grid-template-columns:1fr 1fr}}}}

/* ---- extras ---- */
.extras{{padding:clamp(70px,10vw,120px) 0;background:var(--navy-2)}}
.extra-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:48px}}
.extra-card{{text-align:center}}
.extra-img{{aspect-ratio:1;border-radius:16px;overflow:hidden;margin-bottom:20px;box-shadow:0 24px 50px -24px rgba(0,0,0,.6)}}
.extra-img img{{transition:transform 1s ease}}
.extra-card:hover .extra-img img{{transform:scale(1.06)}}
.extra-card h4{{font-family:var(--serif);font-size:1.5rem;font-weight:600;margin-bottom:6px}}
.extra-card p{{font-size:.86rem;color:var(--muted);font-weight:300;letter-spacing:.02em}}
@media(max-width:760px){{.extra-grid{{grid-template-columns:1fr;max-width:340px;margin:48px auto 0}}}}

/* ---- pricing ---- */
.pricing{{padding:clamp(80px,12vw,150px) 0;background:radial-gradient(120% 80% at 50% 0%,var(--navy-3),var(--navy) 70%)}}
.included{{list-style:none;display:flex;flex-wrap:wrap;gap:10px 14px;justify-content:center;max-width:680px;margin:34px auto 0}}
.included li{{font-size:.84rem;font-weight:300;color:#e9eef7;padding:8px 16px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.03)}}
.included li::before{{content:"✦ ";color:var(--gold-soft)}}
.price-breakdown{{display:flex;align-items:baseline;justify-content:center;gap:14px;margin-top:40px;font-family:var(--serif);font-size:1.5rem;color:var(--muted)}}
.price-breakdown .plus{{color:var(--gold)}}
.price-breakdown em{{font-family:var(--sans);font-size:.7rem;font-style:normal;text-transform:uppercase;letter-spacing:.14em;color:var(--muted)}}
.total{{text-align:center;margin-top:18px}}
.total-label{{display:block;font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:var(--gold-soft);margin-bottom:6px}}
.total-num{{font-family:var(--serif);font-weight:700;font-size:clamp(3.4rem,11vw,7rem);line-height:1;color:#fff;
  background:linear-gradient(180deg,#fff,var(--gold-soft));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}

/* ---- footer ---- */
.footer{{padding:clamp(70px,10vw,120px) 28px;text-align:center;border-top:1px solid var(--line)}}
.footer img{{width:96px;height:96px;object-fit:contain;margin:0 auto 22px;opacity:.9}}
.footer h2{{margin-bottom:26px}}
.footer .contacts{{display:flex;gap:30px;justify-content:center;flex-wrap:wrap;font-size:.9rem;color:#e9eef7}}
.footer .contacts a{{color:#e9eef7;text-decoration:none;border-bottom:1px solid var(--gold);padding-bottom:2px;transition:color .2s}}
.footer .contacts a:hover{{color:var(--gold-soft)}}
.footer .fine{{margin-top:30px;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}}

/* ---- progress bar ---- */
.progress{{position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,var(--gold),var(--gold-soft));z-index:60}}
</style>
</head>
<body>
<div class="progress" id="progress"></div>
<header class="topbar" id="topbar">
  <span class="brand"><img src="{logo_src(embed)}" alt="Como On Boat">Como On Boat</span>
  <span class="tb-contact">{esc(c.get('phone',''))} &nbsp;·&nbsp; {esc(c.get('email',''))}</span>
</header>

<section class="hero">
  <div class="hero-parallax" id="heroPar">
    <div class="hero-bg" style="background-image:url('{img_src(data.get('cover_image'), embed)}')"></div>
  </div>
  <div class="hero-inner">
    <span class="eyebrow">{esc(data.get('subtitle','Private Tour Proposal'))}</span>
    <h1>{esc(data.get('title','Lake Como Tour'))}</h1>
    <div class="meta">
      {''.join(f'<span>{esc(x)}</span>' for x in [data.get('date'), data.get('location')] if x)}
    </div>
  </div>
  <div class="scrollcue"></div>
</section>

<section class="intro">
  <div class="wrap">
    <h2 class="reveal">{esc(data.get('intro_title','The Experience'))}</h2>
    <p class="lead reveal">{esc(data.get('intro',''))}</p>
    <div class="chips">{chips_html}</div>
  </div>
</section>

{render_itinerary(data.get('itinerary'))}
{render_highlights(data.get('highlights', []), embed)}
{render_boat(data.get('boat'), embed)}
{render_extras(data.get('extras', []), embed)}
{render_pricing(data.get('pricing'), data.get('included'))}

<footer class="footer">
  <img src="{logo_src(embed)}" alt="Como On Boat">
  <h2>Ready to set sail?</h2>
  <div class="contacts">
    {f'<a href="mailto:{esc(c.get("email"))}">{esc(c.get("email"))}</a>' if c.get('email') else ''}
    {f'<a href="https://instagram.com/{esc(c.get("ig","").lstrip("@"))}">IG: {esc(c.get("ig"))}</a>' if c.get('ig') else ''}
    {f'<a href="tel:{esc(c.get("phone","").replace(" ",""))}">{esc(c.get("phone"))}</a>' if c.get('phone') else ''}
  </div>
  <p class="fine">Como On Boat · Luxury Rent · Lake Como, Italy</p>
</footer>

<script>
// reveal on scroll
const io=new IntersectionObserver((es)=>{{es.forEach(e=>{{if(e.isIntersecting){{e.target.classList.add('in');io.unobserve(e.target);}}}})}},{{threshold:.18}});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

// topbar + progress + parallax hero
const tb=document.getElementById('topbar'),pg=document.getElementById('progress'),hp=document.getElementById('heroPar');
function onScroll(){{
  const y=window.scrollY,h=document.documentElement.scrollHeight-window.innerHeight;
  tb.classList.toggle('scrolled',y>40);
  pg.style.width=(h>0?(y/h*100):0)+'%';
  if(hp&&y<window.innerHeight) hp.style.transform=`translateY(${{y*0.25}}px)`;
}}
window.addEventListener('scroll',onScroll,{{passive:true}});onScroll();

// animated total counter
const tn=document.querySelector('.total-num');
if(tn){{
  const target=+tn.dataset.target||0, cur=(tn.textContent.match(/[^0-9.,]+/)||['€'])[0];
  const co=new IntersectionObserver((es)=>{{es.forEach(e=>{{if(e.isIntersecting){{
    let t0=null,dur=1500;
    function step(ts){{t0=t0||ts;const p=Math.min((ts-t0)/dur,1);const ease=1-Math.pow(1-p,3);
      tn.textContent=cur+Math.round(target*ease).toLocaleString('it-IT');if(p<1)requestAnimationFrame(step);}}
    requestAnimationFrame(step);co.unobserve(e.target);}}}})}},{{threshold:.6}});
  co.observe(tn);
}}
</script>
</body>
</html>"""
    return page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("content")
    ap.add_argument("--out")
    ap.add_argument("--no-embed", action="store_true", help="reference images instead of embedding")
    args = ap.parse_args()

    with open(args.content, encoding="utf-8") as f:
        data = json.load(f)

    embed = not args.no_embed
    out = args.out or os.path.join(
        HERE, "..", "..", "..", "proposte",
        (data.get("slug") or slugify(data.get("title", "proposal"))) + ".html",
    )
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    html_str = render(data, embed)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html_str)
    size = os.path.getsize(out) / 1024
    print(f"✓ Wrote {out}  ({size:.0f} KB, images {'embedded' if embed else 'linked'})")


if __name__ == "__main__":
    main()
