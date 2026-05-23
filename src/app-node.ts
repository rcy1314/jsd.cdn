import { Hono } from 'hono'
import type { Context } from 'hono'
import { convertToJsDelivr } from './lib/convert.js'
import { proxyJsDelivr } from './lib/proxy.js'
import { AdminDbStore } from './lib/admin-db.js'
import { AuthDb } from './lib/auth-db.js'
import { buildBlockedResponse, buildSetCookie, getClientIp, getSiteDomain, parseCookie } from './lib/admin.js'

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffd36e"/>
    <stop offset="0.35" stop-color="#ff6fb1"/>
    <stop offset="0.7" stop-color="#7b6dff"/>
    <stop offset="1" stop-color="#3ad7ff"/>
  </linearGradient>
</defs>
<rect x="6" y="6" width="52" height="52" rx="16" fill="url(#g)" stroke="#111" stroke-width="4"/>
<text x="32" y="38" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont" font-size="18" font-weight="950" fill="#111" transform="rotate(-12 32 34)">CDN</text>
</svg>`

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffd36e"/>
    <stop offset="0.35" stop-color="#ff6fb1"/>
    <stop offset="0.7" stop-color="#7b6dff"/>
    <stop offset="1" stop-color="#3ad7ff"/>
  </linearGradient>
</defs>
<rect x="6" y="6" width="52" height="52" rx="16" fill="url(#g)" stroke="#111" stroke-width="4"/>
<text x="32" y="38" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont" font-size="18" font-weight="950" fill="#111" transform="rotate(-12 32 34)">CDN</text>
</svg>`

const homeHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <meta name="description" content="{{DESC}}" />
    <title>{{TITLE}}</title>
    <style>
      :root{
        --ink:#111;
        --paper:#fff8ee;
        --bg1:#fff1f7;
        --bg2:#eef7ff;
        --bg3:#f4fff0;
        --card:#ffffff;
        --border:3px solid var(--ink);
        --shadow-lg: 10px 10px 0 var(--ink);
        --shadow-md: 8px 8px 0 var(--ink);
        --shadow-sm: 4px 4px 0 var(--ink);
        --radius: 22px;
        --radius-sm: 16px;
        --pad: 18px;
        --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
        --tag-p-bg: #ffd1ea;
        --tag-b-bg: #cfefff;
        --tag-g-bg: #d7ffcc;
        --tag-y-bg: #fff1b8;
      }
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --bg1:#0f172a;
        --bg2:#0f172a;
        --bg3:#0f172a;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow-lg: 0 0 0 1px #334155;
        --shadow-md: 0 0 0 1px #334155;
        --shadow-sm: 0 0 0 1px #334155;
        --tag-p-bg: #5c1f4d;
        --tag-b-bg: #1a4a68;
        --tag-g-bg: #125423;
        --tag-y-bg: #5c4b00;
      }
      *{box-sizing:border-box}
      html,body{height:100%}
      body{
        margin:0;
        font-family:var(--sans);
        color:var(--ink);
        min-height:100vh;
        display:flex;
        justify-content:center;
        overflow-x:hidden;
        background:var(--body-bg,#f5f0e8);
        transition:background 0.3s;
      }
      a{color:inherit}
      /* 暗黑模式背景 */
      html[data-theme="dark"] body{--body-bg:#1a1a2e}
      .bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
      /* 贴纸风格网格 - 纸质纹理 */
      .bg-grid{
        position:absolute;
        inset:0;
        background-image:
          linear-gradient(var(--grid-line,rgba(139,90,43,0.1)) 1px, transparent 1px),
          linear-gradient(90deg, var(--grid-line,rgba(139,90,43,0.1)) 1px, transparent 1px);
        background-size:24px 24px;
        transition:opacity 0.3s;
      }
      html[data-theme="dark"] .bg-grid{--grid-line:rgba(255,255,255,0.06)}
      /* 便利贴 - 保留原样式 */
      .sticker-note{
        position:absolute;
        background:var(--note-bg,#fff9c4);
        padding:10px 14px;
        border-radius:2px;
        box-shadow:3px 3px 0 rgba(0,0,0,0.12);
        font-size:10px;
        font-weight:900;
        color:var(--note-text,#5d4037);
        transform:rotate(var(--rot,-3deg));
        border-top:4px solid var(--note-accent,#ffe082);
        transition:all 0.3s;
      }
      html[data-theme="dark"] .sticker-note{--note-bg:#3d3d5c;--note-text:#e8e8e8;--note-accent:#ffd54f}
      /* 圆点贴纸 - 动态弹跳 */
      .sticker-dot{
        position:absolute;
        width:20px;
        height:20px;
        border-radius:50%;
        box-shadow:3px 3px 0 rgba(0,0,0,0.15);
        animation:bounceDot 2.5s ease-in-out infinite;
      }
      .sticker-dot:nth-child(2){animation-delay:0.3s}
      .sticker-dot:nth-child(3){animation-delay:0.6s}
      .sticker-dot:nth-child(4){animation-delay:0.9s}
      @keyframes bounceDot{
        0%,100%{transform:translateY(0) scale(1)}
        50%{transform:translateY(-15px) scale(1.1)}
      }
      /* 标签贴纸 - 摇晃动画 */
      .sticker-tag{
        position:absolute;
        background:var(--tag-bg,#ffccbc);
        padding:5px 12px;
        border-radius:20px;
        font-size:9px;
        font-weight:900;
        color:var(--tag-text,#bf360c);
        box-shadow:2px 2px 0 rgba(0,0,0,0.1);
        transform:rotate(var(--rot,3deg));
        animation:wobbleTag 3s ease-in-out infinite;
        transition:all 0.3s;
      }
      .sticker-tag:nth-child(2){animation-delay:0.5s}
      @keyframes wobbleTag{
        0%,100%{transform:rotate(var(--rot,3deg))}
        25%{transform:rotate(calc(var(--rot,3deg) + 5deg))}
        75%{transform:rotate(calc(var(--rot,3deg) - 5deg))}
      }
      html[data-theme="dark"] .sticker-tag{--tag-bg:#5c5c8a;--tag-text:#ffd54f}
      /* 胶带 - 半透明动态 */
      .sticker-tape{
        position:absolute;
        width:60px;
        height:16px;
        background:var(--tape-bg,rgba(255,241,118,0.7));
        opacity:0.8;
        animation:fadeTape 4s ease-in-out infinite;
        transition:background 0.3s;
      }
      .sticker-tape:nth-child(2){animation-delay:1s}
      .sticker-tape:nth-child(3){animation-delay:2s}
      @keyframes fadeTape{
        0%,100%{opacity:0.5}
        50%{opacity:0.9}
      }
      html[data-theme="dark"] .sticker-tape{--tape-bg:rgba(100,100,150,0.5)}
      /* 图钉 - 脉冲动画 */
      .sticker-pin{
        position:absolute;
        width:10px;
        height:10px;
        border-radius:50% 50% 50% 0;
        background:var(--pin-color,#e91e63);
        transform:rotate(-45deg);
        box-shadow:2px 2px 4px rgba(0,0,0,0.2);
        animation:pinPulse 2s ease-in-out infinite;
        transition:background 0.3s;
      }
      .sticker-pin:nth-child(2){animation-delay:0.5s}
      .sticker-pin:nth-child(3){animation-delay:1s}
      @keyframes pinPulse{
        0%,100%{transform:rotate(-45deg) scale(1)}
        50%{transform:rotate(-45deg) scale(1.2)}
      }
      html[data-theme="dark"] .sticker-pin{--pin-color:#ff80ab}
      /* 浮动星星 - 旋转缩放 */
      .sticker-star{
        position:absolute;
        font-size:18px;
        animation:starFloat 5s ease-in-out infinite;
        transition:opacity 0.3s;
      }
      .sticker-star:nth-child(2){animation-delay:0.8s;font-size:14px}
      .sticker-star:nth-child(3){animation-delay:1.6s;font-size:20px}
      @keyframes starFloat{
        0%,100%{transform:translateY(0) rotate(0deg) scale(1);opacity:0.3}
        50%{transform:translateY(-20px) rotate(180deg) scale(1.2);opacity:0.6}
      }
      html[data-theme="dark"] .sticker-star{opacity:0.5}
      /* 纸飞机 - 飘动 */
      .sticker-plane{
        position:absolute;
        font-size:20px;
        animation:flyPlane 8s ease-in-out infinite;
        transition:opacity 0.3s;
      }
      @keyframes flyPlane{
        0%,100%{transform:translate(0,0) rotate(-10deg);opacity:0.2}
        25%{transform:translate(30px,-20px) rotate(5deg);opacity:0.4}
        50%{transform:translate(50px,0) rotate(10deg);opacity:0.2}
        75%{transform:translate(20px,10px) rotate(-5deg);opacity:0.4}
      }
      html[data-theme="dark"] .sticker-plane{opacity:0.4}
      /* 浮动方块 - 旋转 */
      .sticker-cube{
        position:absolute;
        width:16px;
        height:16px;
        border:2px solid var(--cube-color,rgba(255,183,77,0.3));
        transform:rotate(45deg);
        animation:spinCube 10s linear infinite;
        transition:border-color 0.3s;
      }
      @keyframes spinCube{
        0%{transform:rotate(45deg)}
        100%{transform:rotate(405deg)}
      }
      html[data-theme="dark"] .sticker-cube{--cube-color:rgba(255,255,255,0.15)}
      .wrap{
        width:100%;
        max-width:1120px;
        margin:0 auto;
        padding:28px 18px 32px;
        position:relative;
        z-index:1;
      }
      .ann{
        background:var(--card);
        border:var(--border);
        border-radius:var(--radius);
        box-shadow:var(--shadow-md);
        padding:12px 14px;
        margin-bottom:14px;
        overflow:hidden;
        display:none;
      }
      .ann.in{display:block}
      .annRow{
        display:flex;
        align-items:center;
        gap:10px;
      }
      .annLabel{
        font-weight:950;
        font-size:12px;
        white-space:nowrap;
      }
      .annTrack{
        position:relative;
        flex:1;
        overflow:hidden;
      }
      .annScroll{
        display:inline-block;
        white-space:nowrap;
        will-change:transform;
        animation: annMove 18s linear infinite;
        padding-left:100%;
      }
      .annItem{
        display:inline-block;
        margin-right:24px;
      }
      @keyframes annMove{
        0%{transform:translate3d(0,0,0)}
        100%{transform:translate3d(-100%,0,0)}
      }
      .top{
        display:grid;
        grid-template-columns: 1fr auto;
        align-items:start;
        gap:14px;
        margin-bottom:18px;
      }
      @media (max-width: 720px){
        .top{grid-template-columns: 1fr}
      }
      .brand{
        background:var(--card);
        border:var(--border);
        border-radius:var(--radius);
        box-shadow:var(--shadow-lg);
        padding:18px 20px;
        display:flex;
        align-items:center;
        gap:14px;
      }
      .logo{
        width:52px;height:52px;border-radius:16px;
        border:var(--border);
        background:#fff;
        box-shadow:var(--shadow-sm);
        display:block;
      }
      h1{margin:0;font-size:18px;line-height:1.2}
      .sub{margin:4px 0 0;font-size:12px;opacity:.8}
      .chips{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;justify-content:flex-end}
      .chip{
        background:var(--card);
        border:var(--border);
        border-radius:999px;
        padding:10px 12px;
        box-shadow:var(--shadow-md);
        color:var(--ink);
        font-weight:800;
        font-size:12px;
        display:flex;
        gap:8px;
        align-items:center;
      }
      button.chip{appearance:none}
      .chip.admin{
        text-decoration:none;
      }
      .chip.admin svg{display:block}
      .dot{width:10px;height:10px;border:2px solid var(--ink);border-radius:50%}
      .dot.a{background:#7bd4ff}
      .dot.b{background:#ff6fb1}
      .dot.c{background:#9cff6a}
      .grid{
        display:grid;
        grid-template-columns: 1.2fr .8fr;
        gap:18px;
      }
      @media (max-width: 980px){
        .grid{grid-template-columns: 1fr}
      }
      .card{
        background:var(--card);
        border:var(--border);
        border-radius:var(--radius);
        box-shadow:var(--shadow-lg);
        padding:20px;
      }
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
      .between{justify-content:space-between;gap:12px}
      label{font-weight:900;font-size:12px}
      textarea,input{
        width:100%;
        border:var(--border);
        border-radius:var(--radius-sm);
        padding:12px 12px;
        font-size:14px;
        color:var(--ink);
        background:var(--paper);
        outline:none;
        box-shadow: var(--shadow-sm);
      }
      textarea::placeholder,input::placeholder{color:rgba(127,127,127,.9);opacity:1}
      textarea{min-height:92px;resize:vertical;font-family:var(--mono)}
      #in{margin-top:14px}
      textarea:focus,input:focus{box-shadow:0 0 0 4px rgba(17,17,17,.12), var(--shadow-sm)}
      .modes{display:flex;gap:10px;flex-wrap:wrap}
      .mode{
        border:var(--border);
        border-radius:999px;
        padding:8px 10px;
        background:var(--paper);
        box-shadow:var(--shadow-sm);
        display:flex;
        align-items:center;
        gap:8px;
        color:var(--ink);
        font-weight:900;
        font-size:12px;
        user-select:none;
        cursor:pointer;
      }
      .mode input{width:auto;box-shadow:none;accent-color:#60a5fa}
      .actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
      @media (max-width: 760px){
        .actions{gap:12px}
      }
      button{
        border:var(--border);
        border-radius:var(--radius-sm);
        padding:10px 12px;
        font-weight:900;
        color:var(--ink);
        background:var(--card);
        box-shadow:var(--shadow-md);
        cursor:pointer;
      }
      button:hover{transform:translate(-1px,-1px)}
      button:active{transform:translate(2px,2px);box-shadow:var(--shadow-sm)}
      .ghost{background:var(--paper)}
      .mono{font-family:var(--mono)}
      .hint.mono{overflow-wrap:anywhere;word-break:break-word}
      .out{
        display:grid;
        grid-template-columns: 1fr auto auto;
        gap:10px;
        align-items:stretch;
      }
      .out input{min-width:0;font-family:var(--mono)}
      @media (max-width: 560px){
        .out{grid-template-columns: 1fr}
        .out button{width:100%}
      }
      .hint{font-size:12px;opacity:.85;margin-top:10px;line-height:1.55}
      .statusBox{
        margin-top:12px;
        border:var(--border);
        border-radius:18px;
        padding:10px 12px;
        background:var(--card);
        box-shadow:var(--shadow-sm);
        min-height:40px;
        display:flex;
        align-items:center;
      }
      .ok{color:#0b7a2e;font-weight:900}
      .bad{color:#b31237;font-weight:900}
      .list{
        margin:10px 0 0;
        padding:0;
        list-style:none;
        display:grid;
        gap:10px;
      }
      .item{
        border:var(--border);
        border-radius:18px;
        padding:12px 12px;
        background:var(--card);
        box-shadow:var(--shadow-md);
      }
      .item .t{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-weight:950}
      .item code{font-family:var(--mono);font-size:12px}
      .k{
        display:inline-flex;
        align-items:center;
        gap:8px;
        font-weight:900;
      }
      .tag{
        display:inline-block;
        border:var(--border);
        border-radius:999px;
        padding:2px 8px;
        font-weight:950;
        font-size:11px;
        background:#fff;
        transform:rotate(-2deg);
      }
      .tag.p{background:var(--tag-p-bg)}
      .tag.b{background:var(--tag-b-bg)}
      .tag.g{background:var(--tag-g-bg)}
      .tag.y{background:var(--tag-y-bg)}
      .sep{height:1px;background:rgba(17,17,17,.12);margin:14px 0}
      .mini{
        font-size:12px;
        opacity:.85;
      }
      .footer{margin-top:18px;display:none}
      .footer.in{display:block}
      .footerBox{background:var(--card);border:var(--border);border-radius:999px;box-shadow:var(--shadow-md);padding:10px 14px;text-align:center;font-size:12px;font-weight:900;opacity:.9}
      html[data-theme="dark"] textarea::placeholder,
      html[data-theme="dark"] input::placeholder{color:#94a3b8}
    </style>
  </head>
  <body>
    <div class="bg" aria-hidden="true">
      <div class="bg-grid"></div>
      <!-- 便签贴纸 -->
      <div class="sticker-note" style="top:6%;left:3%;--rot:-5deg">CDN ⚡</div>
      <div class="sticker-note" style="top:22%;right:4%;--rot:6deg">免费 ♪</div>
      <div class="sticker-note" style="bottom:18%;left:5%;--rot:-2deg">高速 ★</div>
      <div class="sticker-note" style="bottom:35%;right:3%;--rot:4deg">稳定 ✓</div>
      <!-- 圆点贴纸 - 弹跳 -->
      <div class="sticker-dot" style="top:12%;left:18%;background:#f8bbd9"></div>
      <div class="sticker-dot" style="top:38%;right:12%;background:#b3e5fc"></div>
      <div class="sticker-dot" style="bottom:28%;left:22%;background:#c8e6c9"></div>
      <div class="sticker-dot" style="top:58%;right:6%;background:#ffe0b2"></div>
      <div class="sticker-dot" style="bottom:8%;right:25%;background:#ce93d8"></div>
      <!-- 标签贴纸 - 摇晃 -->
      <div class="sticker-tag" style="top:32%;left:1%;--rot:-8deg">快</div>
      <div class="sticker-tag" style="bottom:12%;right:6%;--rot:5deg">稳</div>
      <div class="sticker-tag" style="top:75%;left:8%;--rot:-3deg">免</div>
      <!-- 胶带 - 闪烁 -->
      <div class="sticker-tape" style="top:4%;right:25%;transform:rotate(12deg)"></div>
      <div class="sticker-tape" style="bottom:45%;left:2%;transform:rotate(-8deg)"></div>
      <div class="sticker-tape" style="top:50%;right:2%;transform:rotate(6deg)"></div>
      <!-- 图钉 - 脉冲 -->
      <div class="sticker-pin" style="top:10%;left:12%"></div>
      <div class="sticker-pin" style="top:48%;right:8%"></div>
      <div class="sticker-pin" style="bottom:42%;left:15%"></div>
      <!-- 星星 - 旋转缩放 -->
      <div class="sticker-star" style="top:15%;left:35%">✦</div>
      <div class="sticker-star" style="top:45%;left:8%">✧</div>
      <div class="sticker-star" style="bottom:25%;right:18%">✦</div>
      <!-- 纸飞机 - 飘动 -->
      <div class="sticker-plane" style="top:20%;right:28%">✈</div>
      <div class="sticker-plane" style="bottom:22%;left:28%">📄</div>
      <!-- 旋转方块 -->
      <div class="sticker-cube" style="top:8%;right:40%"></div>
      <div class="sticker-cube" style="bottom:30%;left:45%"></div>
    </div>
    <div class="wrap">
      <div id="ann" class="ann">
        <div class="annRow">
          <div class="annLabel">公告</div>
          <div class="annTrack"><div id="annScroll" class="annScroll"></div></div>
        </div>
      </div>
      <div class="top">
        <div class="brand">
          <img class="logo" src="/logo" alt="" aria-hidden="true" />
          <div>
            <h1>jsDelivr CDN 加速访问服务</h1>
            <div class="sub">把 GitHub / npm 链接转换成 jsDelivr，并提供 Redirect / Proxy（适合图床直链）</div>
          </div>
        </div>
        <div class="chips" aria-label="cdn elements">
          <div class="chip"><span class="dot a"></span>CDN</div>
          <div class="chip"><span class="dot b"></span>IMG</div>
          <div class="chip"><span class="dot c"></span>JS/CSS</div>
          <button class="chip" id="themeToggle" type="button" aria-label="切换暗黑模式" title="切换暗黑模式">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3v2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M12 19v2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M4.22 4.22 5.64 5.64" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M18.36 18.36 19.78 19.78" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M3 12h2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M19 12h2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M4.22 19.78 5.64 18.36" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M18.36 5.64 19.78 4.22" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
            </svg>
            主题
          </button>
          <a class="chip admin" href="/admin" aria-label="后台">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 10V8a5 5 0 0 1 10 0v2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
              <path d="M7 10h10v11H7V10Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
            </svg>
            后台
          </a>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="row between">
            <label for="in">输入链接（支持 GitHub raw/blob、unpkg、gh:/npm: 简写）</label>
            <div class="actions">
              <button class="ghost" id="exGh" type="button">填入 GitHub 示例</button>
              <button class="ghost" id="exNpm" type="button">填入 npm 示例</button>
              <button class="ghost" id="clear" type="button">清空</button>
            </div>
          </div>
          <textarea id="in" placeholder="例如：https://raw.githubusercontent.com/user/repo/main/path/to/file.png"></textarea>

          <div class="sep"></div>

          <div class="row">
            <label>输出模式</label>
            <div class="modes" role="radiogroup" aria-label="mode">
              <label class="mode"><input type="radio" name="mode" value="mirror" checked />直连（同路径，推荐）</label>
              <label class="mode"><input type="radio" name="mode" value="proxy" />Proxy（兼容模式）</label>
              <label class="mode"><input type="radio" name="mode" value="redirect" />Redirect（轻量跳转）</label>
              <label class="mode"><input type="radio" name="mode" value="raw" />原始 jsDelivr URL</label>
            </div>
          </div>

          <div class="sep"></div>

          <div class="row between">
            <label for="out">结果</label>
            <div class="mini mono">服务地址：<span id="origin"></span></div>
          </div>
          <div class="out">
            <input id="out" class="mono" readonly placeholder="这里会生成加速链接…" />
            <button id="copy" type="button">复制</button>
            <button id="open" type="button">打开</button>
          </div>
          <div id="status" class="hint statusBox" role="status" aria-live="polite"></div>
          <div class="sep"></div>
          <div class="row between">
            <div class="k"><span class="tag y">提示</span>适用场景</div>
          </div>
          <div class="hint">
            <div><span class="ok">适合</span>：GitHub 仓库文件、npm 包文件、图片直链（图床）、跨域加载（已加 CORS）。</div>
            <div><span class="bad">不适合</span>：GitHub Releases 下载链接（jsDelivr 不支持直转）。</div>
          </div>
        </div>

        <div class="card">
          <div class="row" style="justify-content:space-between">
            <div class="k"><span class="tag y">说明</span>使用方式</div>
          </div>
          <ul class="list">
            <li class="item">
              <div class="t"><span class="tag y">直连</span>同路径直连（替换 CDN 域名为服务域名）</div>
              <div class="hint mono"><span id="o1"></span>/gh/owner/repo@ref/path/to/file.png</div>
              <div class="hint mono"><span id="o2"></span>/npm/pkg@ver/path/to/file.js</div>
            </li>
            <li class="item">
              <div class="t"><span class="tag g">Proxy</span>代理输出（兼容，带 CORS）</div>
              <div class="hint mono"><span id="o3"></span>/cdn?url=你的链接</div>
            </li>
            <li class="item">
              <div class="t"><span class="tag b">Redirect</span>跳转输出（更轻）</div>
              <div class="hint mono"><span id="o4"></span>/r?url=你的链接</div>
            </li>
            <li class="item">
              <div class="t"><span class="tag p">简写</span>不想写完整 URL</div>
              <div class="hint mono">gh:owner/repo@ref/path/to/file.png</div>
              <div class="hint mono">npm:pkg@ver/dist/index.js</div>
            </li>
          </ul>
        </div>
      </div>
      <div id="footer" class="footer"><div id="footerBox" class="footerBox"></div></div>
    </div>

    <script>
      const $ = (id) => document.getElementById(id)
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
      const mdToHtml = (md) => {
        const raw = String(md || '')
        let out = esc(raw)
        out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>')
        out = out.replace(/\\*([^*]+)\\*/g, '<i>$1</i>')
        out = out.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        out = out.replace(/\\n/g, '<br/>')
        return out
      }
      const getTheme = () => { try { return localStorage.getItem('jsd_theme') || '' } catch { return '' } }
      const applyTheme = (t) => {
        const theme = t === 'dark' ? 'dark' : 'light'
        document.documentElement.dataset.theme = theme
        try { localStorage.setItem('jsd_theme', theme) } catch {}
      }
      applyTheme(getTheme())
      const input = $('in')
      const out = $('out')
      const status = $('status')
      let base = new URL('.', location.href).toString()
      if (base.endsWith('/')) base = base.slice(0, -1)
      $('origin').textContent = base
      $('o1').textContent = base
      $('o2').textContent = base
      $('o3').textContent = base
      $('o4').textContent = base

      const setStatus = (ok, text) => {
        status.innerHTML = ok
          ? '<span class="ok">OK</span> ' + text
          : '<span class="bad">ERR</span> ' + text
      }

      const loadAnnouncements = async () => {
        try {
          const r = await fetch('/a')
          if (!r.ok) return
          const data = await r.json()
          const format = String((data && data.format) || 'text')
          const items = Array.isArray(data.announcements) ? data.announcements : []
          if (!items.length) return
          const ann = $('ann')
          const scroll = $('annScroll')
          scroll.innerHTML = ''
          const texts = items.map((x) => String(x.text || '').trim()).filter(Boolean)
          if (!texts.length) return
          const html = texts.map((t) => {
            const v = format === 'html' ? String(t) : format === 'md' ? mdToHtml(t) : esc(t)
            return '<span class="annItem">' + v + '</span>'
          }).join('')
          scroll.innerHTML = html
          ann.classList.add('in')
        } catch {}
      }

      const loadSite = async () => {
        try {
          const r = await fetch('/site')
          if (!r.ok) return
          const data = await r.json()
          const text = String((data && data.footerText) || '').trim()
          const format = String((data && data.footerFormat) || 'text')
          if (!text) return
          if (format === 'html') $('footerBox').innerHTML = text
          else if (format === 'md') $('footerBox').innerHTML = mdToHtml(text)
          else $('footerBox').textContent = text
          $('footer').classList.add('in')
        } catch {}
      }

      const getMode = () => {
        const el = document.querySelector('input[name="mode"]:checked')
        return el ? el.value : 'mirror'
      }

      const buildServiceUrl = (mode, rawInput, jsdelivrUrl) => {
        if (mode === 'raw') return jsdelivrUrl
        if (mode === 'redirect') return base + '/r?url=' + encodeURIComponent(rawInput)
        if (mode === 'mirror') {
          try {
            const u = new URL(String(jsdelivrUrl || ''))
            if (u.pathname.startsWith('/gh/') || u.pathname.startsWith('/npm/')) return base + u.pathname + u.search
          } catch {}
          return base + '/cdn?url=' + encodeURIComponent(rawInput)
        }
        return base + '/cdn?url=' + encodeURIComponent(rawInput)
      }

      const refresh = async () => {
        const raw = input.value.trim()
        if (!raw) {
          out.value = ''
          status.textContent = ''
          return
        }
        try {
          const r = await fetch('/u?url=' + encodeURIComponent(raw))
          const data = await r.json()
          if (!data.supported) {
            out.value = ''
            setStatus(false, data.reason || '不支持该链接')
            return
          }
          const mode = getMode()
          out.value = buildServiceUrl(mode, raw, data['jsdelivrUrl'])
          const msg = mode === 'raw' ? '已生成 jsDelivr URL' : mode === 'mirror' ? '已生成同路径直连' : '已生成代理链接'
          setStatus(true, msg + (data.stable ? '（可长期缓存）' : ''))
        } catch (e) {
          out.value = ''
          setStatus(false, '解析失败')
        }
      }

      input.addEventListener('input', () => refresh())
      document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => refresh()))

      $('copy').addEventListener('click', async () => {
        if (!out.value) return
        try { await navigator.clipboard.writeText(out.value); setStatus(true, '已复制到剪贴板') } catch { setStatus(false, '复制失败') }
      })
      $('open').addEventListener('click', () => { if (out.value) window.open(out.value, '_blank', 'noopener,noreferrer') })
      $('clear').addEventListener('click', () => { input.value = ''; out.value=''; status.textContent=''; input.focus() })
      $('exGh').addEventListener('click', () => {
        input.value = 'https://raw.githubusercontent.com/jsdelivr/jsdelivr/master/README.md'
        refresh()
      })
      $('exNpm').addEventListener('click', () => {
        input.value = 'https://unpkg.com/normalize.css@8.0.1/normalize.css'
        refresh()
      })
      $('themeToggle').addEventListener('click', () => {
        const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
        applyTheme(cur === 'dark' ? 'light' : 'dark')
      })

      refresh()
      loadAnnouncements()
      loadSite()
    </script>
  </body>
</html>`

const escAttr = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const renderHomeHtml = (site: any) => {
  const title = String(site?.title ?? '').trim() || 'jsDelivr CDN 加速访问'
  const desc =
    String(site?.description ?? '').trim() ||
    '把 GitHub / npm 链接转换成 jsDelivr，并提供 Redirect / Proxy（适合图床直链）'
  return homeHtml.split('{{TITLE}}').join(escAttr(title)).split('{{DESC}}').join(escAttr(desc))
}

const renderUserLoginHtml = (opts: { allowRegister: boolean }) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>登录</title>
    <style>
      :root{--ink:#111;--paper:#fff8ee;--card:#ffffff;--border:3px solid var(--ink);--shadow-lg:10px 10px 0 var(--ink);--shadow-md:8px 8px 0 var(--ink);--shadow-sm:4px 4px 0 var(--ink);--radius:22px;--radius-sm:16px;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans";--danger:#e11d48;--ok:#15803d}
      *{box-sizing:border-box}html,body{height:100%}
      body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--paper);display:flex;align-items:center;justify-content:center;padding:22px}
      html[data-theme="dark"] body{background:var(--paper)}
      .card{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:22px;max-width:480px;width:100%}
      h1{margin:0 0 12px 0;font-size:18px}
      label{font-weight:900;font-size:12px}
      input{width:100%;border:var(--border);border-radius:var(--radius-sm);padding:12px 12px;font-size:14px;color:var(--ink);background:var(--paper);outline:none;font-family:var(--mono)}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
      button{border:var(--border);border-radius:var(--radius-sm);padding:10px 16px;font-weight:900;color:var(--ink);background:var(--card);box-shadow:var(--shadow-sm);cursor:pointer}
      .hint{font-size:12px;opacity:.85;margin-top:10px;line-height:1.5}
      .bad{color:var(--danger);font-weight:900}
      .ok{color:var(--ok);font-weight:900}
      a{color:inherit}
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow-lg:0 0 0 1px #334155;
        --shadow-md:0 0 0 1px #334155;
        --shadow-sm:0 0 0 1px #334155;
        --danger:#fb7185;
        --ok:#4ade80;
      }
    </style>
  </head>
  <body>
    <script>
      const getTheme = () => { try { return localStorage.getItem('jsd_theme') || '' } catch { return '' } }
      const applyTheme = (t) => {
        const theme = t === 'dark' ? 'dark' : 'light'
        document.documentElement.dataset.theme = theme
        try { localStorage.setItem('jsd_theme', theme) } catch {}
      }
      applyTheme(getTheme())
    </script>
    <div class="card">
      <div class="row">
        <h1>登录</h1>
        <a href="/">返回首页</a>
      </div>
      <div style="margin-top:12px">
        <label for="user">用户名</label>
        <input id="user" autocomplete="username" placeholder="例如：admin" />
      </div>
      <div style="margin-top:12px">
        <label for="pwd">密码</label>
        <input id="pwd" type="password" autocomplete="current-password" placeholder="请输入密码" />
      </div>
      <div class="row" style="margin-top:12px">
        <button id="login" type="button">登录</button>
        ${opts.allowRegister ? '<a class="hint" href="/register">没有账号？去注册</a>' : '<span class="hint"></span>'}
      </div>
      <div id="msg" class="hint"></div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id)
      const getCookie = (name) => {
        const raw = document.cookie || ''
        const parts = raw.split(';').map((x) => x.trim()).filter(Boolean)
        for (const p of parts) {
          const idx = p.indexOf('=')
          if (idx <= 0) continue
          const k = p.slice(0, idx).trim()
          const v = p.slice(idx + 1).trim()
          if (k === name) return v
        }
        return ''
      }
      const setMsg = (ok, t) => $('msg').innerHTML = ok ? '<span class="ok">OK</span> ' + t : '<span class="bad">ERR</span> ' + t
      const submit = async () => {
        $('msg').innerHTML = ''
        const username = $('user').value
        const password = $('pwd').value
        const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || !data.ok) { setMsg(false, data.error || '登录失败'); return }
        location.href = '/account'
      }
      $('login').addEventListener('click', submit)
      $('pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
      $('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    </script>
  </body>
</html>`

const renderUserRegisterHtml = (opts: { allowRegister: boolean; firstRun: boolean }) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>注册</title>
    <style>
      :root{--ink:#111;--paper:#fff8ee;--card:#ffffff;--border:3px solid var(--ink);--shadow-lg:10px 10px 0 var(--ink);--shadow-md:8px 8px 0 var(--ink);--shadow-sm:4px 4px 0 var(--ink);--radius:22px;--radius-sm:16px;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans";}
      *{box-sizing:border-box}html,body{height:100%}
      body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--paper);display:flex;align-items:center;justify-content:center;padding:22px}
      html[data-theme="dark"] body{background:var(--paper)}
      .card{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:22px;max-width:480px;width:100%}
      h1{margin:0 0 12px 0;font-size:18px}
      label{font-weight:900;font-size:12px}
      input{width:100%;border:var(--border);border-radius:var(--radius-sm);padding:12px 12px;font-size:14px;color:var(--ink);background:var(--paper);outline:none;box-shadow:var(--shadow-sm);font-family:var(--mono)}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
      button{border:var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-weight:900;color:var(--ink);background:var(--card);box-shadow:var(--shadow-sm);cursor:pointer}
      .hint{font-size:12px;opacity:.85;margin-top:10px;line-height:1.5}
      .bad{color:#e11d48;font-weight:900}
      .ok{color:#15803d;font-weight:900}
      a{color:inherit}
      .disabled{opacity:.9}
      .pill{display:inline-block;border:var(--border);border-radius:999px;padding:2px 8px;font-weight:950;font-size:11px;background:var(--tag-y-bg);transform:rotate(-2deg)}
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow-lg:0 0 0 1px #334155;
        --shadow-md:0 0 0 1px #334155;
        --shadow-sm:0 0 0 1px #334155;
        --tag-y-bg:#5c4b00;
      }
      html[data-theme="dark"] .pill{background:#5c4b00;color:#e2e8f0}
      html[data-theme="dark"] body{background:#1a1a2e}
      html[data-theme="dark"] .pill{background:#5c5c8a;color:#ffd54f}
      html[data-theme="dark"] .bad{color:#ff8a80}
      html[data-theme="dark"] .ok{color:#80cbc4}
    </style>
  </head>
  <body>
    <script>
      const getTheme = () => { try { return localStorage.getItem('jsd_theme') || '' } catch { return '' } }
      const applyTheme = (t) => {
        const theme = t === 'dark' ? 'dark' : 'light'
        document.documentElement.dataset.theme = theme
        try { localStorage.setItem('jsd_theme', theme) } catch {}
      }
      applyTheme(getTheme())
    </script>
    <div class="card">
      <div class="row">
        <h1>注册</h1>
        <a href="/login">已有账号？去登录</a>
      </div>
      ${
        opts.firstRun
          ? '<div class="hint"><span class="pill">首次</span> 首个注册用户将成为管理员，也可直接走 <a href="/admin/register">后台初始化</a>。</div>'
          : ''
      }
      ${
        opts.allowRegister
          ? ''
          : opts.firstRun
            ? '<div class="hint disabled"><span class="bad">ERR</span> 注册入口仅用于初始化阶段（首个用户）。</div>'
            : '<div class="hint disabled"><span class="bad">ERR</span> 当前未开放注册（系统已初始化）。如你确定还没注册，通常是本机残留 data/app.db：删除 data/app.db 后重启即可首次注册为管理员。</div>'
      }
      <div style="margin-top:12px">
        <label for="user">用户名</label>
        <input id="user" autocomplete="username" placeholder="3~32 位：字母/数字/._-" ${opts.allowRegister ? '' : 'disabled'} />
      </div>
      <div style="margin-top:12px">
        <label for="pwd">密码</label>
        <input id="pwd" type="password" autocomplete="new-password" placeholder="至少 8 位" ${opts.allowRegister ? '' : 'disabled'} />
      </div>
      <div class="row" style="margin-top:12px">
        <button id="reg" type="button" ${opts.allowRegister ? '' : 'disabled'}>注册</button>
        <div id="msg" class="hint"></div>
      </div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id)
      const setMsg = (ok, t) => $('msg').innerHTML = ok ? '<span class="ok">OK</span> ' + t : '<span class="bad">ERR</span> ' + t
      const submit = async () => {
        $('msg').innerHTML = ''
        const username = $('user').value
        const password = $('pwd').value
        const r = await fetch('/api/auth/register', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || !data.ok) { setMsg(false, data.error || '注册失败'); return }
        location.href = '/account'
      }
      const btn = $('reg')
      if (btn) btn.addEventListener('click', submit)
      const pwd = $('pwd')
      const user = $('user')
      if (pwd) pwd.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
      if (user) user.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    </script>
  </body>
</html>`

const renderAccountHtml = () => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>账号</title>
    <style>
      :root{--ink:#111;--paper:#fff8ee;--card:#ffffff;--border:3px solid var(--ink);--shadow-lg:10px 10px 0 var(--ink);--shadow-md:8px 8px 0 var(--ink);--shadow-sm:4px 4px 0 var(--ink);--radius:22px;--radius-sm:16px;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans";}
      *{box-sizing:border-box}html,body{height:100%}
      body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--paper);display:flex;align-items:center;justify-content:center;padding:22px}
      html[data-theme="dark"] body{background:var(--paper)}
      .card{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:22px;max-width:560px;width:100%}
      h1{margin:0;font-size:18px}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
      .hint{font-size:12px;opacity:.85;margin-top:10px;line-height:1.5}
      .mono{font-family:var(--mono)}
      button{border:var(--border);border-radius:16px;padding:10px 12px;font-weight:900;background:var(--card);box-shadow:6px 6px 0 var(--ink);cursor:pointer}
      .bad{color:#b31237;font-weight:900}
      .ok{color:#0b7a2e;font-weight:900}
      a{color:inherit}
      .pill{display:inline-block;border:var(--border);border-radius:999px;padding:2px 8px;font-weight:950;font-size:11px;background:var(--tag-g-bg);transform:rotate(-2deg)}
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow-lg:0 0 0 1px #334155;
        --shadow-md:0 0 0 1px #334155;
        --shadow-sm:0 0 0 1px #334155;
        --tag-g-bg:#125423;
      }
      html[data-theme="dark"] .pill{background:#125423;color:#e2e8f0}
      html[data-theme="dark"] .bad{color:#fb7185}
      html[data-theme="dark"] .ok{color:#4ade80}
    </style>
  </head>
  <body>
    <script>
      const getTheme = () => { try { return localStorage.getItem('jsd_theme') || '' } catch { return '' } }
      const applyTheme = (t) => {
        const theme = t === 'dark' ? 'dark' : 'light'
        document.documentElement.dataset.theme = theme
        try { localStorage.setItem('jsd_theme', theme) } catch {}
      }
      applyTheme(getTheme())
    </script>
    <div class="card">
      <div class="row">
        <h1>账号</h1>
        <a href="/">返回首页</a>
      </div>
      <div class="hint">当前登录信息：</div>
      <div class="hint mono" id="me">加载中…</div>
      <div class="row" style="margin-top:12px">
        <a href="/admin">进入后台</a>
        <button id="logout" type="button">退出登录</button>
      </div>
      <div id="msg" class="hint"></div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id)
      const getCookie = (name) => {
        const raw = document.cookie || ''
        const parts = raw.split(';').map((x) => x.trim()).filter(Boolean)
        for (const p of parts) {
          const idx = p.indexOf('=')
          if (idx <= 0) continue
          const k = p.slice(0, idx).trim()
          const v = p.slice(idx + 1).trim()
          if (k === name) return v
        }
        return ''
      }
      const setMsg = (ok, t) => $('msg').innerHTML = ok ? '<span class="ok">OK</span> ' + t : '<span class="bad">ERR</span> ' + t
      const load = async () => {
        const r = await fetch('/api/auth/me', { credentials: 'include' })
        const data = await r.json().catch(() => ({}))
        if (!data.user) { location.href = '/login'; return }
        const u = data.user
        $('me').innerHTML = '<span class="pill">' + (u.role || 'user') + '</span>  @' + (u.username || 'user')
      }
      $('logout').addEventListener('click', async () => {
        $('msg').innerHTML = ''
        const csrf = getCookie('jsd_csrf') || ''
        const r = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrf } })
        if (!r.ok) { setMsg(false, '退出失败'); return }
        location.href = '/'
      })
      load().catch(() => { location.href = '/login' })
    </script>
  </body>
</html>`

const renderAdminLoginHtml = (opts: { allowAdminRegister: boolean; allowUserRegister: boolean }) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>后台登录</title>
    <style>
      :root{--ink:#111;--paper:#fff8ee;--card:#ffffff;--border:3px solid var(--ink);--shadow-lg:10px 10px 0 var(--ink);--shadow-md:8px 8px 0 var(--ink);--shadow-sm:4px 4px 0 var(--ink);--radius:22px;--radius-sm:16px;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans";--danger:#e11d48;--ok:#15803d}
      *{box-sizing:border-box}html,body{height:100%}
      body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--paper);display:flex;align-items:center;justify-content:center;padding:22px}
      html[data-theme="dark"] body{background:var(--paper)}
      .card{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:22px;max-width:480px;width:100%}
      h1{margin:0 0 12px 0;font-size:18px}
      label{font-weight:900;font-size:12px}
      input{width:100%;border:var(--border);border-radius:12px;padding:12px 12px;font-size:14px;color:var(--ink);background:var(--paper);outline:none;font-family:var(--mono)}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
      button{border:var(--border);border-radius:12px;padding:10px 16px;font-weight:900;color:var(--ink);background:var(--card);box-shadow:4px 4px 0 var(--ink);cursor:pointer}
      .hint{font-size:12px;opacity:.85;margin-top:10px;line-height:1.5}
      .bad{color:var(--danger);font-weight:900}
      a{color:var(--ink)}
      input::placeholder{color:var(--ink);opacity:.5}
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow-lg:0 0 0 1px #334155;
        --shadow-md:0 0 0 1px #334155;
        --shadow-sm:0 0 0 1px #334155;
        --danger:#fb7185;
        --ok:#4ade80;
      }
    </style>
  </head>
  <body>
    <script>
      const getTheme = () => { try { return localStorage.getItem('jsd_theme') || '' } catch { return '' } }
      const applyTheme = (t) => {
        const theme = t === 'dark' ? 'dark' : 'light'
        document.documentElement.dataset.theme = theme
        try { localStorage.setItem('jsd_theme', theme) } catch {}
      }
      applyTheme(getTheme())
    </script>
    <div class="card">
      <div class="row">
        <h1>后台登录</h1>
        <a href="/">返回首页</a>
      </div>
      <div style="margin-top:12px">
        <label for="user">用户名</label>
        <input id="user" autocomplete="username" placeholder="例如：admin" />
      </div>
      <div style="margin-top:12px">
        <label for="pwd">密码</label>
        <input id="pwd" type="password" autocomplete="current-password" placeholder="请输入密码（至少 8 位）" />
      </div>
      <div class="row" style="margin-top:12px">
        <button id="login" type="button">登录</button>
        ${
          opts.allowAdminRegister
            ? '<a class="hint" href="/admin/register">首次使用？初始化管理员</a>'
            : opts.allowUserRegister
              ? '<a class="hint" href="/register">注册普通用户</a>'
              : '<span class="hint">未开放注册</span>'
        }
      </div>
      <div id="msg" class="hint"></div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id)
      const setMsg = (ok, t) => $('msg').innerHTML = ok ? t : '<span class="bad">ERR</span> ' + t
      const submit = async () => {
        const username = $('user').value
        const password = $('pwd').value
        $('msg').innerHTML = ''
        const r = await fetch('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
        if (!r.ok) { setMsg(false, '登录失败'); return }
        const data = await r.json().catch(() => ({}))
        if (!data.ok) { setMsg(false, data.error || '登录失败'); return }
        location.href = '/admin'
      }
      $('login').addEventListener('click', submit)
      $('pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
      $('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    </script>
  </body>
</html>`

const renderAdminRegisterHtml = () => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>首次注册（管理员）</title>
    <style>
      :root{--ink:#111;--paper:#fff8ee;--card:#ffffff;--border:3px solid var(--ink);--shadow-lg:10px 10px 0 var(--ink);--shadow-md:8px 8px 0 var(--ink);--shadow-sm:4px 4px 0 var(--ink);--radius:22px;--radius-sm:16px;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans";--danger:#e11d48;--ok:#15803d}
      *{box-sizing:border-box}html,body{height:100%}
      body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--paper);display:flex;align-items:center;justify-content:center;padding:22px}
      html[data-theme="dark"] body{background:var(--paper)}
      .card{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:22px;max-width:480px;width:100%}
      h1{margin:0 0 12px 0;font-size:18px}
      label{font-weight:900;font-size:12px}
      input{width:100%;border:var(--border);border-radius:var(--radius-sm);padding:12px 12px;font-size:14px;color:var(--ink);background:var(--paper);outline:none;font-family:var(--mono)}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
      button{border:var(--border);border-radius:var(--radius-sm);padding:10px 16px;font-weight:900;color:var(--ink);background:var(--card);box-shadow:var(--shadow-sm);cursor:pointer}
      .hint{font-size:12px;opacity:.85;margin-top:10px;line-height:1.5}
      .bad{color:var(--danger);font-weight:900}
      a{color:var(--ink)}
      input::placeholder{color:var(--ink);opacity:.5}
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow-lg:0 0 0 1px #334155;
        --shadow-md:0 0 0 1px #334155;
        --shadow-sm:0 0 0 1px #334155;
        --danger:#fb7185;
        --ok:#4ade80;
      }
    </style>
  </head>
  <body>
    <script>
      const getTheme = () => { try { return localStorage.getItem('jsd_theme') || '' } catch { return '' } }
      const applyTheme = (t) => {
        const theme = t === 'dark' ? 'dark' : 'light'
        document.documentElement.dataset.theme = theme
        try { localStorage.setItem('jsd_theme', theme) } catch {}
      }
      applyTheme(getTheme())
    </script>
    <div class="card">
      <div class="row">
        <h1>首次注册（管理员）</h1>
        <a href="/admin/login">已有账号？去登录</a>
      </div>
      <div class="hint">首次注册用户自动成为管理员；完成后即可进入安全管理 / 公告管理。</div>
      <div style="margin-top:12px">
        <label for="user">用户名</label>
        <input id="user" autocomplete="username" placeholder="3~32 位：字母/数字/._-" />
      </div>
      <div style="margin-top:12px">
        <label for="pwd">密码</label>
        <input id="pwd" type="password" autocomplete="new-password" placeholder="至少 8 位" />
      </div>
      <div class="row" style="margin-top:12px">
        <button id="reg" type="button">创建管理员</button>
        <div id="msg" class="hint"></div>
      </div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id)
      const setMsg = (ok, t) => $('msg').innerHTML = ok ? t : '<span class="bad">ERR</span> ' + t
      const submit = async () => {
        const username = $('user').value
        const password = $('pwd').value
        $('msg').innerHTML = ''
        const r = await fetch('/admin/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || !data.ok) { setMsg(false, data.error || '注册失败'); return }
        location.href = '/admin'
      }
      $('reg').addEventListener('click', submit)
      $('pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
      $('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    </script>
  </body>
</html>`

const adminHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>后台管理</title>
    <style>
      :root{
        --ink:#111;
        --paper:#fff8ee;
        --bg1:#fff1f7;
        --bg2:#eef7ff;
        --bg3:#f4fff0;
        --card:#ffffff;
        --border:3px solid var(--ink);
        --shadow-lg:10px 10px 0 var(--ink);
        --shadow-md:8px 8px 0 var(--ink);
        --shadow-sm:4px 4px 0 var(--ink);
        --radius:22px;
        --radius-sm:16px;
        --pad:18px;
        --mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
        --sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans","Apple Color Emoji","Segoe UI Emoji";
        --tag-p-bg:#ffd1ea;
        --tag-b-bg:#cfefff;
        --tag-g-bg:#d7ffcc;
        --tag-y-bg:#fff1b8;
        --accent:#66bb6a;
        --accent-strong:#43a047;
        --danger:#c62828;
        --ok:#2e7d32;
        --listH:320px;
      }
      @media(max-width:520px){:root{--listH:260px}}
      *{box-sizing:border-box}
      html,body{min-height:100vh}
      body{margin:0;font-family:var(--sans);color:var(--ink);overflow-x:hidden;background:#f5f0e8;min-height:100vh;min-height:100dvh;overscroll-behavior-y:none}
      html[data-theme="dark"] body{background:#0f172a}
      ::-webkit-scrollbar{width:8px;height:8px}
      ::-webkit-scrollbar-track{background:transparent}
      ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px}
      html[data-theme="dark"] ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15)}
      .wrap{width:100%;max-width:1120px;margin:0 auto;padding:22px 18px 0;padding-left:max(18px, env(safe-area-inset-left));padding-right:max(18px, env(safe-area-inset-right));padding-top:max(22px, env(safe-area-inset-top));padding-bottom:env(safe-area-inset-bottom)}
      .top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,520px);align-items:stretch;gap:14px;margin-bottom:14px}
      @media(max-width:940px){.top{grid-template-columns:1fr}}
      .card{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:var(--pad)}
      .card2{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-md);padding:16px}
      h1{margin:0;font-size:18px}
      .panelNav{min-width:0;display:flex;flex-direction:column;gap:10px}
      .top .card .hint{max-width:60ch;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;min-width:0}
      .quickActions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;min-width:0}
      @media (max-width: 520px){
        .tabs{grid-template-columns:repeat(2,minmax(0,1fr))}
        .quickActions{grid-template-columns:repeat(2,minmax(0,1fr))}
        .top .card .hint{-webkit-line-clamp:4}
        table{border-spacing:0 10px}
        table tr:first-child{display:none}
        .tr{display:block}
        .tr td{display:flex;align-items:flex-start;justify-content:flex-start;flex-wrap:wrap;gap:10px;padding:10px 12px}
        .tr td[colspan]{display:block}
        .tr td::before{content:attr(data-k);font-weight:900;color:var(--muted);flex:0 0 auto;max-width:46%}
        .tr td[colspan]::before{content:""}
        .tr td:first-child{border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-left-radius:0}
        .tr td:last-child{border-bottom-left-radius:18px;border-bottom-right-radius:18px;border-top-right-radius:0}
        .tr td .row{width:100%;justify-content:flex-end}
        .formRow > input:not([type="file"]),.formRow > select,.formRow > textarea{flex-basis:100%}
        .formRow > button{flex-basis:100%}
        .formRow > .switch,.formRow > .hint{flex-basis:100%}
        textarea{min-height:120px}
      }
      .tab,.quickLink,.quickBtn{border:var(--border);border-radius:18px;padding:11px 12px;background:var(--paper);box-shadow:0 8px 18px rgba(15,23,42,.1);font-weight:900;font-size:12px;color:var(--ink);min-height:48px}
      .tab{display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;user-select:none}
      .tab.on{background:var(--card)}
      .quickLink,.quickBtn{display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
      .quickBtn{appearance:none}
      .quickBtn.danger{color:var(--danger)}
      .tab span,.quickLink span,.quickBtn:not(.hasBadge) span,#versionBtnText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #versionBtnText:empty{display:none}
      .quickBtn.versionText{justify-content:center}
      .quickBtn.versionText #versionBtnIcon{display:none}
      .vBadge{margin-left:auto;display:inline-flex;align-items:center;gap:6px;border:var(--border);border-radius:999px;padding:2px 8px;background:var(--tag-y-bg);box-shadow:0 8px 16px rgba(15,23,42,.08);font-weight:950;font-size:11px;line-height:1;white-space:nowrap;min-width:0}
      .navIcon{width:15px;height:15px;display:block;flex:0 0 auto}
      .topLead{max-width:620px}
      .grid{display:grid;grid-template-columns:1fr;gap:14px}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
      .row > div{min-height:0}
      .formRow{justify-content:flex-start}
      .formRow input:not([type="file"]),.formRow select{flex:0 1 220px}
      .formRow .switch{flex:1 1 220px}
      .formRow .hint{flex:1 1 220px}
      label{font-weight:900;font-size:12px}
      input,textarea,select{border:var(--border);border-radius:16px;padding:10px 12px;font-size:14px;color:var(--ink);background:var(--field);outline:none;box-shadow:0 10px 22px rgba(15,23,42,.08);font-family:var(--mono)}
      textarea{width:100%;min-height:140px;resize:vertical}
      input:not([type="file"]){min-width:0;flex:1 1 240px}
      select{min-width:0;flex:1 1 200px}
      button{border:var(--border);border-radius:16px;padding:10px 12px;font-weight:900;color:var(--ink);background:var(--card);box-shadow:0 12px 24px rgba(15,23,42,.12);cursor:pointer}
      button:active{transform:translateY(1px);box-shadow:0 8px 18px rgba(15,23,42,.12)}
      table{width:100%;border-collapse:separate;border-spacing:0 10px}
      td,th{font-size:12px;text-align:left;padding:10px 10px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}
      .tr td{background:var(--card)}
      .tr{border:var(--border);border-radius:18px;background:transparent;box-shadow:0 10px 22px rgba(15,23,42,.08)}
      .tr td:first-child{border-top-left-radius:18px;border-bottom-left-radius:18px}
      .tr td:last-child{border-top-right-radius:18px;border-bottom-right-radius:18px}
      .mono{font-family:var(--mono);overflow-wrap:anywhere;word-break:break-word}
      .hint{font-size:12px;color:var(--muted);opacity:1;line-height:1.6}
      .ok{color:var(--ok);font-weight:900}
      .bad{color:var(--danger);font-weight:900}
      a{color:var(--ink)}
      .switch{display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:12px;user-select:none}
      .switch input{position:absolute;opacity:0;pointer-events:none}
      .switch .slider{width:44px;height:26px;border:var(--border);border-radius:999px;background:var(--paper);box-shadow:0 8px 16px rgba(15,23,42,.1);position:relative;flex:0 0 auto;transition:background .18s ease,border-color .18s ease}
      .switch .slider:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border:var(--border);border-radius:999px;background:var(--card);transition:transform .18s ease}
      .switch input:checked + .slider{background:var(--accent);border-color:var(--accent-strong)}
      .switch input:checked + .slider:after{transform:translateX(18px)}
      .switch .txt{line-height:1}
      .pick{display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:12px;user-select:none}
      .pick input{position:absolute;opacity:0;pointer-events:none}
      .pick .box{width:22px;height:22px;border:var(--border);border-radius:10px;background:var(--paper);box-shadow:0 8px 16px rgba(15,23,42,.1);position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;transition:background .18s ease,border-color .18s ease}
      .pick .box:after{content:"";width:10px;height:10px;border-radius:4px;background:transparent;transition:background .18s ease}
      .pick input:checked + .box{border-color:var(--accent-strong);background:rgba(34,197,94,.16)}
      .pick input:checked + .box:after{background:var(--accent)}
      .pick .txt{line-height:1}
      button{appearance:none}
      .switch.compact{gap:0}
      .switch.compact .txt{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      .switch.compact .slider{width:38px;height:22px;box-shadow:none}
      .switch.compact .slider:after{top:2px;left:2px;width:14px;height:14px}
      .switch.compact input:checked + .slider:after{transform:translateX(16px)}
      .pick.compact{gap:0}
      .pick.compact .txt{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      .pick.compact .box{width:20px;height:20px;box-shadow:none;border-radius:9px}
      .pick.compact .box:after{width:9px;height:9px;border-radius:4px}
      .drop{border:var(--border);border-radius:18px;padding:12px;background:var(--paper);box-shadow:0 12px 24px rgba(15,23,42,.12);min-width:0;width:100%}
      .drop.drag{background:rgba(34,197,94,.16)}
      .prev{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-top:10px}
      .prev img{width:64px;height:64px;border-radius:16px;border:var(--border);background:var(--card);box-shadow:0 10px 20px rgba(15,23,42,.12);object-fit:cover}
      th{color:var(--muted)}
      input::placeholder,textarea::placeholder{color:var(--muted);opacity:1}
      select option{color:var(--ink);background:var(--card)}
      .scrollBox{margin-top:10px;overflow:auto;max-height:var(--listH);overscroll-behavior:none;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;contain:layout paint}
      .modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.38);backdrop-filter:saturate(120%) blur(6px);z-index:9999}
      .modalCard{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:16px;max-width:680px;width:100%;max-height:min(84vh,720px);overflow:auto}
      .kv{display:grid;gap:10px;margin-top:12px}
      .kvRow{border:var(--border);border-radius:18px;background:var(--paper);box-shadow:0 10px 22px rgba(15,23,42,.08);padding:10px 12px;display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
      .kvRow .k{font-weight:900;color:var(--muted);flex:0 0 auto}
      .kvRow .v{font-family:var(--mono);text-align:right;overflow-wrap:anywhere;word-break:break-word;min-width:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
      @media (max-width: 520px){.kvRow{flex-direction:column}.kvRow .v{text-align:left;align-items:flex-start}}
      .stat{border:var(--border);border-radius:var(--radius);padding:12px;background:var(--card);box-shadow:var(--shadow-md);flex:1 1 160px;min-width:0}
      .drop{border:var(--border);border-radius:var(--radius);padding:12px;background:var(--paper);box-shadow:var(--shadow-md);min-width:0;width:100%}
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --bg1:#0f172a;
        --bg2:#0f172a;
        --bg3:#0f172a;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow-lg:0 0 0 1px #334155;
        --shadow-md:0 0 0 1px #334155;
        --shadow-sm:0 0 0 1px #334155;
        --tag-p-bg:#5c1f4d;
        --tag-b-bg:#1a4a68;
        --tag-g-bg:#125423;
        --tag-y-bg:#5c4b00;
        --accent:#4ade80;
        --accent-strong:#22c55e;
        --danger:#fb7185;
        --ok:#4ade80;
      }
      html[data-theme="dark"] .drop.drag{background:rgba(74,222,128,.2)}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div class="card">
          <h1>后台管理</h1>
          <div class="hint">公告会显示在首页顶部并滚动；封禁支持 IP / 域名（Referer/Origin）以及自动识别扫描/滥用。</div>
        </div>
        <div class="card panelNav">
          <div class="tabs">
            <div class="tab on" data-tab="security"><svg class="navIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5 13 3.7v3.4c0 3.2-2 5.9-5 7.4-3-1.5-5-4.2-5-7.4V3.7l5-2.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span>安全管理</span></div>
            <div class="tab" data-tab="traffic"><svg class="navIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 12.8V3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2.5 12.8h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.6 10.8 6.7 8.7l2 1.8 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>流量统计</span></div>
            <div class="tab" data-tab="announce"><svg class="navIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 9.5V3.8a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v5.7l-3.2-1.6H5.7L2.5 9.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 11.8h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>公告管理</span></div>
            <div class="tab" data-tab="site"><svg class="navIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.2 1.8h3.6l.4 1.7 1.5.6 1.5-.8 1.8 3.1-1.2 1.2.1 1.6 1.1 1.2-1.8 3.1-1.5-.8-1.5.6-.4 1.7H6.2l-.4-1.7-1.5-.6-1.5.8-1.8-3.1 1.2-1.2-.1-1.6L1 6.4l1.8-3.1 1.5.8 1.5-.6.4-1.7Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.1" stroke="currentColor" stroke-width="1.3"/></svg><span>页面设置</span></div>
          </div>
          <div class="quickActions">
            <a class="quickLink" href="/"><svg class="navIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 7.2 8 2.5l6 4.7v6.3a1 1 0 0 1-1 1h-3.2V10H6.2v4.5H3a1 1 0 0 1-1-1V7.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span>首页</span></a>
            <button class="quickBtn" id="themeToggle" type="button"><svg class="navIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2v1.6M8 12.2v1.6M3.9 3.9l1.1 1.1M11 11l1.1 1.1M2.2 8h1.6M12.2 8h1.6M3.9 12.1 5 11M11 5l1.1-1.1M10.8 8A2.8 2.8 0 1 1 5.2 8a2.8 2.8 0 0 1 5.6 0Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>主题</span></button>
            <button class="quickBtn" id="versionBtn" type="button" aria-label="版本"><svg class="navIcon" id="versionBtnIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M7.2 2.3h6.5v6.5H7.2V2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.3 7.2h6.5v6.5H2.3V7.2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.3 2.3h3.6v3.6H2.3V2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span id="versionBtnText"></span></button>
            <button class="quickBtn danger" id="logout" type="button"><svg class="navIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.2 2.5H3.8a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2.4M9.5 11.5 12.5 8l-3-3.5M12.2 8H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>退出</span></button>
          </div>
        </div>
      </div>

      <div id="security" class="grid">
        <div class="card2">
          <div class="row">
            <div><b>封禁列表</b></div>
            <div class="row" style="gap:10px">
              <div class="hint mono" id="banCount"></div>
              <button id="banDeleteSel" type="button">删除选中</button>
            </div>
          </div>
          <div class="row formRow" style="margin-top:10px">
            <select id="banType">
              <option value="ip">IP</option>
              <option value="domain">域名</option>
            </select>
            <input id="banValue" placeholder="例如：1.2.3.4 或 example.com" />
            <input id="banReason" placeholder="原因（可选）" />
            <input id="banSeconds" placeholder="封禁秒数（可选）" />
            <button id="addBan" type="button">添加</button>
          </div>
          <div class="scrollBox">
            <table id="banTable"></table>
          </div>
        </div>

        <div class="card2">
          <div class="row"><div><b>自动识别与选项</b></div><button id="saveSettings" type="button">保存</button></div>
          <div class="hint">建议先开启：扫描识别 + 频率限制 + Referer 滥用识别。</div>
          <div class="row formRow" style="margin-top:10px">
            <label class="switch"><input id="secEnabled" type="checkbox" /><span class="slider" aria-hidden="true"></span><span class="txt">启用安全策略</span></label>
            <input id="banSecondsSet" placeholder="自动封禁秒数（默认 3600）" />
          </div>
          <div class="row formRow" style="margin-top:10px">
            <label class="switch"><input id="rateEnabled" type="checkbox" /><span class="slider" aria-hidden="true"></span><span class="txt">频率限制</span></label>
            <input id="rateWindow" placeholder="窗口秒数" />
            <input id="rateMax" placeholder="最大请求数" />
          </div>
          <div class="row formRow" style="margin-top:10px">
            <label class="switch"><input id="scanEnabled" type="checkbox" /><span class="slider" aria-hidden="true"></span><span class="txt">扫描识别</span></label>
            <input id="scanWindow" placeholder="窗口秒数" />
            <input id="scanMax" placeholder="最大命中数" />
          </div>
          <div class="row formRow" style="margin-top:10px">
            <label class="switch"><input id="refEnabled" type="checkbox" /><span class="slider" aria-hidden="true"></span><span class="txt">Referer 滥用识别</span></label>
            <input id="refWindow" placeholder="窗口秒数" />
            <input id="refMax" placeholder="最大请求数" />
          </div>
          <div class="row formRow" style="margin-top:10px">
            <label class="switch"><input id="regEnabled" type="checkbox" /><span class="slider" aria-hidden="true"></span><span class="txt">允许用户注册</span></label>
            <div class="hint">默认仅允许首次注册（管理员）。开启后允许注册普通用户。</div>
          </div>
          <div class="row formRow" style="margin-top:10px">
            <label class="switch"><input id="cleanupEnabled" type="checkbox" /><span class="slider" aria-hidden="true"></span><span class="txt">自动清理</span></label>
            <input id="eventKeepDays" placeholder="事件保留天数（支持小数，默认 14）" />
            <input id="topKeepDays" placeholder="热点保留天数（默认 7）" />
          </div>
          <div class="row formRow" style="margin-top:10px">
            <label class="switch"><input id="trafficEnabled" type="checkbox" /><span class="slider" aria-hidden="true"></span><span class="txt">流量统计</span></label>
            <input id="trafficKeepDays" placeholder="流量保留天数（默认 30）" />
          </div>
          <div class="hint">自动清理：事件日志/近期热点/流量统计；封禁列表只清理到期条目。</div>
          <div id="settingsMsg" class="hint"></div>
        </div>

        <div class="card2">
          <div class="row">
            <div><b>近期热点（IP / 域名）</b></div>
            <div class="row" style="gap:10px">
              <button id="topClearAll" type="button">清空全部</button>
              <button id="topClearSel" type="button">删除选中</button>
              <button id="refresh" type="button">刷新</button>
            </div>
          </div>
          <div class="hint">点击“封禁”可一键加入封禁列表。</div>
          <div class="row" style="margin-top:10px;gap:14px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div class="hint"><b>Top IP</b></div>
              <div class="scrollBox"><table id="topIp"></table></div>
            </div>
            <div style="flex:1;min-width:0">
              <div class="hint"><b>Top 域名（Referer/Origin）</b></div>
              <div class="scrollBox"><table id="topDomain"></table></div>
            </div>
          </div>
        </div>

        <div class="card2">
          <div class="row">
            <div><b>事件日志</b></div>
            <div class="row" style="gap:10px">
              <button id="eventClearAll" type="button">清空全部</button>
              <button id="eventDeleteSel" type="button">删除选中</button>
            </div>
          </div>
          <div class="scrollBox" style="max-height:260px">
            <table id="eventTable"></table>
          </div>
        </div>
      </div>

      <div id="traffic" class="grid" style="display:none">
        <div class="card2">
          <div class="row">
            <div><b>流量统计</b></div>
            <div class="row" style="gap:10px">
              <button id="trafficClearAll" type="button">清空全部</button>
              <button id="trafficRefresh" type="button">刷新</button>
            </div>
          </div>
          <div class="hint">显示近 30 天流量汇总（字节/请求数）与 Top 列表。流量统计开关在「安全管理」内；删除记录可释放内存。</div>
          <div class="row" style="margin-top:10px;gap:12px">
            <div class="stat">
              <div class="hint"><b>近 24h</b></div>
              <div id="trafficStat24" class="mono"></div>
            </div>
            <div class="stat">
              <div class="hint"><b>近 7d</b></div>
              <div id="trafficStat7" class="mono"></div>
            </div>
            <div class="stat">
              <div class="hint"><b>近 30d</b></div>
              <div id="trafficStat30" class="mono"></div>
            </div>
          </div>
          <div id="trafficHint" class="hint" style="margin-top:10px"></div>
        </div>

        <div class="card2">
          <div class="row">
            <div><b>按客户端 IP 流量排行</b></div>
            <button id="trafficIpClearSel" type="button">删除选中</button>
          </div>
          <div class="scrollBox" style="max-height:280px">
            <table id="trafficIpTable"></table>
          </div>
        </div>

        <div class="card2">
          <div class="row">
            <div><b>按客户端域名流量排行</b></div>
            <button id="trafficDomainClearSel" type="button">删除选中</button>
          </div>
          <div class="scrollBox" style="max-height:280px">
            <table id="trafficDomainTable"></table>
          </div>
        </div>
      </div>

      <div id="announce" class="grid" style="display:none">
        <div class="card2">
          <div class="row">
            <div><b>公告管理</b></div>
            <div class="row" style="gap:10px">
              <select id="annFormat">
                <option value="text">Text</option>
                <option value="html">HTML</option>
                <option value="md">MD</option>
              </select>
              <button id="saveAnn" type="button">保存</button>
            </div>
          </div>
          <div class="hint">每行一条公告；格式支持 text/html/md；保存后前台首页顶部滚动显示。</div>
          <textarea id="annText" class="mono" placeholder="例如：欢迎使用本服务\\n如遇 403 请检查是否触发安全策略"></textarea>
          <div id="annMsg" class="hint"></div>
        </div>
      </div>

      <div id="site" class="grid" style="display:none">
        <div class="card2">
          <div class="row"><div><b>页面设置</b></div><button id="saveSite" type="button">保存</button></div>
          <div class="hint">用于首页 SEO（title/description）、favicon/logo 和页脚内容。</div>
          <div class="row formRow" style="margin-top:10px">
            <input id="siteTitle" placeholder="站点标题（title）" />
            <input id="siteDesc" placeholder="站点描述（meta description）" />
          </div>
          <div class="row formRow" style="margin-top:10px">
            <select id="footerFormat">
              <option value="text">Footer: Text</option>
              <option value="html">Footer: HTML</option>
              <option value="md">Footer: MD</option>
            </select>
          </div>
          <textarea id="footerText" class="mono" placeholder="例如：© 2026 noisework.cn"></textarea>
          <div class="row" style="margin-top:10px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div class="hint"><b>Favicon</b>（优先级：上传图片 > URL > 内置）</div>
              <div class="row formRow" style="margin-top:8px">
                <input id="faviconUrl" placeholder="favicon URL（可选）" />
              </div>
              <div class="row" style="margin-top:8px;align-items:flex-start">
                <div id="faviconDrop" class="drop">
                  <div class="hint">拖拽图片到这里，或选择文件上传（<=256KB）。</div>
                  <input id="faviconFile" type="file" accept="image/*" />
                  <div class="row" style="margin-top:8px;gap:10px;justify-content:flex-end">
                    <button id="faviconClear" type="button">清除上传</button>
                  </div>
                </div>
                <div class="prev">
                  <div>
                    <div class="hint">当前生效</div>
                    <img id="faviconNow" src="/favicon" alt="" aria-hidden="true" />
                  </div>
                  <div>
                    <div class="hint">URL 预览</div>
                    <img id="faviconUrlPrev" src="/favicon" alt="" aria-hidden="true" />
                  </div>
                </div>
              </div>
            </div>
            <div style="flex:1;min-width:0">
              <div class="hint"><b>Logo</b>（优先级：上传图片 > URL > 内置）</div>
              <div class="row formRow" style="margin-top:8px">
                <input id="logoUrl" placeholder="logo URL（可选）" />
              </div>
              <div class="row" style="margin-top:8px;align-items:flex-start">
                <div id="logoDrop" class="drop">
                  <div class="hint">拖拽图片到这里，或选择文件上传（<=256KB）。</div>
                  <input id="logoFile" type="file" accept="image/*" />
                  <div class="row" style="margin-top:8px;gap:10px;justify-content:flex-end">
                    <button id="logoClear" type="button">清除上传</button>
                  </div>
                </div>
                <div class="prev">
                  <div>
                    <div class="hint">当前生效</div>
                    <img id="logoNow" src="/logo" alt="" aria-hidden="true" />
                  </div>
                  <div>
                    <div class="hint">URL 预览</div>
                    <img id="logoUrlPrev" src="/logo" alt="" aria-hidden="true" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id="siteMsg" class="hint"></div>
        </div>
      </div>
    </div>
    <div id="versionModal" class="modal" aria-hidden="true">
      <div class="modalCard">
        <div class="row">
          <div><b>版本信息</b></div>
          <button id="versionClose" type="button">关闭</button>
        </div>
        <div id="versionBody" class="kv"></div>
      </div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id)
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
      const fmtTs = (ts) => { try { return new Date(ts).toLocaleString() } catch { return String(ts) } }
      const cacheBust = (url) => url + (url.includes('?') ? '&' : '?') + 't=' + Date.now()
      const getTheme = () => { try { return localStorage.getItem('jsd_theme') || '' } catch { return '' } }
      const applyTheme = (t) => {
        const theme = t === 'dark' ? 'dark' : 'light'
        document.documentElement.dataset.theme = theme
        try { localStorage.setItem('jsd_theme', theme) } catch {}
      }
      applyTheme(getTheme())
      const getCookie = (name) => {
        const raw = document.cookie || ''
        const parts = raw.split(';').map((x) => x.trim()).filter(Boolean)
        for (const p of parts) {
          const idx = p.indexOf('=')
          if (idx <= 0) continue
          const k = p.slice(0, idx).trim()
          const v = p.slice(idx + 1).trim()
          if (k === name) return v
        }
        return ''
      }

      const api = async (path, opts={}) => {
        const o = Object.assign({ credentials: 'include' }, opts)
        const method = String(o.method || 'GET').toUpperCase()
        o.headers = Object.assign({}, o.headers || {})
        if (method !== 'GET') {
          o.headers['x-csrf-token'] = getCookie('jsd_csrf') || ''
        }
        const r = await fetch(path, o)
        if (!r.ok) throw new Error('http_' + r.status)
        return r.json()
      }
      const renderSwitch = (attrs, label, cls = '') => '<label class="switch ' + cls + '"><input type="checkbox" ' + attrs + ' /><span class="slider" aria-hidden="true"></span><span class="txt">' + esc(label) + '</span></label>'
      const renderPick = (attrs, label, cls = '') => '<label class="pick ' + cls + '"><input type="checkbox" ' + attrs + ' /><span class="box" aria-hidden="true"></span><span class="txt">' + esc(label) + '</span></label>'

      const setTab = (name) => {
        const n = String(name || 'security')
        try { localStorage.setItem('jsd_admin_tab', n) } catch {}
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === n))
        $('security').style.display = n === 'security' ? '' : 'none'
        $('traffic').style.display = n === 'traffic' ? '' : 'none'
        $('announce').style.display = n === 'announce' ? '' : 'none'
        $('site').style.display = n === 'site' ? '' : 'none'
        try { window.scrollTo(0, 0) } catch {}
      }

      document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)))

      $('themeToggle').addEventListener('click', () => {
        const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
        applyTheme(cur === 'dark' ? 'light' : 'dark')
      })

      const setModalOpen = (open) => {
        const m = $('versionModal')
        if (!m) return
        m.style.display = open ? 'flex' : 'none'
        m.setAttribute('aria-hidden', open ? 'false' : 'true')
      }

      const renderKvRows = (data) => {
        const version = String((data && data.appVersion) || '').trim()
        const buildTimeRaw = String((data && data.buildTime) || '').trim()
        const buildTimeFmt = buildTimeRaw ? fmtTs(buildTimeRaw) : ''
        const nodeVersion = String((data && data.nodeVersion) || '').trim()
        const platform = String((data && data.platform) || '').trim()
        const arch = String((data && data.arch) || '').trim()
        const runtime = [nodeVersion ? ('Node ' + nodeVersion.replace(/^v/, '')) : '', platform && arch ? (platform + '/' + arch) : ''].filter(Boolean).join(' · ')

        const rows = [
          ['版本', version, ''],
          ['发布时间', buildTimeFmt || buildTimeRaw, buildTimeFmt && buildTimeRaw && buildTimeFmt !== buildTimeRaw ? buildTimeRaw : ''],
          ['运行环境', runtime, '']
        ]
          .map(([k, main, sub]) => [k, String(main || '').trim(), String(sub || '').trim()])
          .filter((x) => x[1])

        if (!rows.length) return '<div class="hint">暂无版本信息（未注入环境变量）</div>'

        return rows
          .map(([k, main, sub]) =>
            '<div class="kvRow">' +
              '<div class="k">' + esc(k) + '</div>' +
              '<div class="v">' +
                '<div>' + esc(main) + '</div>' +
                (sub ? '<div class="hint mono">' + esc(sub) + '</div>' : '') +
              '</div>' +
            '</div>'
          )
          .join('')
      }

      const bindVersion = () => {
        const btn = $('versionBtn')
        const txt = $('versionBtnText')
        const close = $('versionClose')
        const modal = $('versionModal')
        const applyBtn = (data) => {
          const v = String((data && data.appVersion) || '').trim()
          if (txt) txt.textContent = v ? ('版本号：' + v) : '版本'
          btn.classList.toggle('versionText', !!v)
        }
        if (!btn || !close || !modal) return
        api('/admin/api/version')
          .then((data) => applyBtn(data || {}))
          .catch(() => applyBtn({}))
        btn.addEventListener('click', async () => {
          const body = $('versionBody')
          if (body) body.innerHTML = '<div class="hint">加载中…</div>'
          setModalOpen(true)
          try {
            const data = await api('/admin/api/version')
            applyBtn(data || {})
            if (body) body.innerHTML = renderKvRows(data || {})
          } catch {
            if (body) body.innerHTML = '<div class="hint"><span class="bad">ERR</span> 获取失败</div>'
          }
        })
        close.addEventListener('click', () => setModalOpen(false))
        modal.addEventListener('click', (e) => { if (e.target === modal) setModalOpen(false) })
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setModalOpen(false) })
      }

      $('logout').addEventListener('click', async () => {
        await fetch('/admin/logout', { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': getCookie('jsd_csrf') || '' } })
        location.href = '/admin/login'
      })

      const renderBans = (bans) => {
        $('banCount').textContent = '条目：' + bans.length
        const rows = bans.map((b) => {
          const created = b.createdAt ? fmtTs(b.createdAt) : ''
          const exp = b.expiresAt ? fmtTs(b.expiresAt) : '永久'
          const by = b.createdBy === 'auto' ? 'auto' : 'manual'
          return '<tr class="tr">' +
            '<td data-k="选">' + renderPick('data-ban="1" data-type="'+esc(b.type)+'" data-val="'+esc(b.value)+'"', '选择封禁', 'compact') + '</td>' +
            '<td data-k="类型" class="mono">' + esc(b.type) + '</td>' +
            '<td data-k="值" class="mono">' + esc(b.value) + '</td>' +
            '<td data-k="原因">' + esc(b.reason || '') + '</td>' +
            '<td data-k="来源" class="mono">' + esc(by) + '</td>' +
            '<td data-k="封禁" class="mono">' + esc(created) + '</td>' +
            '<td data-k="解封" class="mono">' + esc(exp) + '</td>' +
            '<td data-k="操作"><button data-act="unban" data-type="'+esc(b.type)+'" data-val="'+esc(b.value)+'">删除</button></td>' +
          '</tr>'
        }).join('')
        $('banTable').innerHTML = '<tr><th>' + renderPick('id="banAll"', '全选封禁', 'compact') + '</th><th>类型</th><th>值</th><th>原因</th><th>来源</th><th>封禁时间</th><th>解封时间</th><th></th></tr>' + rows
      }

      const renderTopIp = (list) => {
        const rows = list.map((x) =>
          '<tr class="tr">' +
          '<td data-k="选">' + renderPick('data-topip="1" data-ip="'+esc(x.ip)+'"', '选择 IP', 'compact') + '</td>' +
          '<td data-k="IP" class="mono">' + esc(x.ip) + '</td>' +
          '<td data-k="统计" class="mono">req=' + esc(x.requests) + ' scan=' + esc(x.scanHits) + '</td>' +
          '<td data-k="操作" class="row" style="gap:10px;justify-content:flex-end"><button data-act="banip" data-ip="'+esc(x.ip)+'">封禁</button><button data-act="delip" data-ip="'+esc(x.ip)+'">删除</button></td>' +
          '</tr>'
        ).join('')
        $('topIp').innerHTML = '<tr><th>' + renderPick('id="topIpAll"', '全选 IP', 'compact') + '</th><th>IP</th><th>统计</th><th></th></tr>' + rows
      }

      const renderTopDomain = (list) => {
        const rows = list.map((x) =>
          '<tr class="tr">' +
          '<td data-k="选">' + renderPick('data-topdomain="1" data-domain="'+esc(x.domain)+'"', '选择域名', 'compact') + '</td>' +
          '<td data-k="域名" class="mono">' + esc(x.domain) + '</td>' +
          '<td data-k="统计" class="mono">req=' + esc(x.requests) + '</td>' +
          '<td data-k="操作" class="row" style="gap:10px;justify-content:flex-end"><button data-act="bandomain" data-domain="'+esc(x.domain)+'">封禁</button><button data-act="deldomain" data-domain="'+esc(x.domain)+'">删除</button></td>' +
          '</tr>'
        ).join('')
        $('topDomain').innerHTML = '<tr><th>' + renderPick('id="topDomainAll"', '全选域名', 'compact') + '</th><th>域名</th><th>统计</th><th></th></tr>' + rows
      }

      const renderEvents = (events) => {
        const rows = events.slice().reverse().slice(0, 120).map((e) =>
          '<tr class="tr">' +
          '<td data-k="选">' + (e.id ? renderPick('data-event="1" data-id="'+esc(e.id)+'"', '选择事件', 'compact') : '') + '</td>' +
          '<td data-k="时间" class="mono">' + esc(fmtTs(e.ts)) + '</td>' +
          '<td data-k="类型" class="mono">' + esc(e.kind) + '</td>' +
          '<td data-k="IP" class="mono">' + esc(e.ip || '') + '</td>' +
          '<td data-k="域名" class="mono">' + esc(e.domain || '') + '</td>' +
          '<td data-k="路径" class="mono">' + esc(e.path || '') + '</td>' +
          '<td data-k="详情">' + esc(e.detail || '') + '</td>' +
          '<td data-k="操作">' + (e.id ? '<button data-act="delevent" data-id="'+esc(e.id)+'">删除</button>' : '') + '</td>' +
          '</tr>'
        ).join('')
        $('eventTable').innerHTML = '<tr><th>' + renderPick('id="eventAll"', '全选事件', 'compact') + '</th><th>时间</th><th>类型</th><th>IP</th><th>域名</th><th>路径</th><th>详情</th><th></th></tr>' + rows
      }

      const fillSettings = (s) => {
        $('secEnabled').checked = !!s.enabled
        $('banSecondsSet').value = String(s.banSeconds || '')
        $('rateEnabled').checked = !!s.rate.enabled
        $('rateWindow').value = String(s.rate.windowSeconds || '')
        $('rateMax').value = String(s.rate.maxRequests || '')
        $('scanEnabled').checked = !!s.scan.enabled
        $('scanWindow').value = String(s.scan.windowSeconds || '')
        $('scanMax').value = String(s.scan.maxHits || '')
        $('refEnabled').checked = !!s.refererAbuse.enabled
        $('refWindow').value = String(s.refererAbuse.windowSeconds || '')
        $('refMax').value = String(s.refererAbuse.maxRequests || '')
        $('regEnabled').checked = !!s.registrationEnabled
        $('cleanupEnabled').checked = !!(s.cleanup && s.cleanup.enabled)
        $('eventKeepDays').value = String((s.cleanup && s.cleanup.eventRetentionDays) || '')
        $('topKeepDays').value = String((s.cleanup && s.cleanup.topRetentionDays) || '')
        $('trafficEnabled').checked = !!(s.traffic && s.traffic.enabled)
        $('trafficKeepDays').value = String((s.traffic && s.traffic.retentionDays) || '')
      }

      const fmtBytes = (n) => {
        const v = Number(n || 0)
        if (!Number.isFinite(v) || v <= 0) return '0 B'
        const units = ['B', 'KB', 'MB', 'GB', 'TB']
        let x = v
        let i = 0
        while (x >= 1024 && i < units.length - 1) {
          x /= 1024
          i++
        }
        const s = x >= 100 || i === 0 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)
        return s + ' ' + units[i]
      }

      const renderTraffic = (traffic) => {
        const t = traffic || {}
        if (!t.enabled) {
          $('trafficStat24').textContent = '0 B / 0'
          $('trafficStat7').textContent = '0 B / 0'
          $('trafficStat30').textContent = '0 B / 0'
          $('trafficHint').innerHTML = '<span class="bad">ERR</span> 未开启流量统计：到「安全管理」开启“流量统计”后，这里才会累计数据。'
          $('trafficIpTable').innerHTML = '<tr><th></th><th>IP</th><th>流量</th><th>请求数</th></tr><tr class="tr"><td colspan="4" class="hint">未开启</td></tr>'
          $('trafficDomainTable').innerHTML = '<tr><th></th><th>域名</th><th>流量</th><th>请求数</th></tr><tr class="tr"><td colspan="4" class="hint">未开启</td></tr>'
          return
        }
        const totals = t.totals || {}
        $('trafficStat24').textContent = fmtBytes(totals.last24Bytes || 0) + ' / ' + String(Number(totals.last24Requests || 0) || 0)
        $('trafficStat7').textContent = fmtBytes(totals.last7dBytes || 0) + ' / ' + String(Number(totals.last7dRequests || 0) || 0)
        $('trafficStat30').textContent = fmtBytes(totals.last30dBytes || 0) + ' / ' + String(Number(totals.last30dRequests || 0) || 0)
        $('trafficHint').textContent = ''
        // 渲染客户端 IP 流量列表
        const ipRows = Array.isArray(t.topIps) ? t.topIps.map((x) => {
          const ip = esc(x.ip || '')
          const req = Number(x.requests || 0) || 0
          const bytesFmt = fmtBytes(x.bytes)
          return '<tr class="tr"><td data-k="选">' + renderPick('data-tip="1" data-ip="'+ip+'"', '选择', 'compact') + '</td><td data-k="IP" class="mono">' + ip + '</td><td data-k="流量" class="mono">' + bytesFmt + '</td><td data-k="请求" class="mono">' + req + '</td></tr>'
        }).join('') : ''
        $('trafficIpTable').innerHTML = '<tr><th>' + renderPick('id="tipAll"', '全选', 'compact') + '</th><th>IP</th><th>流量</th><th>请求数</th></tr>' + (ipRows || '<tr class="tr"><td colspan="4" class="hint">暂无数据</td></tr>')

        // 渲染客户端域名流量列表
        const domainRows = Array.isArray(t.topDomains) ? t.topDomains.map((x) => {
          const domain = esc(x.domain || '')
          const req = Number(x.requests || 0) || 0
          const bytesFmtD = fmtBytes(x.bytes)
          return '<tr class="tr"><td data-k="选">' + renderPick('data-tdomain="1" data-domain="'+domain+'"', '选择', 'compact') + '</td><td data-k="域名" class="mono">' + domain + '</td><td data-k="流量" class="mono">' + bytesFmtD + '</td><td data-k="请求" class="mono">' + req + '</td></tr>'
        }).join('') : ''
        $('trafficDomainTable').innerHTML = '<tr><th>' + renderPick('id="tdomainAll"', '全选', 'compact') + '</th><th>域名</th><th>流量</th><th>请求数</th></tr>' + (domainRows || '<tr class="tr"><td colspan="4" class="hint">暂无数据</td></tr>')
      }

      const load = async () => {
        const data = await api('/admin/api/overview')
        renderBans(data.bans || [])
        renderTopIp(data.topIps || [])
        renderTopDomain(data.topDomains || [])
        renderEvents(data.events || [])
        renderTraffic(data.traffic || null)
        fillSettings(data.settings)
        $('footerText').value = String((data.site && data.site.footerText) || '')
        $('footerFormat').value = String((data.site && data.site.footerFormat) || 'text')
        $('siteTitle').value = String((data.site && data.site.title) || '')
        $('siteDesc').value = String((data.site && data.site.description) || '')
        $('faviconUrl').value = String((data.site && data.site.faviconUrl) || '')
        $('logoUrl').value = String((data.site && data.site.logoUrl) || '')
        $('annFormat').value = String((data.site && data.site.announcementFormat) || 'text')
        const favUrl = $('faviconUrl').value.trim()
        const logoUrl = $('logoUrl').value.trim()
        $('faviconNow').src = cacheBust('/favicon')
        $('logoNow').src = cacheBust('/logo')
        $('faviconUrlPrev').src = favUrl || '/favicon'
        $('logoUrlPrev').src = logoUrl || '/logo'
        const annLines = (data.announcements || []).filter((a) => a.enabled).map((a) => a.text).join('\\n')
        $('annText').value = annLines
      }

      $('refresh').addEventListener('click', () => load().catch(() => {}))
      $('trafficRefresh').addEventListener('click', () => load().catch(() => {}))
      $('trafficClearAll').addEventListener('click', async () => {
        if (!confirm('确认清空全部流量统计？')) return
        await api('/admin/api/traffic/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ all: true }) })
        await load()
      })

      // 客户端 IP 流量列表全选
      $('trafficIpTable').addEventListener('change', (e) => {
        const t = e.target
        if (!t || t.id !== 'tipAll') return
        const on = !!t.checked
        $('trafficIpTable').querySelectorAll('input[data-tip="1"]').forEach((x) => { x.checked = on })
      })
      // 客户端域名流量列表全选
      $('trafficDomainTable').addEventListener('change', (e) => {
        const t = e.target
        if (!t || t.id !== 'tdomainAll') return
        const on = !!t.checked
        $('trafficDomainTable').querySelectorAll('input[data-tdomain="1"]').forEach((x) => { x.checked = on })
      })

      // 删除选中的客户端 IP 流量
      $('trafficIpClearSel').addEventListener('click', async () => {
        const ips = Array.from($('trafficIpTable').querySelectorAll('input[data-tip="1"]:checked')).map((x) => x.dataset.ip || '').filter(Boolean)
        if (!ips.length) return
        if (!confirm('确认删除选中的 IP 流量记录？')) return
        await api('/admin/api/traffic/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ips }) })
        await load()
      })

      // 删除选中的客户端域名流量
      $('trafficDomainClearSel').addEventListener('click', async () => {
        const domains = Array.from($('trafficDomainTable').querySelectorAll('input[data-tdomain="1"]:checked')).map((x) => x.dataset.domain || '').filter(Boolean)
        if (!domains.length) return
        if (!confirm('确认删除选中的域名流量记录？')) return
        await api('/admin/api/traffic/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domains }) })
        await load()
      })

      $('addBan').addEventListener('click', async () => {
        const type = $('banType').value
        const value = $('banValue').value.trim()
        const reason = $('banReason').value.trim()
        const seconds = Number($('banSeconds').value.trim() || 0) || undefined
        await api('/admin/api/ban', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, value, reason, seconds }) })
        $('banValue').value = ''
        $('banReason').value = ''
        $('banSeconds').value = ''
        await load()
      })

      $('banTable').addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest && e.target.closest('button')
        if (!btn) return
        if (btn.dataset.act !== 'unban') return
        if (!confirm('确认删除该封禁条目？')) return
        await api('/admin/api/unban', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: btn.dataset.type, value: btn.dataset.val }) })
        await load()
      })

      $('banTable').addEventListener('change', (e) => {
        const t = e.target
        if (!t || t.id !== 'banAll') return
        const on = !!t.checked
        $('banTable').querySelectorAll('input[data-ban="1"]').forEach((x) => { x.checked = on })
      })

      $('banDeleteSel').addEventListener('click', async () => {
        const checked = Array.from($('banTable').querySelectorAll('input[data-ban="1"]:checked'))
        if (!checked.length) return
        if (!confirm('确认删除选中的封禁条目？')) return
        const list = checked.map((x) => ({ type: x.dataset.type === 'domain' ? 'domain' : 'ip', value: x.dataset.val }))
        await api('/admin/api/bans/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list }) })
        await load()
      })

      $('topIp').addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest && e.target.closest('button')
        if (!btn) return
        if (btn.dataset.act === 'banip') {
          await api('/admin/api/ban', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'ip', value: btn.dataset.ip, reason: 'manual_from_top', seconds: 0 }) })
          await load()
          return
        }
        if (btn.dataset.act === 'delip') {
          if (!confirm('确认删除该热点条目？')) return
          await api('/admin/api/top/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ips: [btn.dataset.ip || ''], domains: [] }) })
          await load()
        }
      })

      $('topDomain').addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest && e.target.closest('button')
        if (!btn) return
        if (btn.dataset.act === 'bandomain') {
          await api('/admin/api/ban', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'domain', value: btn.dataset.domain, reason: 'manual_from_top', seconds: 0 }) })
          await load()
          return
        }
        if (btn.dataset.act === 'deldomain') {
          if (!confirm('确认删除该热点条目？')) return
          await api('/admin/api/top/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ips: [], domains: [btn.dataset.domain || ''] }) })
          await load()
        }
      })

      $('topIp').addEventListener('change', (e) => {
        const t = e.target
        if (!t || t.id !== 'topIpAll') return
        const on = !!t.checked
        $('topIp').querySelectorAll('input[data-topip="1"]').forEach((x) => { x.checked = on })
      })
      $('topDomain').addEventListener('change', (e) => {
        const t = e.target
        if (!t || t.id !== 'topDomainAll') return
        const on = !!t.checked
        $('topDomain').querySelectorAll('input[data-topdomain="1"]').forEach((x) => { x.checked = on })
      })
      $('topClearSel').addEventListener('click', async () => {
        const ips = Array.from($('topIp').querySelectorAll('input[data-topip="1"]:checked')).map((x) => x.dataset.ip || '').filter(Boolean)
        const domains = Array.from($('topDomain').querySelectorAll('input[data-topdomain="1"]:checked')).map((x) => x.dataset.domain || '').filter(Boolean)
        if (!ips.length && !domains.length) return
        if (!confirm('确认删除选中的热点条目？')) return
        await api('/admin/api/top/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ips, domains }) })
        await load()
      })

      $('topClearAll').addEventListener('click', async () => {
        if (!confirm('确认清空全部热点（IP/域名）？')) return
        await api('/admin/api/top/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ all: true }) })
        await load()
      })

      $('eventTable').addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest && e.target.closest('button')
        if (!btn) return
        if (btn.dataset.act !== 'delevent') return
        if (!confirm('确认删除该事件日志？')) return
        const id = Number(btn.dataset.id || 0) || 0
        if (!id) return
        await api('/admin/api/events/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [id] }) })
        await load()
      })
      $('eventTable').addEventListener('change', (e) => {
        const t = e.target
        if (!t || t.id !== 'eventAll') return
        const on = !!t.checked
        $('eventTable').querySelectorAll('input[data-event="1"]').forEach((x) => { x.checked = on })
      })
      $('eventDeleteSel').addEventListener('click', async () => {
        const ids = Array.from($('eventTable').querySelectorAll('input[data-event="1"]:checked')).map((x) => Number(x.dataset.id || 0) || 0).filter((x) => x > 0)
        if (!ids.length) return
        if (!confirm('确认删除选中的事件日志？')) return
        await api('/admin/api/events/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) })
        await load()
      })

      $('eventClearAll').addEventListener('click', async () => {
        if (!confirm('确认清空全部事件日志？')) return
        await api('/admin/api/events/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ all: true }) })
        await load()
      })

      $('saveSettings').addEventListener('click', async () => {
        $('settingsMsg').textContent = ''
        const payload = {
          enabled: $('secEnabled').checked,
          banSeconds: Number($('banSecondsSet').value || 0) || undefined,
          rate: { enabled: $('rateEnabled').checked, windowSeconds: Number($('rateWindow').value || 0) || undefined, maxRequests: Number($('rateMax').value || 0) || undefined },
          scan: { enabled: $('scanEnabled').checked, windowSeconds: Number($('scanWindow').value || 0) || undefined, maxHits: Number($('scanMax').value || 0) || undefined },
          refererAbuse: { enabled: $('refEnabled').checked, windowSeconds: Number($('refWindow').value || 0) || undefined, maxRequests: Number($('refMax').value || 0) || undefined },
          registrationEnabled: $('regEnabled').checked,
          cleanup: { enabled: $('cleanupEnabled').checked, eventRetentionDays: Number($('eventKeepDays').value || 0) || undefined, topRetentionDays: Number($('topKeepDays').value || 0) || undefined },
          traffic: { enabled: $('trafficEnabled').checked, retentionDays: Number($('trafficKeepDays').value || 0) || undefined }
        }
        try {
          await api('/admin/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
          $('settingsMsg').innerHTML = '<span class="ok">OK</span> 已保存'
          await load()
        } catch {
          $('settingsMsg').innerHTML = '<span class="bad">ERR</span> 保存失败'
        }
      })

      $('saveAnn').addEventListener('click', async () => {
        $('annMsg').textContent = ''
        const lines = $('annText').value.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean)
        const list = lines.map((t) => ({ text: t, enabled: true }))
        const format = $('annFormat').value
        try {
          await api('/admin/api/announcements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list, format }) })
          $('annMsg').innerHTML = '<span class="ok">OK</span> 已保存'
          await load()
        } catch {
          $('annMsg').innerHTML = '<span class="bad">ERR</span> 保存失败'
        }
      })

      $('saveSite').addEventListener('click', async () => {
        $('siteMsg').textContent = ''
        const payload = {
          footerText: $('footerText').value,
          footerFormat: $('footerFormat').value,
          title: $('siteTitle').value,
          description: $('siteDesc').value,
          faviconUrl: $('faviconUrl').value,
          logoUrl: $('logoUrl').value
        }
        try {
          await api('/admin/api/site', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
          $('siteMsg').innerHTML = '<span class="ok">OK</span> 已保存'
          await load()
        } catch {
          $('siteMsg').innerHTML = '<span class="bad">ERR</span> 保存失败'
        }
      })

      const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result || ''))
        fr.onerror = () => reject(new Error('read_failed'))
        fr.readAsDataURL(file)
      })

      const bindAsset = (kind) => {
        const drop = $(kind + 'Drop')
        const file = $(kind + 'File')
        const clear = $(kind + 'Clear')
        const nowImg = $(kind + 'Now')
        const urlInput = $(kind + 'Url')
        const urlPrev = $(kind + 'UrlPrev')

        const upload = async (f) => {
          const dataUrl = await readFileAsDataUrl(f)
          await api('/admin/api/site-asset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, dataUrl }) })
          nowImg.src = cacheBust('/' + kind)
        }

        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag') })
        drop.addEventListener('dragleave', () => drop.classList.remove('drag'))
        drop.addEventListener('drop', async (e) => {
          e.preventDefault()
          drop.classList.remove('drag')
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
          if (!f) return
          try { await upload(f); await load() } catch {}
        })
        file.addEventListener('change', async () => {
          const f = file.files && file.files[0]
          if (!f) return
          try { await upload(f); await load() } catch {}
          file.value = ''
        })
        clear.addEventListener('click', async () => {
          if (!confirm('确认清除已上传的图片？')) return
          await api('/admin/api/site-asset-clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })
          nowImg.src = cacheBust('/' + kind)
          await load()
        })
        urlInput.addEventListener('input', () => {
          const v = urlInput.value.trim()
          urlPrev.src = v || '/' + kind
        })
      }

      bindAsset('favicon')
      bindAsset('logo')

      const lastTab = (() => { try { return localStorage.getItem('jsd_admin_tab') || '' } catch { return '' } })()
      setTab(lastTab || 'security')
      bindVersion()
      load().catch(() => {})
    </script>
  </body>
</html>`

const renderNotFoundHtml = () => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>404 - 页面未找到</title>
    <style>
      :root{--ink:#111;--paper:#fff8ee;--card:#ffffff;--border:3px solid var(--ink);--shadow:10px 10px 0 var(--ink);--radius:22px;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans"}
      *{box-sizing:border-box}
      html,body{min-height:100vh}
      body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--paper);display:flex;align-items:center;justify-content:center;min-height:100vh}
      html[data-theme="dark"]{
        --ink:#e2e8f0;
        --paper:#1e293b;
        --card:#1e293b;
        --border:3px solid #334155;
        --shadow:0 0 0 1px #334155;
      }
      html[data-theme="dark"] body{background:var(--paper)}
      .container{text-align:center;padding:40px}
      .card{background:var(--card);border:var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:40px 50px;display:inline-block}
      .emoji{font-size:72px;line-height:1;margin-bottom:20px}
      .code{font-size:96px;font-weight:900;line-height:1;margin-bottom:10px;color:var(--ink)}
      .title{font-size:24px;font-weight:900;margin-bottom:15px}
      .desc{font-size:14px;opacity:.8;margin-bottom:25px}
      .btn{border:var(--border);border-radius:16px;padding:12px 24px;font-weight:900;background:var(--card);box-shadow:4px 4px 0 var(--ink);cursor:pointer;text-decoration:none;color:var(--ink);display:inline-block}
      .btn:hover{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--ink)}
      /* 贴纸装饰 */
      .sticker{position:absolute;font-size:18px;animation:floatSticker 5s ease-in-out infinite}
      @keyframes floatSticker{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-10px) rotate(5deg)}}
      .st1{top:15%;left:10%;animation-delay:0s}
      .st2{top:20%;right:15%;animation-delay:1s}
      .st3{bottom:20%;left:15%;animation-delay:2s}
      .st4{bottom:15%;right:10%;animation-delay:0.5s}
    </style>
  </head>
  <body>
    <div class="card">
      <div class="emoji">📄</div>
      <div class="code">404</div>
      <div class="title">页面未找到</div>
      <div class="desc">抱歉，您访问的页面不存在或已被移除</div>
      <a href="/" class="btn">返回首页</a>
    </div>
    <span class="sticker st1">✦</span>
    <span class="sticker st2">★</span>
    <span class="sticker st3">✧</span>
    <span class="sticker st4">✦</span>
    <script>
      const getTheme=()=>{try{return localStorage.getItem('jsd_theme')||''}catch{return''}}
      const applyTheme=(t)=>{const theme=t==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;try{localStorage.setItem('jsd_theme',theme)}catch{}}
      applyTheme(getTheme())
    </script>
  </body>
</html>`

const isProbablyCommitSha = (ref: string) => /^[0-9a-f]{7,40}$/i.test(ref)
const isProbablySemver = (ref: string) => /^v?\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(ref)

const isStableRef = (ref: string) => {
  const lower = ref.toLowerCase()
  if (lower === 'main' || lower === 'master' || lower === 'head' || lower === 'latest') return false
  return isProbablySemver(ref) || isProbablyCommitSha(ref)
}

const stableFromJsDelivrPath = (path: string) => {
  const gh = /\/gh\/[^/]+\/[^@/]+@([^/]+)\//.exec(path)?.[1]
  if (gh) return isStableRef(gh)
  const npm = /\/npm\/(?:@[^/]+\/)?[^@/]+@([^/]+)\//.exec(path)?.[1]
  if (npm) return isStableRef(npm)
  return false
}

const readJsonBody = async (c: Context) => {
  let bodyText = ''
  try {
    bodyText = await c.req.text()
  } catch {}
  try {
    const ct = c.req.header('content-type') ?? ''
    if (ct.includes('application/json')) return JSON.parse(bodyText || '{}')
    const sp = new URLSearchParams(bodyText)
    const out: Record<string, any> = {}
    for (const [k, v] of sp.entries()) out[k] = v
    return out
  } catch {
    return {}
  }
}

const decodeDataUrlToBytes = (dataUrl: string) => {
  const raw = String(dataUrl ?? '').trim()
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(raw)
  if (!m) return null
  const mime = (m[1] || '').trim().toLowerCase()
  const b64 = (m[2] || '').trim()
  if (!mime || !b64) return null
  try {
    const buf = Buffer.from(b64, 'base64')
    return { mime, bytes: new Uint8Array(buf) }
  } catch {
    return null
  }
}

const requireCsrf = (req: Request) => {
  const cookies = parseCookie(req.headers.get('cookie'))
  const csrfCookie = cookies['jsd_csrf'] ?? ''
  const csrfHeader = req.headers.get('x-csrf-token') ?? ''
  return !!csrfCookie && csrfCookie === csrfHeader
}

export const createNodeApp = (deps: { adminStore: AdminDbStore; auth: AuthDb }) => {
  const app = new Hono()
  const adminStore = deps.adminStore
  const auth = deps.auth

  const getSecureFlag = (req: Request) => {
    try {
      return new URL(req.url).protocol === 'https:'
    } catch {
      return false
    }
  }

  const isAuthedAdmin = async (c: Context) => {
    const u = await auth.verify(c.req.raw)
    return !!u && u.role === 'admin'
  }

  app.use('*', async (c: Context, next) => {
    const u = new URL(c.req.url)
    const path = u.pathname
    if (path === '/admin' || path.startsWith('/admin/')) return next()
    if (
      path === '/' ||
      path === '/healthz' ||
      path === '/a' ||
      path === '/site' ||
      path === '/favicon' ||
      path === '/logo' ||
      path === '/favicon.svg' ||
      path === '/favicon.ico'
    )
      return next()
    await adminStore.init()
    const ip = getClientIp(c.req.raw)
    const domain = getSiteDomain(c.req.raw)
    const pre = adminStore.observeStart({ ip, domain, path })
    if (pre.blocked) return buildBlockedResponse(pre.reason)
    await next()
    const res = c.res
    const tracked = (res as any).__jsd_measuredBytes as Promise<number> | undefined
    if (tracked) {
      tracked
        .then((bytes) => {
          adminStore.observeEnd({ ts: Date.now(), path, status: res.status, bytes: Number(bytes || 0) || 0, ip, domain })
        })
        .catch(() => {
          adminStore.observeEnd({ ts: Date.now(), path, status: res.status, bytes: 0, ip, domain })
        })
      return res
    }
    const len = Number(res.headers.get('content-length') || 0) || 0
    adminStore.observeEnd({ ts: Date.now(), path, status: res.status, bytes: len, ip, domain })
    return res
  })

  app.get('/', async (c: Context) => {
    await adminStore.init()
    return c.html(renderHomeHtml(adminStore.getSiteSettings()))
  })
  app.get('/healthz', (c: Context) => c.text('ok'))
  app.get('/favicon', async () => {
    await adminStore.init()
    const site = adminStore.getSiteSettings()
    const asset = adminStore.getSiteAsset('favicon')
    if (asset) return new Response(asset.data, { status: 200, headers: { 'content-type': asset.mime, 'cache-control': 'public, max-age=86400' } })
    const url = String(site.faviconUrl || '').trim()
    if (url) return new Response(null, { status: 302, headers: { location: url } })
    return new Response(faviconSvg, { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } })
  })
  app.get('/logo', async () => {
    await adminStore.init()
    const site = adminStore.getSiteSettings()
    const asset = adminStore.getSiteAsset('logo')
    if (asset) return new Response(asset.data, { status: 200, headers: { 'content-type': asset.mime, 'cache-control': 'public, max-age=86400' } })
    const url = String(site.logoUrl || '').trim()
    if (url) return new Response(null, { status: 302, headers: { location: url } })
    return new Response(logoSvg, { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } })
  })
  app.get('/favicon.svg', (c: Context) => c.redirect('/favicon', 302))
  app.get('/favicon.ico', (c: Context) => c.redirect('/favicon', 302))

  app.get('/a', async (c: Context) => {
    await adminStore.init()
    return c.json({ announcements: adminStore.getAnnouncementsPublic(), format: adminStore.getSiteSettings().announcementFormat })
  })

  app.get('/site', async (c: Context) => {
    await adminStore.init()
    return c.json(adminStore.getSiteSettings())
  })

  app.post('/api/auth/register', async (c: Context) => {
    await auth.init()
    const data = await readJsonBody(c)
    const username = String(data.username ?? '')
    const password = String(data.password ?? '')
    const res = await auth.register(username, password)
    if (!res.ok) return c.json({ ok: false, error: res.error }, 400)
    const login = await auth.login(username, password)
    if (!login.ok) return c.json({ ok: false, error: 'login_failed' }, 500)
    const secure = getSecureFlag(c.req.raw)
    const cookies = auth.buildAuthCookies({ token: login.token, secure })
    const out = c.json({ ok: true, user: login.user })
    out.headers.append('set-cookie', cookies.authCookie)
    out.headers.append('set-cookie', cookies.csrfCookie)
    return out
  })

  app.post('/api/auth/login', async (c: Context) => {
    await auth.init()
    const data = await readJsonBody(c)
    const username = String(data.username ?? '')
    const password = String(data.password ?? '')
    const res = await auth.login(username, password)
    if (!res.ok) return c.json({ ok: false, error: res.error }, 401)
    const secure = getSecureFlag(c.req.raw)
    const cookies = auth.buildAuthCookies({ token: res.token, secure })
    const out = c.json({ ok: true, user: res.user })
    out.headers.append('set-cookie', cookies.authCookie)
    out.headers.append('set-cookie', cookies.csrfCookie)
    return out
  })

  app.post('/api/auth/logout', async (c: Context) => {
    await auth.init()
    if (!requireCsrf(c.req.raw)) return c.json({ ok: false, error: 'csrf' }, 403)
    await auth.logout(c.req.raw)
    const secure = getSecureFlag(c.req.raw)
    const cookies = auth.buildLogoutCookies({ secure })
    const out = c.json({ ok: true })
    out.headers.append('set-cookie', cookies.authCookie)
    out.headers.append('set-cookie', cookies.csrfCookie)
    return out
  })

  app.get('/api/auth/me', async (c: Context) => {
    await auth.init()
    const u = await auth.verify(c.req.raw)
    return c.json({ ok: true, user: u })
  })

  app.get('/api/auth/config', async (c: Context) => {
    await auth.init()
    const count = auth.countUsers()
    return c.json({ ok: true, allowRegister: auth.canPublicRegister(), firstRun: count === 0 })
  })

  app.get('/login', async (c: Context) => {
    await auth.init()
    const u = await auth.verify(c.req.raw)
    if (u) return c.redirect('/account', 302)
    return c.html(renderUserLoginHtml({ allowRegister: auth.canPublicRegister() }))
  })

  app.get('/register', async (c: Context) => {
    await auth.init()
    const u = await auth.verify(c.req.raw)
    if (u) return c.redirect('/account', 302)
    const count = auth.countUsers()
    return c.html(renderUserRegisterHtml({ allowRegister: auth.canPublicRegister(), firstRun: count === 0 }))
  })

  app.get('/account', async (c: Context) => {
    await auth.init()
    const u = await auth.verify(c.req.raw)
    if (!u) return c.redirect('/login', 302)
    return c.html(renderAccountHtml())
  })

  app.get('/admin/login', async (c: Context) => {
    await auth.init()
    if (await isAuthedAdmin(c)) return c.redirect('/admin', 302)
    const allowAdminRegister = auth.countUsers() === 0
    const allowUserRegister = auth.getRegistrationEnabled()
    return c.html(renderAdminLoginHtml({ allowAdminRegister, allowUserRegister }))
  })

  app.post('/admin/login', async (c: Context) => {
    await auth.init()
    const data = await readJsonBody(c)
    const username = String(data.username ?? '')
    const password = String(data.password ?? '')
    const res = await auth.login(username, password)
    if (!res.ok) {
      await adminStore.init()
      adminStore.logEvent({ kind: 'login_fail', ip: getClientIp(c.req.raw) })
      return c.json({ ok: false, error: res.error }, 401)
    }
    if (res.user.role !== 'admin') return c.json({ ok: false, error: 'forbidden' }, 403)
    const secure = getSecureFlag(c.req.raw)
    const cookies = auth.buildAuthCookies({ token: res.token, secure })
    const out = c.json({ ok: true })
    out.headers.append('set-cookie', cookies.authCookie)
    out.headers.append('set-cookie', cookies.csrfCookie)
    return out
  })

  app.get('/admin/register', async (c: Context) => {
    await auth.init()
    if (auth.countUsers() !== 0) return c.json({ error: 'not_found' }, 404)
    return c.html(renderAdminRegisterHtml())
  })

  app.post('/admin/register', async (c: Context) => {
    await auth.init()
    if (auth.countUsers() !== 0) return c.json({ ok: false, error: 'not_allowed' }, 403)
    const data = await readJsonBody(c)
    const username = String(data.username ?? '')
    const password = String(data.password ?? '')
    const res = await auth.register(username, password)
    if (!res.ok) return c.json({ ok: false, error: res.error }, 400)
    const login = await auth.login(username, password)
    if (!login.ok) return c.json({ ok: false, error: 'login_failed' }, 500)
    const secure = getSecureFlag(c.req.raw)
    const cookies = auth.buildAuthCookies({ token: login.token, secure })
    const out = c.json({ ok: true })
    out.headers.append('set-cookie', cookies.authCookie)
    out.headers.append('set-cookie', cookies.csrfCookie)
    return out
  })

  app.post('/admin/logout', async (c: Context) => {
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await auth.logout(c.req.raw)
    const secure = getSecureFlag(c.req.raw)
    const cookies = auth.buildLogoutCookies({ secure })
    const out = c.json({ ok: true })
    out.headers.append('set-cookie', cookies.authCookie)
    out.headers.append('set-cookie', cookies.csrfCookie)
    return out
  })

  app.get('/admin', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.redirect('/admin/login', 302)
    return c.html(adminHtml)
  })

  app.get('/admin/api/overview', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    await adminStore.init()
    return c.json(adminStore.getOverview())
  })

  app.get('/admin/api/version', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    const env = process.env
    return c.json({
      appVersion: String(env.APP_VERSION || ''),
      buildTime: String(env.BUILD_TIME || ''),
      nodeVersion: String(process.version || ''),
      platform: String(process.platform || ''),
      arch: String(process.arch || '')
    })
  })

  app.post('/admin/api/ban', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const res = await adminStore.addBan({
      type: data.type === 'domain' ? 'domain' : 'ip',
      value: String(data.value ?? ''),
      reason: typeof data.reason === 'string' ? data.reason : undefined,
      seconds: typeof data.seconds === 'number' ? data.seconds : undefined,
      createdBy: 'manual'
    })
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json({ ok: true })
  })

  app.post('/admin/api/unban', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const type = data.type === 'domain' ? 'domain' : 'ip'
    await adminStore.removeBan(type, String(data.value ?? ''))
    return c.json({ ok: true })
  })

  app.post('/admin/api/bans/delete', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const list = Array.isArray(data.list) ? data.list : []
    const res = await adminStore.removeBans(list)
    return c.json({ ok: true, deleted: res.deleted })
  })

  app.post('/admin/api/top/clear', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    if (data.all) {
      const res = await adminStore.clearAllTopStats()
      return c.json(res)
    }
    const ips = Array.isArray(data.ips) ? data.ips : []
    const domains = Array.isArray(data.domains) ? data.domains : []
    const r1 = await adminStore.clearIpStats(ips)
    const r2 = await adminStore.clearDomainStats(domains)
    return c.json({ ok: true, clearedIps: r1.cleared, clearedDomains: r2.cleared })
  })

  app.post('/admin/api/traffic/clear', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const hours = Array.isArray(data.hours) ? data.hours : []
    const days = Array.isArray(data.days) ? data.days : []
    const all = !!data.all
    const ips = Array.isArray(data.ips) ? data.ips : []
    const domains = Array.isArray(data.domains) ? data.domains : []
    const res = adminStore.clearTraffic({ hours, days, all, ips, domains })
    return c.json({ ok: true, ...res })
  })

  app.post('/admin/api/events/delete', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const ids = Array.isArray(data.ids) ? data.ids : []
    const res = await adminStore.deleteEvents(ids)
    return c.json({ ok: true, deleted: res.deleted })
  })

  app.post('/admin/api/events/clear', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    if (!data.all) return c.json({ ok: true, deleted: 0 })
    const res = await adminStore.clearAllEvents()
    return c.json({ ok: true, deleted: res.deleted })
  })

  app.post('/admin/api/settings', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const settings = await adminStore.updateSettings(data)
    auth.setRegistrationEnabled(!!settings.registrationEnabled)
    return c.json({ ok: true, settings })
  })

  app.post('/admin/api/site', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const site = await adminStore.updateSiteSettings({
      footerText: data.footerText,
      footerFormat: data.footerFormat,
      title: data.title,
      description: data.description,
      faviconUrl: data.faviconUrl,
      logoUrl: data.logoUrl
    })
    return c.json({ ok: true, site })
  })

  app.post('/admin/api/site-asset', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const kind = data.kind === 'logo' ? 'logo' : 'favicon'
    const parsed = decodeDataUrlToBytes(String(data.dataUrl ?? ''))
    if (!parsed) return c.json({ error: 'invalid_data_url' }, 400)
    const res = await adminStore.setSiteAsset(kind, { mime: parsed.mime, data: parsed.bytes })
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json({ ok: true })
  })

  app.post('/admin/api/site-asset-clear', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const kind = data.kind === 'logo' ? 'logo' : 'favicon'
    await adminStore.clearSiteAsset(kind)
    return c.json({ ok: true })
  })

  app.post('/admin/api/announcements', async (c: Context) => {
    await auth.init()
    if (!(await isAuthedAdmin(c))) return c.json({ error: 'unauthorized' }, 401)
    if (!requireCsrf(c.req.raw)) return c.json({ error: 'csrf' }, 403)
    await adminStore.init()
    const data = await c.req.json().catch(() => ({} as any))
    const list = Array.isArray(data.list) ? data.list : []
    await adminStore.updateSiteSettings({ announcementFormat: data.format })
    const out = await adminStore.setAnnouncements(list)
    return c.json({ ok: true, announcements: out })
  })

  app.get('/gh/*', async (c: Context) => {
    const u = new URL(c.req.url)
    const upstream = `https://cdn.jsdelivr.net${u.pathname}${u.search}`
    return proxyJsDelivr(c, upstream, stableFromJsDelivrPath(u.pathname))
  })

  app.get('/npm/*', async (c: Context) => {
    const u = new URL(c.req.url)
    const upstream = `https://cdn.jsdelivr.net${u.pathname}${u.search}`
    return proxyJsDelivr(c, upstream, stableFromJsDelivrPath(u.pathname))
  })

  app.get('/u', (c: Context) => {
    const url = c.req.query('url') ?? ''
    const result = convertToJsDelivr(url)
    return c.json(result, result.supported ? 200 : 400)
  })

  app.get('/r', (c: Context) => {
    const url = c.req.query('url') ?? ''
    const result = convertToJsDelivr(url)
    if (!result.supported) return c.json(result, 400)
    return c.redirect(result.jsdelivrUrl, 302)
  })

  app.get('/cdn', async (c: Context) => {
    const url = c.req.query('url') ?? ''
    const result = convertToJsDelivr(url)
    if (!result.supported) return c.json(result, 400)
    return proxyJsDelivr(c, result.jsdelivrUrl, result.stable)
  })

  // 404 页面
  app.notFound((c: Context) => {
    const html = renderNotFoundHtml()
    return c.html(html, 404)
  })

  return app
}

export default createNodeApp
