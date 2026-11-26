text=open('src-site/index.html',encoding='utf-8',errors='ignore').read()
i=text.find("const overlay = document.getElementById('donateOverlay')")
open('scripts/_tmp_donate_init.txt','w',encoding='utf-8').write(text[i:i+1800])
