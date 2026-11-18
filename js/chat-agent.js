/* mhzaly Website Chat Agent — no phone number, no third-party key.
   Loads on public pages, posts to /api/chat, stores leads in D1.
   Session id is random + kept in localStorage (no PII in the id). */
(() => {
  const API = 'https://mhzaly-api.mhzaly.workers.dev/api/chat';
  const KEY = 'mhzaly-chat-session';
  let session = localStorage.getItem(KEY);
  if (!session) {
    session = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(KEY, session);
  }

  const style = document.createElement('style');
  style.textContent = `
    #mhzaly-chat-launch{position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;
      background:#25d366;color:#fff;border:none;font-size:26px;cursor:pointer;z-index:9998;
      box-shadow:0 6px 22px rgba(0,0,0,.28)}
    #mhzaly-chat-box{position:fixed;right:18px;bottom:84px;width:min(360px,calc(100vw - 36px));
      max-height:min(520px,calc(100vh - 110px));background:#fff;color:#0f172a;border-radius:16px;
      box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:9999;display:none;flex-direction:column;overflow:hidden;
      font-family:system-ui,Segoe UI,sans-serif}
    #mhzaly-chat-box.open{display:flex}
    #mhzaly-chat-head{background:#0f172a;color:#fff;padding:12px 14px;font-size:14px;font-weight:700;
      display:flex;justify-content:space-between;align-items:center}
    #mhzaly-chat-head button{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}
    #mhzaly-chat-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.5}
    .mz-msg{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}
    .mz-msg.bot{background:#eef2f7;align-self:flex-start}
    .mz-msg.user{background:#d9f7e4;align-self:flex-end}
    #mhzaly-chat-form{display:flex;border-top:1px solid #e2e8f0}
    #mhzaly-chat-input{flex:1;border:none;padding:12px;font-size:14px;outline:none}
    #mhzaly-chat-form button{background:#25d366;color:#fff;border:none;padding:0 16px;font-weight:700;cursor:pointer}
    #mhzaly-chat-note{font-size:11px;color:#64748b;padding:0 12px 8px}
  `;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.id = 'mhzaly-chat-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'mhzaly sales agent');
  box.innerHTML = `
    <div id="mhzaly-chat-head"><span>mhzaly Agent 👋</span><button type="button" aria-label="Close">×</button></div>
    <div id="mhzaly-chat-log"><div class="mz-msg bot">Assalam o Alaikum! Main mhzaly ka agent hoon. 1 din ka free demo, pricing ya payment — kya jaanna chahate hain?</div></div>
    <form id="mhzaly-chat-form"><input id="mhzaly-chat-input" placeholder="Apna sawal likhein..." autocomplete="off" />
      <button type="submit">Send</button></form>
    <div id="mhzaly-chat-note">Powered by mhzaly · email bata dein to direct reply bhi mil jayega</div>`;
  document.body.appendChild(box);

  const launch = document.createElement('button');
  launch.id = 'mhzaly-chat-launch';
  launch.setAttribute('aria-label', 'Chat with mhzaly agent');
  launch.textContent = '💬';
  document.body.appendChild(launch);

  const log = box.querySelector('#mhzaly-chat-log');
  const form = box.querySelector('#mhzaly-chat-form');
  const input = box.querySelector('#mhzaly-chat-input');
  launch.onclick = () => box.classList.toggle('open');
  box.querySelector('#mhzaly-chat-head button').onclick = () => box.classList.remove('open');

  const add = (text, who) => {
    const d = document.createElement('div');
    d.className = 'mz-msg ' + who;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    add(text, 'user');
    input.value = '';
    const typing = document.createElement('div');
    typing.className = 'mz-msg bot';
    typing.textContent = '...';
    log.appendChild(typing);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: session,
          message: text,
          shop: document.title || '',
          city: new URLSearchParams(location.search).get('city') || '',
        }),
      });
      const data = await res.json();
      typing.textContent = data.reply || 'Abhi reply nahi mila — thodi der baad koshish karein.';
    } catch {
      typing.textContent = 'Network issue — thodi der baad retry karein ya email karein: mhzcyb@gmail.com';
    }
    log.scrollTop = log.scrollHeight;
  };
})();
