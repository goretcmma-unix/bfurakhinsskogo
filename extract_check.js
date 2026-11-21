const fs=require('fs');
const s=fs.readFileSync('public-site/index.html','utf8');
const start=s.indexOf('<script type="module">')+22;
const end=s.indexOf('</script>',start);
const code=s.slice(start,end);
fs.writeFileSync('C:/Users/goret/AppData/Local/Temp/kilo/_tmp.mjs',code);
console.log('len',code.length);
