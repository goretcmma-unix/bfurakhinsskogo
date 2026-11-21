import time, sys

path = r"C:\Users\goret\OneDrive\Рабочий стол\Dashboard Charity\public-site\index.html"

new_block = """      @media (max-width: 640px) {
        .donate-overlay { align-items: flex-end; padding: 0; }
        .donate-modal {
          max-width: 100%;
          max-height: 100%;
          overflow: hidden;
          border-radius: 24px 24px 0 0;
          padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px));
          transform: translateY(100%);
          transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease;
        }
        .donate-overlay.open .donate-modal { transform: translateY(0); }
        .donate-modal-handle { display: block; margin-bottom: 10px; }
        .donate-close { top: 12px; right: 12px; width: 30px; height: 30px; }
        .donate-title { font-size: 18px; margin-bottom: 2px; }
        .donate-sub { font-size: 12px; margin-bottom: 10px; line-height: 1.4; }
        .donate-amounts { grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 8px; }
        .donate-amt { padding: 10px 8px; font-size: 13px; }
        .donate-fields-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
        .donate-fields-row .donate-field { margin-bottom: 0; padding: 11px 12px; font-size: 14px; }
        .donate-payment-methods { gap: 8px; margin-top: 6px; }
        .donate-pay { padding: 12px; font-size: 14px; }
        .donate-sbp { padding: 12px; font-size: 14px; }
        .donate-qr-toggle { margin-top: 8px; padding: 9px; font-size: 12px; }
        .donate-qr-container { margin-top: 8px; padding: 12px; }
        .donate-qr-container img { max-width: 110px; }
        .donate-note { margin-top: 8px; font-size: 10px; }
        .donate-modal.qr-open .donate-amounts,
        .donate-modal.qr-open .donate-fields-row,
        .donate-modal.qr-open .donate-payment-methods { display: none; }
      }

      @media (max-width: 640px) and (max-height: 480px) {
        .donate-sub { display: none; }
        .donate-note { display: none; }
        .donate-modal { padding-top: 8px; }
      }
"""

with open(path, encoding='utf-8') as f:
    lines = f.readlines()

assert lines[1064].strip() == "@media (max-width: 640px) {", lines[1064]
assert lines[1084].strip() == "}", lines[1084]
assert lines[1085].strip().startswith(".donate-note"), lines[1085]

result = lines[:1064] + [new_block] + lines[1085:]

for attempt in range(5):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(result)
        print("written ok, attempts:", attempt + 1)
        break
    except OSError as e:
        print("retry", attempt, e)
        time.sleep(2)
else:
    sys.exit("failed to write")
