// 사용법: node tools/build-locked.js <원본(평문).html> <출력.html> <비밀번호>
// 원본의 메뉴 데이터(MENU)를 비밀번호로 암호화(AES-256-GCM, PBKDF2)해서 넣은 잠금 버전을 만든다.
const fs = require('fs'), crypto = require('crypto');
const [,, srcPath, outPath, password] = process.argv;
if (!srcPath || !outPath || !password) { console.error('usage: node build-locked.js src out password'); process.exit(1); }
let s = fs.readFileSync(srcPath, 'utf8');

// 1) 평문 원본에서 MENU 데이터와 앱 코드 분리
const menuRe = /const MENU = (\[[\s\S]*?\]);\n/;
const mm = s.match(menuRe); if (!mm) throw new Error('MENU not found');
const menuJson = mm[1]; JSON.parse(menuJson);
const scriptStart = s.indexOf('<script>\n', s.indexOf('</head>') > 0 ? s.indexOf('<div id="lock">') : 0);
const mainOpen = s.lastIndexOf('<script>');
const mainClose = s.lastIndexOf('</script>');
let app = s.slice(mainOpen + 8, mainClose);
app = app.replace(menuRe, '/* MENU는 비밀번호 입력 후 주입됩니다 */\n');
// 구(기기별) 잠금 코드 제거
const oldStart = app.indexOf('// ===== 비밀번호 잠금');
if (oldStart >= 0) app = app.slice(0, oldStart);
if (app.includes('</script')) throw new Error('app code contains </script');

// 2) 암호화
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 250000;
const key = crypto.pbkdf2Sync(password, salt, iter, 32, 'sha256');
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([c.update(menuJson, 'utf8'), c.final(), c.getAuthTag()]); // WebCrypto 형식(태그가 뒤에 붙음)
const payload = { salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64'), iter };

// 3) 잠금 화면 + 게이트 스크립트
const lockHtml = `<div id="lock"><div class="pwBox">
  <h2>🔒 비밀번호 입력</h2>
  <p>레시피 &amp; 제조 순서 도우미</p>
  <input id="lockInput" type="password" autocomplete="current-password" placeholder="비밀번호">
  <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-weight:600;"><input id="lockRemember" type="checkbox" style="width:auto;" checked> 이 기기에서 기억하기</label>
  <div class="pwErr" id="lockErr"></div>
  <button class="pwBtn" id="lockOk">열기</button>
</div></div>`;
const gate = `
const PAYLOAD = ${JSON.stringify(payload)};
(function(){
  const b64 = t => Uint8Array.from(atob(t), ch => ch.charCodeAt(0));
  const lsGet = k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const lsSet = (k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){} };
  const lsDel = k=>{ try{ localStorage.removeItem(k); }catch(e){} };
  const input = document.getElementById('lockInput'), err = document.getElementById('lockErr');
  async function decrypt(pw){
    if(!(window.crypto && crypto.subtle)) throw new Error('nosubtle');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt:b64(PAYLOAD.salt), iterations:PAYLOAD.iter, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['decrypt']);
    try{
      const buf = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64(PAYLOAD.iv)}, key, b64(PAYLOAD.ct));
      return new TextDecoder().decode(buf);
    }catch(e){ return null; }
  }
  let started = false;
  function start(menuJson){
    if(started) return; started = true;
    const s = document.createElement('script');
    s.textContent = 'const MENU = ' + menuJson + ';\\n' + document.getElementById('appcode').textContent;
    document.body.appendChild(s);
    document.documentElement.classList.remove('locked');
  }
  async function attempt(pw, remember){
    let json;
    try{ json = await decrypt(pw); }
    catch(e){ err.textContent = 'https 주소(배포 사이트)에서 열어주세요'; return false; }
    if(json===null){ err.textContent = '비밀번호가 맞지 않아요'; return false; }
    if(remember){ lsSet('tsAppPw', pw); }
    try{ sessionStorage.setItem('tsAppPw', pw); }catch(e){}
    err.textContent=''; input.value=''; start(json); return true;
  }
  document.getElementById('lockOk').onclick = ()=> attempt(input.value, document.getElementById('lockRemember').checked);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('lockOk').click(); });
  document.getElementById('lockBtn').onclick = ()=>{ lsDel('tsAppPw'); try{ sessionStorage.removeItem('tsAppPw'); }catch(e){} location.reload(); };
  document.getElementById('lockBtn').title = '잠그기';
  // 저장된 비밀번호가 있으면 자동으로 열기 (비밀번호가 바뀌었으면 지우고 입력창 표시)
  (async ()=>{
    let saved = null; try{ saved = sessionStorage.getItem('tsAppPw'); }catch(e){}
    saved = saved || lsGet('tsAppPw');
    if(saved){ const ok = await attempt(saved, false); if(!ok){ lsDel('tsAppPw'); try{ sessionStorage.removeItem('tsAppPw'); }catch(e){} err.textContent=''; } }
  })();
})();
`;

// 4) 조립
let out = s.slice(0, mainOpen) + '<script id="appcode" type="text/plain">' + app + '</script>\n<script>' + gate + '</script>' + s.slice(mainClose + 9);
out = out.replace('<html lang="ko">', '<html lang="ko" class="locked">');
out = out.replace(/<script>try\{ if\(localStorage\.getItem\('tsPwHash'\)[^\n]*<\/script>\n?/, '');
out = out.replace(/<div id="lock">[\s\S]*?<div id="pwDlg"><div class="pwBox" id="pwDlgBox"><\/div><\/div>/, lockHtml);
fs.writeFileSync(outPath, out);
console.log('built', outPath, (out.length/1024).toFixed(0)+'KB');
