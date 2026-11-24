const fs = require('fs');
const path = 'public-site/index.html';
let content = fs.readFileSync(path, 'utf8');

const oldCss = `/* ===== BUTTONS ===== */
       .donate-overlay { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(7,10,10,0.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.3s ease, visibility 0.3s ease; }
      .donate-overlay.open { opacity: 1; visibility: visible; pointer-events: auto; }
      .donate-modal { width: 100%; max-width: 460px; background: linear-gradient(180deg, var(--bg-elevated) 0%, var(--panel) 100%); border: 1px solid var(--border); border-radius: 20px; padding: 28px; box-shadow: var(--shadow-lg); position: relative; opacity: 0; transform: translateY(-12px); transition: opacity 0.3s ease, transform 0.3s ease; }
      .donate-overlay.open .donate-modal { opacity: 1; transform: translateY(0); }
      .donate-close { position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--muted); cursor: pointer; font-size: 18px; line-height: 1; }
      .donate-close:hover { color: var(--text); border-color: var(--border-strong); }
      .donate-title { font-size: 22px; font-weight: 700; color: var(--text); margin-bottom: 6px; letter-spacing: -0.01em; }
      .donate-sub { font-size: 14px; color: var(--muted); margin-bottom: 20px; line-height: 1.5; }
      .donate-amounts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
      .donate-amt { border: 1px solid var(--border); border-radius: 10px; padding: 10px 6px; background: transparent; color: var(--text-soft); font-size: 14px; font-weight: 600; cursor: pointer; transition: border-color .2s, color .2s, background .2s; }
      .donate-amt:hover { border-color: var(--border-strong); color: var(--text); }
      .donate-amt.active { border-color: rgba(64,222,216,0.55); color: var(--accent); background: var(--accent-soft); }
      .donate-field { width: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; color: var(--text); font-size: 15px; padding: 13px 14px; outline: none; margin-bottom: 12px; transition: border-color .2s, box-shadow .2s; }
      .donate-field:focus { border-color: rgba(64,222,216,0.45); box-shadow: 0 0 0 3px var(--accent-soft); }
      .donate-pay { width: 100%; margin-top: 4px; justify-content: center; }
      .donate-qr { margin-top:16px; padding:16px; background:var(--panel); border:1px solid var(--border); border-radius:14px; text-align:center; display: block; }
      .donate-qr img { max-width: 140px; height: auto; }
      .donate-sbp { width: 100%; margin-top: 12px; padding: 14px; font-size: 15px; font-weight: 600; display: block; }
      @media (max-width: 640px) {
        .donate-amounts { grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .donate-modal { padding: 20px; max-width: 100%; }
      }
      @media (max-width: 480px) {
        .donate-amt { padding: 12px 8px; font-size: 13px; }
        .donate-modal { padding: 16px; max-width: 100%; }
      }
      .donate-note { margin-top: 12px; font-size: 12px; color: var(--muted); line-height: 1.5; text-align: center; }
      .donate-note a { color: var(--accent); }`;

const newCss = `/* ===== BUTTONS ===== */
       .donate-overlay { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(7,10,10,0.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.3s ease, visibility 0.3s ease; }
      .donate-overlay.open { opacity: 1; visibility: visible; pointer-events: auto; }
      .donate-modal { width: 100%; max-width: 460px; background: linear-gradient(180deg, var(--bg-elevated) 0%, var(--panel) 100%); border: 1px solid var(--border); border-radius: 20px; padding: 28px; box-shadow: var(--shadow-lg); position: relative; opacity: 0; transform: translateY(-12px); transition: opacity 0.3s ease, transform 0.3s ease; }
      .donate-overlay.open .donate-modal { opacity: 1; transform: translateY(0); }
      .donate-modal-handle { display: none; width: 40px; height: 4px; background: var(--border-strong); border-radius: 2px; margin: 0 auto 20px; }
      .donate-close { position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--muted); cursor: pointer; font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center; }
      .donate-close:hover { color: var(--text); border-color: var(--border-strong); }
      .donate-title { font-size: 22px; font-weight: 700; color: var(--text); margin-bottom: 6px; letter-spacing: -0.01em; }
      .donate-sub { font-size: 14px; color: var(--muted); margin-bottom: 20px; line-height: 1.5; }
      .donate-amounts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
      .donate-amt { border: 1px solid var(--border); border-radius: 10px; padding: 10px 6px; background: transparent; color: var(--text-soft); font-size: 14px; font-weight: 600; cursor: pointer; transition: border-color .2s, color .2s, background .2s; }
      .donate-amt:hover { border-color: var(--border-strong); color: var(--text); }
      .donate-amt.active { border-color: rgba(64,222,216,0.55); color: var(--accent); background: var(--accent-soft); }
      .donate-field { width: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; color: var(--text); font-size: 15px; padding: 13px 14px; outline: none; margin-bottom: 12px; transition: border-color .2s, box-shadow .2s; }
      .donate-field:focus { border-color: rgba(64,222,216,0.45); box-shadow: 0 0 0 3px var(--accent-soft); }
      
      .donate-payment-methods { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
      .donate-pay { width: 100%; justify-content: center; margin: 0; }
      .donate-sbp { width: 100%; margin: 0; padding: 14px; font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; background: #000; color: #fff; border: 1px solid #333; border-radius: 14px; cursor: pointer; }
      .donate-sbp img { height: 20px; }
      
      .donate-qr-toggle { background: transparent; border: 1px solid var(--border); border-radius: 12px; color: var(--text-soft); padding: 10px; font-size: 13px; width: 100%; cursor: pointer; margin-top: 10px; transition: all 0.2s; }
      .donate-qr-toggle:hover { border-color: var(--border-strong); color: var(--text); }
      .donate-qr-container { display: none; margin-top:12px; padding:16px; background:var(--panel); border:1px solid var(--border); border-radius:14px; text-align:center; }
      .donate-qr-container.active { display: block; }
      .donate-qr-container img { max-width: 140px; height: auto; margin: 0 auto 8px; display: block; }
      
      @media (max-width: 640px) {
        .donate-overlay { align-items: flex-end; padding: 0; }
        .donate-modal { 
          max-width: 100%; 
          border-radius: 24px 24px 0 0; 
          padding: 16px 20px 32px; 
          transform: translateY(100%);
          transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease;
        }
        .donate-overlay.open .donate-modal { transform: translateY(0); }
        .donate-modal-handle { display: block; }
        .donate-amounts { grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .donate-close { top: 16px; right: 16px; }
        .donate-title { font-size: 20px; }
        .donate-sub { font-size: 13px; margin-bottom: 16px; }
      }
      
      @media (max-width: 480px) {
        .donate-amt { padding: 12px 8px; font-size: 13px; }
        .donate-modal { padding: 12px 16px 24px; }
      }
      .donate-note { margin-top: 16px; font-size: 11px; color: var(--muted); line-height: 1.4; text-align: center; }
      .donate-note a { color: var(--accent); }`;

const oldHtml = `    <div class="donate-overlay" id="donateOverlay" aria-hidden="true">
      <div class="donate-modal" role="dialog" aria-modal="true" aria-labelledby="donateTitle">
        <button type="button" class="donate-close" id="donateClose" aria-label="Закрыть">×</button>
        <h2 class="donate-title" id="donateTitle">Пожертвование фонду</h2>
        <p class="donate-sub">Выберите сумму и перейдите к безопасной оплате. Средства пойдут на текущие программы и срочные сборы.</p>
        <div class="donate-amounts" role="group" aria-label="Сумма">
          <button type="button" class="donate-amt" data-amount="500">500 ₽</button>
          <button type="button" class="donate-amt active" data-amount="1000">1 000 ₽</button>
          <button type="button" class="donate-amt" data-amount="3000">3 000 ₽</button>
          <button type="button" class="donate-amt" data-amount="5000">5 000 ₽</button>
        </div>
        <label class="visually-hidden" for="donateAmount">Другая сумма, ₽</label>
        <input class="donate-field" id="donateAmount" type="number" min="50" step="50" inputmode="numeric" value="1000" placeholder="Другая сумма, ₽">
        <label class="visually-hidden" for="donateName">Имя (необязательно)</label>
        <input class="donate-field" id="donateName" type="text" autocomplete="name" placeholder="Имя (необязательно, для отчёта)">
        <button type="button" class="btn-primary donate-pay" id="donatePay">Перейти к оплате</button>
        <div class="donate-qr" style="margin-top:16px; padding:16px; background:var(--panel); border:1px solid var(--border); border-radius:14px; text-align:center;">
          <img src="qr.png" alt="QR-код для оплаты" style="width:120px; height:120px; display:block; margin:0 auto 8px;" />
          <div style="font-size:13px; color:var(--muted-strong);">Отсканируйте для оплаты</div>
        </div>
        <button type="button" class="btn-primary donate-sbp" id="donateSbp" style="margin-top:12px; padding:14px; font-size:15px; font-weight:600;">Оплатить через СБП</button>
        <p class="donate-note">Для приёма реальных платежей подключите платёжную ссылку/виджет (ЮKassa, CloudPayments, Stripe и т.п.) в <code>DONATE_PAYMENT_URL</code> в этом файле. Сейчас откроются реквизиты/контакт фонда.</p>
      </div>
    </div>`;

const newHtml = `    <div class="donate-overlay" id="donateOverlay" aria-hidden="true">
      <div class="donate-modal" role="dialog" aria-modal="true" aria-labelledby="donateTitle">
        <div class="donate-modal-handle"></div>
        <button type="button" class="donate-close" id="donateClose" aria-label="Закрыть">×</button>
        <h2 class="donate-title" id="donateTitle">Пожертвование</h2>
        <p class="donate-sub">Ваша помощь важна. Выберите сумму для пожертвования.</p>
        
        <div class="donate-amounts" role="group" aria-label="Сумма">
          <button type="button" class="donate-amt" data-amount="500">500 ₽</button>
          <button type="button" class="donate-amt active" data-amount="1000">1 000 ₽</button>
          <button type="button" class="donate-amt" data-amount="3000">3 000 ₽</button>
          <button type="button" class="donate-amt" data-amount="5000">5 000 ₽</button>
        </div>
        
        <label class="visually-hidden" for="donateAmount">Другая сумма, ₽</label>
        <input class="donate-field" id="donateAmount" type="number" min="50" step="50" inputmode="numeric" value="1000" placeholder="Другая сумма, ₽">
        
        <label class="visually-hidden" for="donateName">Имя (необязательно)</label>
        <input class="donate-field" id="donateName" type="text" autocomplete="name" placeholder="Имя (необязательно, для отчёта)">
        
        <div class="donate-payment-methods">
          <button type="button" class="btn-primary donate-pay" id="donatePay">Банковская карта</button>
          <button type="button" class="donate-sbp" id="donateSbp">
            <img src="https://sbp.nspk.ru/assets/img/logo-sbp.svg" alt="СБP" onerror="this.src='qr.png'; this.style.height='30px';">
            Оплатить через СБП
          </button>
        </div>
        
        <button type="button" class="donate-qr-toggle" id="donateQrToggle">Показать QR-код для оплаты</button>
        <div class="donate-qr-container" id="donateQrContainer">
          <img src="qr.png" alt="QR-код для оплаты" />
          <div style="font-size:13px; color:var(--muted-strong);">Отсканируйте камерой телефона</div>
        </div>
        
        <p class="donate-note">Безопасный платёж. <a href="#">Оферта</a> и <a href="#">политика конфиденциальности</a>.</p>
      </div>
    </div>`;

content = content.replace(oldCss, newCss);
content = content.replace(oldHtml, newHtml);

const oldJs = `        const sbpBtn = document.getElementById('donateSbp');
        sbpBtn && sbpBtn.addEventListener('click', () => {
          const amount = Math.max(50, Number(amountInput && amountInput.value) || 1000);
          const name = (document.getElementById('donateName') || {}).value || '';
          const sbpUrl = 'https://pay.spb.ru/' + encodeURIComponent(amount) + (name ? '?name=' + encodeURIComponent(name) : '');
          window.open(sbpUrl, '_blank', 'noopener');
        });
      }`;

const newJs = `        const sbpBtn = document.getElementById('donateSbp');
        sbpBtn && sbpBtn.addEventListener('click', () => {
          const amount = Math.max(50, Number(amountInput && amountInput.value) || 1000);
          const name = (document.getElementById('donateName') || {}).value || '';
          const sbpUrl = 'https://pay.spb.ru/' + encodeURIComponent(amount) + (name ? '?name=' + encodeURIComponent(name) : '');
          window.open(sbpUrl, '_blank', 'noopener');
        });
        
        const qrToggle = document.getElementById('donateQrToggle');
        const qrContainer = document.getElementById('donateQrContainer');
        if (qrToggle && qrContainer) {
          qrToggle.addEventListener('click', () => {
            const isActive = qrContainer.classList.toggle('active');
            qrToggle.textContent = isActive ? 'Скрыть QR-код' : 'Показать QR-код для оплаты';
          });
        }
      }`;

content = content.replace(oldJs, newJs);

fs.writeFileSync(path, content);
console.log('Success');
