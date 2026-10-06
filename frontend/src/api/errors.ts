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
  REAUTH_FAILED: 'पासवर्ड गलत है',
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
  ENTRY_NOT_IN_WARD: 'यह एंट्री इस वार्ड की नहीं है',
  DUPLICATE_CHANGE: 'एक ही एंट्री दो बार चुनी गई है',
  NO_CHANGE: 'कोई बदलाव नहीं — सुधार की ज़रूरत नहीं',
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
