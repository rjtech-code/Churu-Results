// Every error code the backend can send, in Hindi. Unknown codes show a generic message + the code.
import { ApiError, NETWORK_ERROR } from './api';

type Details = Readonly<Record<string, unknown>>;
type Message = string | ((d: Details) => string);

const n = (v: unknown): string => (typeof v === 'number' ? String(v) : '?');

export const ERROR_MESSAGES: Readonly<Record<string, Message>> = {
  // Auth and security
  INVALID_CREDENTIALS: 'गलत यूज़रनेम या पासवर्ड',
  ACCOUNT_LOCKED: (d) =>
    `खाता अस्थायी रूप से बंद है, ${typeof d.retryAfterSeconds === 'number' ? String(Math.ceil(d.retryAfterSeconds / 60)) : 'कुछ'} मिनट बाद प्रयास करें`,
  TOO_MANY_REQUESTS: 'बहुत अधिक प्रयास, थोड़ी देर बाद फिर प्रयास करें',
  SESSION_EXPIRED: 'सत्र समाप्त, दोबारा लॉगिन करें',
  UNAUTHENTICATED: 'कृपया दोबारा लॉगिन करें',
  CSRF_FAILED: 'सुरक्षा जाँच विफल, पेज दोबारा खोलें',
  ORIGIN_REJECTED: 'यह पेज गलत पते से खुला है, सही पते से खोलें',
  FORBIDDEN: 'आपको यह काम करने की अनुमति नहीं है',
  REAUTH_FAILED: 'Incorrect password. कृपया पुनः प्रयास करें।',
  // General
  VALIDATION_FAILED: 'भरी गई जानकारी सही नहीं है, कृपया जाँचें',
  NOT_FOUND: 'जानकारी नहीं मिली',
  'Not found': 'जानकारी नहीं मिली',
  'Internal error': 'सर्वर में गड़बड़ हुई, थोड़ी देर बाद फिर प्रयास करें',
  'Bad request': 'अनुरोध सही नहीं है',
  'Payload too large': 'भेजी गई जानकारी बहुत बड़ी है',
  METHOD_NOT_ALLOWED: 'यह काम यहाँ नहीं हो सकता',
  SNAPSHOT_UNAVAILABLE: 'परिणाम अभी उपलब्ध नहीं हैं',
  TOO_MANY_STREAMS: 'बहुत अधिक स्क्रीन जुड़ी हैं',
  [NETWORK_ERROR]: 'सर्वर से संपर्क नहीं हो सका — नेटवर्क जाँचें',
  // Counting
  BOOTH_NOT_IN_WARD: 'यह बूथ इस वार्ड का नहीं है',
  VOTES_INCOMPLETE: 'हर उम्मीदवार (नोटा सहित) के मत भरें',
  UNKNOWN_CANDIDATE: 'उम्मीदवार इस वार्ड का नहीं है',
  DUPLICATE_CANDIDATE: 'एक उम्मीदवार दो बार भरा गया है',
  SUM_MISMATCH: (d) => `मतों का जोड़ (${n(d.sum)}) पर्ची के योग (${n(d.sheetTotal)}) से मेल नहीं खाता`,
  EXCEEDS_REGISTERED_VOTERS: (d) =>
    `योग (${n(d.sheetTotal)}) बूथ के पंजीकृत मतदाताओं (${n(d.registeredVoters)}) से अधिक है`,
  VOTER_COUNT_MISSING: 'इस बूथ की मतदाता संख्या दर्ज नहीं है',
  BALLOT_NOT_LOCKED: 'इस वार्ड की उम्मीदवार सूची अभी लॉक नहीं है',
  WARD_UNOPPOSED: 'यह वार्ड निर्विरोध है, मतगणना नहीं होगी',
  WARD_DECLARED: 'वार्ड घोषित हो चुका है; बदलाव केवल संशोधन से होगा',
  ALREADY_ENTERED: 'यह बूथ/डाक मत पहले ही दर्ज हो चुका है',
  STALE_VERSION: 'किसी और ने इसे बदल दिया है, पेज दोबारा खोलें',
  // Declare and correction
  ALREADY_DECLARED: 'यह वार्ड पहले ही घोषित है',
  COUNTING_INCOMPLETE: (d) =>
    `सभी बूथ और डाक मत दर्ज नहीं हुए (बूथ ${n(d.boothsEntered)}/${n(d.boothsTotal)}, डाक मत ${d.postalEntered === true ? 'दर्ज' : 'बाकी'})`,
  RESULT_CHANGED: 'परिणाम बदल गया है, कृपया दोबारा जाँचें',
  LOTTERY_REQUIRED: 'बराबरी है — लॉटरी का परिणाम भरें',
  LOTTERY_NOT_ALLOWED: 'बराबरी नहीं है, लॉटरी की आवश्यकता नहीं',
  LOTTERY_WINNER_NOT_TIED: 'लॉटरी विजेता बराबरी वाले उम्मीदवारों में से होना चाहिए',
  NOTA_HIGHEST_ACK_REQUIRED: 'नोटा को सर्वाधिक मत — पुष्टि का बॉक्स चुनें',
  NOT_DECLARED: 'यह वार्ड अभी घोषित नहीं है',
  // Official ward forms (Part-II, Prarup-7)
  DECLARATION_MISMATCH: 'घोषणा के बाद मत बदले हैं — पहले संशोधन करें, फिर फ़ॉर्म निकालें',
  RESULT_UNAVAILABLE: 'इस वार्ड के परिणाम की गणना नहीं हो सकी — डेटा जाँचें',
  TOO_MANY_CANDIDATES: 'उम्मीदवार इतने अधिक हैं कि फ़ॉर्म एक पेज पर नहीं आएगा',
  FORM_DOES_NOT_FIT: 'पते या नाम बहुत लंबे हैं, फ़ॉर्म एक पेज पर नहीं आ रहा — पते छोटे करें',
  ENTRY_NOT_IN_WARD: 'यह एंट्री इस वार्ड की नहीं है',
  DUPLICATE_CHANGE: 'एक ही एंट्री दो बार चुनी गई है',
  NO_CHANGE: 'कोई बदलाव नहीं — सुधार की ज़रूरत नहीं',
  // Part 13: candidate lists, ballot lock, RO accounts, booths and wards
  CHECK_FAILED: 'सूची में गलतियाँ हैं — नीचे दी गई गलतियाँ ठीक करें',
  MASTER_DATA_BUSY: 'कोई और अभी सूची बदल रहा है, थोड़ी देर बाद फिर प्रयास करें',
  NOT_XLSX: 'यह सही Excel (.xlsx) फ़ाइल नहीं है — सही फ़ाइल चुनें',
  FILE_TOO_LARGE: 'फ़ाइल 5 MB से बड़ी है — सही फ़ाइल चुनें',
  BALLOT_LOCKED: 'इस वार्ड की उम्मीदवार सूची लॉक है, अब बदलाव नहीं हो सकता',
  COUNTING_STARTED: 'मतगणना शुरू हो चुकी है, अब बदलाव नहीं हो सकता',
  LOCK_PLAN_CHANGED: 'इस बीच वार्डों की स्थिति बदल गई — पेज दोबारा खोलकर फिर से लॉक करें',
  LOCK_REFUSED: 'कुछ वार्डों में उम्मीदवार नहीं हैं, इसलिए लॉक नहीं हुआ',
  NOTHING_TO_LOCK: 'लॉक करने के लिए कोई वार्ड नहीं बचा',
  UNLOCK_COUNTING_STARTED:
    'इस सूची में मतगणना शुरू हो चुकी है, इसलिए अनलॉक नहीं हो सकती। पहले उस सूची की एंट्री रद्द करें।',
  NOTHING_TO_UNLOCK: 'इस सूची में कोई वार्ड लॉक नहीं है',
  SEAT_TAKEN: 'इस पद पर पहले से खाता है — "RO बदलें" का उपयोग करें',
  LIST_EMPTY: 'सूची खाली है — पहले उम्मीदवार जोड़कर सेव करें',
  BOOTH_NAME_INVALID: 'बूथ का नाम हिंदी में लिखें (300 अक्षरों तक)',
  WARD_NOT_ALLOWED: 'यह वार्ड इस बूथ के लिए नहीं चुना जा सकता',
  CATEGORY_TOO_LONG: 'आरक्षण वर्ग 50 अक्षरों से लंबा है',
  // Part 13: a password the DM types for an RO
  PASSWORD_TOO_SHORT: 'पासवर्ड कम से कम 10 अक्षर का हो',
  PASSWORD_TOO_LONG: 'पासवर्ड 128 अक्षरों से लंबा नहीं हो सकता',
  PASSWORD_NEEDS_LETTER_AND_DIGIT: 'पासवर्ड में कम से कम एक अक्षर और एक अंक हो',
  PASSWORD_HAS_USERNAME: 'पासवर्ड में RO का यूज़रनेम नहीं होना चाहिए',
  PASSWORD_TOO_COMMON: 'यह पासवर्ड बहुत आसान है, कोई दूसरा चुनें',
  NO_COPY: 'पासवर्ड उपलब्ध नहीं — नया पासवर्ड सेट करें',
  USERNAME_INVALID: 'यूज़रनेम 4-30 अक्षर का हो: केवल छोटे अंग्रेज़ी अक्षर, अंक और _',
  USERNAME_TAKEN: 'यह यूज़रनेम पहले से किसी के पास है',
  PASSWORD_MISMATCH: 'दोनों नए पासवर्ड एक जैसे नहीं हैं',
  // DM "मेरी प्रोफ़ाइल" (OTP by email)
  EMAIL_NOT_SET: 'ईमेल सेट नहीं है, कृपया प्रशासक से संपर्क करें',
  MAIL_NOT_CONFIGURED: 'ईमेल सेवा चालू नहीं है',
  MAIL_FAILED: 'ईमेल नहीं भेजा जा सका, थोड़ी देर बाद फिर प्रयास करें',
  OTP_COOLDOWN: (d) => `नया OTP ${n(d.retryAfterSeconds)} सेकंड बाद भेजें`,
  OTP_NOT_SENT: 'पहले "OTP भेजें" दबाएँ और ईमेल पर आया नया OTP भरें',
  OTP_EXPIRED: 'OTP का समय (10 मिनट) खत्म हो गया, नया OTP भेजें',
  OTP_INVALID: (d) => `गलत OTP — ${n(d.attemptsLeft)} कोशिश बाकी`,
  OTP_LOCKED: '5 बार गलत OTP — यह OTP बंद हो गया, नया OTP भेजें',
  // Super Admin panel
  COUNTING_LOCKED: 'Counting Lock ON है — पहले Lock OFF करें',
  PASSWORD_REQUIRED: 'अपना password लिखें (15 मिनट पूरे हो गए)',
  SETUP_NOT_CONFIGURED: 'Server पर backup/reset setup पूरा नहीं है — technical team को बताएँ',
  DM_NOT_FOUND: 'कोई active DM account नहीं है',
  NOT_JSON: 'यह सही JSON file नहीं है — sample file जैसी file चुनें',
  WARD_HAS_ENTRIES: 'इस ward में counting data है — अब booth नहीं बदल सकते',
  BOOTH_EXISTS: 'इस Panchayat Samiti में यह booth no. पहले से है',
  PS_NOT_FOUND: 'Panchayat Samiti नहीं मिली',
  PS_WARD_NOT_FOUND: 'इस Panchayat Samiti में यह PS ward नहीं है',
  ZP_WARD_NOT_FOUND: 'यह ZP ward नहीं है',
  CONFIRM_MISMATCH: 'लिखा गया booth no. match नहीं करता',
};

/** Hindi text for any error (unknown codes: generic text + the code, so it can be reported). */
export function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    const m = ERROR_MESSAGES[err.code];
    if (m === undefined) return `कुछ गड़बड़ हुई (${err.code})`;
    return typeof m === 'function' ? m(err.details) : m;
  }
  return 'कुछ गड़बड़ हुई';
}
