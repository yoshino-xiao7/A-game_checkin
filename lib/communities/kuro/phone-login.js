import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const CAPTCHA_ID = "3f7e2d848ce0cb7e7d019d621e556ce2"
const SESSION_TTL_MS = 10 * 60 * 1000
const sessions = new Map()

function cleanupSessions() {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token)
  }
}

function activeSession(token) {
  cleanupSessions()
  const session = sessions.get(String(token ?? ""))
  return session?.expiresAt > Date.now() ? session : null
}

function loginPage(session) {
  const phone = JSON.stringify(session.phone)
  const deviceCode = JSON.stringify(session.deviceCode)
  const captchaId = JSON.stringify(CAPTCHA_ID)
  const maskedPhone = `${session.phone.slice(0, 3)} **** ${session.phone.slice(-4)}`
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>库街区短信验证</title>
  <script src="https://static.geetest.com/v4/gt4.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      min-height: 100vh; margin: 0; padding: 24px; display: grid; place-items: center;
      color: #edf2ff; font-family: system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at top, #373060, #11131e 62%);
    }
    main {
      width: min(100%, 430px); padding: 28px; border: 1px solid #59517e;
      border-radius: 22px; background: rgba(25, 25, 42, .95);
      box-shadow: 0 20px 70px rgba(0, 0, 0, .38);
    }
    .eyebrow { color: #a99be8; font-size: 12px; font-weight: 700; letter-spacing: 2px; }
    h1 { margin: 7px 0 10px; font-size: 26px; }
    .phone { margin: 18px 0; color: #aeb7ff; font-size: 19px; font-weight: 700; }
    p { color: #b9bdd0; line-height: 1.65; }
    button {
      width: 100%; min-height: 50px; margin-top: 14px; border: 0; border-radius: 13px;
      color: #151326; background: linear-gradient(90deg, #aeb7ff, #c7aaff);
      font-size: 16px; font-weight: 800;
    }
    button:disabled { opacity: .5; }
    #status {
      margin-top: 17px; padding: 13px; border-radius: 11px;
      color: #ccd1e1; background: #171827; line-height: 1.55;
    }
    #status.ok { color: #8ceab4; }
    #status.error { color: #ffabb4; }
    small { display: block; margin-top: 15px; color: #74798c; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">A-GAME CHECKIN</div>
    <h1>库街区手机号登录</h1>
    <div class="phone">${maskedPhone}</div>
    <p>点击按钮并完成库洛使用的滑块验证。验证成功后，本页面会直接请求库洛官方接口发送短信，不需要机器人公网地址。</p>
    <button id="verify" disabled>正在加载验证组件…</button>
    <div id="status">此文件仅用于本次登录，请在十分钟内完成操作。</div>
    <small>验证码不会在网页中提交。收到短信后，请关闭本页并回到机器人私聊直接回复验证码。</small>
  </main>
  <script>
    const phone = ${phone};
    const deviceCode = ${deviceCode};
    const button = document.getElementById("verify");
    const statusBox = document.getElementById("status");
    let captcha;
    let submitting = false;

    function setStatus(message, kind = "") {
      statusBox.textContent = message;
      statusBox.className = kind;
    }

    async function sendSms(validation) {
      if (submitting) return;
      submitting = true;
      button.disabled = true;
      setStatus("验证通过，正在请求库洛发送短信…");
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "devcode": deviceCode,
        "did": deviceCode,
        "distinct_id": deviceCode,
        "source": "android",
        "version": "2.2.1",
        "versioncode": "2210",
        "osversion": "Android",
        "countrycode": "CN",
        "model": "Android",
        "lang": "zh-Hans",
        "channelid": "4",
        "x-requested-with": "com.kurogame.kjq"
      };
      const body = new URLSearchParams({
        mobile: phone,
        geeTestData: JSON.stringify(validation)
      });
      try {
        const response = await fetch("https://api.kurobbs.com/user/getSmsCode", {
          method: "POST",
          headers,
          body,
          credentials: "include"
        });
        const result = await response.json();
        if (!response.ok || Number(result.code) !== 200) {
          throw new Error(result.msg || result.message || "短信发送失败");
        }
        setStatus("短信验证码已发送，请关闭本页并回到机器人私聊回复验证码。", "ok");
        button.textContent = "短信已发送";
      } catch (error) {
        setStatus(error.message || "短信发送失败，请稍后重试。", "error");
        button.disabled = false;
        button.textContent = "重新验证";
        submitting = false;
        if (captcha?.reset) captcha.reset();
      }
    }

    initGeetest4(
      {
        captchaId: ${captchaId},
        product: "bind",
        language: "zho",
        protocol: "https://",
        timeout: 10000
      },
      instance => {
        captcha = instance;
        captcha
          .onReady(() => {
            button.disabled = false;
            button.textContent = "验证并发送短信";
            setStatus("验证组件已准备好。");
          })
          .onSuccess(() => {
            const result = captcha.getValidate();
            if (result) sendSms(result);
            else setStatus("没有取得验证结果，请重试。", "error");
          })
          .onFail(() => setStatus("验证未通过，请重试。", "error"))
          .onError(() => setStatus("验证组件加载失败，请重新打开文件。", "error"));
      }
    );

    button.addEventListener("click", () => {
      if (captcha && !submitting) captcha.showCaptcha();
    });
  </script>
</body>
</html>`
}

export function createKuroPhoneSession(phone, deviceCode) {
  cleanupSessions()
  const normalizedPhone = String(phone ?? "").trim()
  if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) {
    throw new Error("请输入正确的中国大陆手机号")
  }
  const token = crypto.randomBytes(32).toString("base64url")
  const session = {
    token,
    phone: normalizedPhone,
    deviceCode,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  sessions.set(token, session)
  return {
    token,
    phone: normalizedPhone,
    expiresAt: session.expiresAt,
  }
}

export async function createKuroPhoneLoginFile(token, directory) {
  const session = activeSession(token)
  if (!session) throw new Error("库街区登录会话已过期")
  const outputDirectory = path.resolve(directory)
  await fs.mkdir(outputDirectory, { recursive: true })
  const filePath = path.join(
    outputDirectory,
    `A-game_checkin-库街区验证-${session.token.slice(0, 8)}.html`,
  )
  await fs.writeFile(filePath, loginPage(session), "utf8")
  return filePath
}

export function getKuroPhoneSession(token) {
  const session = activeSession(token)
  if (!session) return null
  return {
    token: session.token,
    expiresAt: session.expiresAt,
  }
}

export function finishKuroPhoneSession(token) {
  sessions.delete(String(token ?? ""))
}

export async function loginKuroPhoneSession(adapter, token, code) {
  const session = activeSession(token)
  if (!session) throw new Error("验证码会话已过期")
  return adapter.loginByPhoneCode(session.phone, code, session.deviceCode)
}

export { CAPTCHA_ID as KURO_CAPTCHA_ID }
