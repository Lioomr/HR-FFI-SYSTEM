/* Deterministic timeline: window.render(t) seeks every animation to time t (seconds). */
const W = 1920, H = 1080;
const stage = document.getElementById("stage");
const anims = [];
const EASE = "cubic-bezier(.2,.8,.2,1)";
function A(el, kf, start, dur, ease = EASE) {
  const a = el.animate(kf, { duration: Math.max(1, dur * 1000), fill: "both", easing: ease });
  a.pause();
  anims.push({ a, start, dur });
  return a;
}
function E(parent, cls, html = "", css = "", tag = "div") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  if (css) e.style.cssText = css;
  parent.appendChild(e);
  return e;
}
const fadeIn = (el, s, d = 0.7, dy = 28, dx = 0) =>
  A(el, [{ opacity: 0, transform: `translate(${dx}px,${dy}px)` }, { opacity: 1, transform: "translate(0,0)" }], s, d);
const pop = (el, s, d = 0.6) =>
  A(el, [{ opacity: 0, transform: "scale(.82)" }, { opacity: 1, transform: "scale(1)" }], s, d, "cubic-bezier(.2,1.4,.3,1)");

/* ---------- scene timing ---------- */
const AUDIO_LEAD = 0.45;   // narration starts this long after the scene starts
const TAIL = 0.9;          // hold after the narration
const scenes = [];
let cursor = 0;

/* narration (plain, for subtitles) + estimated duration fallback */
const NARR = [
  "كم من الوقت تضيّع شركتك كل شهر في ملفات الإكسل، والأوراق، ومتابعة الموافقات من مكتب إلى مكتب؟",
  "نقدّم لكم نظام إف إف آي لإدارة الموارد البشرية؛ منصّة واحدة متكاملة، تجمع الموظفين، والإجازات، والحضور، والرواتب، والموافقات في مكان واحد.",
  "صُمّم النظام لكل أطراف المنشأة: الموظف، والمدير المباشر، والموارد البشرية، والمدير المالي، والرئيس التنفيذي، ومدير النظام. ولكلٍّ منهم لوحة خاصة بصلاحياته.",
  "الموظف يدخل إلى بوابته الشخصية، فيجد أمامه طلباته الجارية، ورصيد إجازاته، وإعلانات الشركة، وكل خدماته في مكان واحد.",
  "تقديم الإجازة إلكتروني بالكامل، ويمرّ الطلب بمسار اعتماد واضح: الموظف البديل، ثم المدير المباشر، ثم الموارد البشرية، ثم الرئيس التنفيذي. ويرى الجميع في أي مرحلة وصل الطلب، ومن ينتظر قراره، مع سجلٍّ كامل لكل قرار.",
  "وبالمنطق نفسه تُدار طلبات السُّلف عبر المدير والموارد البشرية والمدير المالي والرئيس التنفيذي، وكذلك طلبات الاستئذان، وعُهد الموظفين، وتسوية الإجازة السنوية.",
  "وعندما يسافر المدير أو يغيب، يفوّض صلاحية الاعتماد لزميل آخر لفترة محددة، فلا يتوقف عمل الشركة أبدًا.",
  "ويرتبط الحضور والانصراف بأجهزة البصمة، مع تحديد مواقع العمل جغرافيًّا، وسياسة دوام قابلة للضبط، وطلبات تصحيح الحضور، وإشعارات التأخير.",
  "أما المخالفات فتُطبَّق عليها لائحة الجزاءات المعتمدة بشفافية تامة؛ تُسجَّل المخالفة، ويطّلع عليها الموظف، وله أن يُقرَّ بها أو يعترض عليها.",
  "والرواتب تُحتسب في دورة شهرية واحدة، مع الاستقطاعات والجزاءات، وتصدر كشوف رواتب لكل موظف يطّلع عليها بنفسه، مع تقارير جاهزة للإدارة المالية.",
  "ويرافق النظام الموظف طوال رحلته: عروض العمل، وملف الموظف الشامل بكل مستنداته، وتنبيهات استباقية قبل انتهاء الهوية أو الجواز أو العقد، وقرارات تجديد العقود، وتقييم الأداء.",
  "ويمكنكم استيراد بيانات موظفيكم من ملف إكسل في دقائق، وإصدار النماذج الرسمية بصيغة بي دي إف، وتتبّع أصول الشركة من مركبات وأجهزة، وإسنادها للموظفين واستردادها بملصقاتٍ مطبوعة.",
  "وللتواصل الفعّال، تنشرون الإعلانات والاجتماعات لمن تختارون، وتصل الإشعارات فورًا داخل النظام، وعبر الواتساب والبريد الإلكتروني.",
  "ويدعم النظام تعدد الشركات في منصّة واحدة، مع عزل كامل لبيانات كل شركة، وواجهة بالعربية والإنجليزية، بدعم كامل للكتابة من اليمين إلى اليسار.",
  "والأمان في صلب النظام: صلاحيات حسب الدور تُفرض من الخادم، وسجلّ تدقيق لكل عملية حساسة، وملفات محمية، وتسجيل دخول آمن.",
  "ويصل النظام إلى جيب الموظف عبر تطبيق الجوال: الحضور، والإجازات، وكشف الراتب، والإشعارات، في أي وقت ومن أي مكان.",
  "نظام إف إف آي للموارد البشرية؛ وقتٌ أقل في الإجراءات، ووضوحٌ أكثر في القرارات. تواصلوا معنا اليوم لنرتّب لكم عرضًا تجريبيًا.",
];
const est = (s) => s.split(/\s+/).length / 2.25 + 0.5;
const AUD = NARR.map((s, i) => (window.DUR && window.DUR[i + 1]) || est(s));

function addScene(i, build) {
  const aud = AUD[i];
  const dur = AUDIO_LEAD + aud + TAIL;
  const root = E(stage, "scene");
  const sc = { i, root, t0: cursor, dur, aud, a0: cursor + AUDIO_LEAD };
  const FIN = i === 0 ? 0.01 : 0.55, FOUT = i === NARR.length - 1 ? 0.01 : 0.5;
  A(root, [{ opacity: 0 }, { opacity: 1 }], sc.t0 - FIN * 0.0, FIN);
  A(root, [{ opacity: 1 }, { opacity: 0 }], sc.t0 + dur - FOUT, FOUT, "linear");
  build(sc);
  subtitles(sc);
  scenes.push(sc);
  cursor += dur - 0.25; // slight overlap for crossfade
}

function subtitles(sc) {
  const text = NARR[sc.i].replace(/[ًٌٍَُِّْ]/g, "");
  const parts = text.split(/(?<=[،؛.؟:])\s*/).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const p of parts) {
    if (!cur) cur = p;
    else if ((cur + " " + p).split(/\s+/).length <= 11) cur += " " + p;
    else { chunks.push(cur); cur = p; }
  }
  if (cur) chunks.push(cur);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let t = sc.a0;
  chunks.forEach((c) => {
    const d = (c.length / total) * sc.aud;
    const el = E(sc.root, "", c.replace(/[،؛.؟:]+$/, ""), `position:absolute;left:50%;bottom:46px;transform:translateX(-50%);max-width:1560px;width:max-content;text-align:center;font-size:40px;font-weight:700;line-height:1.5;padding:12px 38px;border-radius:18px;background:rgba(10,12,15,.78);border:1px solid rgba(255,255,255,.14);direction:rtl;opacity:0;z-index:40;text-shadow:0 2px 8px rgba(0,0,0,.5)`);
    A(el, [{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: 1, offset: .92 }, { opacity: 0 }], t, d + 0.05, "linear");
    t += d;
  });
}

/* ---------- components ---------- */
function win(sc, o) {
  const w = o.w, vh = Math.round(w * 9 / 16), h = vh + 34;
  const el = E(sc.root, "win", "", `left:${o.x}px;top:${o.y}px;width:${w}px;height:${h}px;${o.css || ""}`);
  el.innerHTML = `<div class="bar"><i></i><i></i><i></i><b>${o.title || ""}</b></div><div class="vp"><div class="layer" style="width:${w}px;height:${vh}px"><img src="img/${o.img}.jpg"></div></div>`;
  const layer = el.querySelector(".layer");
  const tf = ([cx, cy, z]) => {
    cx = Math.min(Math.max(cx, .5 / z), 1 - .5 / z); cy = Math.min(Math.max(cy, .5 / z), 1 - .5 / z);
    return `translate(${(w / 2 - cx * z * w).toFixed(1)}px,${(vh / 2 - cy * z * vh).toFixed(1)}px) scale(${z})`;
  };
  const from = o.from || [.5, .5, 1], to = o.to || from;
  A(layer, [{ transform: tf(from) }, { transform: tf(to) }], o.t0 ?? sc.t0 + .3, o.zd ?? Math.max(2, sc.dur - 1.2), "cubic-bezier(.45,.05,.25,1)");
  const t = o.t ?? sc.t0 + .15;
  const [dx, dy] = o.enter || [-60, 20];
  A(el, [{ opacity: 0, transform: `translate(${dx}px,${dy}px) scale(.94)` }, { opacity: 1, transform: "none" }], t, .8);
  el._layer = layer; el._w = w; el._vh = vh;
  return el;
}
function hl(win_, x, y, w, h, t, d = 1.2) {
  const e = E(win_._layer, "hl", "", `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`);
  A(e, [{ opacity: 0, transform: "scale(1.06)" }, { opacity: 1, transform: "scale(1)", offset: .35 }, { opacity: .6, offset: .7 }, { opacity: 1 }], t, d);
  return e;
}
function tag(win_, text, x, y, t) { // x,y: fractions of the window
  const e = E(win_, "tag", text, `left:${x * 100}%;top:${34 + y * (win_._vh)}px`);
  A(e, [{ opacity: 0, transform: "translateY(16px) scale(.9)" }, { opacity: 1, transform: "none" }], t, .55, "cubic-bezier(.2,1.4,.3,1)");
  return e;
}
function textCol(sc, eyebrow, title, bullets, o = {}) {
  const top = o.top ?? 150;
  const eb = E(sc.root, "eyebrow", `<span>${eyebrow}</span>`, `top:${top}px`);
  fadeIn(eb, sc.t0 + .3, .6, 0, 30);
  const h2 = E(sc.root, "h2", title, `top:${top + 52}px`);
  fadeIn(h2, sc.t0 + .45, .8, 24);
  if (bullets) {
    const ul = E(sc.root, "bul", "", `top:${o.bTop ?? top + 52 + 170}px`, "ul");
    bullets.forEach((b, k) => {
      const li = E(ul, "", b, "", "li");
      fadeIn(li, sc.a0 + 0.8 + k * (sc.aud * 0.7 / bullets.length), .6, 18, 24);
    });
  }
}
function counter(el, from, to, t, d, fmt) {
  // animates textContent via discrete keyframes (deterministic)
  const n = 24; el.textContent = fmt(from);
  const steps = [];
  for (let i = 0; i <= n; i++) steps.push({ opacity: 1, offset: i / n, "--v": i });
  const holder = { el, from, to, fmt };
  holder.t = t; holder.d = d; counters.push(holder);
}
const counters = [];
const demoTag = (sc) => {};

/* ---------- scenes ---------- */
// 1. Hook
addScene(0, (sc) => {
  const q = E(sc.root, "", "كم من الوقت تضيّع شركتك<br><em style='font-style:normal;color:#F6821F'>كل شهر</em> في الأوراق والملفات المتفرقة؟", "position:absolute;left:0;right:0;top:350px;text-align:center;font-size:84px;font-weight:800;line-height:1.35;direction:rtl;z-index:3");
  fadeIn(q, sc.t0 + .4, 1.0, 40);
  const pains = ["ملفات إكسل متفرقة", "أوراق وتواقيع", "موافقات ضائعة", "أخطاء في الرواتب", "متابعة يدوية للحضور", "أين وصل طلبي؟", "تأخّر الإجراءات", "بيانات غير محدّثة"];
  const pos = [[110, 170, -6], [1400, 190, 5], [50, 690, 4], [1450, 700, -5], [420, 790, -3], [1130, 800, 6], [700, 130, 3], [800, 640, -4]];
  pains.forEach((p, k) => {
    const [x, y, r] = pos[k];
    const c = E(sc.root, "chip", p, `position:absolute;left:${x}px;top:${y}px;transform:rotate(${r}deg);background:rgba(246,130,31,.12);border-color:rgba(246,130,31,.45);color:#ffd9b8;z-index:2`);
    const s = sc.t0 + .8 + k * .45;
    A(c, [{ opacity: 0, transform: `translateY(40px) rotate(${r}deg) scale(.8)` }, { opacity: 1, transform: `translateY(0) rotate(${r}deg) scale(1)` }], s, .7, "cubic-bezier(.2,1.3,.3,1)");
    A(c, [{ translate: "0 0" }, { translate: `${(k % 2 ? -1 : 1) * 24}px ${(k % 3 - 1) * 20}px` }], sc.t0, sc.dur, "ease-in-out");
  });
  const line = E(sc.root, "", "", "position:absolute;left:0;top:540px;height:6px;width:100%;background:linear-gradient(90deg,transparent,#F6821F,transparent);opacity:0;z-index:1");
  A(line, [{ opacity: 0, transform: "scaleX(0)" }, { opacity: .9, transform: "scaleX(1)" }], sc.t0 + sc.dur - 2.2, 1.6);
});

// 2. Intro
addScene(1, (sc) => {
  const pw = E(sc.root, "", "", "position:absolute;left:0;right:0;top:130px;display:flex;justify-content:center;z-index:3");
  const plate = E(pw, "", `<img src="img/logo.png" style="height:130px;display:block">`, "background:#fff;border-radius:26px;padding:20px 44px;box-shadow:0 20px 60px rgba(0,0,0,.5)");
  pop(plate, sc.t0 + .3, .8);
  const t = E(sc.root, "", "نظام <em style='font-style:normal;color:#F6821F'>FFI</em> للموارد البشرية", "position:absolute;left:0;right:0;top:340px;text-align:center;font-size:104px;font-weight:800;direction:rtl;z-index:3");
  fadeIn(t, sc.t0 + .7, .9, 40);
  const s = E(sc.root, "", "منصّة واحدة متكاملة لإدارة الموظفين والإجازات والحضور والرواتب والموافقات", "position:absolute;left:0;right:0;top:480px;text-align:center;font-size:40px;font-weight:600;color:#c9d0dc;direction:rtl;z-index:3");
  fadeIn(s, sc.t0 + 1.1, .9, 30);
  const row = E(sc.root, "", "", "position:absolute;left:0;right:0;top:545px;display:flex;justify-content:center;gap:16px;direction:rtl;z-index:3");
  ["الموظفون", "الإجازات", "الحضور", "الرواتب", "الموافقات"].forEach((c, k) => {
    const e = E(row, "chip", c, "background:rgba(246,130,31,.14);border-color:rgba(246,130,31,.5)");
    pop(e, sc.t0 + 1.8 + k * .35, .5);
  });
  [["emp_dash", 250, 655], ["hr_dash", 740, 655], ["ceo_dash", 1230, 655]].forEach(([img, x, y], k) => {
    const w = win(sc, { img, x, y, w: 440, title: "", enter: [0, 140], t: sc.t0 + 1.4 + k * .3, from: [.42, .3, 1.1] });
  });
});

// 3. Roles
addScene(2, (sc) => {
  const h = E(sc.root, "", "لوحة تحكم <em style='font-style:normal;color:#F6821F'>لكل دور</em>", "position:absolute;left:0;right:0;top:130px;text-align:center;font-size:76px;font-weight:800;direction:rtl");
  fadeIn(h, sc.t0 + .3, .8, 30);
  const roles = [
    ["👤", "الموظف", "خدمات ذاتية وطلبات"], ["👔", "المدير المباشر", "فريقه وموافقاته"], ["🧑‍💼", "الموارد البشرية", "الملفات والسياسات"],
    ["💰", "المدير المالي", "السُّلف والقرارات المالية"], ["🏢", "الرئيس التنفيذي", "القرار النهائي"], ["🛡️", "مدير النظام", "الإعدادات والتدقيق"],
  ];
  roles.forEach(([ic, n, d], k) => {
    const col = k % 3, row = Math.floor(k / 3);
    const x = 1920 - 130 - 520 - col * 560, y = 290 + row * 300;
    const c = E(sc.root, "card", `<div class="ico" style="width:104px;height:104px;font-size:56px;margin:26px auto 12px">${ic}</div><div class="big" style="font-size:42px">${n}</div><div style="font-size:28px;color:#aab3c2;margin-top:6px">${d}</div>`, `left:${x}px;top:${y}px;width:520px;height:250px`);
    A(c, [{ opacity: 0, transform: "translateY(50px) scale(.9)" }, { opacity: 1, transform: "none" }], sc.a0 + .6 + k * (sc.aud * .13), .7, "cubic-bezier(.2,1.2,.3,1)");
  });
});

// 4. Employee portal
addScene(3, (sc) => {
  const w = win(sc, { img: "emp_dash", x: 60, y: 150, w: 1130, title: "بوابة الموظف", from: [.42, .5, 1], to: [.42, .44, 1.22] });
  hl(w, .02, .27, .79, .35, sc.t0 + 2.2);
  tag(w, "طلباتي الجارية", .08, .1, sc.t0 + 2.8);
  textCol(sc, "بوابة الموظف", "كل خدماتك <em>في مكان واحد</em>", ["طلباتي الجارية وحالتها", "رصيد الإجازات وكشوف الرواتب", "إعلانات الشركة والإشعارات", "طلب إجازة أو سلفة أو استئذان بضغطة"]);
});

// 5. Leave approval trail
addScene(4, (sc) => {
  const w = win(sc, { img: "emp_leave1", x: 60, y: 150, w: 1130, title: "طلب إجازة · مسار الموافقة", from: [.46, .5, 1], to: [.42, .62, 1.25] });
  hl(w, .07, .38, .7, .6, sc.t0 + 2.6);
  tag(w, "مسار اعتماد واضح", .3, .1, sc.t0 + 3.2);
  const w2 = win(sc, { img: "ceo_leaves", x: 640, y: 540, w: 560, title: "صندوق الاعتماد", t: sc.a0 + sc.aud * .55, enter: [40, 60], from: [.42, .36, 1.35], css: "z-index:6" });
  textCol(sc, "الإجازات", "مسار اعتماد <em>شفاف</em>", ["الموظف البديل ← المدير المباشر", "الموارد البشرية ← الرئيس التنفيذي", "شريط تقدّم يُظهر المرحلة الحالية", "من ينتظر القرار الآن؟ يظهر فورًا", "سجلّ كامل لكل قرار + نموذج PDF"], { bTop: 410 });
});

// 6. Other workflows
addScene(5, (sc) => {
  const pos = [[60, 150], [635, 150], [60, 520], [635, 520]];
  const items = [["emp_loan1", "السُّلف", [.4, .7, 1.2]], ["cfo_loan1", "قرار المدير المالي", [.4, .55, 1.15]], ["hr_assets", "العُهد", [.45, .55, 1.3]], ["mgr_reqs", "الطلبات والاستئذان", [.45, .55, 1.35]]];
  items.forEach(([img, label, f], k) => {
    const w = win(sc, { img, x: pos[k][0], y: pos[k][1], w: 555, title: label, from: [.5, .5, 1], to: f, t: sc.a0 + .3 + k * (sc.aud * .16), enter: [0, 60] });
    tag(w, label, .06, .84, sc.a0 + .8 + k * (sc.aud * .16));
  });
  textCol(sc, "طلبات متعددة", "كل الطلبات <em>بالمنطق نفسه</em>", ["السُّلف: مدير ← موارد بشرية ← مالي ← تنفيذي", "الاستئذان أثناء الدوام", "عُهد الموظفين وطلبات الإرجاع", "تسوية الإجازة السنوية"]);
});

// 7. Delegation (illustrative diagram)
addScene(6, (sc) => {
  const mk = (x, y, ico, t1, t2, k) => {
    const c = E(sc.root, "card", `<div class="ico" style="width:96px;height:96px;font-size:52px;margin:24px auto 10px">${ico}</div><div class="big" style="font-size:36px">${t1}</div><div style="font-size:26px;color:#aab3c2">${t2}</div>`, `left:${x}px;top:${y}px;width:330px;height:230px`);
    A(c, [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }], sc.t0 + .6 + k * .5, .7);
  };
  mk(850, 250, "🧳", "المدير المباشر", "مسافر / غائب", 0);
  mk(60, 250, "🤝", "الزميل المفوَّض", "يعتمد نيابةً عنه", 2);
  const arrow = E(sc.root, "", "", "position:absolute;left:400px;top:350px;width:430px;height:8px;background:linear-gradient(270deg,#F6821F,#FF9D4D);border-radius:8px;transform-origin:100% 50%;box-shadow:0 0 24px rgba(246,130,31,.7)");
  A(arrow, [{ transform: "scaleX(0)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1 }], sc.t0 + 1.3, 1.0);
  const lab = E(sc.root, "tag", "تفويض لفترة محددة", "left:470px;top:275px;position:absolute");
  A(lab, [{ opacity: 0 }, { opacity: 1 }], sc.t0 + 2.0, .5);
  const req = E(sc.root, "card", `<div style="display:flex;align-items:center;justify-content:space-between;padding:28px 34px;direction:rtl"><div style="text-align:right"><div class="big" style="font-size:38px">طلب إجازة سنوية</div><div style="font-size:28px;color:#aab3c2;margin-top:6px">أحمد الزهراني · ٧ أيام</div></div><div class="chip" style="background:rgba(246,130,31,.2);border-color:#F6821F;font-size:28px">بانتظار اعتمادك (تفويض)</div></div>`, "left:60px;top:560px;width:1120px;height:150px;text-align:right");
  A(req, [{ opacity: 0, transform: "translateX(-80px)" }, { opacity: 1, transform: "none" }], sc.a0 + sc.aud * .45, .8);
  const ok = E(sc.root, "chip", "✓ تم الاعتماد نيابةً عن المدير · مسجَّل في سجل القرارات", "position:absolute;left:60px;top:750px;background:rgba(40,200,64,.14);border-color:rgba(40,200,64,.55);color:#9ff0ae;font-size:30px");
  fadeIn(ok, sc.a0 + sc.aud * .75, .6, 20);
  textCol(sc, "التفويض", "لا يتوقف العمل <em>أبدًا</em>", ["تفويض صلاحية الاعتماد لزميل", "بفترة بداية ونهاية محددة", "قرار المفوَّض يُسجَّل باسمه", "الطلبات تصل مباشرة إلى صندوقه"]);
});

// 8. Attendance
addScene(7, (sc) => {
  const w = win(sc, { img: "hr_attend", x: 60, y: 150, w: 1130, title: "سجلات الحضور", from: [.45, .45, 1], to: [.5, .35, 1.35] });
  hl(w, .64, .27, .17, .15, sc.t0 + 2.4);
  tag(w, "نسبة الحضور", .2, .08, sc.t0 + 3.0);
  const w2 = win(sc, { img: "admin_biotime", x: 300, y: 330, w: 900, title: "ربط أجهزة البصمة", t: sc.a0 + sc.aud * .5, enter: [30, 70], from: [.45, .35, 1.3], css: "z-index:6" });
  textCol(sc, "الحضور", "حضور دقيق <em>مرتبط بالبصمة</em>", ["ربط مباشر بأجهزة البصمة", "مواقع العمل الجغرافية", "سياسة دوام قابلة للضبط", "طلبات تصحيح الحضور بموافقة المدير", "إشعارات التأخير"], { bTop: 410 });
});

// 9. Penalties
addScene(8, (sc) => {
  const w = win(sc, { img: "hr_pen", x: 60, y: 150, w: 1130, title: "الجزاءات والمخالفات", from: [.45, .45, 1], to: [.42, .62, 1.35] });
  hl(w, .02, .62, .8, .14, sc.t0 + 2.8);
  const w2 = win(sc, { img: "emp_pen", x: 640, y: 560, w: 560, title: "جزاءاتي", t: sc.a0 + sc.aud * .55, enter: [40, 60], from: [.45, .35, 1.3], css: "z-index:6" });
  tag(w2, "الموظف يقرّ أو يعترض", .2, .75, sc.a0 + sc.aud * .65);
  textCol(sc, "الجزاءات", "لائحة جزاءات <em>عادلة وشفافة</em>", ["كتالوج مخالفات وفق اللائحة المعتمدة", "درجات تكرار وإجراءات محددة", "الموظف يطّلع ويُقرّ أو يعترض", "ربط الاستقطاعات بالرواتب"], { bTop: 410 });
});

// 10. Payroll
addScene(9, (sc) => {
  const w = win(sc, { img: "hr_payroll1", x: 60, y: 150, w: 1130, title: "دورة الرواتب", from: [.45, .45, 1], to: [.4, .4, 1.35] });
  hl(w, .02, .27, .78, .36, sc.t0 + 2.6);
  const kp = E(sc.root, "", "", "position:absolute;left:1250px;top:690px;display:flex;gap:14px;direction:rtl;z-index:5");
  [["١١", "موظفًا"], ["٢٤٧٬٥٠٠", "ر.س صافي"], ["١", "ضغطة"]].forEach(([n, l], k) => {
    const c = E(kp, "card", `<div class="big" style="font-size:44px;color:#F6821F">${n}</div><div style="font-size:21px;color:#b6beca;margin-top:2px">${l}</div>`, `position:relative;width:${k === 1 ? 250 : 170}px;height:112px;padding-top:12px`);
    A(c, [{ opacity: 0, transform: "translateY(30px)" }, { opacity: 1, transform: "none" }], sc.a0 + 1.2 + k * .6, .6);
  });
  textCol(sc, "الرواتب", "رواتب <em>بضغطة واحدة</em>", ["دورة شهرية واحدة لكل شركة", "الاستقطاعات والجزاءات تلقائيًا", "كشف راتب لكل موظف", "تقارير جاهزة للإدارة المالية"], { bTop: 410 });
});

// 11. Lifecycle
addScene(10, (sc) => {
  const w = win(sc, { img: "hr_emp8", x: 60, y: 150, w: 1130, title: "ملف الموظف", from: [.5, .5, 1], to: [.42, .32, 1.45] });
  hl(w, .03, .2, .78, .3, sc.t0 + 2.5);
  const w2 = win(sc, { img: "hr_contracts", x: 560, y: 520, w: 640, title: "قرارات تجديد العقود", t: sc.a0 + sc.aud * .5, enter: [30, 70], from: [.45, .3, 1.3], css: "z-index:6" });
  textCol(sc, "دورة حياة الموظف", "من التعيين <em>إلى التجديد</em>", ["عروض العمل وإقرار مباشرة العمل", "ملف شامل بكل المستندات", "تنبيهات قبل انتهاء الهوية والجواز والعقد", "قرارات تجديد العقود وتقييم الأداء"], { bTop: 410 });
});

// 12. Productivity tools
addScene(11, (sc) => {
  const items = [["hr_import", "استيراد من Excel", 60, 150, [.5, .3, 1.3]], ["hr_templates", "نماذج PDF رسمية", 340, 340, [.42, .58, 1.2]], ["hr_assets", "الأصول والعُهد", 620, 530, [.45, .55, 1.3]]];
  items.forEach(([img, label, x, y, f], k) => {
    const w = win(sc, { img, x, y, w: 560, title: label, from: [.5, .5, 1], to: f, t: sc.a0 + .3 + k * (sc.aud * .22), enter: [0, 70], css: `z-index:${3 + k}` });
    tag(w, label, .05, .86, sc.a0 + .8 + k * (sc.aud * .22));
  });
  textCol(sc, "أدوات يومية", "اختصر <em>الأعمال المتكررة</em>", ["استيراد الموظفين من ملف Excel", "نماذج رسمية بصيغة PDF", "مركبات وأجهزة الشركة", "إسناد واسترداد بملصقات مطبوعة"]);
});

// 13. Communications
addScene(12, (sc) => {
  const mk = (x, ico, title, body, col, k) => {
    const c = E(sc.root, "card", `<div style="display:flex;align-items:center;gap:14px;padding:20px 22px 8px;direction:rtl"><div class="ico" style="width:64px;height:64px;font-size:34px;background:${col}22;border-color:${col}">${ico}</div><div class="big" style="font-size:30px">${title}</div></div><div style="margin:8px 20px;padding:16px 18px;border-radius:16px;background:rgba(255,255,255,.08);font-size:25px;line-height:1.55;text-align:right;direction:rtl">${body}</div>`, `left:${x}px;top:160px;width:360px;height:235px`);
    A(c, [{ opacity: 0, transform: "translateY(50px) scale(.92)" }, { opacity: 1, transform: "none" }], sc.a0 + 1.0 + k * (sc.aud * .2), .7, "cubic-bezier(.2,1.3,.3,1)");
  };
  mk(60, "🔔", "داخل النظام", "طلب إجازة جديد بانتظار موافقتك", "#F6821F", 2);
  mk(450, "💬", "واتساب", "تمت الموافقة على طلب السلفة ✅", "#25D366", 1);
  mk(840, "✉️", "البريد الإلكتروني", "إعلان جديد: اجتماع الإدارة الشهري", "#4C8DFF", 0);
  const w = win(sc, { img: "hr_ann", x: 60, y: 430, w: 640, title: "إدارة الإعلانات", from: [.5, .5, 1], to: [.45, .3, 1.7], t: sc.a0 + 1.2, enter: [0, 60] });
  const w2 = win(sc, { img: "admin_wa", x: 740, y: 430, w: 460, title: "تكامل واتساب", from: [.5, .5, 1], to: [.55, .5, 1.5], t: sc.a0 + 1.8, enter: [0, 60] });
  textCol(sc, "التواصل", "إشعارات <em>تصل فورًا</em>", ["إعلانات واجتماعات لمن تختارون", "إشعارات داخل النظام", "واتساب وبريد إلكتروني", "جمهور محدد: الشركة أو أفراد"], { bTop: 410 });
});

// 14. Multi-company + bilingual
addScene(13, (sc) => {
  const w1 = win(sc, { img: "hr_dash", x: 60, y: 150, w: 555, title: "العربية · RTL", from: [.45, .35, 1], to: [.42, .3, 1.35], t: sc.t0 + .5, enter: [0, 60] });
  const w2 = win(sc, { img: "hrEN_dash", x: 635, y: 150, w: 555, title: "English · LTR", from: [.55, .35, 1], to: [.58, .3, 1.35], t: sc.t0 + 1.0, enter: [0, 60] });
  const row = E(sc.root, "", "", "position:absolute;left:60px;top:560px;width:1130px;display:flex;gap:18px;justify-content:center;direction:rtl");
  ["المكتب الرئيسي", "شركة ١", "شركة ٢", "شركة ٣"].forEach((n, k) => {
    const c = E(row, "card", `<div class="ico" style="width:70px;height:70px;font-size:34px;margin:18px auto 6px">🏢</div><div class="big" style="font-size:30px">${n}</div><div style="font-size:21px;color:#aab3c2">بياناتها معزولة</div>`, `position:relative;width:260px;height:160px`);
    A(c, [{ opacity: 0, transform: "translateY(40px) scale(.9)" }, { opacity: 1, transform: "none" }], sc.a0 + .8 + k * .45, .6, "cubic-bezier(.2,1.3,.3,1)");
  });
  const sw = E(sc.root, "chip", "⇄ تبديل الشركة بضغطة", "position:absolute;left:380px;top:760px;font-size:30px;background:rgba(246,130,31,.18);border-color:#F6821F");
  fadeIn(sw, sc.a0 + 3, .6, 20);
  textCol(sc, "منصّة واحدة", "عدة شركات <em>ولغتان</em>", ["شركات وفروع في منصّة واحدة", "عزل كامل لبيانات كل شركة", "واجهة بالعربية والإنجليزية", "دعم كامل لاتجاه RTL"]);
});

// 15. Security
addScene(14, (sc) => {
  const w = win(sc, { img: "admin_audit", x: 60, y: 150, w: 1130, title: "سجلّ التدقيق", from: [.5, .5, 1], to: [.45, .6, 1.35] });
  hl(w, .02, .34, .78, .17, sc.t0 + 2.6);
  const row = E(sc.root, "", "", "position:absolute;left:60px;top:850px;display:flex;gap:16px;direction:rtl");
  [["🔐", "صلاحيات من الخادم"], ["📜", "سجلّ تدقيق"], ["🗂️", "ملفات محمية"], ["🔑", "دخول آمن"]].forEach(([i, t], k) => {
    const c = E(row, "chip", `${i} ${t}`, "position:relative;font-size:26px;padding:8px 20px");
    pop(c, sc.a0 + 1.5 + k * .5, .5);
  });
  textCol(sc, "الأمان والحوكمة", "أمان في <em>صلب النظام</em>", ["صلاحيات حسب الدور تُفرض من الخادم", "سجلّ تدقيق لكل عملية حساسة", "ملفات ومستندات خاصة ومحمية", "قفل تلقائي بعد محاولات دخول خاطئة"], { bTop: 410 });
});

// 16. Mobile (illustrative phone)
addScene(15, (sc) => {
  const ph = E(sc.root, "", "", "position:absolute;left:380px;top:120px;width:380px;height:760px;border-radius:56px;background:#0a0a0c;border:3px solid #3a3d44;box-shadow:0 40px 100px rgba(0,0,0,.6),0 0 0 10px #15161a;overflow:hidden;direction:rtl");
  ph.innerHTML = `
    <div style="height:58px"></div>
    <div style="margin:0 18px;padding:18px;border-radius:24px;background:#F6821F;color:#1F1F1F"><div style="font-size:20px;font-weight:600">مرحبًا بك 👋</div><div class="big" style="font-size:30px">أحمد الزهراني</div></div>
    <div style="margin:14px 18px;padding:16px;border-radius:22px;background:#FFF6E9;color:#1F1F1F"><div style="font-weight:800;font-size:22px">حضور اليوم</div><div style="display:flex;justify-content:space-between;margin-top:10px;font-size:20px"><span>الدخول<br><b style="font-size:26px">08:24</b></span><span>الخروج<br><b style="font-size:26px">—</b></span></div><div style="margin-top:12px;height:10px;border-radius:8px;background:#e9dcc8"><div style="width:62%;height:100%;border-radius:8px;background:#F6821F"></div></div></div>
    <div style="margin:14px 18px;padding:16px;border-radius:22px;background:#FFF6E9;color:#1F1F1F;display:flex;align-items:center;justify-content:space-between"><div><div style="font-weight:800;font-size:22px">رصيد الإجازات</div><div style="font-size:18px;color:#6B6B6B">إجازة سنوية</div></div><div class="big" style="font-size:46px;color:#F6821F">١٤ <span style="font-size:20px;color:#6B6B6B">يوم</span></div></div>
    <div style="margin:14px 18px;padding:16px;border-radius:999px;background:#F6821F;color:#1F1F1F;text-align:center;font-weight:800;font-size:24px">+ طلب إجازة</div>
    <div style="position:absolute;bottom:0;left:0;right:0;height:84px;background:#fff;display:flex;justify-content:space-around;align-items:center;color:#6B6B6B;font-size:16px;font-weight:700"><span style="color:#F6821F">🏠<br>الرئيسية</span><span>🕘<br>الحضور</span><span>🌴<br>الإجازات</span><span>🔔<br>الإشعارات</span><span>⋯<br>المزيد</span></div>`;
  A(ph, [{ opacity: 0, transform: "translateY(120px) rotate(-3deg)" }, { opacity: 1, transform: "none" }], sc.t0 + .4, 1.1);
  [["🕘", "تسجيل الحضور والانصراف", 120], ["🌴", "طلب ومتابعة الإجازات", 260], ["💵", "كشف الراتب", 400], ["🔔", "إشعارات فورية", 540]].forEach(([i, t, y], k) => {
    const c = E(sc.root, "chip", `${i} ${t}`, `position:absolute;left:830px;top:${y + 190}px;font-size:32px;padding:14px 30px`);
    A(c, [{ opacity: 0, transform: "translateX(-60px)" }, { opacity: 1, transform: "none" }], sc.a0 + .9 + k * (sc.aud * .17), .6);
  });
  const note = E(sc.root, "", "تصوّر توضيحي لواجهة تطبيق الجوال", "position:absolute;left:380px;top:900px;width:380px;text-align:center;font-size:20px;color:#8a93a3;direction:rtl");
  fadeIn(note, sc.t0 + 1.5, .6, 0);
  const t = E(sc.root, "", "", "position:absolute;right:60px;top:150px;width:610px;direction:rtl");
  const eb = E(sc.root, "eyebrow", "<span>تطبيق الجوال</span>", "top:150px"); fadeIn(eb, sc.t0 + .3, .6, 0, 30);
  const h2 = E(sc.root, "h2", "في جيب <em>كل موظف</em>", "top:202px"); fadeIn(h2, sc.t0 + .45, .8, 24);
});

// 17. CTA
addScene(16, (sc) => {
  const pw = E(sc.root, "", "", "position:absolute;left:0;right:0;top:150px;display:flex;justify-content:center");
  const plate = E(pw, "", `<img src="img/logo.png" style="height:150px;display:block">`, "background:#fff;border-radius:28px;padding:24px 52px;box-shadow:0 20px 60px rgba(0,0,0,.5)");
  pop(plate, sc.t0 + .3, .8);
  const t = E(sc.root, "", "وقتٌ أقل في الإجراءات…<br><em style='font-style:normal;color:#F6821F'>ووضوحٌ أكثر في القرارات</em>", "position:absolute;left:0;right:0;top:390px;text-align:center;font-size:88px;font-weight:800;line-height:1.35;direction:rtl");
  fadeIn(t, sc.t0 + .8, 1.0, 40);
  const bw = E(sc.root, "", "", "position:absolute;left:0;right:0;top:710px;display:flex;justify-content:center");
  const b = E(bw, "", "احجز عرضًا تجريبيًا لنظام FFI للموارد البشرية", "background:linear-gradient(90deg,#F6821F,#FF9D4D);color:#1b1208;font-weight:800;font-size:44px;padding:20px 60px;border-radius:999px;box-shadow:0 20px 60px rgba(246,130,31,.55);white-space:nowrap;direction:rtl");
  pop(b, sc.a0 + sc.aud * .55, .8);
  A(b, [{ filter: "brightness(1)" }, { filter: "brightness(1.15)" }, { filter: "brightness(1)" }], sc.a0 + sc.aud * .6, 2.4, "ease-in-out");
});

const TOTAL = cursor + 0.25;
window.TOTAL = TOTAL;
window.SCENES = scenes.map((s) => ({ i: s.i, t0: s.t0, a0: s.a0, aud: s.aud, dur: s.dur }));
const prog = document.getElementById("progress");
window.render = (t) => {
  for (const { a, start, dur } of anims) a.currentTime = Math.min(Math.max((t - start) * 1000, 0), dur * 1000);
  prog.style.width = ((t / TOTAL) * 100).toFixed(2) + "%";
};
render(0);
document.fonts.ready.then(() => { window.READY = true; });
