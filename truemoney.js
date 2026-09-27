// ============================================================
// truemoney.js — รับซองอั่งเปา TrueMoney
// ============================================================
const axios = require('axios');
const https = require('https');

const PHONE = process.env.PAYMENT_PHONE || '0953167272';
const TIMEOUT = 15_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36 Edg/84.0.522.52';

const VOUCHER_URL = 'https://gift.truemoney.com/campaign/vouchers/{}/redeem';

const GIFT_REGEX = /^https:\/\/gift\.truemoney\.com\/campaign\/?\?v=([a-zA-Z0-9]+)$/;

function validateLink(link) {
  if (!link || typeof link !== 'string') return false;
  const clean = link.trim().replace(/\s+/g, '');
  return GIFT_REGEX.test(clean);
}

function extractVoucher(link) {
  if (!link) return null;
  const clean = link.trim().replace(/\s+/g, '');
  const m = clean.match(GIFT_REGEX);
  return m ? m[1] : null;
}

async function redeem(giftLink, phone = PHONE) {
  if (!validateLink(giftLink)) {
    return { success: false, error: 'INVALID_LINK', message: 'รูปแบบลิงก์อั่งเปาไม่ถูกต้อง' };
  }

  const voucher = extractVoucher(giftLink);
  if (!voucher) {
    return { success: false, error: 'INVALID_VOUCHER', message: 'ไม่สามารถดึงรหัสซองได้' };
  }

  const url = VOUCHER_URL.replace('{}', voucher);
  const body = { mobile: String(phone) };

  const httpsAgent = new https.Agent({
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
  });

  try {
    const resp = await axios.post(url, body, {
      timeout: TIMEOUT,
      httpsAgent,
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      validateStatus: () => true,
    });

    const data = resp.data || {};
    const status = data.status || {};
    const code = status.code || '';

    if (code === 'SUCCESS') {
      const ticket = (data.data || {}).my_ticket || {};
      const amountStr = String(ticket.amount_baht || '0').replace(/,/g, '');
      const amount = parseFloat(amountStr) || 0;
      return {
        success: true,
        amount,
        message: `รับเงินสำเร็จ ฿${amount.toFixed(2)}`,
        raw: data,
      };
    }

    const errorMap = {
      VOUCHER_OUT_OF_STOCK:  'ซองนี้ถูกใช้ไปแล้ว',
      VOUCHER_NOT_FOUND:     'ไม่พบซองนี้',
      VOUCHER_EXPIRED:       'ซองหมดอายุแล้ว',
      TARGET_USER_NOT_FOUND: 'ไม่พบเบอร์ผู้รับ',
      TARGET_USER_REDEEMED:  'เบอร์นี้รับซองนี้แล้ว',
      CANNOT_GET_VOUCHER:    'ไม่สามารถรับซองได้',
    };
    const msg = status.message || errorMap[code] || 'รับซองไม่สำเร็จ';
    return { success: false, error: code || 'UNKNOWN', message: msg };

  } catch (e) {
    if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
      return { success: false, error: 'TIMEOUT', message: 'หมดเวลาเชื่อมต่อ' };
    }
    return { success: false, error: 'NETWORK', message: `เชื่อมต่อไม่ได้: ${e.message}` };
  }
}

module.exports = {
  PHONE,
  validateLink,
  extractVoucher,
  redeem,
};