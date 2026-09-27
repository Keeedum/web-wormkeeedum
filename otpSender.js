// language: JavaScript, file: lib/otpSender.js, target: Node 18+
const providers = require('./otpProviders');

const ORDER = [
  'jobbkk', 'theconcert', 'carsome', 'nocnoc', 'freshket',
  'trueShopping', 'hdmall', 'lotuss', 'joox', 'mtsblockchain',
  'makroclick', 'youpik', 'truewallet', 'trueidVacc', 'aisplay',
  'kaitorasap', 'konvy', 'shop1112', 'msport1688', 'ep789bet',
  'theconcertCall', 'jdbaa', 'makroclick2', 'sso', 'tgfone',
  'khonde', 'dtacGaming', 'ch3plus', 'cmtrade', 'bigthailand',
  'instagram',
];

async function sendOtp(phone) {
  for (const name of ORDER) {
    const fn = providers[name];
    if (typeof fn !== 'function') continue;
    try {
      const ok = await fn(phone);
      if (ok) return { ok: true, provider: name };
    } catch (_) { continue; }
  }
  return { ok: false, provider: null };
}

module.exports = { sendOtp };